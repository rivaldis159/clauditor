import { useEffect, useRef, useState } from 'react'
import { diffLines } from 'diff'
import { FileWarning, ImageOff, RefreshCw, TriangleAlert } from 'lucide-react'
import type { EditorSettings } from '@shared/types'
import { monaco } from '@/lib/monaco'
import * as P from '@/lib/paths'
import { bytes } from '@/lib/format'
import { docChanges, fsTouched } from '@/lib/bus'
import { invoke } from '@/lib/ipc'
import { tk, useT } from '@/lib/i18n'
import { useApp } from '@/state/app'
import { useEditors, type Tab } from '@/state/editors'
import { getDoc, isDirty, openDoc, reloadDoc, keepMine, saveDoc, type Doc } from '@/state/documents'
import { registerEditor } from '@/state/editorActions'
import { useEditorStatus } from '@/state/status'
import { pushSelection } from '@/state/ide'
import { useActivity } from '@/state/activity'
import { useGit } from '@/state/git'
import { ImagePreview } from './ImagePreview'

type FileTab = Extract<Tab, { kind: 'file' }>

type LoadState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; doc: Doc } | { kind: 'binary' | 'image' | 'too-large' | 'missing' | 'error'; size: number }

export function editorOptions(s: EditorSettings): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    fontLigatures: s.fontLigatures,
    tabSize: s.tabSize,
    insertSpaces: s.insertSpaces,
    detectIndentation: true,
    wordWrap: s.wordWrap,
    minimap: { enabled: s.minimap, renderCharacters: false, maxColumn: 90, scale: 1, showSlider: 'mouseover' },
    lineNumbers: s.lineNumbers,
    renderWhitespace: s.renderWhitespace,
    stickyScroll: { enabled: s.stickyScroll },
    smoothScrolling: s.smoothScrolling,
    bracketPairColorization: { enabled: s.bracketPairColorization },
    guides: { bracketPairs: 'active', indentation: true, highlightActiveIndentation: true },
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    cursorWidth: 2,
    roundedSelection: true,
    renderLineHighlight: 'all',
    padding: { top: 10, bottom: 10 },
    scrollBeyondLastLine: true,
    fixedOverflowWidgets: true,
    mouseWheelZoom: true,
    glyphMargin: false,
    folding: true,
    showFoldingControls: 'mouseover',
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    scrollbar: { verticalScrollbarSize: 12, horizontalScrollbarSize: 12, useShadows: false, verticalSliderSize: 8, horizontalSliderSize: 8 },
    unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: true },
    automaticLayout: true,
    'semanticHighlighting.enabled': true,
    inlayHints: { enabled: 'offUnlessPressed' },
    suggest: { showStatusBar: true, preview: true },
    quickSuggestions: { other: true, comments: false, strings: false },
    linkedEditing: true,
    colorDecorators: true,
    dragAndDrop: true,
    contextmenu: true
  }
}

/** Claude's cursor: a small ember caret with a name tag, glued to the edit position. */
class ClaudeCursorWidget implements monaco.editor.IContentWidget {
  private node: HTMLElement
  private pos: monaco.IPosition = { lineNumber: 1, column: 1 }
  allowEditorOverflow = false
  constructor() {
    this.node = document.createElement('div')
    this.node.className = 'claude-cursor'
    this.node.innerHTML = '<span class="claude-caret"></span><span class="claude-tag">Claude</span>'
  }
  getId() {
    return 'clauditor.claude.cursor'
  }
  getDomNode() {
    return this.node
  }
  getPosition() {
    return { position: this.pos, preference: [monaco.editor.ContentWidgetPositionPreference.EXACT] }
  }
  move(p: monaco.IPosition) {
    this.pos = p
    this.node.classList.remove('fading')
  }
  fade() {
    this.node.classList.add('fading')
  }
}

const claudeDecos = new WeakMap<monaco.editor.ITextModel, string[]>()
const gitDecos = new WeakMap<monaco.editor.ITextModel, string[]>()

