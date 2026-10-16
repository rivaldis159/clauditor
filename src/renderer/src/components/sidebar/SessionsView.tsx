import { useMemo, useState } from 'react'
import { ChevronRight, Copy, ExternalLink, FileSearch, FolderOpen, Gauge, Play, Plus, RefreshCw, RotateCcw, Search, Sparkles } from 'lucide-react'
import type { SessionMeta } from '@shared/types'
import * as P from '@/lib/paths'
import { ago, bytes } from '@/lib/format'
import { invoke } from '@/lib/ipc'
import { focusComposer } from '@/lib/bus'
import { tk, useT, type T } from '@/lib/i18n'
import { useApp } from '@/state/app'
import { originLabel, sessionTitle, useSessions } from '@/state/sessions'
import { useEditors } from '@/state/editors'
import { openFolder } from '@/state/workspace'
import { newDesktopSession } from '@/commands'

/** Readable project name from a ~/.claude/projects slug when no cwd is known. */
function slugLabel(slug: string): string {
  return slug.replace(/^[A-Za-z]--/, '').replace(/^Users-[^-]+-(Documents|Desktop|Downloads|OneDrive)-/i, '') || slug
}

function statusOf(m: SessionMeta): { cls: string; label: string } {
  if (m.live?.status === 'busy') return { cls: 'live', label: tk('working') }
  if (m.live) return { cls: 'idle', label: tk('waiting') }
  return { cls: '', label: '' }
}

function sessionMenu(e: React.MouseEvent, m: SessionMeta, t: T) {
  e.preventDefault()
  e.stopPropagation()
  const s = useSessions.getState()
  const ws = useApp.getState().workspace
  useApp.getState().showContextMenu(e, [
    { label: t('Show in Claude panel'), icon: <Sparkles size={14} />, run: () => void s.activate(m.id) },
    {
      label: t('Session overview'),
      icon: <Gauge size={14} />,
      run: () => useEditors.getState().openTab({ kind: 'overview', sessionId: m.id, title: t('Overview · {title}', { title: sessionTitle(m) }) })
    },
    {
      label: t('Replay how Claude built it'),
      icon: <Play size={14} />,
      run: () => useEditors.getState().openTab({ kind: 'replay', sessionId: m.id, title: t('Replay · {title}', { title: sessionTitle(m) }) })
    },
    { separator: true },
    { label: t('Open in Claude desktop'), icon: <ExternalLink size={14} />, run: () => void invoke('desktop:openSession', m.id) },
    {
      label: t('Continue in Clauditor'),
      icon: <RotateCcw size={14} />,
      disabled: !!m.live,
      run: async () => {
        await s.activate(m.id)
        focusComposer.emit({})
      }
    },
    ...(m.cwd && (!ws || !P.samePath(ws.root, m.cwd)) ? [{ label: t("Open this session's project folder"), icon: <FolderOpen size={14} />, run: () => void openFolder(m.cwd!) }] : []),
    { separator: true },
    { label: t('Reveal transcript file'), icon: <FileSearch size={14} />, run: () => void invoke('sessions:revealTranscript', m.id) },
    { label: t('Copy session ID'), icon: <Copy size={14} />, run: () => void navigator.clipboard.writeText(m.id) }
  ])
}

function SessionRow({ m, active }: { m: SessionMeta; active: boolean }) {
  const t = useT()
  const st = statusOf(m)
  return (
    <div className={`session-row${active ? ' active' : ''}`} onClick={() => void useSessions.getState().activate(m.id)} onContextMenu={(e) => sessionMenu(e, m, t)}>
      <span className={`dot ${st.cls}`} />
      <div className="session-text">
        <div className="session-title truncate">{sessionTitle(m)}</div>
        <div className="session-meta truncate">
          {st.label ? <span className="session-live-label">{t(st.label)}</span> : ago(m.updatedAt)}
          <span className="sep">·</span>
          {originLabel(m.entrypoint)}
          <span className="sep">·</span>
          {bytes(m.size)}
        </div>
      </div>
    </div>
  )
}

