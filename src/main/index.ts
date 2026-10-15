import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, Menu, Notification, app, nativeTheme, net, protocol } from 'electron'
import { claudeHome, resourcePath } from './lib/paths'
import { SettingsService } from './services/settings'
import { WorkspaceService } from './services/workspace'
import { SearchService } from './services/search'
import { TerminalService } from './services/terminal'
import { GitService } from './services/git'
import { SessionIndex } from './services/claude/session-index'
import { LiveRegistry } from './services/claude/registry'
import { SessionStore } from './services/claude/session-store'
import { ClaudeRunner } from './services/claude/runner'
import { SdkManager } from './services/claude/sdk'
import { ClaudeEnvironmentService } from './services/claude/environment'
import { IdeBridge } from './services/ide-bridge'
import { claudeExecutable, registerIpc, sendTo, type AppContext } from './ipc'
import { createMainWindow } from './window'
import { dropInheritedClaudeSession } from './env'
import { setMainLocale, t } from './i18n'
import type { LiveSessionInfo } from '@shared/types'

dropInheritedClaudeSession()
if (process.env.CLAUDITOR_USER_DATA) app.setPath('userData', path.resolve(process.env.CLAUDITOR_USER_DATA))

app.setName('Clauditor')
if (process.platform === 'win32') app.setAppUserModelId('id.rivaldi.clauditor')

/** First start after the rename: carry settings and layout over from the old "Tempa" profile. */
function migrateFromTempa(): void {
  if (process.env.CLAUDITOR_USER_DATA) return
  const dir = app.getPath('userData')
  const old = path.join(path.dirname(dir), 'Tempa')
  if (fs.existsSync(path.join(dir, 'settings.json')) || !fs.existsSync(path.join(old, 'settings.json'))) return
  fs.mkdirSync(dir, { recursive: true })
  for (const f of ['settings.json', 'state.json', 'window.json']) {
    try {
      fs.copyFileSync(path.join(old, f), path.join(dir, f))
    } catch {
      /* optional file */
    }
  }
}
migrateFromTempa()

