import { useMemo, useState } from 'react'
import { ExternalLink, LoaderCircle, Radio, Sparkles, SquareTerminal } from 'lucide-react'
import { Logo } from '@/components/common/Logo'
import { ago } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { invoke } from '@/lib/ipc'
import * as P from '@/lib/paths'
import { useApp } from '@/state/app'
import { liveForWorkspace, runnerForSession, sessionTitle, useSessions } from '@/state/sessions'
import { useTerminals } from '@/state/terminals'
import { SessionHeader, TodoPanel } from './SessionHeader'
import { PulseStrip } from './PulseStrip'
import { Timeline, type TimelineFilter } from './Timeline'
import { PermissionPrompt } from './PermissionPrompt'
import { Composer } from './Composer'

function StartScreen() {
  const t = useT()
  const workspace = useApp((s) => s.workspace)
  const info = useApp((s) => s.info)
  const live = useSessions((s) => s.live)
  const groups = useSessions((s) => s.groups)
  const here = useMemo(() => {
    if (!workspace) return []
    return groups
      .filter((g) => g.cwd && P.samePath(g.cwd, workspace.root))
      .flatMap((g) => g.sessions)
      .slice(0, 4)
  }, [groups, workspace])
  const liveHere = liveForWorkspace(live, workspace?.root ?? null)
  const s = useSessions.getState()

  return (
    <div className="agent-panel start">
      <div className="start-scroll">
        <div className="start-hero">
          <Logo size={34} />
          <h2>{t('Build with Claude')}</h2>
          <p>{t('Describe what you want to build. Clauditor shows every step Claude takes, live — the files it reads, the code it writes, and the commands it runs.')}</p>
        </div>
        {!info?.claudeExe && (
          <div className="start-warn">
            {t.rich('Claude Code was not found. Install Claude desktop, or set the location of {exe} in Settings.', { exe: <code>claude.exe</code> })}
          </div>
        )}
        {liveHere.length > 0 && (
          <div className="start-section">
            <div className="start-label">
              <Radio size={13} /> {t('Running in this folder')}
            </div>
            {liveHere.map((l) => (
              <button key={l.sessionId} className="start-card live" onClick={() => void s.activate(l.sessionId, { follow: true })}>
                <span className={`dot ${l.status === 'busy' ? 'live' : 'idle'}`} />
                <span className="grow truncate">{l.name ?? t('Claude session')}</span>
                <span className="start-card-meta">{l.status === 'busy' ? t('Working · Follow') : t('Waiting · Follow')}</span>
              </button>
            ))}
          </div>
        )}
        {here.length > 0 && (
          <div className="start-section">
            <div className="start-label">{t('Recent sessions in this project')}</div>
            {here.map((m) => (
              <button key={m.id} className="start-card" onClick={() => void s.activate(m.id)}>
                <Sparkles size={13} className="start-card-icon" />
                <span className="grow truncate">{sessionTitle(m)}</span>
                <span className="start-card-meta">{ago(m.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="start-section">
          <div className="start-label">{t('Other ways to start')}</div>
          <button className="start-card" disabled={!workspace} onClick={() => workspace && void invoke('desktop:newSession', workspace.root)}>
            <ExternalLink size={13} className="start-card-icon" />
            <span className="grow">{t('Start in Claude desktop — Clauditor will follow along')}</span>
          </button>
          <button className="start-card" onClick={() => void useTerminals.getState().create({ profile: 'claude', name: 'Claude Code' })}>
            <SquareTerminal size={13} className="start-card-icon" />
            <span className="grow">{t('Claude Code CLI in the terminal (connected to this editor)')}</span>
          </button>
        </div>
      </div>
      <Composer mode="new" session={null} runner={null} />
    </div>
  )
}

function DesktopLiveBar({ sessionId, busy }: { sessionId: string; busy: boolean }) {
  const t = useT()
  return (
    <div className="desktop-bar">
      <span className={`dot ${busy ? 'live' : 'idle'}`} />
      <div className="grow">
        <div className="desktop-bar-title">{t('This session is running in Claude desktop')}</div>
        <div className="desktop-bar-sub">{t('Clauditor is following it live. Reply or grant permissions in Claude desktop.')}</div>
      </div>
      <button className="btn btn-sm" onClick={() => void invoke('desktop:openSession', sessionId)}>
        <ExternalLink size={13} /> {t('Open')}
      </button>
    </div>
  )
}

export function AgentPanel() {
  const t = useT()
  const activeId = useSessions((s) => s.activeId)
  const data = useSessions((s) => (s.activeId ? s.data[s.activeId] : undefined))
  const opening = useSessions((s) => (s.activeId ? !!s.opening[s.activeId] : false))
  const runners = useSessions((s) => s.runners)
  const streams = useSessions((s) => s.streams)
  const permissions = useSessions((s) => s.permissions)
  const [filter, setFilter] = useState<TimelineFilter>('all')

  if (!activeId) return <StartScreen />
  if (!data) {
    return (
      <div className="agent-panel loading">
        {opening ? (
          <>
            <LoaderCircle size={20} className="spin" />
            <span>{t('Opening session…')}</span>
          </>
        ) : (
          <span className="muted">{t('Session not found.')}</span>
        )}
      </div>
    )
  }

  const runner = runnerForSession({ runners }, activeId)
  const activeRunner = runner && runner.state !== 'stopped' && runner.state !== 'error' ? runner : null
  const stream = activeRunner ? (streams[activeRunner.runId] ?? null) : null
  const live = data.meta.live
  const desktopOwned = !!live && !activeRunner
  const busy = live?.status === 'busy' || activeRunner?.state === 'running' || activeRunner?.state === 'starting'
  const busySince = busy ? (live?.statusUpdatedAt ?? null) : null
  const myPermissions = activeRunner ? permissions.filter((p) => p.runId === activeRunner.runId) : []

  return (
    <div className="agent-panel">
      <SessionHeader
        meta={data.meta}
        stats={data.stats}
        filesChanged={data.files.length}
        busy={!!busy}
        runnerState={activeRunner?.state ?? null}
        filter={filter}
        setFilter={setFilter}
      />
      <PulseStrip sessionId={activeId} events={data.events} live={!!busy} startTs={data.stats.firstTs} />
      {data.todos && data.todos.length > 0 && <TodoPanel todos={data.todos} />}
      <Timeline
        sessionId={activeId}
        events={data.events}
        cwd={data.cwd ?? data.meta.cwd}
        live={!!live || !!activeRunner}
        busy={!!busy}
        busySince={busySince}
        stream={stream}
        filter={filter}
      />
      {myPermissions.length > 0 && (
        <div className="perm-stack">
          {myPermissions.map((p) => (
            <PermissionPrompt key={p.requestId} req={p} />
          ))}
        </div>
      )}
      {desktopOwned ? (
        <DesktopLiveBar sessionId={activeId} busy={!!busy} />
      ) : (
        <Composer mode={activeRunner ? 'runner' : 'resume'} session={data.meta} runner={activeRunner} />
      )}
    </div>
  )
}
