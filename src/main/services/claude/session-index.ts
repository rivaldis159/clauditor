import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { ProjectGroup, SessionMeta } from '@shared/types'
import { stripReminders } from './transcript'

const HEAD_BYTES = 192 * 1024
const TAIL_BYTES = 96 * 1024

interface HeadInfo {
  cwd: string | null
  createdAt: number | null
  firstPrompt: string | null
  entrypoint: string | null
  version: string | null
  gitBranch: string | null
  title: string | null
  forkedFrom: string | null
}

interface CacheEntry {
  size: number
  mtimeMs: number
  head: HeadInfo
  meta: SessionMeta
}

async function readRange(file: string, start: number, length: number): Promise<string> {
  const fh = await fsp.open(file, 'r')
  try {
    const buf = Buffer.alloc(length)
    const { bytesRead } = await fh.read(buf, 0, length, start)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await fh.close()
  }
}

function promptFrom(rec: any): string | null {
  if (rec.type !== 'user' || rec.isMeta || rec.isSidechain || rec.isCompactSummary) return null
  const c = rec.message?.content
  let text = ''
  if (typeof c === 'string') text = c
  else if (Array.isArray(c)) {
    if (c.some((b: any) => b?.type === 'tool_result')) return null
    text = c
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
  }
  const t = text.trimStart()
  if (!t || t.startsWith('<command-') || t.startsWith('<local-command') || t.startsWith('Caveat:') || t.startsWith('[Request interrupted') || t.startsWith('<task-notification>')) {
    return null
  }
  if (t.startsWith('<scheduled-task')) {
    const name = /name="([^"]+)"/.exec(t)?.[1]
    // English marker; the UI's sessionTitle() translates it
    return name ? `Scheduled task: ${name}` : 'Scheduled task'
  }
  const clean = stripReminders(text).replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, 240) : null
}

function parseHead(text: string, complete: boolean): HeadInfo {
  const info: HeadInfo = { cwd: null, createdAt: null, firstPrompt: null, entrypoint: null, version: null, gitBranch: null, title: null, forkedFrom: null }
  const lines = text.split('\n')
  if (!complete) lines.pop()
  for (const line of lines) {
    if (!line) continue
    const h = line.slice(0, 200)
    if (h.includes('"attachment":{"type":"')) continue
    let rec: any
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (rec.timestamp && info.createdAt === null) {
      const t = Date.parse(rec.timestamp)
      if (Number.isFinite(t)) info.createdAt = t
    }
    if (!info.cwd && typeof rec.cwd === 'string') info.cwd = rec.cwd
    if (!info.entrypoint && typeof rec.entrypoint === 'string') info.entrypoint = rec.entrypoint
    if (!info.version && typeof rec.version === 'string') info.version = rec.version
    if (!info.gitBranch && typeof rec.gitBranch === 'string' && rec.gitBranch) info.gitBranch = rec.gitBranch
    if (!info.forkedFrom && typeof rec.forkedFrom?.sessionId === 'string') info.forkedFrom = rec.forkedFrom.sessionId
    if (rec.type === 'custom-title' && rec.customTitle) info.title = rec.customTitle
    if (!info.firstPrompt) info.firstPrompt = promptFrom(rec)
    if (info.cwd && info.createdAt && info.firstPrompt && info.entrypoint) break
  }
  return info
}

function parseTail(text: string): { title: string | null; summary: string | null; lastTs: number | null; branch: string | null } {
  const out = { title: null as string | null, summary: null as string | null, lastTs: null as number | null, branch: null as string | null }
  const lines = text.split('\n')
  for (const line of lines) {
    if (!line || line[0] !== '{') continue
    if (line.includes('"custom-title"')) {
      try {
        const rec = JSON.parse(line)
        if (rec.type === 'custom-title' && rec.customTitle) out.title = rec.customTitle
      } catch {
        /* partial line */
      }
      continue
    }
    if (line.includes('"type":"summary"')) {
      try {
        const rec = JSON.parse(line)
        if (rec.summary) out.summary = rec.summary
      } catch {
        /* ignore */
      }
      continue
    }
    const m = /"timestamp":"([^"]+)"/.exec(line)
    if (m) {
      const t = Date.parse(m[1])
      if (Number.isFinite(t) && (out.lastTs === null || t > out.lastTs)) out.lastTs = t
    }
    const b = /"gitBranch":"([^"]+)"/.exec(line)
    if (b) out.branch = b[1]
  }
  return out
}

export class SessionIndex extends EventEmitter {
  private cache = new Map<string, CacheEntry>()
  private fileById = new Map<string, string>()
  private watcher: fs.FSWatcher | null = null
  private changeTimer: NodeJS.Timeout | null = null

  constructor(private readonly claudeHome: string) {
    super()
  }

  get projectsDir(): string {
    return path.join(this.claudeHome, 'projects')
  }

