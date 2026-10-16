import { useEffect, useMemo, useRef, useState } from 'react'
import fuzzysort from 'fuzzysort'
import { ArrowUp, ExternalLink, ImagePlus, Info, KeyRound, Square, X } from 'lucide-react'
import type { Effort, ModelOption, PermissionMode, PromptImage, RunnerInfo, SessionMeta } from '@shared/types'
import { FileIcon } from '@/lib/fileIcons'
import { tk, useT } from '@/lib/i18n'
import { invoke } from '@/lib/ipc'
import { focusComposer } from '@/lib/bus'
import { defaultModel, desktopOwned } from '@/lib/claudeInfo'
import * as P from '@/lib/paths'
import { useApp } from '@/state/app'
import { loginClaude, sessionTitle, useSessions } from '@/state/sessions'
import { effortsFor, modelFor, useClaude, useClaudeDefaults } from '@/state/claude'
import { newDesktopSession } from '@/commands'
import { EffortPicker, ModelPicker } from './ModelPicker'

/** Permission modes. `label` and `hint` are English source text: render them with t(). */
export const MODES: { value: PermissionMode; label: string; hint: string }[] = [
  { value: 'default', label: tk('Ask first'), hint: tk('Claude asks for permission before editing or running commands') },
  { value: 'acceptEdits', label: tk('Accept edits'), hint: tk('File edits are accepted automatically; commands still need approval') },
  { value: 'plan', label: tk('Plan'), hint: tk('Claude only reads and drafts a plan without changing anything') },
  { value: 'auto', label: tk('Auto'), hint: tk('A classifier approves safe steps and asks when unsure') },
  { value: 'bypassPermissions', label: tk('Bypass permissions'), hint: tk('Every step runs without asking — use with care') }
]

let fileCache: { root: string; files: string[]; at: number } | null = null
async function workspaceFiles(root: string): Promise<string[]> {
  if (fileCache && fileCache.root === root && Date.now() - fileCache.at < 30_000) return fileCache.files
  const files = await invoke('fs:listFiles', root)
  fileCache = { root, files, at: Date.now() }
  return files
}

function readImage(file: File): Promise<PromptImage | null> {
  return new Promise((resolve) => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return resolve(null)
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result)
      resolve({ mediaType: file.type, data: s.slice(s.indexOf(',') + 1) })
    }
    r.onerror = () => resolve(null)
    r.readAsDataURL(file)
  })
}

export type ComposerMode = 'new' | 'runner' | 'resume'

const NO_MODELS: ModelOption[] = []

/** A Claude desktop session opened in the panel: say what sending from here does, offer the alternative. */
function DesktopSessionNote({ session, draft }: { session: SessionMeta; draft: string }) {
  const t = useT()
  const continueThere = async () => {
    const text = draft.trim()
    let copied = false
    if (text) {
      try {
        await navigator.clipboard.writeText(text)
        copied = true
      } catch {
        /* clipboard unavailable: open anyway */
      }
    }
    const r = await invoke('desktop:openSession', session.id)
    useApp.getState().toast(
      r.ok
        ? { level: 'info', title: t('Opened in Claude desktop'), detail: copied ? t('Your message is on the clipboard: paste it there with Ctrl+V.') : undefined }
        : { level: 'error', title: t("Couldn't open Claude desktop") }
    )
  }
  return (
    <div className="composer-note" role="note">
      <Info size={15} strokeWidth={1.9} className="composer-note-icon" />
      <div>
        <div className="composer-note-title">{t('This conversation belongs to Claude desktop')}</div>
        <div className="composer-note-sub">{t("Claude desktop won't show replies you send from here, so Clauditor continues in a copy of it. The original stays as it is.")}</div>
      </div>
      <div className="composer-note-actions">
        <button className="btn btn-sm" onClick={() => void continueThere()} data-tip={draft.trim() ? t('Opens the session in Claude desktop and copies your message') : undefined}>
          <ExternalLink size={13} /> {t('Continue in Claude desktop')}
        </button>
      </div>
    </div>
  )
}

function LoginBanner() {
  const t = useT()
  const [checking, setChecking] = useState(false)
  return (
    <div className="composer-login" role="status">
      <KeyRound size={15} strokeWidth={1.9} className="composer-login-icon" />
      <div>
        <div className="composer-login-title">{t('Claude Code in Clauditor is not signed in')}</div>
        <div className="composer-login-sub">{t('Sign in once so Claude can work directly from this panel. Following Claude desktop sessions still works without signing in.')}</div>
      </div>
      <div className="composer-login-actions">
        <button
          className="btn btn-sm btn-ghost"
          disabled={checking}
          onClick={async () => {
            setChecking(true)
            const st = await useSessions.getState().checkAuth(true)
            setChecking(false)
            if (st?.loggedIn) useApp.getState().toast({ level: 'success', title: t('Claude Code is signed in') })
          }}
        >
          {checking ? t('Checking…') : t('Check again')}
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => void loginClaude()}>
          {t('Sign in')}
        </button>
      </div>
    </div>
  )
}

