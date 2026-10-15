// Reconstructs how files evolved during a Claude Code session, step by step, from the
// transcript's Edit/Write/MultiEdit calls plus a base version (file-history backup,
// originalFile, or the current disk content with the edits undone).
import type { TimelineEvent, ToolEvent } from './types'

export interface ReplayStep {
  index: number
  eventId: string
  ts: number
  path: string
  tool: string
  before: string
  after: string
  /** false when the recorded edit could not be applied exactly (content may be approximate) */
  exact: boolean
  added: number
  removed: number
}

export interface BaseSource {
  /** content before the session first touched the file, when known (null = file did not exist) */
  backup?: string | null
  /** current content on disk (used to undo edits when no backup exists) */
  disk?: string | null
}

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write'])

function norm(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase()
}

export function editEvents(events: TimelineEvent[]): ToolEvent[] {
  return events.filter((e): e is ToolEvent => e.kind === 'tool' && EDIT_TOOLS.has(e.name) && e.status === 'done' && !!filePathOf(e))
}

export function filePathOf(ev: ToolEvent): string | null {
  const p = ev.result?.file?.path ?? ev.input.file_path
  return typeof p === 'string' && p ? p : null
}

interface Op {
  old: string
  neu: string
  all: boolean
}

function opsOf(ev: ToolEvent): Op[] | { write: string } {
  const i = ev.input as Record<string, unknown>
  if (ev.name === 'Write') return { write: typeof i.content === 'string' ? i.content : '' }
  if (ev.name === 'MultiEdit' && Array.isArray(i.edits)) {
    return (i.edits as Record<string, unknown>[]).map((e) => ({ old: String(e.old_string ?? ''), neu: String(e.new_string ?? ''), all: !!e.replace_all }))
  }
  return [{ old: String(i.old_string ?? ''), neu: String(i.new_string ?? ''), all: !!i.replace_all }]
}

/** Claude Code matches edits after normalising CRLF; mirror that while preserving the file's EOL. */
function applyOps(text: string, ops: Op[]): { text: string; exact: boolean } {
  const crlf = text.includes('\r\n')
  let t = crlf ? text.replace(/\r\n/g, '\n') : text
  let exact = true
  for (const op of ops) {
    const old = op.old.replace(/\r\n/g, '\n')
    const neu = op.neu.replace(/\r\n/g, '\n')
    if (old === '') {
      if (t === '') t = neu
      else exact = false
      continue
    }
    const at = t.indexOf(old)
    if (at === -1) {
      exact = false
      continue
    }
    t = op.all ? t.split(old).join(neu) : t.slice(0, at) + neu + t.slice(at + old.length)
  }
  return { text: crlf ? t.replace(/\n/g, '\r\n') : t, exact }
}

function undoOps(text: string, ops: Op[]): { text: string; exact: boolean } {
  const crlf = text.includes('\r\n')
  let t = crlf ? text.replace(/\r\n/g, '\n') : text
  let exact = true
  for (const op of [...ops].reverse()) {
    const old = op.old.replace(/\r\n/g, '\n')
    const neu = op.neu.replace(/\r\n/g, '\n')
    if (neu === '' && old !== '') {
      exact = false
      continue
    }
    const at = t.lastIndexOf(neu)
    if (at === -1) {
      exact = false
      continue
    }
    t = op.all ? t.split(neu).join(old) : t.slice(0, at) + old + t.slice(at + neu.length)
  }
  return { text: crlf ? t.replace(/\n/g, '\r\n') : t, exact }
}

/**
 * Given a file's text AFTER a tool call, reconstruct the text before it.
 * Returns null when it cannot be determined reliably.
 */
export function undoToolEdit(after: string, ev: ToolEvent): string | null {
  const ops = opsOf(ev)
  if ('write' in ops) {
    if (ev.result?.file?.type === 'create') return ''
    return typeof ev.result?.file?.originalFile === 'string' ? ev.result.file.originalFile : null
  }
  if (typeof ev.result?.file?.originalFile === 'string') return ev.result.file.originalFile
  const r = undoOps(after, ops)
  return r.exact ? r.text : null
}

