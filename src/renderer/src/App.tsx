import { useEffect, useState } from 'react'
import { TitleBar } from '@/components/titlebar/TitleBar'
import { ActivityBar } from '@/components/activitybar/ActivityBar'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { EditorArea } from '@/components/editor/EditorArea'
import { BottomPanel } from '@/components/panel/BottomPanel'
import { AgentPanel } from '@/components/agent/AgentPanel'
import { StatusBar } from '@/components/statusbar/StatusBar'
import { Sash } from '@/components/common/Sash'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { TooltipLayer } from '@/components/common/Tooltip'
import { Palette } from '@/components/overlays/Palette'
import { ContextMenu } from '@/components/overlays/ContextMenu'
import { Dialogs } from '@/components/overlays/Dialogs'
import { Toasts } from '@/components/overlays/Toasts'
import { useT } from '@/lib/i18n'
import { useApp } from '@/state/app'
import { useSessions } from '@/state/sessions'

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return size
}

export function App() {
  const t = useT()
  const layout = useApp((s) => s.layout)
  const setLayout = useApp((s) => s.setLayout)
  const follow = useSessions((s) => s.follow)
  const { w, h } = useWindowSize()

  // keep panes inside the window when it shrinks
  const maxSide = Math.max(200, Math.min(640, w - 520))
  const sidebarW = Math.min(layout.sidebarWidth, maxSide)
  const agentW = Math.min(layout.agentWidth, Math.max(320, w - (layout.sidebarVisible ? sidebarW : 0) - 48 - 360))
  const panelH = Math.min(layout.panelHeight, Math.max(120, h - 260))

  return (
    <div className="app" data-follow={follow ? 'on' : 'off'}>
      <TitleBar />
      <div className="workbench">
        <ActivityBar />
        {layout.sidebarVisible && (
          <>
            <aside className="sidebar" style={{ width: sidebarW }}>
              <ErrorBoundary area={t('Sidebar')}>
                <Sidebar />
              </ErrorBoundary>
            </aside>
            <Sash axis="x" size={sidebarW} min={180} max={maxSide} sign={1} onResize={(v) => setLayout({ sidebarWidth: v })} onReset={() => setLayout({ sidebarWidth: 272 })} />
          </>
        )}
        <div className="main-col">
          <EditorArea />
          {layout.panelVisible && (
            <>
              <Sash axis="y" size={panelH} min={110} max={Math.max(140, h - 220)} sign={-1} onResize={(v) => setLayout({ panelHeight: v })} onReset={() => setLayout({ panelHeight: 248 })} />
              <section className="bottom-panel" style={{ height: panelH }}>
                <ErrorBoundary area={t('Panel')}>
                  <BottomPanel />
                </ErrorBoundary>
              </section>
            </>
          )}
        </div>
        {layout.agentVisible && (
          <>
            <Sash axis="x" size={agentW} min={320} max={Math.max(360, w - 560)} sign={-1} onResize={(v) => setLayout({ agentWidth: v })} onReset={() => setLayout({ agentWidth: 440 })} />
            <aside className="agent" style={{ width: agentW }}>
              <ErrorBoundary area={t('Claude panel')}>
                <AgentPanel />
              </ErrorBoundary>
            </aside>
          </>
        )}
      </div>
      <StatusBar />
      <Palette />
      <ContextMenu />
      <Dialogs />
      <Toasts />
      <TooltipLayer />
    </div>
  )
}
