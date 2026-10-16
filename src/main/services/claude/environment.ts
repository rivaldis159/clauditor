// What Claude desktop ships right now: its install location and version, the Claude Code it
// bundles, the fonts it uses and the models / effort levels that Claude Code offers. Everything
// is read from Claude itself and re-read when Claude updates, so Clauditor follows Claude
// without being rebuilt.
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ClaudeEnvironment, ClaudeExecutable, ClaudeUpdateNotice, ModelOption } from '@shared/types'
import { clearExecutableCache, desktopRoots } from './locate'
import { compareVersions, type Sdk, type SdkManager } from './sdk'

interface DesktopInstall {
  version: string
  root: string
  resources: string
  kind: 'msix' | 'squirrel'
}

function execText(file: string, args: string[], timeout = 10_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout }, (_err, stdout) => resolve(String(stdout ?? '')))
  })
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

const PACKAGES_KEY = 'HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages'

/** Claude desktop's install: the Microsoft Store/MSIX package (via the registry) or the classic per-user install. */
export async function detectDesktop(): Promise<DesktopInstall | null> {
  if (process.platform !== 'win32') return null
  const keys = (await execText('reg.exe', ['query', PACKAGES_KEY, '/f', 'Claude_', '/k']))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /\\Claude_[\d.]+_[^\\]+$/.test(l))
    .map((key) => ({ key, version: /\\Claude_([\d.]+)_/.exec(key)?.[1] ?? '0' }))
    .sort((a, b) => compareVersions(b.version, a.version))
  for (const k of keys) {
    const out = await execText('reg.exe', ['query', k.key, '/v', 'PackageRootFolder'])
    const root = /PackageRootFolder\s+REG_\w+\s+(.+)/.exec(out)?.[1]?.trim()
    if (root && fs.existsSync(path.join(root, 'app', 'resources'))) return { version: k.version, root, resources: path.join(root, 'app', 'resources'), kind: 'msix' }
  }
  const local = process.env.LOCALAPPDATA
  if (local) {
    const base = path.join(local, 'AnthropicClaude')
    const apps = safeReaddir(base)
      .filter((n) => /^app-\d/.test(n))
      .sort((a, b) => compareVersions(b.slice(4), a.slice(4)))
    for (const a of apps) {
      const resources = path.join(base, a, 'resources')
      if (fs.existsSync(resources)) return { version: a.slice(4), root: path.join(base, a), resources, kind: 'squirrel' }
    }
  }
  return null
}

const FONT_PATTERNS: Record<keyof ClaudeEnvironment['fonts'], RegExp[]> = {
  sans: [/^AnthropicSans-Roman-Variable.*\.woff2$/i, /^AnthropicSans-Roman.*\.woff2$/i],
  sansItalic: [/^AnthropicSans-Italic-Variable.*\.woff2$/i, /^AnthropicSans-Italic.*\.woff2$/i],
  serif: [/^AnthropicSerif-Roman-Variable.*\.woff2$/i, /^AnthropicSerif-Roman.*\.woff2$/i],
  mono: [/^AnthropicMono-Roman-Variable.*\.woff2$/i, /^AnthropicMono-Roman.*\.woff2$/i]
}

export function fontUrl(file: string): string {
  return `clauditor-file://local/${encodeURI(file.replace(/\\/g, '/'))}`
}

/** Claude's own fonts inside the desktop install (file names carry content hashes that change per release). */
export function findFonts(resources: string | null): ClaudeEnvironment['fonts'] {
  const fonts: ClaudeEnvironment['fonts'] = { sans: null, sansItalic: null, serif: null, mono: null }
  if (!resources) return fonts
  const dirs = [path.join(resources, 'ion-dist', '_frame-rt', '_runtime'), path.join(resources, 'ion-dist', 'assets'), path.join(resources, 'fonts')]
  const files = dirs.flatMap((d) => safeReaddir(d).map((name) => ({ name, full: path.join(d, name) })))
  for (const key of Object.keys(FONT_PATTERNS) as (keyof ClaudeEnvironment['fonts'])[]) {
    for (const re of FONT_PATTERNS[key]) {
      const hit = files.filter((f) => re.test(f.name)).sort((a, b) => b.name.localeCompare(a.name))[0]
      if (hit) {
        fonts[key] = fontUrl(hit.full)
        break
      }
    }
  }
  return fonts
}

/** "2.1.295 (Claude Code)" → "2.1.295" */
export async function readCliVersion(exe: string): Promise<string | null> {
  const out = await execText(exe, ['--version'], 15_000)
  return /(\d+\.\d+\.\d+)/.exec(out)?.[1] ?? null
}

type RawModel = { value: string; displayName?: string; description?: string; resolvedModel?: string; supportsEffort?: boolean; supportedEffortLevels?: string[]; supportsFastMode?: boolean; supportsAutoMode?: boolean }

export interface ModelWindow {
  contextWindow: number
  autoCompactAt: number | null
}

