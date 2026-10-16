import { BrowserWindow, Notification, app, dialog, ipcMain, shell } from 'electron'
import type { EventChannel, EventMap, InvokeChannel, InvokeMap, SendChannel, SendMap } from '@shared/ipc'
import type { AppInfo, ClaudeExecutable } from '@shared/types'
import type { SettingsService } from './services/settings'
import type { WorkspaceService } from './services/workspace'
import type { SearchService } from './services/search'
import type { TerminalService } from './services/terminal'
import type { GitService } from './services/git'
import type { SessionIndex } from './services/claude/session-index'
import type { LiveRegistry } from './services/claude/registry'
import type { SessionStore } from './services/claude/session-store'
import type { DesktopSessions } from './services/claude/desktop-sessions'
import type { ClaudeRunner } from './services/claude/runner'
import type { ClaudeEnvironmentService } from './services/claude/environment'
import type { IdeBridge } from './services/ide-bridge'
import { findClaudeExecutable } from './services/claude/locate'
import { claudeDefaults } from './services/claude/defaults'
import { TITLEBAR_HEIGHT } from './window'
import { t } from './i18n'

export interface AppContext {
  win: () => BrowserWindow | null
  settings: SettingsService
  workspace: WorkspaceService
  search: SearchService
  terminals: TerminalService
  git: GitService
  index: SessionIndex
  registry: LiveRegistry
  desktop: DesktopSessions
  store: SessionStore
  runner: ClaudeRunner
  claude: ClaudeEnvironmentService
  bridge: IdeBridge
  claudeHome: string
  initialFolder: string | null
  allowClose: () => void
  ackQuit: () => void
}

export function sendTo<K extends EventChannel>(ctx: AppContext, channel: K, payload: EventMap[K]): void {
  const w = ctx.win()
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
}

type Handler<K extends InvokeChannel> = (...args: Parameters<InvokeMap[K]>) => ReturnType<InvokeMap[K]> | Promise<Awaited<ReturnType<InvokeMap[K]>>>

function handle<K extends InvokeChannel>(channel: K, fn: Handler<K>): void {
  ipcMain.handle(channel, (_e, ...args) => fn(...(args as Parameters<InvokeMap[K]>)))
}

function on<K extends SendChannel>(channel: K, fn: (...args: SendMap[K]) => void): void {
  ipcMain.on(channel, (_e, ...args) => fn(...(args as SendMap[K])))
}

export function claudeExecutable(ctx: AppContext): ClaudeExecutable | null {
  return findClaudeExecutable(ctx.settings.getSettings().claude.executablePath)
}