  start(): void {
    try {
      this.watcher = fs.watch(this.projectsDir, { recursive: true, persistent: false }, (_e, filename) => {
        if (!filename || !String(filename).endsWith('.jsonl')) return
        if (String(filename).includes(`${path.sep}subagents${path.sep}`)) return
        if (!this.changeTimer) {
          this.changeTimer = setTimeout(() => {
            this.changeTimer = null
            this.emit('changed')
          }, 2500)
        }
      })
      this.watcher.on('error', () => {})
    } catch {
      /* projects dir may not exist yet */
    }
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
  }

  private async metaFor(file: string, slug: string, st: fs.Stats): Promise<SessionMeta> {
    const id = path.basename(file, '.jsonl')
    const cached = this.cache.get(file)
    if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return cached.meta
    let head = cached?.head
    if (!head || !head.firstPrompt || !head.cwd) {
      const len = Math.min(st.size, HEAD_BYTES)
      head = parseHead(await readRange(file, 0, len), st.size <= HEAD_BYTES)
    }
    let tailTitle: string | null = null
    let summary: string | null = null
    let lastTs: number | null = null
    let branch: string | null = null
    if (st.size > 0) {
      const start = Math.max(0, st.size - TAIL_BYTES)
      const tail = parseTail(await readRange(file, start, st.size - start))
      tailTitle = tail.title
      summary = tail.summary
      lastTs = tail.lastTs
      branch = tail.branch
    }
    let fileTitle: string | null = null
    try {
      const raw = JSON.parse(await fsp.readFile(path.join(path.dirname(file), id, 'custom-title.json'), 'utf8'))
      if (typeof raw?.customTitle === 'string' && raw.customTitle.trim()) fileTitle = raw.customTitle.trim()
    } catch {
      /* no title file */
    }
    const meta: SessionMeta = {
      id,
      file,
      projectSlug: slug,
      cwd: head.cwd,
      title: fileTitle ?? tailTitle ?? head.title ?? summary,
      firstPrompt: head.firstPrompt,
      createdAt: head.createdAt ?? st.birthtimeMs,
      updatedAt: Math.max(lastTs ?? 0, st.mtimeMs),
      size: st.size,
      entrypoint: head.entrypoint,
      gitBranch: branch ?? head.gitBranch,
      version: head.version,
      live: null,
      startedByClauditor: false,
      desktop: null,
      forkedFrom: head.forkedFrom
    }
    this.cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, head, meta })
    this.fileById.set(id, file)
    return meta
  }

  async list(): Promise<SessionMeta[]> {
    const out: SessionMeta[] = []
    let slugs: string[] = []
    try {
      slugs = await fsp.readdir(this.projectsDir)
    } catch {
      return out
    }
    await Promise.all(
      slugs.map(async (slug) => {
        const dir = path.join(this.projectsDir, slug)
        let names: string[]
        try {
          names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.jsonl'))
        } catch {
          return
        }
        await Promise.all(
          names.map(async (n) => {
            const file = path.join(dir, n)
            try {
              const st = await fsp.stat(file)
              if (st.size === 0) return
              out.push(await this.metaFor(file, slug, st))
            } catch {
              /* vanished */
            }
          })
        )
      })
    )
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async groups(decorate: (m: SessionMeta) => SessionMeta): Promise<ProjectGroup[]> {
    const metas = (await this.list()).map(decorate)
    const bySlug = new Map<string, ProjectGroup>()
    for (const m of metas) {
      let g = bySlug.get(m.projectSlug)
      if (!g) {
        g = { slug: m.projectSlug, cwd: m.cwd, sessions: [] }
        bySlug.set(m.projectSlug, g)
      }
      if (!g.cwd && m.cwd) g.cwd = m.cwd
      g.sessions.push(m)
    }
    return [...bySlug.values()].sort((a, b) => (b.sessions[0]?.updatedAt ?? 0) - (a.sessions[0]?.updatedAt ?? 0))
  }

  async findFile(sessionId: string): Promise<string | null> {
    const known = this.fileById.get(sessionId)
    if (known && fs.existsSync(known)) return known
    let slugs: string[] = []
    try {
      slugs = await fsp.readdir(this.projectsDir)
    } catch {
      return null
    }
    for (const slug of slugs) {
      const candidate = path.join(this.projectsDir, slug, `${sessionId}.jsonl`)
      if (fs.existsSync(candidate)) {
        this.fileById.set(sessionId, candidate)
        return candidate
      }
    }
    return null
  }

  async meta(sessionId: string): Promise<SessionMeta | null> {
    const file = await this.findFile(sessionId)
    if (!file) return null
    try {
      const st = await fsp.stat(file)
      return await this.metaFor(file, path.basename(path.dirname(file)), st)
    } catch {
      return null
    }
  }
}
