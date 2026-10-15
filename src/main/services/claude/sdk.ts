// The Agent SDK that drives claude.exe. It is Anthropic's (proprietary licence), so the installed
// app does not carry it: the release made for the Claude Code that Claude desktop ships is fetched
// from the npm registry (integrity-checked) on first run, and again whenever Claude desktop brings a
// newer Claude Code — keeping the protocol between the two in step with Claude. In development the
// copy in node_modules is used as well.
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { ClaudeEnvironment } from '@shared/types'
import { t } from '../../i18n'

export type Sdk = typeof import('@anthropic-ai/claude-agent-sdk')

const PACKAGE = '@anthropic-ai/claude-agent-sdk'
const REGISTRY = `https://registry.npmjs.org/${PACKAGE.replace('/', '%2F')}`

interface Candidate {
  version: string
  claudeCodeVersion: string | null
  source: 'bundled' | 'synced'
  /** absolute path of sdk.mjs; null for the bundled copy (imported by package name) */
  entry: string | null
}

/** Numeric comparison of dotted versions ("2.1.295" < "2.1.300"); non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * Best SDK for a Claude Code version: the exact match, else the newest one made for an older
 * Claude Code, else the oldest available (closest from above).
 */
export function pickCandidate<T extends { claudeCodeVersion: string | null }>(candidates: T[], cliVersion: string | null): T | null {
  const known = candidates.filter((c): c is T & { claudeCodeVersion: string } => !!c.claudeCodeVersion)
  if (!cliVersion || !known.length) return candidates[0] ?? null
  const exact = known.find((c) => compareVersions(c.claudeCodeVersion, cliVersion) === 0)
  if (exact) return exact
  const older = known.filter((c) => compareVersions(c.claudeCodeVersion, cliVersion) < 0).sort((a, b) => compareVersions(b.claudeCodeVersion, a.claudeCodeVersion))
  if (older.length) return older[0]
  return [...known].sort((a, b) => compareVersions(a.claudeCodeVersion, b.claudeCodeVersion))[0]
}

/** Files of a .tgz (npm tarball) whose names pass `want`, as name → contents. */
export function untar(tgz: Buffer, want: (name: string) => boolean): Map<string, Buffer> {
  const tar = zlib.gunzipSync(tgz)
  const out = new Map<string, Buffer>()
  let off = 0
  let longName: string | null = null
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512)
    if (header.every((b) => b === 0)) break
    const field = (s: number, n: number) => header.subarray(s, s + n).toString('utf8').replace(/\0.*$/s, '')
    const size = Number.parseInt(field(124, 12).trim() || '0', 8)
    const type = String.fromCharCode(header[156] || 48)
    const prefix = field(345, 155)
    let name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100))
    longName = null
    const body = tar.subarray(off + 512, off + 512 + size)
    if (type === 'x') {
      // pax extended header: may carry the real path of the next entry
      const m = /\d+ path=([^\n]+)\n/.exec(body.toString('utf8'))
      if (m) longName = m[1]
    } else if (type === 'L') {
      longName = body.toString('utf8').replace(/\0.*$/s, '')
    } else if ((type === '0' || type === '\0') && want(name)) {
      out.set(name, Buffer.from(body))
    }
    name = ''
    off += 512 + Math.ceil(size / 512) * 512
  }
  return out
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

export class SdkManager extends EventEmitter {
  private readonly dir: string
  /** the SDK from node_modules: present in development, absent in the installed app */
  private readonly bundled: Candidate | null
  private active: Candidate | null
  private loaded: { key: string; mod: Promise<Sdk> } | null = null
  private syncing: Promise<boolean> | null = null
  private readonly badFile: string
  private cliVersion: () => string | null = () => null

  constructor(userData: string) {
    super()
    this.dir = path.join(userData, 'claude-sdk')
    this.badFile = path.join(this.dir, 'rejected.json')
    let bundled: Candidate | null = null
    try {
      const require = createRequire(import.meta.url)
      const pkg = readJson<{ version?: string; claudeCodeVersion?: string }>(path.join(path.dirname(require.resolve(PACKAGE)), 'package.json'))
      if (pkg?.version) bundled = { version: pkg.version, claudeCodeVersion: pkg.claudeCodeVersion ?? null, source: 'bundled', entry: null }
    } catch {
      /* not installed alongside the app: it is downloaded from npm instead */
    }
    this.bundled = bundled
    this.active = pickCandidate(this.candidates(), null)
  }

  /** Where to read the installed Claude Code version from (the environment service). */
  setCliVersionSource(fn: () => string | null): void {
    this.cliVersion = fn
  }

  info(): ClaudeEnvironment['sdk'] {
    return this.active
      ? { version: this.active.version, claudeCodeVersion: this.active.claudeCodeVersion, source: this.active.source }
      : { version: null, claudeCodeVersion: null, source: 'none' }
  }

  /** True when some SDK copy is on this machine. */
  available(): boolean {
    return this.candidates().length > 0
  }

  private candidates(): Candidate[] {
    return [...(this.bundled ? [this.bundled] : []), ...this.synced()]
  }

  private rejected(): string[] {
    return readJson<string[]>(this.badFile) ?? []
  }

  private synced(): Candidate[] {
    const bad = new Set(this.rejected())
    let names: string[] = []
    try {
      names = fs.readdirSync(this.dir)
    } catch {
      return []
    }
    const out: Candidate[] = []
    for (const name of names) {
      const entry = path.join(this.dir, name, 'sdk.mjs')
      const pkg = readJson<{ version?: string; claudeCodeVersion?: string }>(path.join(this.dir, name, 'package.json'))
      if (!pkg?.version || bad.has(pkg.version) || !fs.existsSync(entry)) continue
      out.push({ version: pkg.version, claudeCodeVersion: pkg.claudeCodeVersion ?? null, source: 'synced', entry })
    }
    return out
  }