/** Claude Code's model rows as picker options; its "default" row means "don't pass a model". */
export function toModelOption(m: RawModel, window?: ModelWindow | null): ModelOption {
  return {
    value: m.value === 'default' ? '' : m.value,
    label: m.displayName || m.value,
    description: m.description ?? '',
    resolvedModel: m.resolvedModel ?? null,
    effortLevels: m.supportedEffortLevels ?? (m.supportsEffort ? ['low', 'medium', 'high'] : []),
    supportsFastMode: !!m.supportsFastMode,
    supportsAutoMode: m.supportsAutoMode !== false,
    contextWindow: window?.contextWindow ?? null,
    autoCompactAt: window?.autoCompactAt ?? null
  }
}

type ContextProbe = { rawMaxTokens?: number; maxTokens?: number; autoCompactThreshold?: number; isAutoCompactEnabled?: boolean }

/**
 * Each model's context window and auto-compact point, as Claude Code computes them for this user's
 * settings (/context on an empty session: local, no model call). Stops at the time budget.
 */
async function probeWindows(q: ReturnType<Sdk['query']>, list: RawModel[], budgetMs = 15_000): Promise<Map<string, ModelWindow>> {
  const out = new Map<string, ModelWindow>()
  const ask = q as unknown as { getContextUsage?: (o: { detail: 'summary' }) => Promise<ContextProbe> }
  if (typeof ask.getContextUsage !== 'function') return out
  const deadline = Date.now() + budgetMs
  for (const m of list) {
    if (Date.now() > deadline) break
    try {
      await q.setModel(m.value === 'default' ? undefined : m.value)
      const u = await ask.getContextUsage({ detail: 'summary' })
      const contextWindow = Number(u.rawMaxTokens || u.maxTokens) || 0
      if (contextWindow) out.set(m.value, { contextWindow, autoCompactAt: u.isAutoCompactEnabled && u.autoCompactThreshold ? u.autoCompactThreshold : null })
    } catch {
      break
    }
  }
  return out
}

/** Starts Claude Code without a prompt (no API call) just to read what it offers. */
async function probeClaude(sdk: Sdk, exe: string, env: Record<string, string>): Promise<{ models: ModelOption[]; outputStyles: string[] }> {
  const idle = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<never>>(() => {}) }) }
  const q = sdk.query({
    prompt: idle as never,
    options: { cwd: os.tmpdir(), pathToClaudeCodeExecutable: exe, persistSession: false, strictMcpConfig: true, mcpServers: {}, settingSources: ['user'], env }
  })
  const timer = setTimeout(() => q.close(), 45_000)
  try {
    const init = (await q.initializationResult()) as { models?: RawModel[]; available_output_styles?: string[] }
    const list: RawModel[] = init.models?.length ? init.models : ((await q.supportedModels()) as RawModel[])
    const windows = await probeWindows(q, list)
    return { models: list.map((m) => toModelOption(m, windows.get(m.value))), outputStyles: init.available_output_styles ?? [] }
  } finally {
    clearTimeout(timer)
    q.close()
  }
}

function empty(sdk: SdkManager): ClaudeEnvironment {
  return { desktop: { version: null, root: null, kind: null }, cli: { path: null, version: null, source: null }, sdk: sdk.info(), fonts: { sans: null, sansItalic: null, serif: null, mono: null }, models: [], outputStyles: [], checkedAt: 0 }
}

export interface EnvironmentOptions {
  userData: string
  sdk: SdkManager
  executable: () => ClaudeExecutable | null
  childEnv: () => Record<string, string>
  /** false while Claude runs are active: the SDK is only swapped between runs */
  canSwapSdk: () => boolean
  /** user setting: fetch the SDK release that matches Claude's Claude Code */
  syncSdk: () => boolean
}

export class ClaudeEnvironmentService extends EventEmitter {
  private env: ClaudeEnvironment
  private readonly cacheFile: string
  private refreshing: Promise<ClaudeEnvironment> | null = null
  private watchers: fs.FSWatcher[] = []
  private timer: NodeJS.Timeout | null = null
  private debounce: NodeJS.Timeout | null = null
  private lastLight = 0
  private pendingSdkSelect = false

  constructor(private readonly o: EnvironmentOptions) {
    super()
    this.cacheFile = path.join(o.userData, 'claude-environment.json')
    o.sdk.setCliVersionSource(() => this.env.cli.version)
    const cached = this.readCache()
    // models from the last run make the pickers usable before the first probe finishes
    this.env = cached ? { ...empty(o.sdk), ...cached, sdk: o.sdk.info() } : empty(o.sdk)
  }

  private readCache(): ClaudeEnvironment | null {
    try {
      return JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')) as ClaudeEnvironment
    } catch {
      return null
    }
  }