function applyClaudeDecorations(model: monaco.editor.ITextModel, added: [number, number][], removedAt: number[]) {
  const max = model.getLineCount()
  const clamp = (n: number) => Math.max(1, Math.min(max, n))
  const flash: monaco.editor.IModelDeltaDecoration[] = []
  for (const [a, b] of added) {
    if (b < a) continue
    flash.push({
      range: new monaco.Range(clamp(a), 1, clamp(b), 1),
      options: {
        isWholeLine: true,
        className: 'claude-line-flash',
        linesDecorationsClassName: 'claude-gutter',
        overviewRuler: { color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), position: monaco.editor.OverviewRulerLane.Left },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }
    })
  }
  for (const n of removedAt) {
    flash.push({ range: new monaco.Range(clamp(n), 1, clamp(n), 1), options: { linesDecorationsClassName: 'claude-gutter-removed' } })
  }
  const prev = claudeDecos.get(model) ?? []
  // keep earlier gutter marks, add the new flashing ones
  const ids = model.deltaDecorations([], flash)
  claudeDecos.set(model, [...prev, ...ids])
  // after the flash, replace with persistent gutter-only marks (avoids replays on scroll)
  window.setTimeout(() => {
    if (model.isDisposed()) return
    const persistent: monaco.editor.IModelDeltaDecoration[] = []
    for (const id of ids) {
      const r = model.getDecorationRange(id)
      const opts = model.getDecorationOptions(id)
      if (!r) continue
      persistent.push({ range: r, options: { isWholeLine: true, linesDecorationsClassName: opts?.linesDecorationsClassName ?? 'claude-gutter', stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges } })
    }
    const next = model.deltaDecorations(ids, persistent)
    claudeDecos.set(model, [...(claudeDecos.get(model) ?? []).filter((i) => !ids.includes(i)), ...next])
  }, 2600)
}

export function clearClaudeDecorations() {
  for (const m of monaco.editor.getModels()) {
    const ids = claudeDecos.get(m)
    if (ids?.length) {
      m.deltaDecorations(ids, [])
      claudeDecos.set(m, [])
    }
  }
}

async function updateGitGutter(model: monaco.editor.ITextModel, path: string) {
  const root = useGit.getState().status?.root
  if (!root || !useApp.getState().settings.editor.gitGutter) {
    const ids = gitDecos.get(model)
    if (ids?.length) gitDecos.set(model, model.deltaDecorations(ids, []))
    return
  }
  const tracked = useGit.getState().byPath[P.key(path)]
  if (tracked?.index === '?') return
  const head = await invoke('git:show', root, path, 'HEAD')
  if (model.isDisposed() || head === null) return
  const parts = diffLines(head.replace(/\r\n/g, '\n'), model.getValue().replace(/\r\n/g, '\n'))
  const decos: monaco.editor.IModelDeltaDecoration[] = []
  let line = 1
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    const n = p.count ?? 0
    if (!p.added && !p.removed) {
      line += n
      continue
    }
    if (p.removed) {
      const next = parts[i + 1]
      if (next?.added) {
        const m = next.count ?? 0
        if (m > 0) decos.push({ range: new monaco.Range(line, 1, line + m - 1, 1), options: { isWholeLine: true, linesDecorationsClassName: 'git-gutter-modified' } })
        line += m
        i++
      } else {
        decos.push({ range: new monaco.Range(Math.max(1, line - 1), 1, Math.max(1, line - 1), 1), options: { linesDecorationsClassName: 'git-gutter-deleted' } })
      }
      continue
    }
    decos.push({ range: new monaco.Range(line, 1, line + n - 1, 1), options: { isWholeLine: true, linesDecorationsClassName: 'git-gutter-added' } })
    line += n
  }
  gitDecos.set(model, model.deltaDecorations(gitDecos.get(model) ?? [], decos))
}