/** True when the tool's edit is already visible in `text` (new strings present, old ones gone). */
export function editAlreadyApplied(text: string, ev: ToolEvent): boolean {
  const ops = opsOf(ev)
  if ('write' in ops) return text.replace(/\r\n/g, '\n') === ops.write.replace(/\r\n/g, '\n')
  const t = text.replace(/\r\n/g, '\n')
  return ops.every((op) => {
    const neu = op.neu.replace(/\r\n/g, '\n')
    const old = op.old.replace(/\r\n/g, '\n')
    return (neu === '' || t.includes(neu)) && (old === '' || old === neu || !t.includes(old))
  })
}

function countLines(a: string, b: string): { added: number; removed: number } {
  const al = a ? a.split(/\r?\n/) : []
  const bl = b ? b.split(/\r?\n/) : []
  // cheap multiset delta: good enough for step badges
  const m = new Map<string, number>()
  for (const l of al) m.set(l, (m.get(l) ?? 0) + 1)
  let added = 0
  for (const l of bl) {
    const n = m.get(l) ?? 0
    if (n > 0) m.set(l, n - 1)
    else added++
  }
  let removed = 0
  for (const n of m.values()) removed += n
  return { added, removed }
}

/**
 * Build the replay. `bases` maps lower-cased Windows paths to what we know about the file
 * before the session (backup) and now (disk).
 */
export function buildReplay(events: TimelineEvent[], bases: Map<string, BaseSource>): ReplayStep[] {
  const edits = editEvents(events)
  const byFile = new Map<string, ToolEvent[]>()
  for (const ev of edits) {
    const k = norm(filePathOf(ev)!)
    byFile.set(k, [...(byFile.get(k) ?? []), ev])
  }
  // resolve the starting content of every file
  const start = new Map<string, { text: string; exact: boolean }>()
  for (const [k, list] of byFile) {
    const base = bases.get(k)
    const first = list[0]
    const firstOps = opsOf(first)
    if (base && base.backup !== undefined) {
      start.set(k, { text: base.backup ?? '', exact: true })
    } else if (first.name === 'Write' && first.result?.file?.type === 'create') {
      start.set(k, { text: '', exact: true })
    } else if (typeof first.result?.file?.originalFile === 'string') {
      start.set(k, { text: first.result.file.originalFile, exact: true })
    } else if (base?.disk !== undefined && base.disk !== null) {
      // undo every recorded edit from the end, stopping at a Write (whose prior content is unknown)
      let text = base.disk
      let exact = true
      for (let i = list.length - 1; i >= 0; i--) {
        const ops = opsOf(list[i])
        if ('write' in ops) {
          exact = false
          break
        }
        const r = undoOps(text, ops)
        text = r.text
        exact = exact && r.exact
      }
      start.set(k, { text, exact })
    } else {
      start.set(k, { text: 'write' in firstOps ? '' : '', exact: false })
    }
  }
  const current = new Map(start)
  const steps: ReplayStep[] = []
  for (const ev of edits) {
    const path = filePathOf(ev)!
    const k = norm(path)
    const cur = current.get(k)!
    const ops = opsOf(ev)
    let after: string
    let exact = cur.exact
    if ('write' in ops) {
      after = ops.write
      exact = true
    } else {
      // a recorded originalFile lets us re-sync if earlier reconstruction drifted
      const base = typeof ev.result?.file?.originalFile === 'string' ? ev.result.file.originalFile : cur.text
      const r = applyOps(base, ops)
      after = r.text
      exact = (typeof ev.result?.file?.originalFile === 'string' || cur.exact) && r.exact
    }
    const { added, removed } = ev.result?.file ? { added: ev.result.file.added, removed: ev.result.file.removed } : countLines(cur.text, after)
    steps.push({ index: steps.length, eventId: ev.id, ts: ev.endTs ?? ev.ts, path, tool: ev.name, before: cur.text, after, exact, added, removed })
    current.set(k, { text: after, exact })
  }
  return steps
}