  /**
   * Module of the active SDK (imported once per version). Without any local copy — the installed
   * app on its first run — the matching release is downloaded first.
   */
  async load(): Promise<Sdk> {
    if (!this.active) {
      await this.sync(this.cliVersion()).catch(() => false)
      this.select(this.cliVersion())
    }
    const active = this.active
    if (!active) throw new Error(t("Clauditor couldn't download Claude's Agent SDK from npm. Check your internet connection, then try again."))
    const key = active.entry ?? 'bundled'
    if (this.loaded?.key === key) return this.loaded.mod
    const mod = active.entry ? (import(pathToFileURL(active.entry).href) as Promise<Sdk>) : (import('@anthropic-ai/claude-agent-sdk') as Promise<Sdk>)
    this.loaded = { key, mod }
    return mod
  }

  /** Chooses the SDK for this Claude Code version; returns true when it changed. */
  select(cliVersion: string | null): boolean {
    const next = pickCandidate(this.candidates(), cliVersion)
    if (next?.version === this.active?.version && next?.source === this.active?.source) return false
    this.active = next
    this.emit('changed', this.info())
    return true
  }

  /** Marks the active synced SDK as unusable (e.g. it failed to talk to claude.exe) and falls back. */
  reject(cliVersion: string | null): void {
    if (this.active?.source !== 'synced') return
    fs.mkdirSync(this.dir, { recursive: true })
    fs.writeFileSync(this.badFile, JSON.stringify([...new Set([...this.rejected(), this.active.version])]))
    this.select(cliVersion)
  }

  /** True when there is no SDK yet, or Claude Code is newer than every SDK available locally. */
  needsSync(cliVersion: string | null): boolean {
    const local = this.candidates()
    if (!local.length) return true
    if (!cliVersion) return false
    const best = pickCandidate(local, cliVersion)
    return !best?.claudeCodeVersion || compareVersions(best.claudeCodeVersion, cliVersion) < 0
  }

  /**
   * Downloads the SDK release made for `cliVersion` (or the newest one before it) when no local
   * copy is that recent — or any matching release when there is none at all. Resolves true when a
   * new SDK was installed.
   */
  sync(cliVersion: string | null): Promise<boolean> {
    if (!this.needsSync(cliVersion)) return Promise.resolve(false)
    this.syncing ??= this.download(cliVersion).finally(() => {
      this.syncing = null
    })
    return this.syncing
  }

  private async download(cliVersion: string | null): Promise<boolean> {
    // Electron's net follows the system proxy settings; imported lazily so the helpers above stay testable
    const { net } = await import('electron')
    const res = await net.fetch(REGISTRY, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`npm registry: HTTP ${res.status}`)
    type Release = { version: string; claudeCodeVersion?: string; dist?: { tarball?: string; integrity?: string } }
    const doc = (await res.json()) as { 'dist-tags'?: { latest?: string }; versions?: Record<string, Release> }
    const bad = new Set(this.rejected())
    const local = this.candidates()
    const have = pickCandidate(local, cliVersion)
    const releases = Object.values(doc.versions ?? {})
      .filter((v) => v.claudeCodeVersion && v.dist?.tarball && v.dist.integrity?.startsWith('sha512-') && !bad.has(v.version) && !/-/.test(v.version))
      .map((v) => ({ ...v, claudeCodeVersion: v.claudeCodeVersion ?? null }))
    const latest = releases.find((v) => v.version === doc['dist-tags']?.latest) ?? null
    const target = cliVersion ? pickCandidate(releases, cliVersion) : latest
    if (!target?.claudeCodeVersion) return false
    if (local.length) {
      // updates only move forward, and never past the Claude Code that is installed
      if (cliVersion && compareVersions(target.claudeCodeVersion, cliVersion) > 0) return false
      if (have?.claudeCodeVersion && compareVersions(target.claudeCodeVersion, have.claudeCodeVersion) <= 0) return false
    }

    const tgzRes = await net.fetch(target.dist!.tarball!)
    if (!tgzRes.ok) throw new Error(`npm tarball: HTTP ${tgzRes.status}`)
    const tgz = Buffer.from(await tgzRes.arrayBuffer())
    const digest = `sha512-${crypto.createHash('sha512').update(tgz).digest('base64')}`
    if (digest !== target.dist!.integrity) throw new Error('npm tarball integrity mismatch')
    // the module itself, its manifest, and Anthropic's license terms that come with it
    const files = untar(tgz, (n) => ['package/sdk.mjs', 'package/package.json', 'package/LICENSE.md', 'package/README.md'].includes(n))
    const sdk = files.get('package/sdk.mjs')
    const pkg = files.get('package/package.json')
    if (!sdk || !pkg) throw new Error('npm tarball without sdk.mjs')

    const dest = path.join(this.dir, target.version)
    const tmp = `${dest}.part`
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.mkdirSync(tmp, { recursive: true })
    for (const [name, body] of files) fs.writeFileSync(path.join(tmp, path.basename(name)), body)
    fs.rmSync(dest, { recursive: true, force: true })
    fs.renameSync(tmp, dest)
    this.prune(target.version)
    return true
  }

  /** Keeps the newest two synced SDKs (plus the one in use). */
  private prune(keep: string): void {
    const synced = this.synced().sort((a, b) => compareVersions(b.version, a.version))
    for (const c of synced.slice(2)) {
      if (c.version === keep || c.version === this.active?.version) continue
      try {
        fs.rmSync(path.dirname(c.entry!), { recursive: true, force: true })
      } catch {
        /* in use */
      }
    }
  }
}