export function CodeEditorHost({ groupId, tab }: { groupId: string; tab: FileTab | null }) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const edRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const viewStates = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>())
  const widgetRef = useRef<ClaudeCursorWidget | null>(null)
  const widgetTimer = useRef<number | null>(null)
  const [state, setState] = useState<LoadState>({ kind: 'idle' })
  const settings = useApp((s) => s.settings.editor)
  const reveal = useEditors((s) => s.reveal)
  const focusNonce = useEditors((s) => s.focusNonce)
  const conflict = useEditors((s) => (tab ? !!s.conflicts[P.key(tab.path)] : false))
  const deleted = useEditors((s) => (tab ? !!s.deleted[P.key(tab.path)] : false))
  const isActiveGroup = useEditors((s) => s.activeGroupId === groupId)
  const path = tab?.path ?? null
  const [retry, setRetry] = useState(0)

  // a tab showing "not found" comes alive when the file appears (e.g. Claude just created it)
  useEffect(() => {
    return fsTouched.on((paths) => {
      if (!path || (state.kind !== 'missing' && state.kind !== 'error')) return
      if (paths.some((p) => P.samePath(p, path))) setRetry((n) => n + 1)
    })
  }, [path, state.kind])

  // create the editor once per group
  useEffect(() => {
    const ed = monaco.editor.create(containerRef.current!, { ...editorOptions(useApp.getState().settings.editor), model: null, theme: 'clauditor' })
    edRef.current = ed
    const unregister = registerEditor(groupId, ed)
    const updateStatus = () => {
      const m = ed.getModel()
      const sel = ed.getSelection()
      if (!m || !sel) return
      const doc = getDoc(m.uri.fsPath)
      const opts = m.getOptions()
      useEditorStatus.getState().set({
        line: sel.positionLineNumber,
        column: sel.positionColumn,
        selected: sel.isEmpty() ? 0 : m.getValueLengthInRange(sel),
        language: m.getLanguageId(),
        eol: m.getEOL() === '\r\n' ? 'CRLF' : 'LF',
        encoding: doc?.encoding ?? 'utf8',
        tabSize: opts.tabSize,
        insertSpaces: opts.insertSpaces,
        path: m.uri.fsPath
      })
    }
    let selTimer: number | null = null
    const d1 = ed.onDidChangeCursorSelection(() => {
      updateStatus()
      if (selTimer) window.clearTimeout(selTimer)
      selTimer = window.setTimeout(() => pushSelection(ed), 120)
    })
    const d2 = ed.onDidFocusEditorText(() => {
      useEditors.getState().focusGroup(groupId)
      updateStatus()
      pushSelection(ed)
    })
    const d3 = ed.onDidChangeModel(updateStatus)
    let gitTimer: number | null = null
    const d4 = ed.onDidChangeModelContent(() => {
      if (gitTimer) window.clearTimeout(gitTimer)
      gitTimer = window.setTimeout(() => {
        const m = ed.getModel()
        if (m) void updateGitGutter(m, m.uri.fsPath)
      }, 500)
    })
    widgetRef.current = new ClaudeCursorWidget()
    return () => {
      d1.dispose()
      d2.dispose()
      d3.dispose()
      d4.dispose()
      unregister()
      ed.dispose()
      edRef.current = null
    }
  }, [groupId])

  useEffect(() => {
    edRef.current?.updateOptions(editorOptions(settings))
  }, [settings])

  // switch documents when the active file tab changes
  useEffect(() => {
    const ed = edRef.current
    if (!ed) return
    const current = ed.getModel()
    if (current) viewStates.current.set(P.key(current.uri.fsPath), ed.saveViewState())
    if (!path) {
      setState({ kind: 'idle' })
      return
    }
    let cancelled = false
    const existing = getDoc(path)
    if (!existing) setState({ kind: 'loading' })
    void openDoc(path).then((r) => {
      if (cancelled) return
      if (!r.ok) {
        ed.setModel(null)
        setState({ kind: r.kind, size: r.size })
        return
      }
      if (ed.getModel() !== r.doc.model) {
        ed.setModel(r.doc.model)
        const vs = viewStates.current.get(P.key(path))
        if (vs) ed.restoreViewState(vs)
      }
      setState({ kind: 'ready', doc: r.doc })
      void updateGitGutter(r.doc.model, path)
    })
    return () => {
      cancelled = true
    }
  }, [path, retry])

  // refresh git gutter when git status changes
  const gitVersion = useGit((s) => s.status)
  useEffect(() => {
    const m = edRef.current?.getModel()
    if (m && path) void updateGitGutter(m, path)
  }, [gitVersion, path])

  // reveal / select requests (search results, IDE openFile, timeline clicks), each handled once
  const handledReveal = useRef(0)
  useEffect(() => {
    const ed = edRef.current
    if (!ed || !reveal || !path || !P.samePath(reveal.path, path) || state.kind !== 'ready') return
    if (reveal.nonce === handledReveal.current) return
    const model = ed.getModel()
    if (!model) return
    handledReveal.current = reveal.nonce
    const line = Math.min(reveal.line, model.getLineCount())
    const range = new monaco.Range(line, reveal.column ?? 1, Math.min(reveal.endLine ?? line, model.getLineCount()), reveal.endColumn ?? reveal.column ?? 1)
    ed.setSelection(range)
    ed.revealRangeInCenterIfOutsideViewport(range, monaco.editor.ScrollType.Smooth)
    if (reveal.highlight) {
      const ids = ed.createDecorationsCollection([{ range: new monaco.Range(line, 1, range.endLineNumber, 1), options: { isWholeLine: true, className: 'reveal-flash' } }])
      window.setTimeout(() => ids.clear(), 1600)
    }
    ed.focus()
  }, [reveal, path, state.kind])

  // focus only in answer to a new focus request (not whenever some document finishes loading)
  const handledFocus = useRef(focusNonce)
  useEffect(() => {
    if (focusNonce === handledFocus.current || !isActiveGroup || state.kind !== 'ready') return
    handledFocus.current = focusNonce
    edRef.current?.focus()
  }, [focusNonce, isActiveGroup, state.kind])

  // Claude's edits: highlight changed lines and reveal them when following
  useEffect(() => {
    return docChanges.on((ev) => {
      const ed = edRef.current
      const model = ed?.getModel()
      if (!ed || !model || !P.samePath(model.uri.fsPath, ev.path)) return
      if (ev.source !== 'claude') return
      applyClaudeDecorations(model, ev.change.added, ev.change.removedAt)
      const first = ev.change.added[0]?.[0] ?? ev.change.removedAt[0]
      if (ev.reveal && first) ed.revealLineInCenterIfOutsideViewport(first, monaco.editor.ScrollType.Smooth)
      const last = ev.change.added[ev.change.added.length - 1]
      if (last && widgetRef.current) {
        const line = Math.min(last[1], model.getLineCount())
        widgetRef.current.move({ lineNumber: line, column: model.getLineMaxColumn(line) })
        ed.removeContentWidget(widgetRef.current)
        ed.addContentWidget(widgetRef.current)
        if (widgetTimer.current) window.clearTimeout(widgetTimer.current)
        widgetTimer.current = window.setTimeout(() => widgetRef.current?.fade(), 2600)
      }
    })
  }, [])

  // live typing cursor
  const cursor = useActivity((s) => s.cursor)
  useEffect(() => {
    const ed = edRef.current
    const w = widgetRef.current
    if (!ed || !w || !cursor || !path || !P.samePath(cursor.path, path)) return
    w.move({ lineNumber: cursor.line, column: cursor.column })
    ed.removeContentWidget(w)
    ed.addContentWidget(w)
    if (widgetTimer.current) window.clearTimeout(widgetTimer.current)
    widgetTimer.current = window.setTimeout(() => w.fade(), 2600)
  }, [cursor, path])

  const visible = !!tab
  return (
    <div className="code-host" style={{ display: visible ? 'flex' : 'none' }}>
      {visible && conflict && path && (
        <div className="editor-banner warn">
          <TriangleAlert size={15} />
          <span className="grow">{t('This file changed on disk (possibly by Claude) while you have unsaved changes.')}</span>
          <button
            className="btn btn-sm"
            onClick={() =>
              useEditors.getState().openTab({
                kind: 'diff',
                key: `conflict:${P.key(path)}`,
                path,
                title: t('{name} (disk ↔ yours)', { name: P.basename(path) }),
                left: { kind: 'text', text: '', label: tk('Disk') },
                right: { kind: 'file', label: tk('Yours') }
              })
            }
          >
            {t('Compare')}
          </button>
          <button className="btn btn-sm" onClick={() => void reloadDoc(path, { force: true })}>
            {t('Use disk version')}
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={async () => {
              keepMine(path)
              await saveDoc(path, true)
            }}
          >
            {t('Overwrite with mine')}
          </button>
        </div>
      )}
      {visible && deleted && path && !conflict && (
        <div className="editor-banner bad">
          <FileWarning size={15} />
          <span className="grow">
            {isDirty(getDoc(path)) ? t('This file was deleted from disk. Your changes are still in the editor.') : t('This file was deleted from disk.')}
          </span>
          <button className="btn btn-sm" onClick={() => void saveDoc(path, true)}>
            {t('Save again')}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => useEditors.getState().closeWhere((x) => x.kind === 'file' && P.samePath(x.path, path))}>
            {t('Close')}
          </button>
        </div>
      )}
      <div className="monaco-host" ref={containerRef} style={{ visibility: state.kind === 'ready' ? 'visible' : 'hidden' }} />
      {visible && state.kind === 'image' && path && <ImagePreview path={path} size={state.size} />}
      {visible && (state.kind === 'binary' || state.kind === 'too-large' || state.kind === 'missing' || state.kind === 'error') && path && (
        <div className="editor-notice">
          {state.kind === 'missing' ? <FileWarning size={30} strokeWidth={1.4} /> : <ImageOff size={30} strokeWidth={1.4} />}
          <strong>
            {state.kind === 'binary'
              ? t("Binary file can't be displayed")
              : state.kind === 'too-large'
                ? t('File is too large ({size})', { size: bytes(state.size) })
                : state.kind === 'missing'
                  ? t('File not found')
                  : t("File couldn't be opened")}
          </strong>
          <div className="notice-actions">
            {state.kind !== 'missing' && (
              <button className="btn" onClick={() => void invoke('app:openPath', path)}>
                {t('Open with default app')}
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => void invoke('app:revealPath', path)}>
              <RefreshCw size={14} /> {t('Reveal in File Explorer')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
