import { useState } from 'react'
import { ChevronRight, Coins, Copy, Ellipsis, ExternalLink, Eye, EyeOff, FileSearch, Files, FolderOpen, Gauge, ListFilter, Play, Timer, Wrench, X } from 'lucide-react'
import type { SessionMeta, SessionStats, TodoItem } from '@shared/types'
import * as P from '@/lib/paths'
import { compact, duration, num, usd } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { invoke } from '@/lib/ipc'
import { useApp } from '@/state/app'
import { useEditors } from '@/state/editors'
import { originLabel, sessionTitle, useSessions } from '@/state/sessions'
import { openFolder } from '@/state/workspace'
import { TodoView } from './ToolCard'
import type { TimelineFilter } from './Timeline'

export function SessionHeader({
  meta,
  stats,
  filesChanged,
  busy,
  runnerState,
  filter,
  setFilter
}: {
  meta: SessionMeta
  stats: SessionStats
  filesChanged: number
  busy: boolean
  runnerState: string | null
  filter: TimelineFilter
  setFilter(f: TimelineFilter): void
}) {
  const t = useT()
  const follow = useSessions((s) => s.follow)
  const workspace = useApp((s) => s.workspace)
  const title = sessionTitle(meta)
  const status = busy ? 'live' : meta.live || runnerState === 'idle' ? 'idle' : ''
  const statusText = busy ? t('Working') : meta.live ? t('Waiting for input') : runnerState === 'idle' ? t('Waiting for input') : t('Finished')
  const span = stats.firstTs && stats.lastTs ? stats.lastTs - stats.firstTs : 0
  const totalTokens = stats.inputTokens + stats.outputTokens + stats.cacheReadTokens + stats.cacheCreationTokens
  const tokenTip = t('Tokens: input {input}, output {output}, cache read {cacheRead}, cache write {cacheWrite}', {
    input: num(stats.inputTokens),
    output: num(stats.outputTokens),
    cacheRead: num(stats.cacheReadTokens),
    cacheWrite: num(stats.cacheCreationTokens)
  })
  const otherFolder = meta.cwd && workspace && !P.samePath(meta.cwd, workspace.root) && !P.isInside(meta.cwd, workspace.root)
  const s = useSessions.getState()

  const menu = (e: React.MouseEvent) =>
    useApp.getState().showContextMenu(e, [
      { label: t('Switch session…'), run: () => useApp.getState().openPalette('sessions') },
      { separator: true },
      { label: t('Show: all steps'), run: () => setFilter('all'), icon: filter === 'all' ? <ChevronRight size={13} /> : undefined },
      { label: t('Show: changes & commands only'), run: () => setFilter('changes'), icon: filter === 'changes' ? <ChevronRight size={13} /> : undefined },
      { label: t('Show: conversation only'), run: () => setFilter('chat'), icon: filter === 'chat' ? <ChevronRight size={13} /> : undefined },
      { separator: true },
      ...(meta.cwd ? [{ label: t("Open session's project folder"), icon: <FolderOpen size={14} />, run: () => void openFolder(meta.cwd!) }] : []),
      { label: t('Reveal transcript file'), icon: <FileSearch size={14} />, run: () => void invoke('sessions:revealTranscript', meta.id) },
      { label: t('Copy session ID'), icon: <Copy size={14} />, run: () => void navigator.clipboard.writeText(meta.id) },
      { separator: true },
      { label: t('Close session in panel'), icon: <X size={14} />, run: () => void s.activate(null) }
    ])

  return (
    <div className={`agent-head${busy ? ' busy' : ''}`}>
      <div className="agent-head-row">
        <span className={`dot ${status}`} data-tip={statusText} />
        <div className="agent-title truncate" data-tip={title}>
          {title}
        </div>
        <button className={`icon-btn sm${follow ? ' on' : ''}`} onClick={() => s.setFollow(!follow)} data-tip={follow ? t('Following: files Claude edits open automatically') : t('Start following Claude')} data-tip-keys="Ctrl+Alt+F">
          {follow ? <Eye size={15} strokeWidth={1.8} /> : <EyeOff size={15} strokeWidth={1.8} />}
        </button>
        <button className="icon-btn sm" data-tip={t('Session overview')} onClick={() => useEditors.getState().openTab({ kind: 'overview', sessionId: meta.id, title: t('Overview · {title}', { title }) })}>
          <Gauge size={15} strokeWidth={1.8} />
        </button>
        <button className="icon-btn sm" data-tip={t('Replay how Claude built it')} onClick={() => useEditors.getState().openTab({ kind: 'replay', sessionId: meta.id, title: t('Replay · {title}', { title }) })}>
          <Play size={15} strokeWidth={1.8} />
        </button>
        <button className="icon-btn sm" data-tip={t('Open in Claude desktop')} onClick={() => void invoke('desktop:openSession', meta.id)}>
          <ExternalLink size={14} strokeWidth={1.8} />
        </button>
        <button className="icon-btn sm" data-tip={t('More')} onClick={menu}>
          {filter !== 'all' ? <ListFilter size={15} strokeWidth={1.8} className="accent" /> : <Ellipsis size={15} />}
        </button>
      </div>
      <div className="agent-sub truncate">
        <span className={`agent-state ${status}`}>{statusText}</span>
        <span className="sep">·</span>
        <span>{originLabel(meta.entrypoint)}</span>
        {meta.cwd && (
          <>
            <span className="sep">·</span>
            <span className={otherFolder ? 'warn-text' : ''} data-tip={meta.cwd}>
              {P.basename(meta.cwd)}
            </span>
          </>
        )}
        {meta.gitBranch && (
          <>
            <span className="sep">·</span>
            <span>{meta.gitBranch}</span>
          </>
        )}
      </div>
      <div className="agent-stats">
        <span className="stat" data-tip={t('Session duration')}>
          <Timer size={12} strokeWidth={2} /> {span ? duration(span) : '—'}
        </span>
        <span className="stat" data-tip={t.n(stats.toolCalls, '{n} tool call', '{n} tool calls', { n: num(stats.toolCalls) })}>
          <Wrench size={12} strokeWidth={2} /> {num(stats.toolCalls)}
        </span>
        <span className="stat" data-tip={t.n(filesChanged, '{n} file changed', '{n} files changed', { n: num(filesChanged) })}>
          <Files size={12} strokeWidth={2} /> {num(filesChanged)}
        </span>
        <span className="stat delta" data-tip={t('Lines added / removed')}>
          <span className={stats.linesAdded ? 'plus' : 'plus zero'}>+{compact(stats.linesAdded)}</span>
          <span className={stats.linesRemoved ? 'minus' : 'minus zero'}>−{compact(stats.linesRemoved)}</span>
        </span>
        <span className="stat" data-tip={stats.costUSD ? t('{tokens} · cost {cost}', { tokens: tokenTip, cost: usd(stats.costUSD) }) : tokenTip}>
          <Coins size={12} strokeWidth={2} /> {compact(totalTokens)}
        </span>
      </div>
    </div>
  )
}

export function TodoPanel({ todos }: { todos: TodoItem[] }) {
  const t = useT()
  const [open, setOpen] = useState(true)
  const done = todos.filter((t) => t.status === 'completed').length
  const current = todos.find((t) => t.status === 'in_progress')
  return (
    <div className={`todo-panel${open ? ' open' : ''}`}>
      <button className="todo-head" onClick={() => setOpen(!open)}>
        <ChevronRight size={13} strokeWidth={2} className="tc-chev" />
        <span className="todo-head-title">{t("Claude's plan")}</span>
        {!open && current && <span className="todo-current truncate">{current.activeForm ?? current.content}</span>}
        <span className="grow" />
        <span className="todo-count">
          {done}/{todos.length}
        </span>
        <span className="todo-bar">
          <span style={{ width: `${todos.length ? (done / todos.length) * 100 : 0}%` }} />
        </span>
      </button>
      {open && <TodoView todos={todos} />}
    </div>
  )
}
