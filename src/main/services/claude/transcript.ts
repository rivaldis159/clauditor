// Incremental parser for Claude Code transcript files (~/.claude/projects/<slug>/<id>.jsonl).
// Pure module: no Electron imports, so it can be unit tested and reused for subagents.
import path from 'node:path'
import type {
  Hunk,
  PromptEvent,
  SessionFileChange,
  SessionStats,
  TimelineEvent,
  TodoItem,
  ToolEvent,
  ToolResult
} from '@shared/types'

const MAX_TEXT = 80_000
const MAX_RESULT = 24_000
const MAX_STDOUT = 48_000
const MAX_STDERR = 12_000
const MAX_INPUT_STRING = 600_000
const MAX_FILENAMES = 300

type Rec = Record<string, any>

export interface ParserMeta {
  sessionId: string | null
  cwd: string | null
  title: string | null
  summary: string | null
  firstPrompt: string | null
  gitBranch: string | null
  version: string | null
  entrypoint: string | null
  createdAt: number | null
  lastTs: number | null
  /** source session of a copy made with Claude Code's fork (records carry `forkedFrom`) */
  forkedFrom: string | null
}

export interface Drained {
  added: TimelineEvent[]
  updated: TimelineEvent[]
}

export function emptyStats(): SessionStats {
  return {
    turns: 0,
    toolCalls: 0,
    toolCounts: {},
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUSD: null,
    models: [],
    model: null,
    linesAdded: 0,
    linesRemoved: 0,
    firstTs: null,
    lastTs: null,
    contextTokens: 0
  }
}

export function pathKey(p: string): string {
  const n = path.normalize(p)
  return process.platform === 'win32' ? n.toLowerCase() : n
}

function cap(s: string, n: number): [string, boolean] {
  if (s.length <= n) return [s, false]
  return [s.slice(0, n), true]
}

const REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g

export function stripReminders(s: string): string {
  return s.replace(REMINDER_RE, '').trim()
}

function stripTags(s: string): string {
  return s.replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?>/gi, '').trim()
}

export function blockText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const b of content) {
    if (b && typeof b === 'object' && (b as Rec).type === 'text' && typeof (b as Rec).text === 'string') parts.push((b as Rec).text)
  }
  return parts.join('\n')
}

export function normalizeHunks(raw: unknown): Hunk[] {
  if (!Array.isArray(raw)) return []
  const out: Hunk[] = []
  for (const h of raw) {
    if (!h || typeof h !== 'object') continue
    const r = h as Rec
    out.push({
      oldStart: Number(r.oldStart) || 0,
      oldLines: Number(r.oldLines) || 0,
      newStart: Number(r.newStart) || 0,
      newLines: Number(r.newLines) || 0,
      lines: Array.isArray(r.lines) ? r.lines.map((l: unknown) => String(l)) : []
    })
  }
  return out
}

export function countPatch(hunks: Hunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.startsWith('+')) added++
      else if (l.startsWith('-')) removed++
    }
  }
  return { added, removed }
}

function lineCount(s: unknown): number {
  if (typeof s !== 'string' || s.length === 0) return 0
  let n = 1
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++
  if (s.endsWith('\n')) n--
  return n
}

function trimInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input as Rec)) {
    out[k] = typeof v === 'string' && v.length > MAX_INPUT_STRING ? v.slice(0, MAX_INPUT_STRING) : v
  }
  return out
}

function normalizeTodos(raw: unknown): TodoItem[] | null {
  if (!Array.isArray(raw)) return null
  return raw
    .filter((t) => t && typeof t === 'object')
    .map((t: Rec) => ({
      content: String(t.content ?? t.subject ?? ''),
      status: t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending',
      activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined
    }))
}

const DENIAL_RE = /doesn't want to proceed|was rejected|rejected this|permission (?:to use .* )?(?:was |has been )?denied|User rejected|denied by/i

export interface ParserOptions {
  /** Subagent transcripts mark every record as sidechain; include them. */
  includeSidechain?: boolean
}

export class TranscriptParser {
  readonly events: TimelineEvent[] = []
  readonly meta: ParserMeta = {
    sessionId: null,
    cwd: null,
    title: null,
    summary: null,
    firstPrompt: null,
    gitBranch: null,
    version: null,
    entrypoint: null,
    createdAt: null,
    lastTs: null,
    forkedFrom: null
  }
  readonly stats: SessionStats = emptyStats()
  todos: TodoItem[] | null = null

