import {
  Bot,
  BookOpen,
  FilePen,
  FilePlus,
  FileSearch,
  FileText,
  Globe,
  ListTodo,
  MessageCircleQuestion,
  NotebookPen,
  Plug,
  Search,
  ScrollText,
  SquareTerminal,
  Sparkles,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import type { ToolEvent } from '@shared/types'
import { t, tk } from '@/lib/i18n'
import * as P from '@/lib/paths'

export type ToolCategory = 'edit' | 'read' | 'shell' | 'search' | 'web' | 'agent' | 'plan' | 'mcp' | 'other'

export interface ToolMeta {
  icon: LucideIcon
  category: ToolCategory
  verb: string
  doneVerb: string
}

// verbs are English source text; toolMeta() returns them translated
const META: Record<string, ToolMeta> = {
  Edit: { icon: FilePen, category: 'edit', verb: tk('Editing'), doneVerb: tk('done::Edited') },
  MultiEdit: { icon: FilePen, category: 'edit', verb: tk('Editing'), doneVerb: tk('done::Edited') },
  Write: { icon: FilePlus, category: 'edit', verb: tk('Writing'), doneVerb: tk('done::Wrote') },
  NotebookEdit: { icon: NotebookPen, category: 'edit', verb: tk('Editing notebook'), doneVerb: tk('done::Edited notebook') },
  Read: { icon: FileText, category: 'read', verb: tk('Reading'), doneVerb: tk('done::Read') },
  Bash: { icon: SquareTerminal, category: 'shell', verb: tk('Running'), doneVerb: tk('done::Ran') },
  PowerShell: { icon: SquareTerminal, category: 'shell', verb: tk('Running'), doneVerb: tk('done::Ran') },
  BashOutput: { icon: ScrollText, category: 'shell', verb: tk('Reading output'), doneVerb: tk('done::Read output') },
  KillShell: { icon: SquareTerminal, category: 'shell', verb: tk('Stopping process'), doneVerb: tk('done::Stopped process') },
  Grep: { icon: Search, category: 'search', verb: tk('Searching'), doneVerb: tk('done::Searched') },
  Glob: { icon: FileSearch, category: 'search', verb: tk('Finding files'), doneVerb: tk('done::Found files') },
  LS: { icon: FileSearch, category: 'search', verb: tk('Listing folder'), doneVerb: tk('done::Listed folder') },
  WebFetch: { icon: Globe, category: 'web', verb: tk('Fetching'), doneVerb: tk('done::Fetched') },
  WebSearch: { icon: Globe, category: 'web', verb: tk('Searching the web'), doneVerb: tk('done::Searched the web') },
  web_search: { icon: Globe, category: 'web', verb: tk('Searching the web'), doneVerb: tk('done::Searched the web') },
  Task: { icon: Bot, category: 'agent', verb: tk('Delegating to subagent'), doneVerb: tk('Subagent') },
  Agent: { icon: Bot, category: 'agent', verb: tk('Delegating to subagent'), doneVerb: tk('Subagent') },
  TodoWrite: { icon: ListTodo, category: 'plan', verb: tk('Updating plan'), doneVerb: tk('done::Updated plan') },
  TaskCreate: { icon: ListTodo, category: 'plan', verb: tk('Adding task'), doneVerb: tk('done::Added task') },
  TaskUpdate: { icon: ListTodo, category: 'plan', verb: tk('Updating task'), doneVerb: tk('done::Updated task') },
  TaskList: { icon: ListTodo, category: 'plan', verb: tk('Listing tasks'), doneVerb: tk('done::Listed tasks') },
  ExitPlanMode: { icon: ListTodo, category: 'plan', verb: tk('Proposing plan'), doneVerb: tk('done::Proposed plan') },
  AskUserQuestion: { icon: MessageCircleQuestion, category: 'plan', verb: tk('Asking a question'), doneVerb: tk('done::Asked a question') },
  Skill: { icon: BookOpen, category: 'other', verb: tk('Using skill'), doneVerb: tk('done::Used skill') },
  ToolSearch: { icon: Wrench, category: 'other', verb: tk('Loading tools'), doneVerb: tk('done::Loaded tools') }
}
const MCP_META: ToolMeta = { icon: Plug, category: 'mcp', verb: tk('Calling'), doneVerb: tk('done::Called') }
const OTHER_META: ToolMeta = { icon: Sparkles, category: 'other', verb: tk('Using'), doneVerb: tk('done::Used') }

export function toolMeta(name: string): ToolMeta {
  const m = META[name] ?? (name.startsWith('mcp__') ? MCP_META : OTHER_META)
  return { ...m, verb: t(m.verb), doneVerb: t(m.doneVerb) }
}

/** Chart-safe category colors (validated palette, see tokens.css). */
export const CATEGORY_COLOR: Record<ToolCategory, string> = {
  edit: 'var(--cat-edit)',
  read: 'var(--cat-read)',
  search: 'var(--cat-search)',
  web: 'var(--cat-search)',
  shell: 'var(--cat-shell)',
  agent: 'var(--cat-agent)',
  plan: 'var(--cat-other)',
  mcp: 'var(--cat-other)',
  other: 'var(--cat-other)'
}

/** Chart series: the five validated hues in their tested order, plus a neutral "other". Labels are English source text: render them with t(). */
export const SERIES: { key: 'edit' | 'read' | 'search' | 'shell' | 'agent' | 'other'; label: string; color: string }[] = [
  { key: 'edit', label: tk('Edit & write'), color: 'var(--cat-edit)' },
  { key: 'read', label: tk('Read'), color: 'var(--cat-read)' },
  { key: 'search', label: tk('Search & web'), color: 'var(--cat-search)' },
  { key: 'shell', label: tk('Commands'), color: 'var(--cat-shell)' },
  { key: 'agent', label: tk('Subagents'), color: 'var(--cat-agent)' },
  { key: 'other', label: tk('Other'), color: 'var(--cat-other)' }
]

export function seriesOf(cat: ToolCategory): (typeof SERIES)[number]['key'] {
  if (cat === 'web') return 'search'
  if (cat === 'plan' || cat === 'mcp') return 'other'
  return cat
}

function short(s: string, n = 80): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

export function mcpParts(name: string): { server: string; tool: string } {
  const parts = name.split('__')
  return { server: parts[1] ?? '', tool: parts.slice(2).join('__') }
}

/** Human-readable target of a tool call (path, command, pattern…). */
export function toolTarget(ev: ToolEvent, root: string | null): string {
  const i = ev.input as Record<string, unknown>
  const s = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '')
  const fp = ev.result?.file?.path ?? (s('file_path') || s('notebook_path') || s('path'))
  switch (ev.name) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
    case 'Read':
      return fp ? P.displayPath(fp, root) : ''
    case 'Bash':
    case 'PowerShell':
      return short(s('description') || s('command'), 90)
    case 'Grep': {
      const where = s('path')
      const inRoot = !where || (root && (P.samePath(where, root) || where === '.'))
      const pattern = `“${short(s('pattern'), 50)}”`
      return inRoot ? pattern : t('{pattern} in {path}', { pattern, path: P.displayPath(where, root) })
    }
    case 'Glob':
      return short(s('pattern'), 60)
    case 'WebFetch':
      return short(s('url'), 70)
    case 'WebSearch':
    case 'web_search':
      return `“${short(s('query'), 60)}”`
    case 'Task':
    case 'Agent':
      return short(s('description') || s('prompt'), 70)
    case 'Skill':
      return s('skill') || s('command') || s('name')
    case 'TaskCreate':
      return short(s('subject') || s('description'), 70)
    case 'ToolSearch':
      return short(s('query'), 60)
    default:
      if (ev.name.startsWith('mcp__')) {
        const { server, tool } = mcpParts(ev.name)
        return `${server} › ${tool}`
      }
      return ''
  }
}