function Group({ title, path, sessions, activeId, defaultOpen }: { title: string; path?: string | null; sessions: SessionMeta[]; activeId: string | null; defaultOpen: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(defaultOpen)
  const [limit, setLimit] = useState(25)
  return (
    <div className="session-group">
      <div className="section-head" onClick={() => setOpen(!open)} data-tip={path ?? undefined}>
        <ChevronRight size={14} strokeWidth={2} className={`chev${open ? ' open' : ''}`} />
        <span className="grow truncate">{title}</span>
        <span className="badge">{sessions.length}</span>
      </div>
      {open && (
        <>
          {sessions.slice(0, limit).map((m) => (
            <SessionRow key={m.id} m={m} active={m.id === activeId} />
          ))}
          {sessions.length > limit && (
            <button className="show-more" onClick={() => setLimit(limit + 50)}>
              {t('Show {count} more…', { count: Math.min(50, sessions.length - limit) })}
            </button>
          )}
        </>
      )}
    </div>
  )
}

export function SessionsView() {
  const t = useT()
  const groups = useSessions((s) => s.groups)
  const live = useSessions((s) => s.live)
  const activeId = useSessions((s) => s.activeId)
  const loading = useSessions((s) => s.listLoading)
  const workspace = useApp((s) => s.workspace)
  const [filter, setFilter] = useState('')

  const { liveMetas, here, others } = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const match = (m: SessionMeta) => !f || sessionTitle(m).toLowerCase().includes(f) || (m.cwd ?? '').toLowerCase().includes(f) || m.id.startsWith(f)
    const all = groups.flatMap((g) => g.sessions)
    const liveIds = new Set(live.map((l) => l.sessionId))
    const liveMetas = live
      .map((l) => {
        const m = all.find((x) => x.id === l.sessionId)
        return m
          ? { ...m, live: l }
          : ({
              id: l.sessionId,
              file: '',
              projectSlug: '',
              cwd: l.cwd,
              title: l.name,
              firstPrompt: null,
              createdAt: l.startedAt ?? Date.now(),
              updatedAt: l.statusUpdatedAt ?? Date.now(),
              size: 0,
              entrypoint: l.entrypoint,
              gitBranch: null,
              version: l.version,
              live: l,
              startedByClauditor: false,
              desktop: null,
              forkedFrom: null
            } satisfies SessionMeta)
      })
      .filter(match)
    const here = workspace ? groups.filter((g) => g.cwd && P.samePath(g.cwd, workspace.root)) : []
    const others = groups.filter((g) => !here.includes(g))
    const strip = (list: SessionMeta[]) => list.filter((m) => !liveIds.has(m.id) && match(m))
    return {
      liveMetas,
      here: here.flatMap((g) => strip(g.sessions)),
      others: others.map((g) => ({ ...g, sessions: strip(g.sessions) })).filter((g) => g.sessions.length > 0)
    }
  }, [groups, live, workspace, filter])

  return (
    <div className="view">
      <div className="view-head">
        <span className="view-title">{t('Claude sessions')}</span>
        <button className="icon-btn sm" data-tip={t('New session in Clauditor')} data-tip-keys="Ctrl+Alt+N" onClick={() => {
          void useSessions.getState().activate(null)
          focusComposer.emit({})
        }}>
          <Plus size={16} strokeWidth={1.7} />
        </button>
        <button className="icon-btn sm" data-tip={t('New session in Claude desktop')} onClick={() => void newDesktopSession()}>
          <ExternalLink size={14} strokeWidth={1.7} />
        </button>
        <button className="icon-btn sm" data-tip={t('Reload')} onClick={() => void useSessions.getState().refreshList()}>
          <RefreshCw size={14} strokeWidth={1.7} className={loading ? 'spin' : ''} />
        </button>
      </div>
      <div className="sessions-filter">
        <Search size={14} strokeWidth={1.8} />
        <input className="input" placeholder={t('Filter sessions…')} value={filter} onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
      </div>
      <div className="sessions-scroll">
        {liveMetas.length > 0 && (
          <div className="session-group">
            <div className="section-head static">
              <span className="dot live small" />
              <span className="grow">{t('Running now')}</span>
              <span className="badge">{liveMetas.length}</span>
            </div>
            {liveMetas.map((m) => (
              <SessionRow key={m.id} m={m} active={m.id === activeId} />
            ))}
          </div>
        )}
        {workspace && <Group title={t('This project · {name}', { name: workspace.name })} path={workspace.root} sessions={here} activeId={activeId} defaultOpen />}
        {others.map((g) => (
          <Group key={g.slug} title={g.cwd ? P.basename(g.cwd) : slugLabel(g.slug)} path={g.cwd} sessions={g.sessions} activeId={activeId} defaultOpen={!workspace && others.length <= 3} />
        ))}
        {!loading && groups.length === 0 && (
          <div className="empty-state">
            <Sparkles size={26} strokeWidth={1.4} />
            <strong>{t('No Claude Code sessions yet')}</strong>
            <span>{t('Sessions from Claude desktop and the Claude Code CLI will appear here automatically.')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
