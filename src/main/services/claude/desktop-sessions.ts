// Claude desktop's own list of its Claude Code sessions: one JSON file per session under
// <Claude data>\claude-code-sessions\<org>\<account>\local_*.json. It tells which transcripts belong
// to Claude desktop (Claude desktop only shows what its own Claude Code ran, so Clauditor must not
// write into those) and which model and effort Claude desktop runs them with. Read-only; the format
// is Claude desktop's, so every field is optional.
import fs from 'node:fs'
import path from 'node:path'
import type { DesktopSessionRef } from '@shared/types'

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/** Claude desktop's data folders: the Microsoft Store (MSIX) one and the classic installer's. */
export function desktopDataDirs(): string[] {
  // tests point Clauditor at a throw-away copy, like CLAUDITOR_CLAUDE_HOME
  if (process.env.CLAUDITOR_DESKTOP_DATA) return [process.env.CLAUDITOR_DESKTOP_DATA]
  const dirs: string[] = []
  const local = process.env.LOCALAPPDATA
  if (local) {
    const pkgs = path.join(local, 'Packages')
    for (const name of safeReaddir(pkgs)) {
      if (/^Claude_/i.test(name)) dirs.push(path.join(pkgs, name, 'LocalCache', 'Roaming', 'Claude'))
    }
  }
  if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'Claude'))
  return dirs
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** One session file → its transcript id (cliSessionId) and what Clauditor shows about it. */
export function parseDesktopSession(raw: unknown): (DesktopSessionRef & { cliSessionId: string }) | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const cliSessionId = text(r.cliSessionId)
  const hostSessionId = text(r.sessionId)
  if (!cliSessionId || !hostSessionId) return null
  return {
    cliSessionId,
    hostSessionId,
    title: text(r.title),
    model: text(r.model),
    effort: text(r.effort),
    permissionMode: text(r.permissionMode),
    archived: r.isArchived === true
  }
}

interface FileEntry {
  mtimeMs: number
  size: number
  cli: string | null
}

export class DesktopSessions {
  private byCli = new Map<string, DesktopSessionRef>()
  private files = new Map<string, FileEntry>()
  private scannedAt = 0

  constructor(private readonly dirs: () => string[] = desktopDataDirs) {}

  /** Re-lists at most every `maxAgeMs`; a file is only parsed again when it changed. */
  private scan(maxAgeMs = 3000): void {
    if (Date.now() - this.scannedAt < maxAgeMs) return
    this.scannedAt = Date.now()
    const seen = new Set<string>()
    for (const dir of this.dirs()) {
      const root = path.join(dir, 'claude-code-sessions')
      for (const org of safeReaddir(root)) {
        for (const account of safeReaddir(path.join(root, org))) {
          const folder = path.join(root, org, account)
          for (const name of safeReaddir(folder)) {
            if (!/^local_[\w-]+\.json$/.test(name)) continue
            const file = path.join(folder, name)
            seen.add(file)
            let st: fs.Stats
            try {
              st = fs.statSync(file)
            } catch {
              continue
            }
            const prev = this.files.get(file)
            if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) continue
            let ref: ReturnType<typeof parseDesktopSession> = null
            try {
              ref = parseDesktopSession(JSON.parse(fs.readFileSync(file, 'utf8')))
            } catch {
              /* mid-write: picked up on the next scan */
            }
            if (prev?.cli) this.byCli.delete(prev.cli)
            this.files.set(file, { mtimeMs: st.mtimeMs, size: st.size, cli: ref?.cliSessionId ?? null })
            if (ref) {
              const { cliSessionId, ...info } = ref
              this.byCli.set(cliSessionId, info)
            }
          }
        }
      }
    }
    for (const [file, entry] of this.files) {
      if (seen.has(file)) continue
      this.files.delete(file)
      if (entry.cli) this.byCli.delete(entry.cli)
    }
  }

  /** Claude desktop's record of a transcript, or null when Claude desktop does not list it. */
  get(cliSessionId: string): DesktopSessionRef | null {
    this.scan()
    return this.byCli.get(cliSessionId) ?? null
  }
}
