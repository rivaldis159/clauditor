import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { SessionMeta, SessionSnapshot, SessionUpdate, SubagentInfo, TimelineEvent } from '@shared/types'
import { TranscriptParser } from './transcript'
import type { SessionIndex } from './session-index'
import type { LiveRegistry } from './registry'
import type { DesktopSessions } from './desktop-sessions'
import { decodeBuffer } from '../../lib/text-codec'

const liveKey = (l: SessionMeta['live']) => (l ? `${l.status}|${l.pid}|${l.peers.map((p) => `${p.pid}:${p.status}`).join(',')}` : '')

const CHUNK = 1024 * 1024
const yieldNow = () => new Promise<void>((r) => setImmediate(r))

interface OpenSession {
  id: string
  file: string
  parser: TranscriptParser
  offset: number
  remainder: Buffer
  refs: number
  meta: SessionMeta
  watcher: fs.FSWatcher | null
  poll: NodeJS.Timeout | null
  debounce: NodeJS.Timeout | null
  reading: Promise<void> | null
  rerun: boolean
}

/** Parse a whole transcript file in chunks, yielding to the event loop between chunks. */
export async function parseTranscriptFile(file: string, parser: TranscriptParser, from = 0, carry: Buffer = Buffer.alloc(0)): Promise<{ offset: number; remainder: Buffer }> {
  const fh = await fsp.open(file, 'r')
  try {
    const { size } = await fh.stat()
    let offset = from
    let remainder = carry
    if (size < offset) return { offset, remainder }
    const buf = Buffer.alloc(CHUNK)
    while (offset < size) {
      const want = Math.min(CHUNK, size - offset)
      const { bytesRead } = await fh.read(buf, 0, want, offset)
      if (bytesRead <= 0) break
      offset += bytesRead
      const data = remainder.length ? Buffer.concat([remainder, buf.subarray(0, bytesRead)]) : Buffer.from(buf.subarray(0, bytesRead))
      const last = data.lastIndexOf(0x0a)
      if (last === -1) {
        remainder = data
        continue
      }
      remainder = Buffer.from(data.subarray(last + 1))
      const text = data.subarray(0, last).toString('utf8')
      let start = 0
      while (start <= text.length) {
        let nl = text.indexOf('\n', start)
        if (nl === -1) nl = text.length
        const line = text.slice(start, nl)
        if (line) parser.feedLine(line.endsWith('\r') ? line.slice(0, -1) : line)
        start = nl + 1
      }
      await yieldNow()
    }
    return { offset, remainder }
  } finally {
    await fh.close()
  }
}

export class SessionStore extends EventEmitter {
  private open = new Map<string, OpenSession>()

  constructor(
    private readonly claudeHome: string,
    private readonly index: SessionIndex,
    private readonly registry: LiveRegistry,
    private readonly desktop: DesktopSessions
  ) {
    super()
    registry.on('changed', () => {
      for (const s of this.open.values()) {
        const live = registry.get(s.id)
        if (liveKey(live) !== liveKey(s.meta.live)) {
          s.meta = { ...s.meta, live }
          this.emitUpdate(s, { added: [], updated: [] })
        }
      }
    })
  }

  private decorate(s: OpenSession): SessionMeta {
    const p = s.parser
    return {
      ...s.meta,
      title: p.meta.title ?? s.meta.title ?? p.meta.summary,
      cwd: s.meta.cwd ?? p.meta.cwd,
      firstPrompt: s.meta.firstPrompt ?? p.meta.firstPrompt,
      updatedAt: Math.max(s.meta.updatedAt, p.meta.lastTs ?? 0),
      gitBranch: p.meta.gitBranch ?? s.meta.gitBranch,
      live: this.registry.get(s.id),
      desktop: this.desktop.get(s.id),
      forkedFrom: s.meta.forkedFrom ?? p.meta.forkedFrom
    }
  }

  private snapshot(s: OpenSession): SessionSnapshot {
    s.meta = this.decorate(s)
    return {
      meta: s.meta,
      events: s.parser.events,
      stats: s.parser.stats,
      todos: s.parser.todos,
      files: s.parser.fileChanges(),
      cwd: s.parser.meta.cwd
    }
  }

  async openSession(sessionId: string): Promise<SessionSnapshot | null> {
    const existing = this.open.get(sessionId)
    if (existing) {
      existing.refs++
      if (existing.reading) await existing.reading
      return this.snapshot(existing)
    }
    const meta = await this.index.meta(sessionId)
    if (!meta) return null
    const s: OpenSession = {
      id: sessionId,
      file: meta.file,
      parser: new TranscriptParser(),
      offset: 0,
      remainder: Buffer.alloc(0),
      refs: 1,
      meta,
      watcher: null,
      poll: null,
      debounce: null,
      reading: null,
      rerun: false
    }
    this.open.set(sessionId, s)
    s.reading = (async () => {
      const r = await parseTranscriptFile(s.file, s.parser)
      s.offset = r.offset
      s.remainder = r.remainder
      s.parser.drain()
    })()
    try {
      await s.reading
    } finally {
      s.reading = null
    }
    this.watch(s)
    return this.snapshot(s)
  }

