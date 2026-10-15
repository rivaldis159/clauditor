import { memo, useState } from 'react'
import { Ban, Check, ChevronRight, CircleX, ExternalLink, FileDiff, LoaderCircle } from 'lucide-react'
import type { Hunk, TimelineEvent, TodoItem, ToolEvent } from '@shared/types'
import * as P from '@/lib/paths'
import { duration, num } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { languageForPath } from '@/lib/monaco'
import { invoke } from '@/lib/ipc'
import { useApp } from '@/state/app'
import { useEditors } from '@/state/editors'
import { useSessions } from '@/state/sessions'
import { CodeBlock, Markdown } from './Markdown'
import { CATEGORY_COLOR, mcpParts, toolMeta, toolTarget } from './toolInfo'

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g
const stripAnsi = (s: string) => s.replace(ANSI, '')

function absPath(p: string, cwd: string | null): string {
  if (/^[A-Za-z]:|^\\\\|^\//.test(p) || !cwd) return p
  return P.join(cwd, p)
}

export function HunkView({ hunks, maxLines = 40 }: { hunks: Hunk[]; maxLines?: number }) {
  const t = useT()
  const [all, setAll] = useState(false)
  const rows: { kind: 'ctx' | 'add' | 'del' | 'sep'; text: string; oldN?: number; newN?: number }[] = []
  hunks.forEach((h, hi) => {
    if (hi > 0) rows.push({ kind: 'sep', text: '' })
    let o = h.oldStart
    let n = h.newStart
    for (const l of h.lines) {
      const c = l[0]
      const text = l.slice(1)
      if (c === '+') rows.push({ kind: 'add', text, newN: n++ })
      else if (c === '-') rows.push({ kind: 'del', text, oldN: o++ })
      else if (c === '\\') continue
      else rows.push({ kind: 'ctx', text, oldN: o++, newN: n++ })
    }
  })
  const shown = all ? rows : rows.slice(0, maxLines)
  return (
    <div className="hunks">
      {shown.map((r, i) =>
        r.kind === 'sep' ? (
          <div key={i} className="hunk-sep">⋯</div>
        ) : (
          <div key={i} className={`hunk-line ${r.kind}`}>
            <span className="hl-n">{r.kind === 'del' ? r.oldN : r.newN}</span>
            <span className="hl-sign">{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' '}</span>
            <span className="hl-text">{r.text || ' '}</span>
          </div>
        )
      )}
      {rows.length > maxLines && (
        <button className="hunk-more" onClick={() => setAll(!all)}>
          {all ? t('Show less') : t.n(rows.length - maxLines, 'Show {n} more line', 'Show {n} more lines', { n: num(rows.length - maxLines) })}
        </button>
      )}
    </div>
  )
}

export function TodoView({ todos }: { todos: TodoItem[] }) {
  return (
    <ul className="todos">
      {todos.map((t, i) => (
        <li key={i} className={`todo ${t.status}`}>
          <span className="todo-box">{t.status === 'completed' ? <Check size={11} strokeWidth={3} /> : t.status === 'in_progress' ? <span className="todo-spark" /> : null}</span>
          <span className="todo-text">{t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}</span>
        </li>
      ))}
    </ul>
  )
}

function editHunksFromInput(ev: ToolEvent): Hunk[] {
  // fallback while running / when the transcript lacks a structured patch
  const i = ev.input as Record<string, unknown>
  const old = typeof i.old_string === 'string' ? i.old_string : ''
  const neu = typeof i.new_string === 'string' ? i.new_string : ''
  if (!old && !neu) return []
  const lines = [...(old ? old.split('\n').map((l) => `-${l}`) : []), ...(neu ? neu.split('\n').map((l) => `+${l}`) : [])]
  return [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, lines }]
}

function Subagent({ ev, sessionId }: { ev: ToolEvent; sessionId: string }) {
  const t = useT()
  const [events, setEvents] = useState<TimelineEvent[] | null>(null)
  const [loading, setLoading] = useState(false)
  const load = async () => {
    setLoading(true)
    try {
      const list = await invoke('sessions:subagents', sessionId)
      const info = list.find((a) => a.toolUseId === ev.toolUseId) ?? (ev.result?.agentId ? list.find((a) => a.agentId === ev.result?.agentId) : undefined)
      if (!info) {
        setEvents([])
        return
      }
      setEvents(await useSessions.getState().loadSubagent(sessionId, info.agentId))
    } finally {
      setLoading(false)
    }
  }
  if (!events) {
    return (
      <button className="btn btn-sm btn-ghost subagent-load" onClick={() => void load()} disabled={loading}>
        {loading ? <LoaderCircle size={13} className="spin" /> : <ChevronRight size={13} />} {t('Show subagent steps')}
      </button>
    )
  }
  if (!events.length) return <div className="faint tool-note">{t('Subagent transcript is not available.')}</div>
  const tools = events.filter((e): e is ToolEvent => e.kind === 'tool')
  return (
    <div className="subagent-steps">
      {tools.slice(0, 200).map((t) => (
        <ToolCard key={t.id} ev={t} sessionId={sessionId} cwd={null} compact />
      ))}
      {tools.length > 200 && <div className="faint tool-note">{t.n(tools.length - 200, '+{n} more step', '+{n} more steps')}</div>}
    </div>
  )
}

