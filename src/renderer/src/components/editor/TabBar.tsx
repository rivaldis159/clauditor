import { useEffect, useRef, useState } from 'react'
import { Columns2, Ellipsis, FileDiff, Gauge, Home, Play, Settings, Sparkles, X } from 'lucide-react'
import { FileIcon } from '@/lib/fileIcons'
import * as P from '@/lib/paths'
import { invoke } from '@/lib/ipc'
import { useT, type T } from '@/lib/i18n'
import { useApp } from '@/state/app'
import { useEditors, type Group, type Tab } from '@/state/editors'
import { useActivity } from '@/state/activity'
import { useExplorer } from '@/state/explorer'

/** Text shown for a tab. Fixed pages are named here so their tabs follow a language change. */
export function tabLabel(tab: Tab, t: T): string {
  switch (tab.kind) {
    case 'settings':
      return t('Settings')
    case 'welcome':
      return t('Welcome')
    case 'markdown':
      return t('Preview {name}', { name: P.basename(tab.path) })
    default:
      return tab.title
  }
}

function TabIcon({ tab }: { tab: Tab }) {
  switch (tab.kind) {
    case 'file':
    case 'markdown':
      return <FileIcon name={P.basename(tab.path)} />
    case 'diff':
      return <FileDiff size={15} strokeWidth={1.7} className="tab-kind-icon diff" />
    case 'ide-diff':
      return <Sparkles size={15} strokeWidth={1.7} className="tab-kind-icon claude" />
    case 'welcome':
      return <Home size={15} strokeWidth={1.7} className="tab-kind-icon" />
    case 'settings':
      return <Settings size={15} strokeWidth={1.7} className="tab-kind-icon" />
    case 'overview':
      return <Gauge size={15} strokeWidth={1.7} className="tab-kind-icon claude" />
    case 'replay':
      return <Play size={15} strokeWidth={1.7} className="tab-kind-icon claude" />
  }
}

function TabItem({ group, tab, active, label, hint }: { group: Group; tab: Tab; active: boolean; label: string; hint: string | null }) {
  const t = useT()
  const pathKey = tab.kind === 'file' ? P.key(tab.path) : null
  const dirty = useEditors((s) => (pathKey ? !!s.dirty[pathKey] : false))
  const conflict = useEditors((s) => (pathKey ? !!s.conflicts[pathKey] : false))
  const deleted = useEditors((s) => (pathKey ? !!s.deleted[pathKey] : false))
  const working = useActivity((s) => (pathKey ? s.working[pathKey] : undefined))
  const typing = useActivity((s) => (pathKey ? !!s.typing[pathKey] : false))
  const touched = useActivity((s) => (pathKey ? !!s.touched[pathKey] : false))
  const ref = useRef<HTMLDivElement>(null)
  const st = useEditors.getState()

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const menu = (e: React.MouseEvent) => {
    e.preventDefault()
    const path = 'path' in tab ? tab.path : null
    useApp.getState().showContextMenu(e, [
      { label: t('Close'), shortcut: 'Ctrl+W', run: () => void st.closeTab(group.id, tab.id) },
      { label: t('Close others'), run: () => void st.closeOthers(group.id, tab.id) },
      { label: t('Close to the right'), run: () => void st.closeToRight(group.id, tab.id) },
      { label: t('Close all'), run: () => void st.closeAll() },
      { separator: true },
      ...(tab.preview ? [{ label: t('Keep open'), run: () => st.pin(group.id, tab.id) }] : []),
      ...(path
        ? [
            { label: t('Copy path'), run: () => void navigator.clipboard.writeText(path) },
            { label: t('Copy relative path'), run: () => void navigator.clipboard.writeText(P.displayPath(path, useApp.getState().workspace?.root)) },
            {
              label: t('Reveal in Explorer'),
              run: () => {
                useApp.getState().setLayout({ sidebarVisible: true, activeView: 'explorer' })
                void useExplorer.getState().reveal(path)
              }
            },
            { label: t('Reveal in File Explorer'), run: () => void invoke('app:revealPath', path) }
          ]
        : []),
      { separator: true },
      { label: t('Split right'), run: () => st.split() }
    ])
  }

  return (
    <div
      ref={ref}
      className={`tab${active ? ' active' : ''}${tab.preview ? ' preview' : ''}${dirty ? ' dirty' : ''}${working || typing ? ' claude-working' : ''}`}
      onPointerDown={(e) => {
        if (e.button === 0) st.setActive(group.id, tab.id)
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          void st.closeTab(group.id, tab.id)
        }
      }}
      onDoubleClick={() => st.pin(group.id, tab.id)}
      onContextMenu={menu}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-clauditor-tab', JSON.stringify({ groupId: group.id, tabId: tab.id }))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-clauditor-tab')) {
          e.preventDefault()
          e.currentTarget.classList.add('drop-before')
        }
      }}
      onDragLeave={(e) => e.currentTarget.classList.remove('drop-before')}
      onDrop={(e) => {
        e.currentTarget.classList.remove('drop-before')
        const raw = e.dataTransfer.getData('application/x-clauditor-tab')
        if (!raw) return
        e.preventDefault()
        e.stopPropagation()
        const src = JSON.parse(raw) as { groupId: string; tabId: string }
        const index = group.tabs.findIndex((t) => t.id === tab.id)
        st.moveTab(src.groupId, src.tabId, group.id, index)
      }}
      data-tip={'path' in tab ? tab.path : label}
    >
      {(working || typing) && <span className="tab-ember" />}
      <TabIcon tab={tab} />
      <span className={`tab-label${deleted ? ' deleted' : ''}${conflict ? ' conflict' : ''}`}>{label}</span>
      {hint && <span className="tab-hint">{hint}</span>}
      {touched && !working && !typing && <span className="tab-touched" />}
      <button
        className="tab-close"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          void st.closeTab(group.id, tab.id)
        }}
        aria-label={t('Close')}
      >
        <span className="tab-dirty-dot" />
        <X size={14} strokeWidth={1.9} className="tab-x" />
      </button>
    </div>
  )
}