  closeSession(sessionId: string): void {
    const s = this.open.get(sessionId)
    if (!s) return
    s.refs--
    if (s.refs > 0) return
    s.watcher?.close()
    if (s.poll) clearInterval(s.poll)
    if (s.debounce) clearTimeout(s.debounce)
    this.open.delete(sessionId)
  }

  closeAll(): void {
    for (const id of [...this.open.keys()]) {
      const s = this.open.get(id)
      if (s) s.refs = 1
      this.closeSession(id)
    }
  }

  private watch(s: OpenSession): void {
    const schedule = () => {
      if (s.debounce) return
      s.debounce = setTimeout(() => {
        s.debounce = null
        void this.readMore(s)
      }, 40)
    }
    try {
      s.watcher = fs.watch(s.file, { persistent: false }, schedule)
      s.watcher.on('error', () => {})
    } catch {
      /* polling only */
    }
    // fs.watch can miss appends made by another process holding the file; poll the size as well.
    s.poll = setInterval(async () => {
      try {
        const st = await fsp.stat(s.file)
        if (st.size !== s.offset) schedule()
      } catch {
        /* file removed */
      }
    }, 900)
  }

  private async readMore(s: OpenSession): Promise<void> {
    if (s.reading) {
      s.rerun = true
      return
    }
    s.reading = (async () => {
      let st: fs.Stats
      try {
        st = await fsp.stat(s.file)
      } catch {
        return
      }
      if (st.size < s.offset) {
        // Rewritten transcript: start over.
        s.parser = new TranscriptParser()
        const r = await parseTranscriptFile(s.file, s.parser)
        s.offset = r.offset
        s.remainder = r.remainder
        s.parser.drain()
        const snap = this.snapshot(s)
        this.emit('update', {
          sessionId: s.id,
          reset: true,
          added: snap.events,
          updated: [],
          stats: snap.stats,
          todos: snap.todos,
          files: snap.files,
          meta: snap.meta
        } satisfies SessionUpdate)
        return
      }
      if (st.size === s.offset) return
      const r = await parseTranscriptFile(s.file, s.parser, s.offset, s.remainder)
      s.offset = r.offset
      s.remainder = r.remainder
      const d = s.parser.drain()
      if (d.added.length || d.updated.length) this.emitUpdate(s, d)
    })()
    try {
      await s.reading
    } finally {
      s.reading = null
      if (s.rerun) {
        s.rerun = false
        void this.readMore(s)
      }
    }
  }

  private emitUpdate(s: OpenSession, d: { added: TimelineEvent[]; updated: TimelineEvent[] }): void {
    s.meta = this.decorate(s)
    const update: SessionUpdate = {
      sessionId: s.id,
      added: d.added,
      updated: d.updated,
      stats: s.parser.stats,
      todos: s.parser.todos,
      files: s.parser.fileChanges(),
      meta: s.meta
    }
    this.emit('update', update)
  }

  isOpen(sessionId: string): boolean {
    return this.open.has(sessionId)
  }

  async readBackup(sessionId: string, backupFile: string): Promise<string | null> {
    if (!/^[\w.@-]+$/.test(backupFile)) return null
    try {
      const buf = await fsp.readFile(path.join(this.claudeHome, 'file-history', sessionId, backupFile))
      const d = decodeBuffer(buf)
      return d.binary ? null : d.text
    } catch {
      return null
    }
  }

  async subagents(sessionId: string): Promise<SubagentInfo[]> {
    const file = await this.index.findFile(sessionId)
    if (!file) return []
    const dir = path.join(path.dirname(file), sessionId, 'subagents')
    let names: string[] = []
    try {
      names = await fsp.readdir(dir)
    } catch {
      return []
    }
    const out: SubagentInfo[] = []
    for (const n of names) {
      const m = /^agent-([\w-]+)\.jsonl$/.exec(n)
      if (!m) continue
      let meta: any = {}
      try {
        meta = JSON.parse(await fsp.readFile(path.join(dir, `agent-${m[1]}.meta.json`), 'utf8'))
      } catch {
        /* older versions have no meta */
      }
      out.push({
        agentId: m[1],
        toolUseId: typeof meta.toolUseId === 'string' ? meta.toolUseId : null,
        agentType: typeof meta.agentType === 'string' ? meta.agentType : null,
        description: typeof meta.description === 'string' ? meta.description : null,
        file: path.join(dir, n)
      })
    }
    return out
  }

  async subagentEvents(sessionId: string, agentId: string): Promise<TimelineEvent[]> {
    const info = (await this.subagents(sessionId)).find((a) => a.agentId === agentId)
    if (!info) return []
    const parser = new TranscriptParser({ includeSidechain: true })
    await parseTranscriptFile(info.file, parser)
    return parser.events
  }
}
