import { Fragment, useRef, useState } from 'react'
import { useT } from '@/lib/i18n'
import { useEditors, type Group } from '@/state/editors'
import { Sash } from '@/components/common/Sash'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { TabBar, tabLabel } from './TabBar'
import { Breadcrumbs } from './Breadcrumbs'
import { CodeEditorHost } from './CodeEditorHost'
import { DiffHost } from './DiffHost'
import { IdeDiffHost } from './IdeDiffHost'
import { EmptyEditor } from './EmptyEditor'
import { WelcomePage } from '@/components/pages/WelcomePage'
import { SettingsPage } from '@/components/pages/SettingsPage'
import { OverviewPage } from '@/components/pages/OverviewPage'
import { ReplayPage } from '@/components/pages/ReplayPage'
import { MarkdownPreview } from '@/components/pages/MarkdownPreview'

function EditorGroup({ group, active }: { group: Group; active: boolean }) {
  const t = useT()
  const tab = group.tabs.find((x) => x.id === group.activeId) ?? null
  const fileTab = tab?.kind === 'file' ? tab : null
  return (
    <div className={`editor-group${active ? ' active' : ''}`} onPointerDownCapture={() => useEditors.getState().focusGroup(group.id)}>
      <TabBar group={group} active={active} />
      {tab && (tab.kind === 'file' || tab.kind === 'markdown') && <Breadcrumbs path={tab.path} />}
      <div className="editor-content">
        <ErrorBoundary area={t('Editor')}>
          <CodeEditorHost groupId={group.id} tab={fileTab} />
        </ErrorBoundary>
        {tab && tab.kind !== 'file' && (
          <ErrorBoundary key={tab.id} area={tabLabel(tab, t)}>
            {tab.kind === 'diff' && <DiffHost tab={tab} />}
            {tab.kind === 'ide-diff' && <IdeDiffHost tab={tab} />}
            {tab.kind === 'welcome' && <WelcomePage />}
            {tab.kind === 'settings' && <SettingsPage />}
            {tab.kind === 'overview' && <OverviewPage sessionId={tab.sessionId} />}
            {tab.kind === 'replay' && <ReplayPage sessionId={tab.sessionId} />}
            {tab.kind === 'markdown' && <MarkdownPreview path={tab.path} />}
          </ErrorBoundary>
        )}
        {!tab && <EmptyEditor />}
      </div>
    </div>
  )
}

export function EditorArea() {
  const groups = useEditors((s) => s.groups)
  const activeGroupId = useEditors((s) => s.activeGroupId)
  const [weights, setWeights] = useState<Record<string, number>>({})
  const slots = useRef(new Map<string, HTMLDivElement>())
  const weight = (id: string) => weights[id] ?? 1

  return (
    <div className="editor-area">
      {groups.map((g, i) => {
        const prev = groups[i - 1]
        const leftEl = prev ? slots.current.get(prev.id) : undefined
        const rightEl = slots.current.get(g.id)
        const pair = (leftEl?.offsetWidth ?? 0) + (rightEl?.offsetWidth ?? 0)
        return (
          <Fragment key={g.id}>
            {prev && (
              <Sash
                axis="x"
                size={leftEl?.offsetWidth ?? 400}
                min={220}
                max={Math.max(240, pair - 220)}
                sign={1}
                onResize={(leftPx) => {
                  const total = weight(prev.id) + weight(g.id)
                  const lw = (leftPx / Math.max(1, pair)) * total
                  setWeights((w) => ({ ...w, [prev.id]: lw, [g.id]: total - lw }))
                }}
                onReset={() => setWeights({})}
              />
            )}
            <div
              className="editor-group-slot"
              ref={(el) => {
                if (el) slots.current.set(g.id, el)
                else slots.current.delete(g.id)
              }}
              style={{ flex: `${weight(g.id)} 1 0` }}
            >
              <EditorGroup group={g} active={g.id === activeGroupId && groups.length > 1} />
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
