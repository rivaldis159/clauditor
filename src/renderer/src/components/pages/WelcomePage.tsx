import { CircleCheck, CircleDashed, ExternalLink, FolderOpen, Plug, Sparkles, SquareTerminal } from 'lucide-react'
import { Logo } from '@/components/common/Logo'
import { FolderIcon } from '@/lib/fileIcons'
import { getCommand, prettyKeys, runCommand } from '@/lib/commands'
import { ago } from '@/lib/format'
import { tk, useT } from '@/lib/i18n'
import * as P from '@/lib/paths'
import { invoke } from '@/lib/ipc'
import { useApp } from '@/state/app'
import { loginClaude, sessionTitle, useSessions } from '@/state/sessions'
import { useTerminals } from '@/state/terminals'
import { openFolder } from '@/state/workspace'

const SHORTCUTS: { id: string; label: string }[] = [
  { id: 'workbench.quickOpen', label: tk('Quick open file') },
  { id: 'workbench.palette', label: tk('Command palette') },
  { id: 'claude.focusComposer', label: tk('Message Claude') },
  { id: 'claude.follow', label: tk('Claude follow mode') },
  { id: 'claude.addSelection', label: tk('Add selection to message') },
  { id: 'terminal.toggle', label: tk('Terminal') },
  { id: 'view.agent', label: tk('Claude panel') }
]

export function WelcomePage() {
  const t = useT()
  const info = useApp((s) => s.info)
  const recent = useApp((s) => s.persisted.recentFolders)
  const ide = useApp((s) => s.ide)
  const workspace = useApp((s) => s.workspace)
  const live = useSessions((s) => s.live)
  const groups = useSessions((s) => s.groups)
  const signedOut = useSessions((s) => s.auth?.loggedIn === false)
  const latest = groups
    .flatMap((g) => g.sessions)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5)

  return (
    <div className="page welcome">
      <div className="welcome-glow" />
      <div className="welcome-inner">
        <header className="welcome-hero">
          <Logo size={52} />
          <div>
            <h1>Clauditor</h1>
            <p>{t('A code studio for Claude Code — watch Claude build your project step by step, right in the editor.')}</p>
          </div>
        </header>

        <div className="welcome-grid">
          <section className="welcome-col">
            <h3>{t('Start')}</h3>
            <button className="welcome-action" onClick={() => void openFolder()}>
              <FolderOpen size={16} /> {t('Open project folder…')}
            </button>
            <button className="welcome-action" onClick={() => runCommand('claude.newSession')}>
              <Sparkles size={16} /> {t('New Claude session in Clauditor')}
            </button>
            <button className="welcome-action" disabled={!workspace} onClick={() => workspace && void invoke('desktop:newSession', workspace.root)}>
              <ExternalLink size={16} /> {t('New session in Claude desktop')}
            </button>
            <button className="welcome-action" onClick={() => void useTerminals.getState().create({ profile: 'claude', name: 'Claude Code' })}>
              <SquareTerminal size={16} /> {t('Claude Code CLI in a terminal')}
            </button>

            {recent.length > 0 && (
              <>
                <h3>{t('Recent folders')}</h3>
                {recent.slice(0, 7).map((f) => (
                  <button key={f} className="welcome-recent" onClick={() => void openFolder(f)}>
                    <FolderIcon name={P.basename(f)} open={false} size={15} />
                    <span className="welcome-recent-name">{P.basename(f)}</span>
                    <span className="welcome-recent-path truncate">{P.dirname(f)}</span>
                  </button>
                ))}
              </>
            )}
          </section>

          <section className="welcome-col">
            <h3>{t('Claude connection')}</h3>
            <div className="welcome-status">
              <div className="ws-row">
                {info?.claudeExe && !signedOut ? <CircleCheck size={15} className="ok" /> : <CircleDashed size={15} className="warn" />}
                <div className="ws-text">
                  <div className="ws-title">{info?.claudeExe ? `Claude Code ${info.claudeExe.version ?? ''}`.trim() : t('Claude Code not found')}</div>
                  {!info?.claudeExe ? (
                    <div className="ws-sub">{t('Install Claude desktop or set its location in Settings')}</div>
                  ) : signedOut ? (
                    <div className="ws-sub">
                      {t('You need to sign in to run Claude from Clauditor.')}{' '}
                      <button className="ws-link" onClick={() => void loginClaude()}>
                        {t('Sign in now')}
                      </button>
                    </div>
                  ) : (
                    <div className="ws-sub truncate">{info.claudeExe.source === 'desktop' ? t('Shared with Claude desktop') : info.claudeExe.path}</div>
                  )}
                </div>
              </div>
              <div className="ws-row">
                {ide?.enabled ? <Plug size={15} className="ok" /> : <CircleDashed size={15} className="warn" />}
                <div className="ws-text">
                  <div className="ws-title">{ide?.enabled ? t('IDE bridge on') : t('IDE bridge off')}</div>
                  <div className="ws-sub">{ide?.enabled ? t('Claude Code CLI can open diffs and read selections in Clauditor (port {port})', { port: ide.port ?? '' }) : t('Turn on in Settings → Claude')}</div>
                </div>
              </div>
              <div className="ws-row">
                {live.length ? <span className="dot live" /> : <span className="dot" />}
                <div className="ws-text">
                  <div className="ws-title">{live.length ? t.n(live.length, '{n} Claude session running', '{n} Claude sessions running') : t('No sessions running')}</div>
                  <div className="ws-sub">{t('Sessions from Claude desktop and the CLI are followed live')}</div>
                </div>
              </div>
            </div>

            {latest.length > 0 && (
              <>
                <h3>{t('Recent sessions')}</h3>
                {latest.map((m) => (
                  <button key={m.id} className="welcome-recent" onClick={() => void useSessions.getState().activate(m.id)}>
                    <Sparkles size={14} className={live.some((l) => l.sessionId === m.id) ? 'accent' : 'faint'} />
                    <span className="welcome-recent-name truncate">{sessionTitle(m)}</span>
                    <span className="welcome-recent-path">{ago(m.updatedAt)}</span>
                  </button>
                ))}
              </>
            )}

            <h3>{t('Shortcuts')}</h3>
            <div className="welcome-keys">
              {SHORTCUTS.map(({ id, label }) => {
                const c = getCommand(id)
                if (!c) return null
                return (
                  <button key={id} className="welcome-key" onClick={() => runCommand(id)}>
                    <span className="truncate">{t(label)}</span>
                    <span className="hint-keys">
                      {prettyKeys(c.keys).map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        </div>
        <footer className="welcome-foot">
          Clauditor {info?.version} · Electron {info?.electron} · {info?.claudeHome}
        </footer>
      </div>
    </div>
  )
}