export function TabBar({ group, active }: { group: Group; active: boolean }) {
  const t = useT()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  const st = useEditors.getState()

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [group.tabs.length])

  // disambiguate duplicate file names with their parent folder
  const names = new Map<string, number>()
  for (const tab of group.tabs) names.set(tab.title, (names.get(tab.title) ?? 0) + 1)

  return (
    <div className={`tabbar${active ? ' group-active' : ''}`}>
      <div
        className={`tabs${overflow ? ' overflow' : ''}`}
        ref={scrollRef}
        onWheel={(e) => {
          if (scrollRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) scrollRef.current.scrollLeft += e.deltaY
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-clauditor-tab')) e.preventDefault()
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData('application/x-clauditor-tab')
          if (!raw) return
          const src = JSON.parse(raw) as { groupId: string; tabId: string }
          st.moveTab(src.groupId, src.tabId, group.id, group.tabs.length)
        }}
      >
        {group.tabs.map((tab) => {
          const dup = (names.get(tab.title) ?? 0) > 1 && 'path' in tab
          const hint = dup && 'path' in tab ? P.basename(P.dirname(tab.path)) : null
          return <TabItem key={tab.id} group={group} tab={tab} active={tab.id === group.activeId} label={tabLabel(tab, t)} hint={hint} />
        })}
      </div>
      <div className="tabbar-actions">
        <button className="icon-btn sm" data-tip={t('Split editor right')} data-tip-keys="Ctrl+\" onClick={() => st.split()}>
          <Columns2 size={15} strokeWidth={1.7} />
        </button>
        <button
          className="icon-btn sm"
          data-tip={t('More actions')}
          onClick={(e) =>
            useApp.getState().showContextMenu(e, [
              { label: t('Close all'), run: () => void st.closeAll() },
              { label: t('Close saved'), run: () => st.closeWhere((tab) => tab.kind !== 'file' || !useEditors.getState().dirty[P.key(tab.path)]) },
              { separator: true },
              { label: t('Reopen closed tab'), shortcut: 'Ctrl+Shift+T', run: () => st.reopenClosed() }
            ])
          }
        >
          <Ellipsis size={15} />
        </button>
      </div>
    </div>
  )
}