interface Props {
  ev: ToolEvent
  sessionId: string
  cwd: string | null
  live?: boolean
  compact?: boolean
}

export const ToolCard = memo(function ToolCard({ ev, sessionId, cwd, live, compact }: Props) {
  const t = useT()
  const root = useApp((s) => s.workspace?.root ?? null)
  const meta = toolMeta(ev.name)
  const Icon = meta.icon
  const [open, setOpen] = useState(false)
  const target = toolTarget(ev, root ?? cwd)
  const status = ev.status === 'running' && !live ? 'stale' : ev.status
  const file = ev.result?.file
  const filePath = file?.path ?? (typeof ev.input.file_path === 'string' ? ev.input.file_path : null)
  const absFile = filePath ? absPath(filePath, cwd) : null
  const isEdit = meta.category === 'edit'
  const isShell = ev.name === 'Bash' || ev.name === 'PowerShell'
  const hunks = file?.hunks?.length ? file.hunks : isEdit && ev.name !== 'Write' ? editHunksFromInput(ev) : []
  const elapsed = ev.endTs && ev.endTs > ev.ts ? ev.endTs - ev.ts : null

  const openFile = () => {
    if (!absFile) return
    const firstHunk = file?.hunks?.[0]
    const line = firstHunk ? firstHunk.newStart : file?.startLine
    useEditors.getState().openFile(absFile, { preview: true, line: line || undefined, highlight: !!line })
  }

  const hasBody =
    isEdit ||
    isShell ||
    ev.name === 'TodoWrite' ||
    ev.name === 'Task' ||
    ev.name === 'Agent' ||
    !!ev.result?.filenames?.length ||
    !!ev.result?.text ||
    ev.name.startsWith('mcp__') ||
    ev.name === 'ExitPlanMode' ||
    ev.name === 'AskUserQuestion'

  const headTitle = (() => {
    if (ev.name.startsWith('mcp__')) {
      const { server, tool } = mcpParts(ev.name)
      return (
        <>
          <span className="tc-verb">{tool}</span>
          <span className="tc-target muted">{server}</span>
        </>
      )
    }
    // finished cards read in the past tense ("Read form.ts"), running ones in the present ("Reading form.ts")
    const finished = status === 'done'
    const verb = ev.name === 'Write' && file?.type === 'create' ? (finished ? t('done::Created') : t('Creating')) : finished ? meta.doneVerb : meta.verb
    return (
      <>
        <span className="tc-verb">{verb}</span>
        {target && <span className={`tc-target${absFile ? ' path' : ''}`}>{target}</span>}
      </>
    )
  })()

  return (
    <div className={`tool-card cat-${meta.category} st-${status}${open ? ' open' : ''}${compact ? ' compact' : ''}`} style={{ ['--cat' as string]: CATEGORY_COLOR[meta.category] }}>
      <div
        className="tc-head"
        onClick={() => {
          if (hasBody) setOpen(!open)
          else openFile()
        }}
      >
        <span className="tc-icon">
          <Icon size={14} strokeWidth={1.8} />
        </span>
        <span className="tc-title truncate">{headTitle}</span>
        {file && (file.added > 0 || file.removed > 0) && (
          <span className="tc-delta">
            {file.added > 0 && <span className="plus">+{file.added}</span>}
            {file.removed > 0 && <span className="minus">−{file.removed}</span>}
          </span>
        )}
        {ev.name === 'Read' && file?.numLines ? <span className="tc-meta">{t.n(file.numLines, '{n} line', '{n} lines', { n: num(file.numLines) })}</span> : null}
        {ev.result?.numFiles !== undefined && <span className="tc-meta">{t.n(ev.result.numFiles, '{n} file', '{n} files', { n: num(ev.result.numFiles) })}</span>}
        {elapsed !== null && elapsed > 1500 && <span className="tc-meta">{duration(elapsed)}</span>}
        <span className="tc-status">
          {status === 'running' && <LoaderCircle size={13} className="spin" />}
          {status === 'done' && <Check size={13} strokeWidth={2.4} />}
          {status === 'error' && <CircleX size={13} strokeWidth={2} />}
          {status === 'denied' && <Ban size={13} strokeWidth={2} />}
        </span>
        {hasBody && <ChevronRight size={13} strokeWidth={2} className="tc-chev" />}
      </div>
      {open && (
        <div className="tc-body">
          {absFile && (
            <div className="tc-actions">
              <button className="btn btn-sm btn-ghost" onClick={openFile}>
                {t('Open file')}
              </button>
              {hunks.length > 0 && file?.type !== 'read' && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    const before = hunks
                      .flatMap((h) => h.lines)
                      .filter((l) => !l.startsWith('+'))
                      .map((l) => l.slice(1))
                      .join('\n')
                    const after = hunks
                      .flatMap((h) => h.lines)
                      .filter((l) => !l.startsWith('-'))
                      .map((l) => l.slice(1))
                      .join('\n')
                    useEditors.getState().openTab({
                      kind: 'diff',
                      key: `tool:${ev.toolUseId}`,
                      path: absFile,
                      title: t("{name} · Claude's edit", { name: P.basename(absFile) }),
                      left: { kind: 'text', text: before, label: t('Before edit') },
                      right: { kind: 'text', text: after, label: t('After edit') },
                      preview: true
                    })
                  }}
                >
                  <FileDiff size={13} /> {t('Diff')}
                </button>
              )}
            </div>
          )}
          {isEdit && ev.name === 'Write' && typeof ev.input.content === 'string' && (
            <CodeBlock code={(ev.input.content as string).slice(0, 12000)} lang={languageForPath(absFile ?? '')} maxLines={24} />
          )}
          {isEdit && ev.name !== 'Write' && hunks.length > 0 && <HunkView hunks={hunks} />}
          {isShell && (
            <div className="shell">
              <div className="shell-cmd selectable">
                <span className="shell-prompt">{ev.name === 'PowerShell' ? 'PS>' : '$'}</span>
                <span>{String(ev.input.command ?? '')}</span>
              </div>
              {ev.result?.shell && (ev.result.shell.stdout || ev.result.shell.stderr) && (
                <pre className="shell-out selectable">
                  {stripAnsi(ev.result.shell.stdout)}
                  {ev.result.shell.stderr && <span className="shell-err">{stripAnsi(ev.result.shell.stderr)}</span>}
                </pre>
              )}
              {ev.result?.shell?.backgroundTaskId && <div className="faint tool-note">{t('Running in the background (task {id})', { id: ev.result.shell.backgroundTaskId })}</div>}
            </div>
          )}
          {ev.name === 'TodoWrite' && Array.isArray(ev.input.todos) && <TodoView todos={(ev.result?.todos ?? (ev.input.todos as TodoItem[])) as TodoItem[]} />}
          {(ev.name === 'Task' || ev.name === 'Agent') && (
            <>
              {typeof ev.input.prompt === 'string' && (
                <details className="tc-details">
                  <summary>{t('Instructions for the subagent')}</summary>
                  <Markdown text={String(ev.input.prompt).slice(0, 6000)} />
                </details>
              )}
              <Subagent ev={ev} sessionId={sessionId} />
            </>
          )}
          {ev.name === 'ExitPlanMode' && typeof ev.input.plan === 'string' && <Markdown text={ev.input.plan as string} />}
          {ev.result?.filenames && ev.result.filenames.length > 0 && (
            <div className="tc-files">
              {ev.result.filenames.slice(0, 40).map((f) => (
                <button key={f} className="tc-file truncate" onClick={() => useEditors.getState().openFile(absPath(f, cwd), { preview: true })}>
                  {P.displayPath(absPath(f, cwd), root ?? cwd)}
                </button>
              ))}
              {ev.result.filenames.length > 40 && <span className="faint">{t('+{n} more', { n: ev.result.filenames.length - 40 })}</span>}
            </div>
          )}
          {ev.name.startsWith('mcp__') && (
            <details className="tc-details">
              <summary>{t('Input')}</summary>
              <pre className="json selectable">{JSON.stringify(ev.input, null, 2).slice(0, 8000)}</pre>
            </details>
          )}
          {ev.result?.text && !isShell && ev.name !== 'TodoWrite' && (
            <pre className={`tc-result selectable${ev.result.isError ? ' err' : ''}`}>{stripAnsi(ev.result.text).slice(0, 8000)}</pre>
          )}
          {ev.result?.truncated && <div className="faint tool-note">{t('Output truncated.')}</div>}
          {ev.name === 'WebFetch' && typeof ev.input.url === 'string' && (
            <button className="btn btn-sm btn-ghost" onClick={() => void invoke('app:openExternal', String(ev.input.url))}>
              <ExternalLink size={13} /> {t('Open link')}
            </button>
          )}
        </div>
      )}
    </div>
  )
})
