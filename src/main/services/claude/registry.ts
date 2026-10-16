import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { LiveSessionInfo } from '@shared/types'

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * One entry per session: the most recently started process, with the others on the same session
 * (say Claude desktop and Clauditor both holding it) listed as peers.
 */
export function groupLive(entries: LiveSessionInfo[]): Map<string, LiveSessionInfo> {
  const bySession = new Map<string, LiveSessionInfo[]>()
  for (const e of entries) bySession.set(e.sessionId, [...(bySession.get(e.sessionId) ?? []), e])
  const out = new Map<string, LiveSessionInfo>()
  for (const [id, list] of bySession) {
    const sorted = [...list].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || b.pid - a.pid)
    const [primary, ...rest] = sorted
    out.set(id, { ...primary, peers: rest.map((p) => ({ pid: p.pid, entrypoint: p.entrypoint, status: p.status })) })
  }
  return out
}

/**
 * Watches ~/.claude/sessions/<pid>.json — the registry every running Claude Code process
 * (including the ones Claude desktop starts) keeps up to date with its status.
 */
export class LiveRegistry extends EventEmitter {
  private live = new Map<string, LiveSessionInfo>()
  private signature = ''
  private watcher: fs.FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private refreshing = false
  private again = false

  constructor(private readonly claudeHome: string) {
    super()
  }

  get dir(): string {
    return path.join(this.claudeHome, 'sessions')
  }

  start(): void {
    void this.refresh()
    try {
      this.watcher = fs.watch(this.dir, { persistent: false }, () => void this.refresh())
      this.watcher.on('error', () => {})
    } catch {
      /* directory created later; polling covers it */
    }
    this.timer = setInterval(() => void this.refresh(), 1500)
  }

  stop(): void {
    this.watcher?.close()
    if (this.timer) clearInterval(this.timer)
    this.watcher = null
    this.timer = null
  }

  list(): LiveSessionInfo[] {
    return [...this.live.values()]
  }

  get(sessionId: string): LiveSessionInfo | null {
    return this.live.get(sessionId) ?? null
  }

  async refresh(): Promise<void> {
    if (this.refreshing) {
      this.again = true
      return
    }
    this.refreshing = true
    try {
      let names: string[] = []
      try {
        names = (await fsp.readdir(this.dir)).filter((n) => /^\d+\.json$/.test(n))
      } catch {
        names = []
      }
      const all: LiveSessionInfo[] = []
      await Promise.all(
        names.map(async (n) => {
          try {
            const raw = JSON.parse(await fsp.readFile(path.join(this.dir, n), 'utf8'))
            const pid = Number(raw.pid)
            if (!raw.sessionId || !alive(pid)) return
            all.push({
              pid,
              sessionId: String(raw.sessionId),
              cwd: String(raw.cwd ?? ''),
              status: String(raw.status ?? 'unknown'),
              statusUpdatedAt: Number(raw.statusUpdatedAt) || null,
              name: typeof raw.name === 'string' ? raw.name : null,
              hostSessionId: typeof raw.hostSessionId === 'string' ? raw.hostSessionId : null,
              entrypoint: typeof raw.entrypoint === 'string' ? raw.entrypoint : null,
              kind: typeof raw.kind === 'string' ? raw.kind : null,
              version: typeof raw.version === 'string' ? raw.version : null,
              startedAt: Number(raw.startedAt) || null,
              peers: []
            })
          } catch {
            /* file mid-write */
          }
        })
      )
      const next = groupLive(all)
      const sig = JSON.stringify([...next.values()].sort((a, b) => a.pid - b.pid))
      if (sig !== this.signature) {
        const prev = this.live
        this.signature = sig
        this.live = next
        this.emit('changed', this.list(), prev)
      }
    } finally {
      this.refreshing = false
      if (this.again) {
        this.again = false
        void this.refresh()
      }
    }
  }
}
