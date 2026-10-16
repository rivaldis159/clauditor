import { describe, expect, it, vi } from 'vitest'
import type { ClaudeDefaults, ModelOption, RunnerInfo, SessionMeta, SessionStats } from '../../../src/shared/types'

// the renderer's i18n module pulls in the app store; claudeInfo only needs the tk() marker
vi.mock('@/lib/i18n', () => ({ tk: (s: string) => s }))
const { claudeText, contextTone, contextView, defaultEffort, defaultModel, desktopOwned, effortRank, findModel, prettyModel, sessionEffort, sessionModel } = await import('../../../src/renderer/src/lib/claudeInfo')

const models: ModelOption[] = [
  { value: '', label: 'Default (recommended)', description: 'Opus 5.5 · Best for everyday, complex tasks', resolvedModel: 'claude-opus-5-5', effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], contextWindow: 1_000_000, autoCompactAt: 967_000 },
  { value: 'opus', label: 'Opus 5.5', description: 'For complex work and everyday tasks', resolvedModel: 'claude-opus-5-5', effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], contextWindow: 1_000_000, autoCompactAt: 967_000 },
  { value: 'fable[1m]', label: 'Fable 5.1', description: 'For your toughest challenges', resolvedModel: 'claude-fable-5-1', effortLevels: ['low', 'high'], contextWindow: 1_000_000, autoCompactAt: 967_000 },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', description: 'Fastest for quick answers', resolvedModel: 'claude-haiku-4-5-20251001', effortLevels: [], contextWindow: 200_000, autoCompactAt: 167_000 }
]

const stats = (over: Partial<SessionStats> = {}): SessionStats => ({
  turns: 1,
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
  contextTokens: 0,
  ...over
})

const meta = (over: Partial<SessionMeta> = {}): SessionMeta => ({
  id: 's1',
  file: '',
  projectSlug: '',
  cwd: null,
  title: null,
  firstPrompt: null,
  createdAt: 0,
  updatedAt: 0,
  size: 0,
  entrypoint: 'cli',
  gitBranch: null,
  version: null,
  live: null,
  startedByClauditor: false,
  desktop: null,
  forkedFrom: null,
  ...over
})

const runner = (over: Partial<RunnerInfo> = {}): RunnerInfo => ({
  runId: 'r',
  sessionId: 's1',
  cwd: 'C:\\p',
  state: 'idle',
  model: 'claude-opus-5-5',
  permissionMode: 'default',
  effort: '',
  error: null,
  needsLogin: false,
  startedAt: 0,
  lastResult: null,
  context: null,
  forkedFrom: null,
  ...over
})

describe('model names', () => {
  it('turns model ids into readable names', () => {
    expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(prettyModel('claude-sonnet-5')).toBe('Sonnet 5')
    expect(prettyModel('fable[1m]')).toBe('Fable')
    expect(prettyModel('gpt-x')).toBe('gpt-x')
  })
  it('finds the picker row for ids and aliases, never the Default row', () => {
    expect(findModel(models, 'claude-opus-5-5')?.value).toBe('opus')
    expect(findModel(models, 'fable[1m]')?.label).toBe('Fable 5.1')
    expect(findModel(models, 'claude-fable-5-1[1m]')?.value).toBe('fable[1m]')
    expect(findModel(models, 'claude-haiku-4-5')?.value).toBe('claude-haiku-4-5-20251001')
    expect(findModel(models, '')).toBeNull()
    expect(findModel(models, 'unknown')).toBeNull()
  })
})

describe('what "Default" means', () => {
  const none: ClaudeDefaults = { model: null, effort: null, modelEfforts: {} }
  it("uses Claude Code's settings, else its recommendation", () => {
    expect(defaultModel(models, none)).toMatchObject({ id: 'claude-opus-5-5', source: null })
    expect(defaultModel(models, none).value?.value).toBe('opus')
    const fromSettings = defaultModel(models, { ...none, model: { value: 'fable[1m]', source: 'user' } })
    expect(fromSettings.value?.label).toBe('Fable 5.1')
    expect(fromSettings.source).toBe('user')
  })
  it('picks the effort Claude Code would use', () => {
    const opus = models[1]
    expect(defaultEffort(none, opus)).toBeNull()
    expect(defaultEffort({ ...none, effort: { value: 'medium', source: 'user' } }, opus)).toEqual({ value: 'medium', source: 'user' })
    const perModel: ClaudeDefaults = { model: null, effort: { value: 'medium', source: 'user' }, modelEfforts: { 'claude-opus-5-5': { value: 'xhigh', source: 'user' } } }
    expect(defaultEffort(perModel, opus)?.value).toBe('xhigh')
    expect(defaultEffort({ ...perModel, effort: { value: 'low', source: 'env' } }, opus)?.value).toBe('low')
  })
})

