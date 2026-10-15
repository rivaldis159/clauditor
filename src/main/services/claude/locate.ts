import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { ClaudeExecutable } from '@shared/types'

const require = createRequire(import.meta.url)

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * Claude desktop keeps its bundled Claude Code under
 * %APPDATA%\Claude\claude-code\<version>\<hash>\claude.exe. For the MSIX build that
 * folder is virtualised to %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming.
 */
export function desktopRoots(): string[] {
  const roots: string[] = []
  const local = process.env.LOCALAPPDATA
  const roaming = process.env.APPDATA
  if (local) {
    const pkgs = path.join(local, 'Packages')
    for (const name of safeReaddir(pkgs)) {
      if (/^Claude_/i.test(name)) roots.push(path.join(pkgs, name, 'LocalCache', 'Roaming', 'Claude', 'claude-code'))
    }
  }
  if (roaming) roots.push(path.join(roaming, 'Claude', 'claude-code'))
  return roots
}

export function findDesktopExecutable(): ClaudeExecutable | null {
  let best: ClaudeExecutable | null = null
  for (const root of desktopRoots()) {
    for (const version of safeReaddir(root)) {
      if (!/^\d+\.\d+\.\d+/.test(version)) continue
      for (const hash of safeReaddir(path.join(root, version))) {
        const exe = path.join(root, version, hash, process.platform === 'win32' ? 'claude.exe' : 'claude')
        if (!fs.existsSync(exe)) continue
        if (!best || compareVersions(version, best.version ?? '0') > 0) best = { path: exe, version, source: 'desktop' }
      }
    }
  }
  return best
}

function findOnPath(): ClaudeExecutable | null {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const native = path.join(home, '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')
  if (fs.existsSync(native)) return { path: native, version: null, source: 'path' }
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['claude'], { encoding: 'utf8', windowsHide: true, timeout: 4000 })
    const first = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && (process.platform !== 'win32' || /\.(exe|cmd)$/i.test(l)))
    if (first) return { path: first, version: null, source: 'path' }
  } catch {
    /* not installed */
  }
  return null
}

function findSdkBundled(): ClaudeExecutable | null {
  try {
    const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`
    const dir = path.dirname(require.resolve(pkg))
    const exe = path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude')
    if (fs.existsSync(exe)) return { path: exe, version: null, source: 'sdk' }
  } catch {
    /* optional package not installed */
  }
  return null
}

let cached: { key: string; value: ClaudeExecutable | null; at: number } | null = null

/** Forget the last lookup (Claude desktop may have installed a new Claude Code). */
export function clearExecutableCache(): void {
  cached = null
}

export function findClaudeExecutable(override: string): ClaudeExecutable | null {
  const key = override || ''
  if (cached && cached.key === key && Date.now() - cached.at < 30_000) return cached.value
  let value: ClaudeExecutable | null = null
  if (override && fs.existsSync(override)) value = { path: override, version: null, source: 'settings' }
  value ??= findDesktopExecutable() ?? findOnPath() ?? findSdkBundled()
  cached = { key, value, at: Date.now() }
  return value
}
