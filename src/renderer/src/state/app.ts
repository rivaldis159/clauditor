import { create } from 'zustand'
import type { AppInfo, AppState, DeepPartial, IdeBridgeStatus, LayoutState, Settings, SidebarView, ToastMessage, WorkspaceInfo } from '@shared/types'
import { defaultAppState, defaultSettings, deepMerge } from '@shared/defaults'
import { t } from '@/lib/i18n'
import { errorText, invoke } from '@/lib/ipc'

export type ResolvedTheme = 'dark' | 'light'

export interface DialogButton {
  label: string
  value: string
  kind?: 'primary' | 'danger' | 'ghost'
}

export interface DialogRequest {
  id: string
  title: string
  message?: string
  detail?: string
  buttons: DialogButton[]
  input?: { value: string; placeholder?: string; select?: [number, number] }
  resolve: (r: { button: string | null; value?: string }) => void
}

export interface ContextMenuItem {
  label?: string
  icon?: React.ReactNode
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  run?: () => void
}

export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

export type PaletteMode = 'commands' | 'files' | 'sessions' | 'goto' | 'branches' | 'recent'

interface AppStore {
  info: AppInfo | null
  settings: Settings
  persisted: AppState
  theme: ResolvedTheme
  layout: LayoutState
  workspace: WorkspaceInfo | null
  ide: IdeBridgeStatus | null
  maximized: boolean
  palette: { open: boolean; mode: PaletteMode; query: string }
  dialogs: DialogRequest[]
  toasts: ToastMessage[]
  contextMenu: ContextMenuState | null
  panelTab: 'terminal' | 'problems' | 'output'
  problems: { errors: number; warnings: number }

  init(): Promise<void>
  updateSettings(patch: DeepPartial<Settings>): Promise<void>
  setLayout(patch: Partial<LayoutState>): void
  showView(view: SidebarView): void
  toggleSidebar(): void
  togglePanel(force?: boolean): void
  toggleAgent(force?: boolean): void
  setWorkspace(ws: WorkspaceInfo | null): void
  openPalette(mode: PaletteMode, query?: string): void
  closePalette(): void
  toast(t: Omit<ToastMessage, 'id'> & { id?: string }): string
  dismissToast(id: string): void
  ask(req: Omit<DialogRequest, 'id' | 'resolve'>): Promise<{ button: string | null; value?: string }>
  closeDialog(id: string, button: string | null, value?: string): void
  showContextMenu(e: { clientX: number; clientY: number }, items: ContextMenuItem[]): void
  closeContextMenu(): void
  setPanelTab(tab: 'terminal' | 'problems' | 'output'): void
  setProblems(p: { errors: number; warnings: number }): void
  setIde(s: IdeBridgeStatus): void
}