export function registerIpc(ctx: AppContext): void {
  const s = ctx.settings

  /* app */
  handle('app:info', (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    userData: app.getPath('userData'),
    claudeHome: ctx.claudeHome,
    claudeExe: claudeExecutable(ctx),
    initialFolder: ctx.initialFolder,
    isPackaged: app.isPackaged
  }))
  handle('app:openExternal', async (url) => {
    if (/^(https?|mailto|claude):/i.test(url)) await shell.openExternal(url)
  })
  handle('app:revealPath', (p) => shell.showItemInFolder(p))
  handle('app:openPath', (p) => shell.openPath(p))
  handle('app:pickFolder', async (title) => {
    const w = ctx.win()
    const r = w
      ? await dialog.showOpenDialog(w, { title: title ?? t('Open folder'), properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ title: title ?? t('Open folder'), properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  handle('app:pickFile', async (title) => {
    const w = ctx.win()
    const opts: Electron.OpenDialogOptions = { title: title ?? t('Choose file'), properties: ['openFile'] }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  handle('app:setTitleBarTheme', ({ background, symbol }) => {
    const w = ctx.win()
    try {
      w?.setTitleBarOverlay({ color: background, symbolColor: symbol, height: TITLEBAR_HEIGHT })
    } catch {
      /* platform without overlay */
    }
  })
  handle('app:windowAction', (action) => {
    const w = ctx.win()
    if (!w) return
    const wc = w.webContents
    switch (action) {
      case 'minimize':
        w.minimize()
        break
      case 'maximize':
        if (w.isMaximized()) w.unmaximize()
        else w.maximize()
        break
      case 'close':
        w.close()
        break
      case 'devtools':
        wc.toggleDevTools()
        break
      case 'reload':
        wc.reload()
        break
      case 'zoomIn':
        wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 4))
        break
      case 'zoomOut':
        wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3))
        break
      case 'zoomReset':
        wc.setZoomLevel(0)
        break
      case 'fullscreen':
        w.setFullScreen(!w.isFullScreen())
        break
    }
  })
  handle('app:isMaximized', () => !!ctx.win()?.isMaximized())
  handle('app:notify', (title, body) => {
    if (Notification.isSupported()) new Notification({ title, body, silent: false }).show()
  })
  handle('app:confirmQuit', () => {
    ctx.allowClose()
    ctx.win()?.close()
  })
  handle('app:quitAck', () => ctx.ackQuit())

  /* settings */
  handle('settings:get', () => s.getSettings())
  handle('settings:update', (patch) => s.updateSettings(patch))
  handle('state:get', () => s.getState())
  handle('state:update', (patch) => s.updateState(patch))

  /* workspace */
  handle('workspace:open', (root) => {
    const info = ctx.workspace.open(root)
    s.rememberFolder(info.root)
    ctx.bridge.setFolders([info.root])
    ctx.git.invalidate()
    return info
  })
  handle('workspace:close', () => {
    ctx.workspace.close()
    ctx.bridge.setFolders([])
  })
  handle('fs:readDir', (dir) => ctx.workspace.readDir(dir))
  handle('fs:readFile', (p) => ctx.workspace.readFile(p))
  handle('fs:writeFile', (p, text, opts) => ctx.workspace.writeFile(p, text, opts))
  handle('fs:stat', (p) => ctx.workspace.stat(p))
  handle('fs:createFile', (p) => ctx.workspace.createFile(p))
  handle('fs:createDir', (p) => ctx.workspace.createDir(p))
  handle('fs:rename', (a, b) => ctx.workspace.rename(a, b))
  handle('fs:trash', (p) => ctx.workspace.trash(p))
  handle('fs:copy', (a, b) => ctx.workspace.copy(a, b))
  handle('fs:listFiles', (root) => ctx.workspace.listFiles(root))

  /* search */
  handle('search:start', (q) => ctx.search.start(q))
  handle('search:cancel', (id) => ctx.search.cancel(id))
  handle('search:replaceInFile', (p, q, r) => ctx.search.replaceInFile(p, q, r))

  /* terminal */
  handle('terminal:profiles', () => ctx.terminals.profiles())
  handle('terminal:create', (opts) => ctx.terminals.create(opts, s.getSettings().terminal.shell))
  handle('terminal:kill', (id) => ctx.terminals.kill(id))
  handle('terminal:list', () => ctx.terminals.list())
  on('terminal:input', (id, data) => ctx.terminals.write(id, data))
  on('terminal:resize', (id, cols, rows) => ctx.terminals.resize(id, cols, rows))

  /* git */
  handle('git:status', (root) => ctx.git.status(root))
  handle('git:stage', (root, paths) => ctx.git.stage(root, paths))
  handle('git:unstage', (root, paths) => ctx.git.unstage(root, paths))
  handle('git:discard', (root, paths) => ctx.git.discard(root, paths))
  handle('git:commit', (root, msg, opts) => ctx.git.commit(root, msg, opts))
  handle('git:branches', (root) => ctx.git.branches(root))
  handle('git:checkout', (root, b, create) => ctx.git.checkout(root, b, create))
  handle('git:show', (root, p, ref) => ctx.git.show(root, p, ref))
  handle('git:log', (root, n) => ctx.git.log(root, n))
  handle('git:sync', (root, action) => ctx.git.sync(root, action))
  handle('git:init', (root) => ctx.git.init(root))
  handle('git:diff', (root, staged) => ctx.git.diff(root, staged))

  /* sessions */
  const decorate = (m: import('@shared/types').SessionMeta) => {
    const live = ctx.registry.get(m.id)
    const desktop = ctx.desktop.get(m.id)
    return { ...m, live, desktop, title: m.title ?? desktop?.title ?? live?.name ?? null }
  }
  handle('sessions:list', () => ctx.index.groups(decorate))
  handle('sessions:live', () => ctx.registry.list())
  handle('sessions:open', (id) => ctx.store.openSession(id))
  handle('sessions:close', (id) => ctx.store.closeSession(id))
  handle('sessions:meta', async (id) => {
    const m = await ctx.index.meta(id)
    return m ? decorate(m) : null
  })
  handle('sessions:backup', (id, f) => ctx.store.readBackup(id, f))
  handle('sessions:subagents', (id) => ctx.store.subagents(id))
  handle('sessions:subagentEvents', (id, agentId) => ctx.store.subagentEvents(id, agentId))
  handle('sessions:findForCwd', async (cwd) => {
    const want = cwd.toLowerCase().replace(/[\\/]+$/, '')
    return (await ctx.index.list()).filter((m) => (m.cwd ?? '').toLowerCase().replace(/[\\/]+$/, '') === want).map(decorate)
  })
  handle('sessions:revealTranscript', async (id) => {
    const f = await ctx.index.findFile(id)
    if (f) shell.showItemInFolder(f)
  })

  /* Claude desktop deep links */
  handle('desktop:openSession', async (sessionId) => {
    const host = ctx.desktop.get(sessionId)?.hostSessionId ?? ctx.registry.get(sessionId)?.hostSessionId ?? s.getState().hostSessionIds[sessionId]
    const url = host ? `claude://code/continue?session=${encodeURIComponent(host)}` : `claude://resume?session=${encodeURIComponent(sessionId)}`
    try {
      await shell.openExternal(url)
      return { ok: true, url }
    } catch {
      return { ok: false, url }
    }
  })
  handle('desktop:newSession', async (folder, prompt) => {
    let url = `claude://code/new?folder=${encodeURIComponent(folder)}`
    if (prompt) url += `&q=${encodeURIComponent(prompt.slice(0, 8000))}`
    try {
      await shell.openExternal(url)
      return { ok: true, url }
    } catch {
      return { ok: false, url }
    }
  })

  /* runner */
  handle('runner:start', (opts) => ctx.runner.start(opts))
  handle('runner:send', (id, prompt) => ctx.runner.send(id, prompt))
  handle('runner:interrupt', (id) => ctx.runner.interrupt(id))
  handle('runner:stop', (id) => ctx.runner.stop(id))
  handle('runner:list', () => ctx.runner.list())
  handle('runner:respond', (id, req, decision) => ctx.runner.respond(id, req, decision))
  handle('runner:setMode', (id, mode) => ctx.runner.setMode(id, mode))
  handle('runner:setModel', (id, model) => ctx.runner.setModel(id, model))
  handle('runner:setEffort', (id, effort) => ctx.runner.setEffort(id, effort))
  handle('runner:models', () => ctx.claude.models())
  handle('runner:pending', () => ctx.runner.pending())
  handle('runner:oneShot', (cwd, prompt) => ctx.runner.oneShot(cwd, prompt))
  handle('runner:authStatus', (force) => ctx.runner.authStatus(force))
  handle('claude:environment', () => ctx.claude.get())
  handle('claude:refresh', () => ctx.claude.refresh())
  handle('claude:defaults', (cwd) => claudeDefaults(ctx.claudeHome, cwd))

  /* IDE bridge */
  handle('ide:status', () => ctx.bridge.status())
  handle('ide:diffResult', (id, r) => ctx.bridge.diffResult(id, r))
  handle('ide:atMention', (p, a, b) => ctx.bridge.atMention(p, a, b))
  on('ide:selection', (sel) => ctx.bridge.setSelection(sel))
  on('ide:diagnostics', (files) => ctx.bridge.setDiagnostics(files))
  on('ide:editors', (st) => ctx.bridge.setEditors(st))
  on('ide:saved', (id, ok) => ctx.bridge.saved(id, ok))
}
