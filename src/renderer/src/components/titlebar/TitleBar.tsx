import { useEffect, useRef, useState } from 'react'
import { PanelBottom, PanelLeft, PanelRight, Search } from 'lucide-react'
import { Logo } from '@/components/common/Logo'
import { getCommand, prettyKeys, runCommand } from '@/lib/commands'
import { invoke } from '@/lib/ipc'
import { tk, useT, type T } from '@/lib/i18n'
import { useApp, type ContextMenuItem } from '@/state/app'
import { liveForWorkspace, useSessions } from '@/state/sessions'
import { focusedEditor } from '@/state/editorActions'

type MenuEntry = string | '-' | { label: string; run: () => void; keys?: string }

// labels are English source text, translated where they are shown ('Claude' is a product name)
const MENUS: { label: string; items: MenuEntry[] }[] = [
  {
    label: tk('File'),
    items: ['file.new', 'file.openFolder', 'workbench.recent', '-', 'file.save', 'file.saveAll', '-', 'editor.close', 'editor.reopen', 'file.closeFolder', '-', 'app.settings', '-', { label: tk('Exit'), run: () => void invoke('app:windowAction', 'close') }]
  },
  {
    label: tk('Edit'),
    items: [
      { label: tk('Undo'), keys: 'Ctrl+Z', run: () => focusedEditor()?.trigger('menu', 'undo', null) },
      { label: tk('Redo'), keys: 'Ctrl+Y', run: () => focusedEditor()?.trigger('menu', 'redo', null) },
      '-',
      { label: tk('Find'), keys: 'Ctrl+F', run: () => void focusedEditor()?.getAction('actions.find')?.run() },
      { label: tk('Replace'), keys: 'Ctrl+H', run: () => void focusedEditor()?.getAction('editor.action.startFindReplaceAction')?.run() },
      '-',
      'view.search',
      'workbench.gotoLine',
      '-',
      'editor.format'
    ]
  },
  {
    label: tk('View'),
    items: ['workbench.palette', 'workbench.quickOpen', '-', 'view.explorer', 'view.search', 'view.scm', 'view.sessions', 'view.problems', '-', 'view.sidebar', 'view.panel', 'view.agent', 'editor.split', '-', 'app.toggleTheme', 'app.zoomIn', 'app.zoomOut', 'app.zoomReset', 'app.fullscreen']
  },
  {
    label: 'Claude',
    items: [
      'claude.focusComposer',
      'claude.newSession',
      'claude.newDesktop',
      'claude.openInDesktop',
      '-',
      'claude.follow',
      'claude.sessions',
      'claude.overview',
      'claude.replay',
      '-',
      'terminal.claude',
      'claude.addSelection',
      'claude.mention',
      '-',
      'claude.clearHighlights',
      'claude.refreshSessions'
    ]
  },
  { label: tk('Terminal'), items: ['terminal.new', 'terminal.claude', 'terminal.toggle'] },
  {
    label: tk('Help'),
    items: ['app.welcome', 'workbench.palette', '-', 'app.devtools', 'app.reload']
  }
]

function toItems(entries: MenuEntry[], t: T): ContextMenuItem[] {
  const out: ContextMenuItem[] = []
  for (const e of entries) {
    if (e === '-') {
      if (out.length && !out[out.length - 1].separator) out.push({ separator: true })
      continue
    }
    if (typeof e === 'string') {
      const c = getCommand(e)
      if (!c) continue
      out.push({ label: t(c.title), shortcut: prettyKeys(c.keys).join('+'), disabled: c.when ? !c.when() : false, run: () => runCommand(e) })
    } else out.push({ label: t(e.label), shortcut: e.keys, run: e.run })
  }
  while (out.length && out[out.length - 1].separator) out.pop()
  return out
}

function MenuBar() {
  const t = useT()
  const [open, setOpen] = useState<number | null>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const contextMenu = useApp((s) => s.contextMenu)
  useEffect(() => {
    if (!contextMenu) setOpen(null)
  }, [contextMenu])

  const show = (i: number) => {
    const el = refs.current[i]
    if (!el) return
    const r = el.getBoundingClientRect()
    setOpen(i)
    useApp.getState().showContextMenu({ clientX: r.left, clientY: r.bottom + 2 }, toItems(MENUS[i].items, t))
  }

  return (
    <nav className="menubar">
      {MENUS.map((m, i) => (
        <button
          key={m.label}
          ref={(el) => {
            refs.current[i] = el
          }}
          className={`menubar-item${open === i ? ' open' : ''}`}
          onPointerDown={(e) => {
            e.stopPropagation()
            if (open === i) {
              useApp.getState().closeContextMenu()
              setOpen(null)
            } else show(i)
          }}
          onPointerEnter={() => {
            if (open !== null && open !== i) show(i)
          }}
        >
          {t(m.label)}
        </button>
      ))}
    </nav>
  )
}

export function TitleBar() {
  const t = useT()
  const workspace = useApp((s) => s.workspace)
  const layout = useApp((s) => s.layout)
  const live = useSessions((s) => s.live)
  const runners = useSessions((s) => s.runners)
  const working = liveForWorkspace(live, workspace?.root ?? null).some((l) => l.status === 'busy') || Object.values(runners).some((r) => r.state === 'running')
  const a = useApp.getState()

  return (
    <header className={`titlebar${working ? ' is-working' : ''}`}>
      <div className="titlebar-left">
        <div className="titlebar-logo" data-tip={t('Clauditor — a code studio for Claude Code')}>
          <Logo size={18} />
        </div>
        <MenuBar />
      </div>
      <div className="titlebar-center">
        <button className="command-center" onClick={() => a.openPalette('files')} data-tip={t('Search files, commands, and Claude sessions')} data-tip-keys="Ctrl+P">
          <Search size={14} strokeWidth={1.8} />
          <span className="cc-label truncate">{workspace ? workspace.name : 'Clauditor'}</span>
          <span className="cc-hint">
            <kbd>Ctrl</kbd>
            <kbd>P</kbd>
          </span>
        </button>
      </div>
      <div className="titlebar-right">
        <button className={`icon-btn${layout.sidebarVisible ? ' on-soft' : ''}`} onClick={() => a.toggleSidebar()} data-tip={t('Sidebar')} data-tip-keys="Ctrl+B">
          <PanelLeft size={16} strokeWidth={1.7} />
        </button>
        <button className={`icon-btn${layout.panelVisible ? ' on-soft' : ''}`} onClick={() => a.togglePanel()} data-tip={t('Bottom panel')} data-tip-keys="Ctrl+J">
          <PanelBottom size={16} strokeWidth={1.7} />
        </button>
        <button className={`icon-btn${layout.agentVisible ? ' on-soft' : ''}`} onClick={() => a.toggleAgent()} data-tip={t('Claude panel')} data-tip-keys="Ctrl+Alt+B">
          <PanelRight size={16} strokeWidth={1.7} />
        </button>
      </div>
      <div className="titlebar-heat" />
    </header>
  )
}
