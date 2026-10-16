// Plain-language facts about a session's model, effort and context window, from what Claude Code
// reports (model list, /context measurements, transcripts) and from Claude desktop's own session
// records. Used by the agent header, its info card, the composer picker and the overview page.
import type { ClaudeDefaults, ClaudeSettingSource, ContextUsage, Effort, ModelOption, RunnerInfo, SessionMeta, SessionStats } from '@shared/types'
import { tk, type T } from '@/lib/i18n'

const plain = (id: string) => id.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5", "sonnet" → "Sonnet" */
export function prettyModel(id: string): string {
  const base = plain(id.trim())
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/i.exec(base)
  if (m) return `${cap(m[1])} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
  if (/^[a-z]+$/i.test(base)) return cap(base)
  return id
}

/** The picker row for a model id or alias (not the "Default" row): by value, resolved id, or the id without "[1m]" / date. */
export function findModel(models: ModelOption[], id: string | null | undefined): ModelOption | null {
  if (!id) return null
  const rows = models.filter((m) => m.value)
  return (
    rows.find((m) => m.value === id) ??
    rows.find((m) => m.resolvedModel === id) ??
    rows.find((m) => plain(m.value) === plain(id)) ??
    rows.find((m) => !!m.resolvedModel && plain(m.resolvedModel) === plain(id)) ??
    null
  )
}

/** "Default (recommended)" → "Default": labels without Claude Code's parenthesized notes. */
export function shortModelLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '') || label
}

export function modelLabel(models: ModelOption[], id: string | null | undefined): string {
  if (!id) return ''
  const row = findModel(models, id)
  return row ? shortModelLabel(row.label) : prettyModel(id)
}

/* ------------------------------------------------------------------ Claude Code's own wording */

/** English text Claude Code sends (model descriptions, /context rows), translated when known. */
const CLAUDE_TEXT = [
  tk('Best for everyday, complex tasks'),
  tk('For complex work and everyday tasks'),
  tk('For your toughest challenges'),
  tk('Most efficient for simpler tasks'),
  tk('Fastest for quick answers'),
  tk('Efficient for routine tasks'),
  tk('Most capable for your hardest and longest-running tasks'),
  tk('Most capable for complex work'),
  tk('System prompt'),
  tk('System tools'),
  tk('System tools (deferred)'),
  tk('MCP tools'),
  tk('MCP server instructions'),
  tk('MCP tools (deferred)'),
  tk('Custom agents'),
  tk('Memory files'),
  tk('Skills'),
  tk('Messages'),
  tk('Free space'),
  tk('Autocompact buffer'),
  tk('Compact buffer')
]
const KNOWN = new Set<string>(CLAUDE_TEXT)

export function claudeText(t: T, text: string): string {
  if (KNOWN.has(text)) return t(text)
  // "Opus 5.5 · Best for everyday, complex tasks" (the Default row): keep the name, translate the rest
  const dot = text.indexOf(' · ')
  if (dot > 0 && KNOWN.has(text.slice(dot + 3))) return `${text.slice(0, dot)} · ${t(text.slice(dot + 3))}`
  return text
}

/* ------------------------------------------------------------------ effort */

export const EFFORT_ORDER: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

const EFFORT_INFO: Record<string, { name: string; label: string; hint: string }> = {
  low: { name: tk('effort::Low'), label: tk('Low effort'), hint: tk('Quick answers with little thinking. The fastest level and the fewest tokens.') },
  medium: { name: tk('effort::Medium'), label: tk('Medium effort'), hint: tk('Thinks briefly before acting. Faster than High and still careful.') },
  high: { name: tk('effort::High'), label: tk('High effort'), hint: tk('Thinks things through before acting. A good balance for most coding work.') },
  xhigh: { name: tk('effort::Extra high'), label: tk('Extra high effort'), hint: tk('Thinks longer on hard problems. Slower, and uses more tokens.') },
  max: { name: tk('effort::Max'), label: tk('Max effort'), hint: tk('Thinks as long as it needs. The deepest reasoning, but the slowest and the most tokens.') }
}

/** 1 (low) … 5 (max); 0 when unknown. */
export function effortRank(level: string | null | undefined): number {
  const i = EFFORT_ORDER.indexOf((level ?? '') as Effort)
  return i < 0 ? 0 : i + 1
}

/** "High" — the level on its own. */
export function effortName(t: T, level: string): string {
  const known = EFFORT_INFO[level]
  return known ? t(known.name) : cap(level)
}

/** "High effort" — for places where the word effort is not around it. */
export function effortLabel(t: T, level: string): string {
  if (!level) return t('Default effort')
  const known = EFFORT_INFO[level]
  return known ? t(known.label) : t('{level} effort', { level: cap(level) })
}

export function effortHint(t: T, level: string): string {
  const known = EFFORT_INFO[level]
  return known ? t(known.hint) : ''
}

/* ------------------------------------------------------------------ defaults */

export interface ResolvedDefault<V> {
  value: V
  /** where Claude Code takes it from; null = its own built-in default */
  source: ClaudeSettingSource | null
}

/** The model "Default" stands for: Claude Code's settings first, else its recommended model. */
export function defaultModel(models: ModelOption[], defaults: ClaudeDefaults | null): ResolvedDefault<ModelOption | null> & { id: string | null } {
  if (defaults?.model) return { id: defaults.model.value, value: findModel(models, defaults.model.value), source: defaults.model.source }
  const row = models.find((m) => !m.value) ?? null
  return { id: row?.resolvedModel ?? null, value: row?.resolvedModel ? findModel(models, row.resolvedModel) : null, source: null }
}

/** The effort Claude Code uses for a model when none is picked: env, then /effort per model, then effortLevel. */
export function defaultEffort(defaults: ClaudeDefaults | null, model: ModelOption | null): ResolvedDefault<string> | null {
  if (!defaults) return null
  if (defaults.effort?.source === 'env') return { value: defaults.effort.value, source: 'env' }
  if (model) {
    const names = [model.value, model.resolvedModel, model.resolvedModel ? plain(model.resolvedModel) : null].filter((n): n is string => !!n)
    for (const n of names) {
      const hit = defaults.modelEfforts[n]
      if (hit) return { value: hit.value, source: hit.source }
    }
  }
  return defaults.effort ? { value: defaults.effort.value, source: defaults.effort.source } : null
}

export function settingSourceLabel(t: T, source: ClaudeSettingSource): string {
  switch (source) {
    case 'env':
      return t('an environment variable')
    case 'local':
      return t("this project's .claude/settings.local.json")
    case 'project':
      return t("this project's .claude/settings.json")
    default:
      return t('your Claude Code settings (~/.claude/settings.json)')
  }
}

/* ------------------------------------------------------------------ a session's facts */

export type InfoSource = 'desktop' | 'clauditor' | 'settings' | 'default' | 'transcript' | 'unknown'

export interface SessionModelView {
  id: string | null
  row: ModelOption | null
  label: string
  source: InfoSource
  /** Claude desktop's current pick when it differs from the model of the latest reply */
  nextInDesktop: string | null
  others: string[]
}

export function sessionModel(meta: SessionMeta, stats: SessionStats, runner: RunnerInfo | null, models: ModelOption[]): SessionModelView {
  const id = runner?.model ?? stats.model ?? meta.desktop?.model ?? null
  const row = findModel(models, id)
  const source: InfoSource = runner ? 'clauditor' : meta.desktop ? 'desktop' : id ? 'transcript' : 'unknown'
  const desk = meta.desktop?.model
  const nextInDesktop = !runner && desk && stats.model && plain(desk) !== plain(stats.model) ? desk : null
  const others = stats.models.filter((m) => m !== id && m !== '<synthetic>')
  return { id, row, label: id ? (row ? shortModelLabel(row.label) : prettyModel(id)) : '', source, nextInDesktop, others }
}

export interface SessionEffortView {
  /** the level in use; null when it is not known */
  level: string | null
  source: InfoSource
  /** with source 'settings': the settings file (or env) Claude Code takes the level from */
  setting: ClaudeSettingSource | null
  /** the model has no effort setting */
  unsupported: boolean
}

export function sessionEffort(meta: SessionMeta, runner: RunnerInfo | null, model: ModelOption | null, defaults: ClaudeDefaults | null): SessionEffortView {
  const unsupported = !!model && (model.effortLevels?.length ?? 0) === 0
  if (runner) {
    if (runner.effort) return { level: runner.effort, source: 'clauditor', setting: null, unsupported }
    const d = defaultEffort(defaults, model)
    return { level: d?.value ?? null, source: d ? 'settings' : 'default', setting: d?.source ?? null, unsupported }
  }
  if (meta.desktop) return { level: meta.desktop.effort, source: meta.desktop.effort ? 'desktop' : 'default', setting: null, unsupported }
  return { level: null, source: 'unknown', setting: null, unsupported }
}

export interface ContextView {
  used: number
  limit: number | null
  percent: number | null
  autoCompactAt: number | null
  /** null when not known (the model's window has not been measured yet) */
  autoCompactEnabled: boolean | null
  /** 'claude': Claude Code's own /context measurement; 'transcript': the latest reply's token usage */
  measured: 'claude' | 'transcript'
  categories: ContextUsage['categories']
  memoryFiles: ContextUsage['memoryFiles']
}

export function contextView(stats: SessionStats, runner: RunnerInfo | null, model: ModelOption | null): ContextView | null {
  const c = runner?.context
  // a measurement older than the transcript's latest reply is stale (e.g. Claude is mid-turn)
  if (c && (!stats.lastTs || c.measuredAt >= stats.lastTs - 1500)) {
    return { used: c.used, limit: c.limit, percent: c.percent, autoCompactAt: c.autoCompactAt, autoCompactEnabled: c.autoCompactEnabled, measured: 'claude', categories: c.categories, memoryFiles: c.memoryFiles }
  }
  if (stats.contextTokens <= 0) return null
  const limit = model?.contextWindow ?? null
  return {
    used: stats.contextTokens,
    limit,
    percent: limit ? Math.min(999, Math.round((stats.contextTokens / limit) * 100)) : null,
    autoCompactAt: model?.autoCompactAt ?? null,
    autoCompactEnabled: limit ? model?.autoCompactAt !== null && model?.autoCompactAt !== undefined : null,
    measured: 'transcript',
    categories: [],
    memoryFiles: []
  }
}

/** ok → warn → bad as the conversation nears the point where Claude Code compacts it. */
export function contextTone(v: ContextView): 'ok' | 'warn' | 'bad' {
  const edge = v.autoCompactAt ?? v.limit
  if (!edge) return 'ok'
  const r = v.used / edge
  return r >= 0.92 ? 'bad' : r >= 0.75 ? 'warn' : 'ok'
}

/** A session Claude desktop owns: replies written by another app never show up there. */
export function desktopOwned(meta: Pick<SessionMeta, 'desktop' | 'entrypoint' | 'forkedFrom'>): boolean {
  return !!meta.desktop || (meta.entrypoint === 'claude-desktop' && !meta.forkedFrom)
}
