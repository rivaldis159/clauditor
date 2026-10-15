import { useApp } from '@/state/app'
import { ExplorerView } from './ExplorerView'
import { SearchView } from './SearchView'
import { ScmView } from './ScmView'
import { SessionsView } from './SessionsView'

export function Sidebar() {
  const view = useApp((s) => s.layout.activeView)
  return (
    <div className="sidebar-inner">
      <div className="sidebar-view" style={{ display: view === 'explorer' ? 'flex' : 'none' }}>
        <ExplorerView />
      </div>
      <div className="sidebar-view" style={{ display: view === 'search' ? 'flex' : 'none' }}>
        <SearchView active={view === 'search'} />
      </div>
      <div className="sidebar-view" style={{ display: view === 'scm' ? 'flex' : 'none' }}>
        <ScmView />
      </div>
      <div className="sidebar-view" style={{ display: view === 'sessions' ? 'flex' : 'none' }}>
        <SessionsView />
      </div>
    </div>
  )
}