export function Composer({ mode, session, runner }: { mode: ComposerMode; session: SessionMeta | null; runner: RunnerInfo | null }) {
  const t = useT()
  const settings = useApp((s) => s.settings.claude)
  const workspace = useApp((s) => s.workspace)
  const models = useClaude((s) => s.env?.models) ?? NO_MODELS
  const starting = useSessions((s) => s.starting)
  const signedOut = useSessions((s) => s.auth?.loggedIn === false)
  const [text, setText] = useState('')
  const [images, setImages] = useState<PromptImage[]>([])
  const [model, setModel] = useState(settings.defaultModel)
  const [permMode, setPermMode] = useState<PermissionMode>(settings.defaultPermissionMode)
  const [effort, setEffort] = useState<Effort | ''>(settings.defaultEffort)
  const [mention, setMention] = useState<{ query: string; start: number; index: number } | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const ta = useRef<HTMLTextAreaElement>(null)
  const running = runner?.state === 'running' || runner?.state === 'starting'
  const cwd = session?.cwd ?? workspace?.root ?? null
  const defaults = useClaudeDefaults(cwd)
  // sending into Claude desktop's own session continues in a copy (Claude desktop would never show the reply)
  const copyOnSend = mode === 'resume' && !!session && desktopOwned(session)

  useEffect(() => {
    if (runner) {
      setPermMode(runner.permissionMode)
      if (runner.model) setModel(models.some((m) => m.value === runner.model) ? runner.model : model)
      setEffort(runner.effort)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner?.runId, runner?.permissionMode])

  useEffect(() => {
    return focusComposer.on(({ text: insert }) => {
      const el = ta.current
      if (!el) return
      el.focus()
      if (insert) {
        setText((t) => (t && !t.endsWith('\n') && !t.endsWith(' ') ? `${t} ${insert}` : t + insert))
        requestAnimationFrame(() => {
          el.selectionStart = el.selectionEnd = el.value.length
        })
      }
    })
  }, [])

  // autosize
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`
  }, [text])

  useEffect(() => {
    if (mention && workspace) void workspaceFiles(workspace.root).then(setFiles)
  }, [mention, workspace])

  const suggestions = useMemo(() => {
    if (!mention || !workspace) return []
    const rels = files.map((f) => P.relative(workspace.root, f))
    if (!mention.query) return rels.slice(0, 8)
    return fuzzysort.go(mention.query, rels, { limit: 8, threshold: 0.2 }).map((r) => r.target)
  }, [mention, files, workspace])

  const insertMention = (rel: string) => {
    if (!mention) return
    const before = text.slice(0, mention.start)
    const after = text.slice(mention.start + 1 + mention.query.length)
    const next = `${before}@${rel} ${after}`
    setText(next)
    setMention(null)
    requestAnimationFrame(() => {
      const el = ta.current
      if (el) el.selectionStart = el.selectionEnd = before.length + rel.length + 2
    })
  }

  const submit = async () => {
    const body = text.trim()
    if ((!body && !images.length) || starting) return
    const prompt = { text: body, images }
    const s = useSessions.getState()
    if (mode === 'runner' && runner) {
      void s.send(runner.runId, prompt)
    } else if (mode === 'resume' && session) {
      if (!cwd) return
      const started = await s.startRun({
        cwd,
        prompt,
        resumeSessionId: session.id,
        fork: copyOnSend,
        forkTitle: copyOnSend ? `${sessionTitle(session)} · Clauditor` : undefined,
        model: model || undefined,
        permissionMode: permMode,
        effort: efforts.includes(effort) ? effort : ''
      })
      if (!started) return
    } else {
      if (!workspace) {
        useApp.getState().toast({ level: 'info', title: t('Open a project folder first'), detail: t('Claude will work in the folder you open.') })
        return
      }
      // keep the draft when the run could not start (signed out, missing claude.exe…)
      if (!(await s.startRun({ cwd: workspace.root, prompt, model: model || undefined, permissionMode: permMode, effort: efforts.includes(effort) ? effort : '' }))) return
    }
    setText('')
    setImages([])
  }

  const placeholder =
    mode === 'runner'
      ? running
        ? t('Add guidance — Claude will read it after this step…')
        : t('Reply to Claude…')
      : mode === 'resume'
        ? copyOnSend
          ? t('Continue in a copy, here in Clauditor…')
          : t('Continue this session in Clauditor…')
        : workspace
          ? t('What do you want to build in {name}?', { name: workspace.name })
          : t('Open a folder, then describe what you want to build…')
  const modeHint = MODES.find((m) => m.value === permMode)?.hint
  // pickers follow what Claude Code offers for the chosen model
  const selected = modelFor(models, model)
  const efforts = effortsFor(models, model)
  const modes = MODES.filter((m) => m.value !== 'auto' || selected?.supportsAutoMode !== false || permMode === 'auto')

  return (
    <div
      className="composer"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={async (e) => {
        const list = [...e.dataTransfer.files]
        if (!list.length) return
        e.preventDefault()
        const imgs = (await Promise.all(list.map(readImage))).filter((x): x is PromptImage => !!x)
        if (imgs.length) setImages((cur) => [...cur, ...imgs].slice(0, 8))
      }}
    >
      {signedOut && mode !== 'runner' && <LoginBanner />}
      {copyOnSend && session && <DesktopSessionNote session={session} draft={text} />}
      {images.length > 0 && (
        <div className="composer-images">
          {images.map((img, i) => (
            <div key={i} className="composer-image">
              <img src={`data:${img.mediaType};base64,${img.data}`} alt="" />
              <button className="composer-image-x" onClick={() => setImages(images.filter((_, j) => j !== i))} aria-label={t('Remove image')}>
                <X size={11} strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="composer-box">
        <textarea
          ref={ta}
          className="composer-input"
          rows={2}
          value={text}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value
            setText(v)
            const caret = e.target.selectionStart
            const upto = v.slice(0, caret)
            const m = /(^|\s)@([\w./\\-]*)$/.exec(upto)
            if (m) setMention({ query: m[2], start: caret - m[2].length - 1, index: 0 })
            else setMention(null)
          }}
          onPaste={async (e) => {
            const items = [...e.clipboardData.items].filter((it) => it.type.startsWith('image/'))
            if (!items.length) return
            e.preventDefault()
            const imgs = (await Promise.all(items.map((it) => it.getAsFile()).filter((f): f is File => !!f).map(readImage))).filter((x): x is PromptImage => !!x)
            setImages((cur) => [...cur, ...imgs].slice(0, 8))
          }}
          onKeyDown={(e) => {
            if (mention && suggestions.length) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const d = e.key === 'ArrowDown' ? 1 : -1
                setMention({ ...mention, index: (mention.index + d + suggestions.length) % suggestions.length })
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                insertMention(suggestions[mention.index])
                return
              }
              if (e.key === 'Escape') {
                setMention(null)
                return
              }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
            if (e.key === 'Escape' && running && runner) void useSessions.getState().interrupt(runner.runId)
          }}
        />
        {mention && suggestions.length > 0 && (
          <div className="mention-pop">
            {suggestions.map((rel, i) => (
              <button
                key={rel}
                className={`mention-item${i === mention.index ? ' on' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertMention(rel)
                }}
              >
                <FileIcon name={P.basename(rel)} size={14} />
                <span className="mention-name">{P.basename(rel)}</span>
                <span className="mention-dir truncate">{P.dirname(rel) === rel ? '' : P.dirname(rel)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="composer-bar">
          <ModelPicker
            models={models}
            value={model}
            defaults={defaults}
            cwd={cwd}
            live={!!runner && runner.state !== 'stopped'}
            onChange={(v) => {
              setModel(v)
              if (runner && runner.state !== 'stopped') void useSessions.getState().setModel(runner.runId, v)
            }}
          />
          {efforts.length > 0 && (
            <EffortPicker
              levels={efforts}
              value={effort}
              model={selected?.value ? selected : (defaultModel(models, defaults).value ?? selected)}
              defaults={defaults}
              live={!!runner && runner.state !== 'stopped'}
              onChange={(v) => {
                setEffort(v)
                if (runner && runner.state !== 'stopped') void useSessions.getState().setEffort(runner.runId, v)
              }}
            />
          )}
          <select
            className={`composer-select mode-${permMode}`}
            value={permMode}
            data-tip={modeHint ? t(modeHint) : undefined}
            onChange={(e) => {
              const v = e.target.value as PermissionMode
              setPermMode(v)
              if (runner && runner.state !== 'stopped') void useSessions.getState().setMode(runner.runId, v)
            }}
          >
            {modes.map((m) => (
              <option key={m.value} value={m.value}>
                {t(m.label)}
              </option>
            ))}
          </select>
          <span className="grow" />
          <label className="icon-btn sm composer-attach" data-tip={t('Attach image')}>
            <ImagePlus size={15} strokeWidth={1.8} />
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              hidden
              onChange={async (e) => {
                const list = [...(e.target.files ?? [])]
                const imgs = (await Promise.all(list.map(readImage))).filter((x): x is PromptImage => !!x)
                setImages((cur) => [...cur, ...imgs].slice(0, 8))
                e.target.value = ''
              }}
            />
          </label>
          {mode === 'new' && workspace && (
            <button className="icon-btn sm" data-tip={t('Send to Claude desktop (new session in this folder)')} onClick={() => void newDesktopSession(text.trim() || undefined).then(() => setText(''))}>
              <ExternalLink size={14} strokeWidth={1.8} />
            </button>
          )}
          {running && runner ? (
            <button className="send-btn stop" onClick={() => void useSessions.getState().interrupt(runner.runId)} data-tip={t('Stop')} data-tip-keys="Esc">
              <Square size={12} strokeWidth={0} fill="currentColor" />
            </button>
          ) : (
            <button className="send-btn" disabled={(!text.trim() && !images.length) || starting} onClick={() => void submit()} data-tip={t('Send')} data-tip-keys="Enter">
              <ArrowUp size={16} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