protocol.registerSchemesAsPrivileged([
  // corsEnabled: fonts (Claude's own, from the Claude desktop install) are loaded with CORS
  { scheme: 'clauditor-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

function folderFromArgv(argv: string[]): string | null {
  const flag = argv.find((a) => a.startsWith('--folder='))
  if (flag) return path.resolve(flag.slice('--folder='.length).replace(/^"|"$/g, ''))
  if (process.env.CLAUDITOR_OPEN_FOLDER) return path.resolve(process.env.CLAUDITOR_OPEN_FOLDER)
  const args = argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-'))
  for (let i = args.length - 1; i >= 0; i--) {
    const candidate = path.resolve(args[i])
    try {
      if (fs.statSync(candidate).isDirectory() && candidate !== path.resolve(app.getAppPath())) return candidate
    } catch {
      /* not a path */
    }
  }
  return null
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let win: BrowserWindow | null = null
  let allowClose = false
  let quitAcked = false
  let ctx: AppContext

  app.on('second-instance', (_e, argv) => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
    const folder = folderFromArgv(argv)
    if (folder) sendTo(ctx, 'app:openFolder', folder)
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)

    protocol.handle('clauditor-file', async (req) => {
      const url = new URL(req.url)
      let p = decodeURIComponent(url.pathname)
      if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
      const res = await net.fetch(pathToFileURL(path.normalize(p)).href)
      const headers = new Headers(res.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      if (/\.woff2$/i.test(p)) headers.set('Content-Type', 'font/woff2')
      return new Response(res.body, { status: res.status, headers })
    })

    const home = claudeHome()
    const settings = new SettingsService(app.getPath('userData'))
    setMainLocale(settings.getSettings().language)
    const bridge = new IdeBridge(home, app.getVersion())
    const index = new SessionIndex(home)
    const registry = new LiveRegistry(home)
    const exePath = () => claudeExecutable(ctx)?.path ?? null
    const sdk = new SdkManager(app.getPath('userData'))
    const runner = new ClaudeRunner(exePath, () => ({}), () => sdk.load())
    const claude = new ClaudeEnvironmentService({
      userData: app.getPath('userData'),
      sdk,
      executable: () => claudeExecutable(ctx),
      childEnv: () => {
        const env: Record<string, string> = {}
        for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
        delete env.ELECTRON_RUN_AS_NODE
        return env
      },
      canSwapSdk: () => !runner.busy,
      syncSdk: () => settings.getSettings().claude.syncSdk
    })

    ctx = {
      win: () => win,
      settings,
      workspace: new WorkspaceService(),
      search: new SearchService(),
      terminals: new TerminalService(exePath, () => bridge.terminalEnv()),
      git: new GitService(),
      index,
      registry,
      store: new SessionStore(home, index, registry),
      runner,
      claude,
      bridge,
      claudeHome: home,
      initialFolder: folderFromArgv(process.argv),
      allowClose: () => {
        allowClose = true
      },
      ackQuit: () => {
        quitAcked = true
      }
    }
    registerIpc(ctx)

    ctx.workspace.on('changed', (batch) => sendTo(ctx, 'fs:changed', batch))
    ctx.search.on('progress', (p) => sendTo(ctx, 'search:progress', p))
    ctx.search.on('done', (d) => sendTo(ctx, 'search:done', d))
    ctx.terminals.on('data', (d) => sendTo(ctx, 'terminal:data', d))
    ctx.terminals.on('exit', (d) => sendTo(ctx, 'terminal:exit', d))
    ctx.store.on('update', (u) => sendTo(ctx, 'sessions:update', u))
    index.on('changed', () => sendTo(ctx, 'sessions:listChanged', undefined))
    ctx.runner.on('state', (info) => {
      sendTo(ctx, 'runner:state', info)
      if (!runner.busy) claude.onRunsIdle()
    })
    claude.on('changed', (env) => sendTo(ctx, 'claude:environment', env))
    claude.on('update', (n) => sendTo(ctx, 'claude:update', n))
    ctx.runner.on('stream', (u) => sendTo(ctx, 'runner:stream', u))
    ctx.runner.on('permission', (r) => {
      sendTo(ctx, 'runner:permission', r)
      if (win && !win.isFocused() && Notification.isSupported()) {
        new Notification({ title: t('Claude needs your permission'), body: t('{tool} — open Clauditor to respond', { tool: r.toolName }) }).show()
      }
    })
    ctx.runner.on('permissionResolved', (r) => sendTo(ctx, 'runner:permissionResolved', r))
    ctx.runner.on('auth', (st) => sendTo(ctx, 'runner:auth', st))
    ctx.runner.on('result', (info) => {
      if (win && !win.isFocused() && settings.getSettings().claude.notifyOnIdle && Notification.isSupported()) {
        new Notification({ title: t('Claude finished'), body: info.lastResult?.text?.slice(0, 160) || t('Turn complete') }).show()
      }
    })
    bridge.on('status', (st) => sendTo(ctx, 'ide:status', st))
    bridge.on('openFile', (r) => {
      sendTo(ctx, 'ide:openFile', r)
      win?.focus()
    })
    bridge.on('openDiff', (r) => {
      sendTo(ctx, 'ide:openDiff', r)
      if (win && !win.isFocused()) win.flashFrame(true)
    })
    bridge.on('closeTab', (r) => sendTo(ctx, 'ide:closeTab', r))
    bridge.on('closeAllDiffs', () => sendTo(ctx, 'ide:closeAllDiffs', undefined))
    bridge.on('saveDocument', (r) => sendTo(ctx, 'ide:saveDocument', r))

    registry.on('changed', (list: LiveSessionInfo[], prev: Map<string, LiveSessionInfo>) => {
      sendTo(ctx, 'sessions:live', list)
      for (const l of list) if (l.hostSessionId) settings.rememberHostSession(l.sessionId, l.hostSessionId)
      if (!settings.getSettings().claude.notifyOnIdle || !win || win.isFocused() || !Notification.isSupported()) return
      for (const l of list) {
        const before = prev.get(l.sessionId)
        if (before?.status === 'busy' && l.status !== 'busy' && ctx.store.isOpen(l.sessionId)) {
          const n = new Notification({ title: t('Claude finished working'), body: l.name ?? path.basename(l.cwd) })
          n.on('click', () => win?.focus())
          n.show()
        }
      }
    })

    settings.on('settings', (next) => {
      setMainLocale(next.language)
      sendTo(ctx, 'settings:changed', next)
      if (next.claude.ideBridge && !bridge.running) void bridge.start()
      else if (!next.claude.ideBridge && bridge.running) bridge.stop()
    })
    nativeTheme.on('updated', () => sendTo(ctx, 'settings:changed', settings.getSettings()))

    if (settings.getSettings().claude.ideBridge) await bridge.start()
    index.start()
    registry.start()

    await claude.prepare().catch(() => {})
    win = createMainWindow(settings, resourcePath('icon.png'))
    claude.start()
    // coming back to Clauditor is a good moment to notice a Claude update
    win.on('focus', () => void claude.lightCheck())
    win.on('close', (e) => {
      if (allowClose || !win || win.webContents.isCrashed()) return
      e.preventDefault()
      sendTo(ctx, 'app:beforeQuit', undefined)
      // The renderer acknowledges at once (it may then show a "save changes?" dialog).
      // No acknowledgement means it is hung: close anyway.
      quitAcked = false
      setTimeout(() => {
        if (!quitAcked && win && !win.isDestroyed()) {
          allowClose = true
          win.close()
        }
      }, 3000)
    })
    win.on('closed', () => {
      win = null
    })
  })

  app.on('before-quit', () => {
    if (!ctx) return
    ctx.settings.flush()
    ctx.bridge.stop()
    ctx.terminals.killAll()
    ctx.runner.stopAll()
    ctx.claude.stop()
    ctx.store.closeAll()
    ctx.registry.stop()
    ctx.index.stop()
  })

  app.on('window-all-closed', () => app.quit())
}