describe("a session's model and effort", () => {
  it("takes Claude desktop's pick for its sessions", () => {
    const m = meta({ entrypoint: 'claude-desktop', desktop: { hostSessionId: 'local_1', title: null, model: 'claude-opus-5-5', effort: 'max', permissionMode: null, archived: false } })
    const s = stats({ model: 'claude-opus-5-5', models: ['claude-opus-5-5'] })
    const view = sessionModel(m, s, null, models)
    expect(view).toMatchObject({ label: 'Opus 5.5', source: 'desktop', nextInDesktop: null })
    expect(sessionEffort(m, null, view.row, null)).toMatchObject({ level: 'max', source: 'desktop' })
  })
  it('notes when Claude desktop switched model after the latest reply', () => {
    const m = meta({ desktop: { hostSessionId: 'l', title: null, model: 'claude-fable-5-1', effort: null, permissionMode: null, archived: false } })
    const view = sessionModel(m, stats({ model: 'claude-opus-5-5', models: ['claude-opus-5-5'] }), null, models)
    expect(view.nextInDesktop).toBe('claude-fable-5-1')
    expect(sessionEffort(m, null, view.row, null)).toMatchObject({ level: null, source: 'default' })
  })
  it("knows a Clauditor run's effort, or the default it falls back to", () => {
    const view = sessionModel(meta(), stats(), runner(), models)
    expect(view.source).toBe('clauditor')
    expect(sessionEffort(meta(), runner({ effort: 'high' }), view.row, null)).toMatchObject({ level: 'high', source: 'clauditor' })
    const d: ClaudeDefaults = { model: null, effort: { value: 'medium', source: 'project' }, modelEfforts: {} }
    expect(sessionEffort(meta(), runner(), view.row, d)).toMatchObject({ level: 'medium', source: 'settings', setting: 'project' })
  })
  it('says unknown for CLI sessions and unsupported for models without effort', () => {
    expect(sessionEffort(meta(), null, models[1], null).source).toBe('unknown')
    expect(sessionEffort(meta(), runner(), models[3], null).unsupported).toBe(true)
  })
  it('ranks effort levels', () => {
    expect(effortRank('low')).toBe(1)
    expect(effortRank('max')).toBe(5)
    expect(effortRank(null)).toBe(0)
  })
})

describe('context window', () => {
  it("prefers Claude Code's fresh measurement for runs", () => {
    const r = runner({ context: { model: 'claude-opus-5-5', used: 30_000, limit: 1_000_000, percent: 3, autoCompactAt: 967_000, autoCompactEnabled: true, categories: [], memoryFiles: [], measuredAt: 2000 } })
    expect(contextView(stats({ contextTokens: 10, lastTs: 1000 }), r, models[1])).toMatchObject({ used: 30_000, measured: 'claude' })
    // older than the latest reply: fall back to the transcript
    expect(contextView(stats({ contextTokens: 50_000, lastTs: 9000 }), r, models[1])).toMatchObject({ used: 50_000, measured: 'transcript', percent: 5, limit: 1_000_000 })
  })
  it("uses the model's window for followed sessions, and says when it is unknown", () => {
    expect(contextView(stats({ contextTokens: 150_000 }), null, models[3])).toMatchObject({ percent: 75, autoCompactAt: 167_000 })
    expect(contextView(stats({ contextTokens: 150_000 }), null, null)).toMatchObject({ limit: null, percent: null })
    expect(contextView(stats(), null, models[1])).toBeNull()
  })
  it('warns as the conversation nears auto-compact', () => {
    const v = (used: number) => contextView(stats({ contextTokens: used }), null, models[3])!
    expect(contextTone(v(100_000))).toBe('ok')
    expect(contextTone(v(130_000))).toBe('warn')
    expect(contextTone(v(160_000))).toBe('bad')
  })
})

describe('ownership and wording', () => {
  it("treats Claude desktop's sessions as owned by it, copies as not", () => {
    expect(desktopOwned({ desktop: { hostSessionId: 'l', title: null, model: null, effort: null, permissionMode: null, archived: false }, entrypoint: 'cli', forkedFrom: null })).toBe(true)
    expect(desktopOwned({ desktop: null, entrypoint: 'claude-desktop', forkedFrom: null })).toBe(true)
    expect(desktopOwned({ desktop: null, entrypoint: 'claude-desktop', forkedFrom: 'orig' })).toBe(false)
    expect(desktopOwned({ desktop: null, entrypoint: 'cli', forkedFrom: null })).toBe(false)
  })
  it("translates Claude Code's known wording and keeps the rest", () => {
    const t = ((s: string) => `[${s}]`) as never
    expect(claudeText(t, 'Fastest for quick answers')).toBe('[Fastest for quick answers]')
    expect(claudeText(t, 'Opus 5.5 · Best for everyday, complex tasks')).toBe('Opus 5.5 · [Best for everyday, complex tasks]')
    expect(claudeText(t, 'Something new')).toBe('Something new')
  })
})
