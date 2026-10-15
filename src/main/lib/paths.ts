import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

/** Root of Claude Code's per-user data (~/.claude). Overridable for tests. */
export function claudeHome(): string {
  return process.env.CLAUDITOR_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

export function userDataDir(): string {
  return app.getPath('userData')
}

/** Paths inside app.asar cannot be executed; native helpers live in app.asar.unpacked. */
export function unpacked(p: string): string {
  return p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
}

export function resourcePath(...parts: string[]): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.join(app.getAppPath(), 'resources', ...parts)
}

/** Case-insensitive key for Windows paths. */
export function pathKey(p: string): string {
  const n = path.normalize(p)
  return process.platform === 'win32' ? n.toLowerCase() : n
}

export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}
