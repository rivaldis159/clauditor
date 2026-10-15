import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, nativeTheme, screen, shell } from 'electron'
import type { SettingsService, WindowState } from './services/settings'

const here = path.dirname(fileURLToPath(import.meta.url))
export const TITLEBAR_HEIGHT = 38

export function themeColors(dark: boolean) {
  return dark ? { background: '#141416', symbol: '#c8c8ce' } : { background: '#efeff2', symbol: '#3b3b45' }
}

function isDark(settings: SettingsService): boolean {
  const t = settings.getSettings().theme
  return t === 'dark' || (t === 'system' && nativeTheme.shouldUseDarkColors)
}

function visibleBounds(ws: WindowState): Partial<Electron.Rectangle> {
  const width = Math.max(880, ws.width || 1440)
  const height = Math.max(540, ws.height || 900)
  if (ws.x === undefined || ws.y === undefined || (ws.x === 0 && ws.y === 0)) return { width, height }
  const fits = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return ws.x! + 80 > a.x && ws.x! < a.x + a.width - 80 && ws.y! >= a.y - 8 && ws.y! < a.y + a.height - 80
  })
  return fits ? { x: ws.x, y: ws.y, width, height } : { width, height }
}

export function createMainWindow(settings: SettingsService, icon: string): BrowserWindow {
  const ws = settings.getWindowState()
  const dark = isDark(settings)
  const colors = themeColors(dark)
  const win = new BrowserWindow({
    ...visibleBounds(ws),
    minWidth: 880,
    minHeight: 540,
    show: false,
    title: 'Clauditor',
    icon,
    backgroundColor: dark ? '#18181b' : '#f7f7f9',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.background, symbolColor: colors.symbol, height: TITLEBAR_HEIGHT },
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  if (ws.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  let saveTimer: NodeJS.Timeout | null = null
  const save = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (win.isDestroyed()) return
      const b = win.getNormalBounds()
      settings.setWindowState({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() })
    }, 400)
  }
  win.on('resize', save)
  win.on('move', save)
  win.on('maximize', () => {
    save()
    win.webContents.send('app:maximized', true)
  })
  win.on('unmaximize', () => {
    save()
    win.webContents.send('app:maximized', false)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(here, '../renderer/index.html'))
  return win
}
