import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronFirst, ChevronLast, LoaderCircle, Pause, Play, SkipBack, SkipForward, TriangleAlert } from 'lucide-react'
import { buildReplay, editEvents, filePathOf, type BaseSource, type ReplayStep } from '@shared/replay'
import { computeLineEdits } from '@shared/lineEdits'
import { languageForPath, monaco } from '@/lib/monaco'
import { typeEdits } from '@/lib/typewriter'
import { FileIcon } from '@/lib/fileIcons'
import { clock } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { invoke } from '@/lib/ipc'
import * as P from '@/lib/paths'
import { useApp } from '@/state/app'
import { useEditors } from '@/state/editors'
import { useSessions } from '@/state/sessions'
import { editorOptions } from '@/components/editor/CodeEditorHost'

const SPEEDS = [0.5, 1, 2, 4, 8]

export function ReplayPage({ sessionId }: { sessionId: string }) {
  const t = useT()
  const data = useSessions((s) => s.data[sessionId])
  const root = useApp((s) => s.workspace?.root ?? null)
  const [steps, setSteps] = useState<ReplayStep[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const hostRef = useRef<HTMLDivElement>(null)
  const edRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const models = useRef(new Map<string, monaco.editor.ITextModel>())
  const decos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const playToken = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!useSessions.getState().data[sessionId]) void useSessions.getState().open(sessionId)
  }, [sessionId])

  // build the reconstruction once the session is loaded
  const editCount = useMemo(() => (data ? editEvents(data.events).length : 0), [data])
  useEffect(() => {
    if (!data) return
    let cancelled = false
    void (async () => {
      try {
        const edits = editEvents(data.events)
        const paths = [...new Map(edits.map((e) => [filePathOf(e)!.toLowerCase().replace(/\//g, '\\'), filePathOf(e)!])).values()]
        const bases = new Map<string, BaseSource>()
        await Promise.all(
          paths.map(async (p) => {
            const k = p.toLowerCase().replace(/\//g, '\\')
            const fc = data.files.find((f) => P.samePath(f.path, p))
            if (fc?.created) bases.set(k, { backup: null })
            else if (fc?.backup) {
              const text = await invoke('sessions:backup', sessionId, fc.backup)
              if (text !== null) bases.set(k, { backup: text })
            }
            if (!bases.has(k)) {
              const c = await invoke('fs:readFile', p)
              bases.set(k, { disk: c.kind === 'text' ? c.text : null })
            }
          })
        )
        if (cancelled) return
        const s = buildReplay(data.events, bases)
        setSteps(s)
        setIndex(Math.max(0, s.length - 1))
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    })()
    return () => {
      cancelled = true
    }
    // rebuild only when the number of edits changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, editCount, !!data])

  // editor
  useEffect(() => {
    const ed = monaco.editor.create(hostRef.current!, { ...editorOptions(useApp.getState().settings.editor), readOnly: true, model: null, minimap: { enabled: false }, theme: 'clauditor' })
    edRef.current = ed
    decos.current = ed.createDecorationsCollection([])
    const m = models.current
    return () => {
      ed.dispose()
      for (const model of m.values()) model.dispose()
      m.clear()
    }
  }, [])

  const modelFor = (path: string): monaco.editor.ITextModel => {
    const k = P.key(path)
    let m = models.current.get(k)
    if (!m) {
      m = monaco.editor.createModel('', languageForPath(path), monaco.Uri.parse(`clauditor-replay:/${sessionId}/${models.current.size}/${encodeURIComponent(P.basename(path))}`))
      models.current.set(k, m)
    }
    return m
  }

  const decorate = (step: ReplayStep, model: monaco.editor.ITextModel) => {
    const { change } = computeLineEdits(step.before, step.after, model.getEOL())
    const max = model.getLineCount()
    const clamp = (n: number) => Math.max(1, Math.min(max, n))
    decos.current?.set([
      ...change.added.map(([a, b]) => ({ range: new monaco.Range(clamp(a), 1, clamp(b), 1), options: { isWholeLine: true, className: 'replay-added', linesDecorationsClassName: 'claude-gutter' } })),
      ...change.removedAt.map((n) => ({ range: new monaco.Range(clamp(n), 1, clamp(n), 1), options: { linesDecorationsClassName: 'claude-gutter-removed' } }))
    ])
    const first = change.added[0]?.[0] ?? change.removedAt[0]
    if (first) edRef.current?.revealLineInCenterIfOutsideViewport(first, monaco.editor.ScrollType.Smooth)
  }

  // show a step instantly (when not playing)
  useEffect(() => {
    if (!steps || !steps[index] || playing) return
    const step = steps[index]
    const ed = edRef.current
    if (!ed) return
    const model = modelFor(step.path)
    if (model.getValue() !== step.after) model.setValue(step.after)
    if (ed.getModel() !== model) ed.setModel(model)
    decorate(step, model)
    listRef.current?.querySelector(`[data-step="${index}"]`)?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, index, playing])

  // playback loop
  useEffect(() => {
    if (!playing || !steps) return
    const token = ++playToken.current
    void (async () => {
      let i = index >= steps.length - 1 ? 0 : index + 1
      while (playToken.current === token && i < steps.length) {
        const step = steps[i]
        const ed = edRef.current
        if (!ed) break
        const model = modelFor(step.path)
        if (ed.getModel() !== model) ed.setModel(model)
        if (model.getValue() !== step.before) model.setValue(step.before)
        setIndex(i)
        listRef.current?.querySelector(`[data-step="${i}"]`)?.scrollIntoView({ block: 'nearest' })
        const { edits } = computeLineEdits(step.before, step.after, model.getEOL())
        await typeEdits(ed, model, edits, { path: `replay:${step.path}`, maxMs: 1400 / speed })
        if (model.getValue() !== step.after) model.setValue(step.after)
        decorate(step, model)
        await new Promise((r) => setTimeout(r, 650 / speed))
        i++
      }
      if (playToken.current === token) setPlaying(false)
    })()
    return () => {
      playToken.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, steps])

  const step = steps?.[index]
  const go = (i: number) => {
    setPlaying(false)
    if (steps) setIndex(Math.max(0, Math.min(steps.length - 1, i)))
  }

  return (
    <div className="page replay">
      <div className="replay-bar">
        <div className="replay-transport">
          <button className="icon-btn" data-tip={t('First step')} onClick={() => go(0)} disabled={!steps?.length}>
            <ChevronFirst size={16} />
          </button>
          <button className="icon-btn" data-tip={t('Previous step')} onClick={() => go(index - 1)} disabled={!steps?.length}>
            <SkipBack size={15} />
          </button>
          <button className="replay-play" onClick={() => setPlaying(!playing)} disabled={!steps?.length} data-tip={playing ? t('Pause') : t('Play')}>
            {playing ? <Pause size={16} fill="currentColor" strokeWidth={0} /> : <Play size={16} fill="currentColor" strokeWidth={0} />}
          </button>
          <button className="icon-btn" data-tip={t('Next step')} onClick={() => go(index + 1)} disabled={!steps?.length}>
            <SkipForward size={15} />
          </button>
          <button className="icon-btn" data-tip={t('Last step')} onClick={() => go((steps?.length ?? 1) - 1)} disabled={!steps?.length}>
            <ChevronLast size={16} />
          </button>
        </div>
        <input
          className="replay-scrub"
          type="range"
          min={0}
          max={Math.max(0, (steps?.length ?? 1) - 1)}
          value={index}
          onChange={(e) => go(Number(e.target.value))}
          disabled={!steps?.length}
        />
        <span className="replay-count">{steps ? `${steps.length ? index + 1 : 0} / ${steps.length}` : '…'}</span>
        <select className="input replay-speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} data-tip={t('Speed')}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>
      <div className="replay-body">
        <div className="replay-steps" ref={listRef}>
          {!steps && !error && (
            <div className="empty-state">
              <LoaderCircle size={18} className="spin" /> {t('Reconstructing file history…')}
            </div>
          )}
          {error && <div className="empty-state">{error}</div>}
          {steps?.length === 0 && <div className="empty-state">{t('No file edits in this session.')}</div>}
          {steps?.map((s) => (
            <button key={s.index} data-step={s.index} className={`replay-step${s.index === index ? ' active' : ''}${s.index > index ? ' future' : ''}`} onClick={() => go(s.index)}>
              <span className="replay-step-n">{s.index + 1}</span>
              <FileIcon name={P.basename(s.path)} size={14} />
              <span className="replay-step-name truncate">{P.basename(s.path)}</span>
              <span className="replay-step-delta">
                {s.added > 0 && <span className="plus">+{s.added}</span>}
                {s.removed > 0 && <span className="minus">−{s.removed}</span>}
              </span>
              {!s.exact && <TriangleAlert size={12} className="replay-inexact" />}
            </button>
          ))}
        </div>
        <div className="replay-main">
          {step && (
            <div className="replay-file">
              <FileIcon name={P.basename(step.path)} size={15} />
              <button className="crumb-btn truncate" onClick={() => useEditors.getState().openFile(step.path, { preview: true })} data-tip={t('Open current version')}>
                {P.displayPath(step.path, root ?? data?.cwd)}
              </button>
              <span className="chip">{step.tool === 'Write' ? (step.before ? t('Rewrite') : t('Create file')) : step.tool === 'MultiEdit' ? t('Multi-edit') : t('Edit')}</span>
              <span className="faint">{clock(step.ts, true)}</span>
              {!step.exact && (
                <span className="replay-warn" data-tip={t('The file content before this step was not fully recorded, so the view may differ slightly from the original.')}>
                  <TriangleAlert size={13} /> {t('approximate')}
                </span>
              )}
            </div>
          )}
          <div className="monaco-host" ref={hostRef} />
        </div>
      </div>
    </div>
  )
}