  private writeCache(): void {
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true })
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.env, null, 1))
    } catch {
      /* cache only */
    }
  }

  get(): ClaudeEnvironment {
    return this.env
  }

  models(): ModelOption[] {
    return this.env.models
  }

  /** Re-detects everything and re-asks Claude Code for its models. */
  refresh(): Promise<ClaudeEnvironment> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async doRefresh(): Promise<ClaudeEnvironment> {
    const prev = this.env
    clearExecutableCache()
    const exe = this.o.executable()
    const desktop = await detectDesktop()
    const cliVersion = exe ? (exe.version ?? (await readCliVersion(exe.path))) : null

    // the first download always happens (the installed app carries no SDK); later updates follow the setting
    if ((this.o.syncSdk() || !this.o.sdk.available()) && this.o.sdk.needsSync(cliVersion)) {
      try {
        await this.o.sdk.sync(cliVersion)
      } catch (err) {
        console.warn('[claude-env] SDK sync skipped:', (err as Error).message)
      }
    }
    if (this.o.canSwapSdk()) this.o.sdk.select(cliVersion)
    else this.pendingSdkSelect = true

    let probed: { models: ModelOption[]; outputStyles: string[] } | null = null
    if (exe && this.o.sdk.available()) {
      const env = this.o.childEnv()
      try {
        probed = await probeClaude(await this.o.sdk.load(), exe.path, env)
      } catch (err) {
        console.warn('[claude-env] probe failed:', (err as Error).message)
        if (this.o.sdk.info().source === 'synced' && this.o.canSwapSdk()) {
          // the downloaded SDK does not get along with this claude.exe: back to the bundled one
          this.o.sdk.reject(cliVersion)
          probed = await probeClaude(await this.o.sdk.load(), exe.path, env).catch(() => null)
        }
      }
    }

    // a model whose window was not measured this time (time budget) keeps the last known one
    const models = probed?.models.length
      ? probed.models.map((m) => {
          const before = m.contextWindow ? null : prev.models.find((p) => p.value === m.value && p.contextWindow)
          return before ? { ...m, contextWindow: before.contextWindow, autoCompactAt: before.autoCompactAt ?? null } : m
        })
      : prev.models
    this.env = {
      desktop: { version: desktop?.version ?? null, root: desktop?.root ?? null, kind: desktop?.kind ?? null },
      cli: { path: exe?.path ?? null, version: cliVersion, source: exe?.source ?? null },
      sdk: this.o.sdk.info(),
      fonts: findFonts(desktop?.resources ?? null),
      models,
      outputStyles: probed?.outputStyles ?? prev.outputStyles,
      checkedAt: Date.now()
    }
    this.writeCache()
    this.rewatch()

    if (prev.checkedAt) {
      const notices: ClaudeUpdateNotice[] = []
      if (prev.desktop.version && this.env.desktop.version && prev.desktop.version !== this.env.desktop.version) notices.push({ what: 'desktop', from: prev.desktop.version, to: this.env.desktop.version })
      if (prev.cli.version && this.env.cli.version && prev.cli.version !== this.env.cli.version) notices.push({ what: 'cli', from: prev.cli.version, to: this.env.cli.version })
      if (prev.sdk.version && this.env.sdk.version && prev.sdk.version !== this.env.sdk.version) notices.push({ what: 'sdk', from: prev.sdk.version, to: this.env.sdk.version })
      for (const n of notices) this.emit('update', n)
    }
    this.emit('changed', this.env)
    return this.env
  }

  /**
   * The quick part of a refresh (registry + folder listing, no Claude Code launch): run before the
   * window opens so Claude's fonts are known for the first paint.
   */
  async prepare(): Promise<void> {
    const desktop = await detectDesktop()
    this.env = {
      ...this.env,
      desktop: { version: desktop?.version ?? null, root: desktop?.root ?? null, kind: desktop?.kind ?? null },
      fonts: findFonts(desktop?.resources ?? null)
    }
  }

  /** Cheap check (registry + folder listing) used on focus and on a timer; refreshes on a difference. */
  async lightCheck(force = false): Promise<void> {
    if (!force && Date.now() - this.lastLight < 120_000) return
    this.lastLight = Date.now()
    clearExecutableCache()
    const exe = this.o.executable()
    const desktop = await detectDesktop()
    if ((exe?.path ?? null) !== this.env.cli.path || (desktop?.version ?? null) !== this.env.desktop.version) await this.refresh()
  }

  /** Called when Claude runs end, so a deferred SDK switch can happen. */
  onRunsIdle(): void {
    if (!this.pendingSdkSelect) return
    this.pendingSdkSelect = false
    if (this.o.sdk.select(this.env.cli.version)) {
      this.env = { ...this.env, sdk: this.o.sdk.info() }
      this.emit('changed', this.env)
    }
  }

  start(): void {
    void this.refresh()
    this.timer = setInterval(() => void this.lightCheck(true), 15 * 60_000)
    this.timer.unref()
  }

  /** Watches the folders where Claude desktop drops new Claude Code versions. */
  private rewatch(): void {
    for (const w of this.watchers) w.close()
    this.watchers = []
    for (const root of desktopRoots()) {
      if (!fs.existsSync(root)) continue
      try {
        const w = fs.watch(root, () => {
          if (this.debounce) clearTimeout(this.debounce)
          this.debounce = setTimeout(() => void this.refresh(), 4000)
        })
        w.on('error', () => w.close())
        this.watchers.push(w)
      } catch {
        /* not watchable */
      }
    }
  }

  stop(): void {
    for (const w of this.watchers) w.close()
    this.watchers = []
    if (this.timer) clearInterval(this.timer)
    if (this.debounce) clearTimeout(this.debounce)
  }
}
