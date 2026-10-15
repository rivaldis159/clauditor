import { Files, GitBranch, Search, Settings, Sparkles } from 'lucide-react'
import type { SidebarView } from '@shared/types'
import { useApp } from '@/state/app'
import { useGit } from '@/state/git'
import { liveForWorkspace, useSessions } from '@/state/sessions'
import { openSettings } from '@/commands'
import { tk, useT } from '@/lib/i18n'

const ITEMS: { view: SidebarView; label: string; keys: string; icon: typeof Files }[] = [
  { view: 'explorer', label: tk('Explorer'), keys: 'Ctrl+Shift+E', icon: Files },
  { view: 'search', label: tk('Search'), keys: 'Ctrl+Shift+F', icon: Search },
  { view: 'scm', label: tk('Source control'), keys: 'Ctrl+Shift+G', icon: GitBranch },
  { view: 'sessions', label: tk('Claude sessions'), keys: 'Ctrl+Shift+A', icon: Sparkles }
]

export function ActivityBar() {
  const t = useT()
  const active = useApp((s) => (s.layout.sidebarVisible ? s.layout.activeView : null))
  const changes = useGit((s) => s.status?.files.length ?? 0)
  const workspace = useApp((s) => s.workspace)
  const live = useSessions((s) => s.live)
  const busyHere = liveForWorkspace(live, workspace?.root ?? null).some((l) => l.status === 'busy')
  const anyLive = live.length > 0

  return (
    <nav className="activitybar">
      <div className="activity-top">
        {ITEMS.map(({ view, label, keys, icon: Icon }) => (
          <button
            key={view}
            className={`activity-item${active === view ? ' active' : ''}`}
            onClick={() => useApp.getState().showView(view)}
            data-tip={t(label)}
            data-tip-keys={keys}
            data-tip-place="right"
          >
            <Icon size={22} strokeWidth={1.5} />
            {view === 'scm' && changes > 0 && <span className="activity-badge">{changes > 99 ? '99+' : changes}</span>}
            {view === 'sessions' && anyLive && <span className={`activity-live${busyHere ? ' busy' : ''}`} />}
          </button>
        ))}
      </div>
      <div className="activity-bottom">
        <button className="activity-item" onClick={openSettings} data-tip={t('Settings')} data-tip-keys="Ctrl+," data-tip-place="right">
          <Settings size={21} strokeWidth={1.5} />
        </button>
      </div>
    </nav>
  )
}
