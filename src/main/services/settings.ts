import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { AppState, DeepPartial, Settings } from '@shared/types'
import { LEGACY_FONTS, conform, deepMerge, defaultAppState, defaultSettings } from '@shared/defaults'
import { isLocale } from '@shared/i18n'
import { JsonStore } from '../lib/json-store'

function normalizeSettings(raw: unknown): Settings {
  const s = conform(defaultSettings(), raw)
  if (!isLocale(s.language)) s.language = 'en'
  // untouched font defaults from earlier releases move to Claude's fonts
  s.editor.fontFamily = LEGACY_FONTS[s.editor.fontFamily] ?? s.editor.fontFamily
  s.terminal.fontFamily = LEGACY_FONTS[s.terminal.fontFamily] ?? s.terminal.fontFamily
  return s
}

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

function normalizeState(raw: unknown): AppState {
  const d = defaultAppState()
  const base = conform(d, raw)
  const r = (raw ?? {}) as Partial<AppState>
  base.workspaces = r.workspaces && typeof r.workspaces === 'object' ? r.workspaces : {}
  base.hostSessionIds = r.hostSessionIds && typeof r.hostSessionIds === 'object' ? r.hostSessionIds : {}
  base.recentFolders = (base.recentFolders ?? []).filter((f) => typeof f === 'string').slice(0, 20)
  return base
}

export class SettingsService extends EventEmitter {
  private settings: JsonStore<Settings>
  private state: JsonStore<AppState>
  private windowState: JsonStore<WindowState>

  constructor(dir: string) {
    super()
    this.settings = new JsonStore(path.join(dir, 'settings.json'), defaultSettings, normalizeSettings)
    this.state = new JsonStore(path.join(dir, 'state.json'), defaultAppState, normalizeState)
    this.windowState = new JsonStore<WindowState>(
      path.join(dir, 'window.json'),
      () => ({ width: 1440, height: 900, maximized: false }),
      (raw) => conform({ x: 0, y: 0, width: 1440, height: 900, maximized: false }, raw)
    )
  }

  getSettings(): Settings {
    return this.settings.get()
  }

  updateSettings(patch: DeepPartial<Settings>): Settings {
    const next = normalizeSettings(deepMerge(this.settings.get(), patch))
    this.settings.set(next)
    this.emit('settings', next)
    return next
  }

  getState(): AppState {
    return this.state.get()
  }

  updateState(patch: Partial<AppState>): void {
    const cur = this.state.get()
    const next: AppState = { ...cur, ...patch }
    if (patch.layout) next.layout = { ...cur.layout, ...patch.layout }
    if (patch.workspaces) next.workspaces = { ...cur.workspaces, ...patch.workspaces }
    if (patch.hostSessionIds) next.hostSessionIds = { ...cur.hostSessionIds, ...patch.hostSessionIds }
    this.state.set(normalizeState(next))
  }

  rememberFolder(folder: string): void {
    const cur = this.state.get()
    const recent = [folder, ...cur.recentFolders.filter((f) => f.toLowerCase() !== folder.toLowerCase())].slice(0, 15)
    this.updateState({ recentFolders: recent, lastFolder: folder })
  }

  rememberHostSession(sessionId: string, hostSessionId: string): void {
    if (this.state.get().hostSessionIds[sessionId] === hostSessionId) return
    this.updateState({ hostSessionIds: { [sessionId]: hostSessionId } })
  }

  getWindowState(): WindowState {
    return this.windowState.get()
  }

  setWindowState(ws: WindowState): void {
    this.windowState.set(ws)
  }

  flush(): void {
    this.settings.flush()
    this.state.flush()
    this.windowState.flush()
  }
}