  private readonly includeSidechain: boolean
  private tools = new Map<string, ToolEvent>()
  private usage = new Map<string, { i: number; o: number; cr: number; cc: number }>()
  private models = new Set<string>()
  private fileMap = new Map<string, SessionFileChange>()
  private backups = new Map<string, { name: string | null; version: number }>()
  private tasks = new Map<string, TodoItem>()
  private pendingTaskCreate = new Map<string, TodoItem>()
  private added: TimelineEvent[] = []
  private addedSet = new Set<TimelineEvent>()
  private updated = new Set<TimelineEvent>()
  private lastSystemText = ''

  constructor(opts: ParserOptions = {}) {
    this.includeSidechain = !!opts.includeSidechain
  }

  feedLine(line: string): void {
    if (!line || line.length < 2) return
    // Attachment records (system prompt snapshots, reminders…) are by far the largest lines;
    // skip parsing those we never display.
    const head = line.slice(0, 200)
    if (head.includes('"attachment":{"type":"') && !/"attachment":\{"type":"(queued_command|edited_text_file)"/.test(head)) {
      return
    }
    let rec: Rec
    try {
      rec = JSON.parse(line)
    } catch {
      return
    }
    this.feed(rec)
  }

  feed(rec: Rec): void {
    if (!rec || typeof rec !== 'object') return
    const ts = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : Number.NaN
    if (Number.isFinite(ts)) {
      this.meta.createdAt ??= ts
      this.meta.lastTs = Math.max(this.meta.lastTs ?? 0, ts)
      this.stats.firstTs ??= ts
      this.stats.lastTs = this.meta.lastTs
    }
    if (typeof rec.cwd === 'string' && !this.meta.cwd) this.meta.cwd = rec.cwd
    if (typeof rec.sessionId === 'string' && !this.meta.sessionId) this.meta.sessionId = rec.sessionId
    if (typeof rec.version === 'string') this.meta.version = rec.version
    if (typeof rec.gitBranch === 'string' && rec.gitBranch) this.meta.gitBranch = rec.gitBranch
    if (typeof rec.entrypoint === 'string' && !this.meta.entrypoint) this.meta.entrypoint = rec.entrypoint
    if (!this.meta.forkedFrom && typeof rec.forkedFrom?.sessionId === 'string') this.meta.forkedFrom = rec.forkedFrom.sessionId
    const when = Number.isFinite(ts) ? ts : (this.meta.lastTs ?? 0)

    switch (rec.type) {
      case 'user':
        this.onUser(rec, when)
        break
      case 'assistant':
        this.onAssistant(rec, when)
        break
      case 'system':
        this.onSystem(rec, when)
        break
      case 'attachment':
        this.onAttachment(rec, when)
        break
      case 'custom-title':
        if (typeof rec.customTitle === 'string' && rec.customTitle.trim()) this.meta.title = rec.customTitle.trim()
        break
      case 'summary':
        if (typeof rec.summary === 'string') this.meta.summary = rec.summary
        break
      case 'file-history-snapshot': {
        const tfb = rec.snapshot?.trackedFileBackups
        if (tfb && typeof tfb === 'object') {
          for (const [k, v] of Object.entries(tfb as Rec)) {
            const abs = v?.realParentDir
              ? path.join(v.realParentDir, path.basename(k))
              : path.isAbsolute(k)
                ? k
                : this.meta.cwd
                  ? path.join(this.meta.cwd, k)
                  : k
            this.recordBackup(abs, v)
          }
        }
        break
      }
      case 'file-history-delta':
        if (typeof rec.trackingPath === 'string' && rec.backup) this.recordBackup(rec.trackingPath, rec.backup)
        break
      case 'cost-state':
        if (typeof rec.totalCostUSD === 'number' && rec.totalCostUSD > 0) this.stats.costUSD = rec.totalCostUSD
        break
      default:
        break
    }
  }

  /** Events added/updated since the previous drain. */
  drain(): Drained {
    const added = this.added
    const updated = [...this.updated].filter((e) => !this.addedSet.has(e))
    this.added = []
    this.addedSet = new Set()
    this.updated = new Set()
    return { added, updated }
  }

  fileChanges(): SessionFileChange[] {
    const out: SessionFileChange[] = []
    for (const [key, fc] of this.fileMap) {
      const b = this.backups.get(key)
      out.push({ ...fc, backup: b?.name ?? null, created: fc.created || (b !== undefined && b.name === null) })
    }
    return out.sort((a, b) => a.firstTs - b.firstTs)
  }

  backupFor(file: string): { name: string | null; version: number } | undefined {
    return this.backups.get(pathKey(file))
  }

  get title(): string | null {
    return this.meta.title ?? this.meta.summary ?? null
  }

  /* ---------------------------------------------------------------- */

  private push(ev: TimelineEvent): void {
    this.events.push(ev)
    this.added.push(ev)
    this.addedSet.add(ev)
  }

  private touch(ev: TimelineEvent): void {
    if (!this.addedSet.has(ev)) this.updated.add(ev)
  }

  private pushSystem(id: string, ts: number, level: 'info' | 'warning' | 'error', subtype: string, text: string, vars?: Record<string, string>, i18n = false): void {
    const key = `${subtype}:${text}:${vars ? JSON.stringify(vars) : ''}`
    if (key === this.lastSystemText) return
    this.lastSystemText = key
    this.push(i18n ? { kind: 'system', id, ts, level, subtype, text, i18n, vars } : { kind: 'system', id, ts, level, subtype, text })
  }

  /** A notice written by Clauditor itself: an English template the UI translates with `vars`. */
  private pushNotice(id: string, ts: number, level: 'info' | 'warning' | 'error', subtype: string, template: string, vars?: Record<string, string>): void {
    this.pushSystem(id, ts, level, subtype, template, vars, true)
  }

  private recordBackup(abs: string, v: Rec): void {
    const key = pathKey(abs)
    const version = Number(v?.version) || 1
    const name = typeof v?.backupFileName === 'string' ? v.backupFileName : null
    const cur = this.backups.get(key)
    if (!cur || version < cur.version) this.backups.set(key, { name, version })
  }

  private onUser(rec: Rec, ts: number): void {
    if (rec.isSidechain && !this.includeSidechain) return
    const msg = rec.message
    if (!msg) return
    if (rec.isCompactSummary) {
      this.pushNotice(rec.uuid ?? `c${ts}`, ts, 'info', 'compact', 'Conversation summarized to fit in the context window')
      return
    }
    if (rec.isMeta) return
    const content = msg.content
    if (typeof content === 'string') {
      this.onPromptText(content, rec, ts, 0)
      return
    }
    if (!Array.isArray(content)) return
    const texts: string[] = []
    let images = 0
    let hadToolResult = false
    for (const b of content) {
      if (!b || typeof b !== 'object') continue
      if (b.type === 'tool_result') {
        hadToolResult = true
        this.onToolResult(b, rec, ts)
      } else if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
      else if (b.type === 'image') images++
    }
    if (!hadToolResult && (texts.length || images)) this.onPromptText(texts.join('\n'), rec, ts, images)
  }

  private onPromptText(raw: string, rec: Rec, ts: number, images: number): void {
    const id = rec.uuid ?? `p${ts}-${this.events.length}`
    const trimmed = raw.trimStart()
    if (/^\[Request interrupted by user/.test(trimmed)) {
      this.pushNotice(id, ts, 'warning', 'interrupt', 'Stopped by user')
      return
    }
    if (trimmed.startsWith('<local-command-stdout>') || trimmed.startsWith('<local-command-stderr>')) {
      const t = stripTags(raw)
      if (t) this.pushSystem(id, ts, 'info', 'local-command', t.slice(0, 4000))
      return
    }
    if (trimmed.startsWith('Caveat: The messages below')) return
    if (raw.includes('<command-name>')) {
      const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(raw)?.[1]?.trim() ?? ''
      const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(raw)?.[1]?.trim() ?? ''
      const text = `${name.startsWith('/') ? name : `/${name}`} ${args}`.trim()
      this.push({ kind: 'prompt', id, ts, text, images: 0, origin: 'command' })
      this.stats.turns++
      return
    }
    let origin: PromptEvent['origin'] = 'user'
    let text = stripReminders(raw)
    if (trimmed.startsWith('<scheduled-task')) {
      origin = 'scheduled'
    } else if (trimmed.startsWith('<task-notification>')) {
      origin = 'task-notification'
      const summary = /<summary>([\s\S]*?)<\/summary>/.exec(raw)?.[1]
      text = (summary ?? stripTags(raw)).trim()
    }
    if (!text && !images) return
    const [capped] = cap(text, MAX_TEXT)
    this.push({ kind: 'prompt', id, ts, text: capped, images, origin })
    if (origin !== 'task-notification') this.stats.turns++
    if (origin === 'user' && !this.meta.firstPrompt) this.meta.firstPrompt = text.slice(0, 400)
  }

  private onSystem(rec: Rec, ts: number): void {
    if (rec.isSidechain && !this.includeSidechain) return
    const id = rec.uuid ?? `s${ts}-${this.events.length}`
    const st = String(rec.subtype ?? '')
    if (st === 'compact_boundary') {
      const manual = rec.compactMetadata?.trigger === 'manual'
      const pre = Number(rec.compactMetadata?.preTokens) || 0
      if (pre) this.pushNotice(id, ts, 'info', 'compact', manual ? 'Context compacted manually from {k}k tokens' : 'Context compacted automatically from {k}k tokens', { k: String(Math.round(pre / 1000)) })
      else this.pushNotice(id, ts, 'info', 'compact', manual ? 'Context compacted manually' : 'Context compacted automatically')
    } else if (st === 'api_error') {
      const detail = typeof rec.error?.message === 'string' ? rec.error.message : typeof rec.content === 'string' ? rec.content : ''
      if (rec.retryAttempt) {
        this.pushNotice(id, ts, 'warning', 'api', '{detail} — attempt {n} of {max}', { detail: (detail || 'API error').slice(0, 560), n: String(rec.retryAttempt), max: String(rec.maxRetries ?? '?') })
      } else if (detail) this.pushSystem(id, ts, 'warning', 'api', detail.slice(0, 600))
      else this.pushNotice(id, ts, 'warning', 'api', 'API error')
    } else if (st === 'stop_hook_summary') {
      if (Array.isArray(rec.hookErrors) && rec.hookErrors.length) {
        this.pushNotice(id, ts, 'warning', 'hook', 'Hook failed: {errors}', { errors: rec.hookErrors.map(String).join('; ').slice(0, 600) })
      }
    } else if (st === 'local_command') {
      const t = typeof rec.content === 'string' ? stripTags(rec.content) : ''
      if (t) this.pushSystem(id, ts, 'info', 'local-command', t.slice(0, 4000))
    } else if ((rec.level === 'error' || rec.level === 'warning') && typeof rec.content === 'string' && rec.content.trim()) {
      this.pushSystem(id, ts, rec.level, st || 'system', stripTags(rec.content).slice(0, 1200))
    }
  }

  private onAttachment(rec: Rec, ts: number): void {
    if (rec.isSidechain && !this.includeSidechain) return
    const a = rec.attachment
    if (!a || typeof a !== 'object') return
    if (a.type === 'queued_command' && typeof a.prompt === 'string') {
      this.onPromptText(a.prompt, rec, ts, 0)
    } else if (a.type === 'edited_text_file' && typeof a.filename === 'string') {
      this.pushNotice(rec.uuid ?? `a${ts}`, ts, 'info', 'user-edit', 'File changed outside Claude: {file}', { file: a.filename })
    }
  }

  private onAssistant(rec: Rec, ts: number): void {
    if (rec.isSidechain && !this.includeSidechain) return
    const msg = rec.message
    if (!msg) return
    const mid: string = msg.id ?? rec.uuid
    const model: string | undefined = typeof msg.model === 'string' ? msg.model : undefined
    if (rec.isApiErrorMessage || model === '<synthetic>') {
      const t = stripReminders(blockText(msg.content))
      if (t) this.pushSystem(rec.uuid ?? `e${ts}`, ts, rec.isApiErrorMessage ? 'error' : 'warning', 'api', t.slice(0, 2000))
      return
    }
    if (model && !this.models.has(model)) {
      this.models.add(model)
      this.stats.models = [...this.models]
    }
    if (model) this.stats.model = model
    if (msg.usage) this.addUsage(mid, msg.usage)
    const content = Array.isArray(msg.content) ? msg.content : []
    content.forEach((b: Rec, i: number) => {
      if (!b || typeof b !== 'object') return
      const id = `${rec.uuid ?? mid}:${i}`
      if (b.type === 'text') {
        const t = typeof b.text === 'string' ? b.text.trim() : ''
        if (t) this.push({ kind: 'text', id, ts, text: cap(t, MAX_TEXT)[0], model })
      } else if (b.type === 'thinking') {
        const t = typeof b.thinking === 'string' ? b.thinking.trim() : ''
        if (t) this.push({ kind: 'thinking', id, ts, text: cap(t, MAX_TEXT)[0] })
      } else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
        this.onToolUse(b, ts)
      } else if (b.type === 'web_search_tool_result') {
        const ev = this.tools.get(b.tool_use_id)
        if (ev) {
          ev.status = 'done'
          ev.endTs = ts
          const hits = Array.isArray(b.content) ? b.content : []
          ev.result = {
            isError: false,
            truncated: false,
            text: hits
              .map((h: Rec) => (h?.title ? `${h.title} — ${h.url ?? ''}` : ''))
              .filter(Boolean)
              .join('\n')
          }
          this.touch(ev)
        }
      }
    })
  }

  private addUsage(mid: string, u: Rec): void {
    const cur = {
      i: Number(u.input_tokens) || 0,
      o: Number(u.output_tokens) || 0,
      cr: Number(u.cache_read_input_tokens) || 0,
      cc: Number(u.cache_creation_input_tokens) || 0
    }
    const prev = this.usage.get(mid)
    const merged = prev
      ? { i: Math.max(prev.i, cur.i), o: Math.max(prev.o, cur.o), cr: Math.max(prev.cr, cur.cr), cc: Math.max(prev.cc, cur.cc) }
      : cur
    if (prev) {
      this.stats.inputTokens -= prev.i
      this.stats.outputTokens -= prev.o
      this.stats.cacheReadTokens -= prev.cr
      this.stats.cacheCreationTokens -= prev.cc
    }
    this.stats.inputTokens += merged.i
    this.stats.outputTokens += merged.o
    this.stats.cacheReadTokens += merged.cr
    this.stats.cacheCreationTokens += merged.cc
    this.usage.set(mid, merged)
    const ctx = merged.i + merged.cr + merged.cc
    if (ctx > 0) this.stats.contextTokens = ctx
  }

  private onToolUse(b: Rec, ts: number): void {
    const id: string = b.id
    if (!id || this.tools.has(id)) return
    const name: string = String(b.name ?? 'tool')
    const input = trimInput(b.input)
    const ev: ToolEvent = { kind: 'tool', id, ts, toolUseId: id, name, input, status: 'running' }
    this.tools.set(id, ev)
    this.push(ev)
    this.stats.toolCalls++
    this.stats.toolCounts[name] = (this.stats.toolCounts[name] ?? 0) + 1
    if (name === 'TodoWrite') {
      const todos = normalizeTodos(input.todos)
      if (todos) this.todos = todos
    } else if (name === 'TaskCreate') {
      const subject = String(input.subject ?? input.title ?? input.description ?? '').trim()
      if (subject) {
        this.pendingTaskCreate.set(id, {
          content: subject,
          status: 'pending',
          activeForm: typeof input.activeForm === 'string' ? input.activeForm : undefined
        })
      }
    } else if (name === 'TaskUpdate') {
      const taskId = input.taskId ?? input.id
      const t = taskId !== undefined ? this.tasks.get(String(taskId)) : undefined
      if (t) {
        if (input.status === 'completed' || input.status === 'in_progress' || input.status === 'pending') t.status = input.status
        if (input.status === 'deleted') this.tasks.delete(String(taskId))
        if (typeof input.subject === 'string') t.content = input.subject
        this.todos = [...this.tasks.values()]
      }
    }
  }

  private onToolResult(block: Rec, rec: Rec, ts: number): void {
    const ev = this.tools.get(block.tool_use_id)
    if (!ev) return
    const text = blockText(block.content)
    const isError = !!block.is_error
    const denied = isError && (!!rec.toolDenialKind || DENIAL_RE.test(text.slice(0, 400)))
    ev.status = denied ? 'denied' : isError ? 'error' : 'done'
    ev.endTs = ts
    ev.result = this.summarize(ev, rec.toolUseResult, text, isError)
    this.touch(ev)

    if (!isError && ev.result.file && ev.result.file.type !== 'read') this.trackFile(ev.result.file.path, ev.result.file, ts)
    if (!isError && ev.name === 'TaskCreate') {
      const pending = this.pendingTaskCreate.get(ev.toolUseId)
      const tur = rec.toolUseResult
      const taskId = tur && typeof tur === 'object' ? (tur.task?.id ?? tur.id ?? tur.taskId) : /#(\d+)/.exec(text)?.[1]
      if (pending && taskId !== undefined) {
        this.tasks.set(String(taskId), pending)
        this.todos = [...this.tasks.values()]
      }
      this.pendingTaskCreate.delete(ev.toolUseId)
    }
  }

  private trackFile(file: string, r: NonNullable<ToolResult['file']>, ts: number): void {
    const key = pathKey(file)
    let fc = this.fileMap.get(key)
    if (!fc) {
      fc = { path: file, edits: 0, added: 0, removed: 0, created: false, backup: null, firstTs: ts, lastTs: ts }
      this.fileMap.set(key, fc)
    }
    fc.edits++
    fc.added += r.added
    fc.removed += r.removed
    fc.lastTs = ts
    if (r.type === 'create' && fc.edits === 1) fc.created = true
    this.stats.linesAdded += r.added
    this.stats.linesRemoved += r.removed
  }

  private summarize(ev: ToolEvent, tur: unknown, text: string, isError: boolean): ToolResult {
    const r: ToolResult = { isError, text: '', truncated: false }
    const take = (s: string, n: number) => {
      const [v, tr] = cap(s, n)
      if (tr) r.truncated = true
      return v
    }
    if (isError) {
      r.text = take(stripReminders(text || (typeof tur === 'string' ? tur : '')), MAX_RESULT)
      return r
    }
    const t = tur && typeof tur === 'object' ? (tur as Rec) : null
    const name = ev.name
    if (t) {
      if ((name === 'Edit' || name === 'MultiEdit') && typeof t.filePath === 'string') {
        const hunks = normalizeHunks(t.structuredPatch)
        const { added, removed } = countPatch(hunks)
        r.file = {
          path: t.filePath,
          type: 'edit',
          hunks,
          added,
          removed,
          originalFile: typeof t.originalFile === 'string' ? cap(t.originalFile, MAX_INPUT_STRING)[0] : null
        }
        return r
      }
      if (name === 'Write' && typeof t.filePath === 'string') {
        const hunks = normalizeHunks(t.structuredPatch)
        let { added, removed } = countPatch(hunks)
        if (t.type === 'create' && hunks.length === 0) {
          added = lineCount(t.content ?? ev.input.content)
          removed = 0
        }
        r.file = {
          path: t.filePath,
          type: t.type === 'create' ? 'create' : 'update',
          hunks,
          added,
          removed,
          originalFile: typeof t.originalFile === 'string' ? cap(t.originalFile, MAX_INPUT_STRING)[0] : null
        }
        return r
      }
      if (name === 'NotebookEdit' && typeof (t.notebook_path ?? ev.input.notebook_path) === 'string') {
        r.file = { path: String(t.notebook_path ?? ev.input.notebook_path), type: 'edit', hunks: [], added: 0, removed: 0 }
        return r
      }
      if (name === 'Read' && t.file && typeof t.file.filePath === 'string') {
        r.file = {
          path: t.file.filePath,
          type: 'read',
          hunks: [],
          added: 0,
          removed: 0,
          numLines: Number(t.file.numLines) || undefined,
          startLine: Number(t.file.startLine) || undefined
        }
        return r
      }
      if ('stdout' in t || 'stderr' in t) {
        r.shell = {
          stdout: take(String(t.stdout ?? ''), MAX_STDOUT),
          stderr: take(String(t.stderr ?? ''), MAX_STDERR),
          interrupted: !!t.interrupted,
          backgroundTaskId: typeof t.backgroundTaskId === 'string' ? t.backgroundTaskId : undefined
        }
        if (!r.shell.stdout && !r.shell.stderr) r.text = take(stripReminders(text), MAX_RESULT)
        return r
      }
      if (Array.isArray(t.filenames)) {
        r.filenames = t.filenames.slice(0, MAX_FILENAMES).map(String)
        r.numFiles = Number(t.numFiles) || t.filenames.length
        if (typeof t.content === 'string' && t.content) r.text = take(t.content, MAX_RESULT)
        return r
      }
      if (name === 'TodoWrite') {
        r.todos = normalizeTodos(t.newTodos ?? ev.input.todos) ?? undefined
        return r
      }
      if ((name === 'Task' || name === 'Agent') && typeof t.agentId === 'string') r.agentId = t.agentId
    }
    r.text = take(stripReminders(text || (typeof tur === 'string' ? tur : '')), MAX_RESULT)
    return r
  }
}