function resolveTheme(s: Settings): ResolvedTheme {
  if (s.theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return s.theme
}

let layoutTimer: ReturnType<typeof setTimeout> | null = null
let toastSeq = 0
let dialogSeq = 0

export const useApp = create<AppStore>((set, get) => ({
  info: null,
  settings: defaultSettings(),
  persisted: defaultAppState(),
  theme: 'dark',
  layout: defaultAppState().layout,
  workspace: null,
  ide: null,
  maximized: false,
  palette: { open: false, mode: 'commands', query: '' },
  dialogs: [],
  toasts: [],
  contextMenu: null,
  panelTab: 'terminal',
  problems: { errors: 0, warnings: 0 },

  async init() {
    const [info, settings, persisted, ide, maximized] = await Promise.all([
      invoke('app:info'),
      invoke('settings:get'),
      invoke('state:get'),
      invoke('ide:status'),
      invoke('app:isMaximized')
    ])
    set({ info, settings, persisted, layout: persisted.layout, theme: resolveTheme(settings), ide, maximized })
  },

  async updateSettings(patch) {
    const optimistic = deepMerge(get().settings, patch)
    set({ settings: optimistic, theme: resolveTheme(optimistic) })
    try {
      const saved = await invoke('settings:update', patch)
      set({ settings: saved, theme: resolveTheme(saved) })
    } catch (err) {
      get().toast({ level: 'error', title: t("Couldn't save settings"), detail: errorText(err) })
    }
  },

  setLayout(patch) {
    const layout = { ...get().layout, ...patch }
    set({ layout })
    if (layoutTimer) clearTimeout(layoutTimer)
    layoutTimer = setTimeout(() => void invoke('state:update', { layout }), 300)
  },

  showView(view) {
    const { layout } = get()
    if (layout.activeView === view && layout.sidebarVisible) get().setLayout({ sidebarVisible: false })
    else get().setLayout({ activeView: view, sidebarVisible: true })
  },

  toggleSidebar() {
    get().setLayout({ sidebarVisible: !get().layout.sidebarVisible })
  },

  togglePanel(force) {
    get().setLayout({ panelVisible: force ?? !get().layout.panelVisible })
  },

  toggleAgent(force) {
    get().setLayout({ agentVisible: force ?? !get().layout.agentVisible })
  },

  setWorkspace(ws) {
    set({ workspace: ws })
    document.title = ws ? `${ws.name} — Clauditor` : 'Clauditor'
  },

  openPalette(mode, query = '') {
    set({ palette: { open: true, mode, query } })
  },

  closePalette() {
    set({ palette: { ...get().palette, open: false } })
  },

  toast(t) {
    const id = t.id ?? `t${++toastSeq}`
    const toast: ToastMessage = { ...t, id }
    set({ toasts: [...get().toasts.filter((x) => x.id !== id), toast].slice(-5) })
    const timeout = t.timeout ?? (t.level === 'error' ? 9000 : t.actions?.length ? 12000 : 4500)
    if (timeout > 0) setTimeout(() => get().dismissToast(id), timeout)
    return id
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },

  ask(req) {
    return new Promise((resolve) => {
      const id = `d${++dialogSeq}`
      set({ dialogs: [...get().dialogs, { ...req, id, resolve }] })
    })
  },

  closeDialog(id, button, value) {
    const d = get().dialogs.find((x) => x.id === id)
    if (!d) return
    set({ dialogs: get().dialogs.filter((x) => x.id !== id) })
    d.resolve({ button, value })
  },

  showContextMenu(e, items) {
    set({ contextMenu: { x: e.clientX, y: e.clientY, items } })
  },

  closeContextMenu() {
    if (get().contextMenu) set({ contextMenu: null })
  },

  setPanelTab(tab) {
    set({ panelTab: tab })
  },

  setProblems(p) {
    const cur = get().problems
    if (cur.errors !== p.errors || cur.warnings !== p.warnings) set({ problems: p })
  },

  setIde(s) {
    set({ ide: s })
  }
}))

/** Convenience confirm dialog. */
export async function confirm(title: string, message: string, okLabel = t('Continue'), danger = false): Promise<boolean> {
  const r = await useApp.getState().ask({
    title,
    message,
    buttons: [
      { label: t('Cancel'), value: 'cancel', kind: 'ghost' },
      { label: okLabel, value: 'ok', kind: danger ? 'danger' : 'primary' }
    ]
  })
  return r.button === 'ok'
}

export async function prompt(title: string, value = '', placeholder = '', message?: string): Promise<string | null> {
  const dot = value.lastIndexOf('.')
  const r = await useApp.getState().ask({
    title,
    message,
    input: { value, placeholder, select: [0, dot > 0 ? dot : value.length] },
    buttons: [
      { label: t('Cancel'), value: 'cancel', kind: 'ghost' },
      { label: 'OK', value: 'ok', kind: 'primary' }
    ]
  })
  return r.button === 'ok' ? (r.value ?? '').trim() || null : null
}

export function toastError(title: string, err: unknown): void {
  useApp.getState().toast({ level: 'error', title, detail: errorText(err) })
}
