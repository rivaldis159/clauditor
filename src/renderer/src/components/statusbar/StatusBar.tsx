import { ArrowDown, ArrowUp, CircleX, Eye, EyeOff, GitBranch, Plug, TriangleAlert } from 'lucide-react'
import { useApp } from '@/state/app'
import { useGit } from '@/state/git'
import { useSessions, runnerForSession, sessionTitle } from '@/state/sessions'
import { useEditorStatus } from '@/state/status'
import { useEditors } from '@/state/editors'
import { languageLabel } from '@/lib/monaco'
import { runCommand } from '@/lib/commands'
import { useT } from '@/lib/i18n'

const ENC: Record<string, string> = { utf8: 'UTF-8', utf8bom: 'UTF-8 BOM', utf16le: 'UTF-16 LE', utf16be: 'UTF-16 BE', windows1252: 'Windows 1252' }

function ClaudeItem() {
  const t = useT()
  const activeId = useSessions((s) => s.activeId)
  const data = useSessions((s) => (s.activeId ? s.data[s.activeId] : undefined))
  const follow = useSessions((s) => s.follow)
  const runners = useSessions((s) => s.runners)
  const signedOut = useSessions((s) => s.auth?.loggedIn === false)
  const runner = runnerForSession({ runners }, activeId)
  if (!activeId || !data) {
    if (signedOut) {
      return (
        <button className="sb-item" onClick={() => runCommand('claude.login')} data-tip={t('Sign in so Claude can run from Clauditor')} data-tip-place="above">
          <span className="dot warn" />
          <span>{t('Claude not signed in')}</span>
        </button>
      )
    }
    return (
      <button className="sb-item" onClick={() => runCommand('claude.newSession')} data-tip={t('Start a Claude Code session in Clauditor')} data-tip-place="above">
        <span className="dot" />
        <span>{t('Claude ready')}</span>
      </button>
    )
  }
  const live = data.meta.live
  const busy = live?.status === 'busy' || runner?.state === 'running' || runner?.state === 'starting'
  const state = busy ? t('busy') : live || (runner && runner.state === 'idle') ? t('waiting') : t('done')
  return (
    <>
      <button className={`sb-item sb-claude${busy ? ' busy' : ''}`} onClick={() => useApp.getState().toggleAgent(true)} data-tip={t('Current Claude session')} data-tip-place="above">
        <span className={`dot${busy ? ' live' : live || runner ? ' idle' : ''}`} />
        <span className="truncate sb-claude-title">{sessionTitle(data.meta)}</span>
        <span className="sb-sep">·</span>
        <span>{state}</span>
      </button>
      <button
        className={`sb-item sb-icon${follow ? ' on' : ''}`}
        onClick={() => runCommand('claude.follow')}
        data-tip={follow ? t('Following: files Claude edits open automatically') : t('Follow mode off')}
        data-tip-keys="Ctrl+Alt+F"
        data-tip-place="above"
      >
        {follow ? <Eye size={14} strokeWidth={1.8} /> : <EyeOff size={14} strokeWidth={1.8} />}
        <span>{follow ? t('Following') : t('Not following')}</span>
      </button>
    </>
  )
}

export function StatusBar() {
  const t = useT()
  const git = useGit((s) => s.status)
  const busy = useGit((s) => s.busy)
  const problems = useApp((s) => s.problems)
  const ide = useApp((s) => s.ide)
  const st = useEditorStatus()
  const hasEditor = useEditors((s) => {
    const g = s.groups.find((x) => x.id === s.activeGroupId)
    const tab = g?.tabs.find((x) => x.id === g.activeId)
    return tab?.kind === 'file'
  })
  const a = useApp.getState()

  return (
    <footer className="statusbar">
      <div className="sb-left">
        {git?.isRepo ? (
          <button className="sb-item" onClick={() => a.openPalette('branches')} data-tip={t('Switch branch')} data-tip-place="above">
            <GitBranch size={14} strokeWidth={1.8} />
            <span className="truncate sb-branch">{git.branch ?? (git.detached ? t('Detached HEAD') : '—')}</span>
            {busy && <span className="sb-busy">{busy}…</span>}
            {(git.ahead > 0 || git.behind > 0) && (
              <span className="sb-sync">
                {git.behind > 0 && (
                  <>
                    <ArrowDown size={12} strokeWidth={2} />
                    {git.behind}
                  </>
                )}
                {git.ahead > 0 && (
                  <>
                    <ArrowUp size={12} strokeWidth={2} />
                    {git.ahead}
                  </>
                )}
              </span>
            )}
          </button>
        ) : null}
        <button className="sb-item" onClick={() => runCommand('view.problems')} data-tip={t('Problems')} data-tip-keys="Ctrl+Shift+M" data-tip-place="above">
          <CircleX size={14} strokeWidth={1.8} />
          <span>{problems.errors}</span>
          <TriangleAlert size={14} strokeWidth={1.8} />
          <span>{problems.warnings}</span>
        </button>
        <ClaudeItem />
      </div>
      <div className="sb-right">
        {hasEditor && (
          <>
            <button className="sb-item" onClick={() => runCommand('workbench.gotoLine')} data-tip={t('Go to line')} data-tip-place="above">
              {t('Ln {line}, Col {column}', { line: st.line, column: st.column })}
              {st.selected > 0 && <span className="muted"> {t('({count} selected)', { count: st.selected })}</span>}
            </button>
            <span className="sb-item static">{st.insertSpaces ? t('Spaces: {size}', { size: st.tabSize }) : t('Tab size: {size}', { size: st.tabSize })}</span>
            <span className="sb-item static">{ENC[st.encoding] ?? st.encoding}</span>
            <span className="sb-item static">{st.eol}</span>
            <span className="sb-item static">{languageLabel(st.language)}</span>
          </>
        )}
        <span
          className={`sb-item static sb-ide${ide?.clients.length ? ' connected' : ''}`}
          data-tip={
            ide?.enabled
              ? t.n(
                  ide.clients.length,
                  'IDE bridge active on port {port} — {n} Claude Code session connected',
                  'IDE bridge active on port {port} — {n} Claude Code sessions connected',
                  { port: String(ide.port) }
                )
              : ide?.error
                ? t('IDE bridge failed: {error}', { error: ide.error })
                : t('IDE bridge off')
          }
          data-tip-place="above"
        >
          <Plug size={13} strokeWidth={1.9} />
          <span>{ide?.clients.length ? `IDE · ${ide.clients.length}` : 'IDE'}</span>
        </span>
      </div>
    </footer>
  )
}
