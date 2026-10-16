import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TranscriptParser } from '../../src/main/services/claude/transcript'
import { DesktopSessions, parseDesktopSession } from '../../src/main/services/claude/desktop-sessions'
import { groupLive } from '../../src/main/services/claude/registry'
import { claudeDefaults } from '../../src/main/services/claude/defaults'
import { toContextUsage } from '../../src/main/services/claude/runner'
import type { LiveSessionInfo } from '../../src/shared/types'

const temps: string[] = []
function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'clauditor-unit-'))
  temps.push(d)
  return d
}
afterEach(() => {
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe('transcript: forks and the latest model', () => {
  it('reads forkedFrom and keeps the model of the latest reply', () => {
    const p = new TranscriptParser()
    const base = { sessionId: 'new', cwd: 'C:\\p', entrypoint: 'claude-desktop', timestamp: '2026-10-16T10:00:00.000Z' }
    p.feed({ ...base, type: 'user', uuid: 'u1', forkedFrom: { sessionId: 'orig', messageUuid: 'x' }, message: { role: 'user', content: 'hi' } })
    p.feed({ ...base, type: 'assistant', uuid: 'a1', message: { id: 'm1', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'one' }], usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 } } })
    p.feed({ ...base, type: 'assistant', uuid: 'a2', message: { id: 'm2', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'two' }], usage: { input_tokens: 20, cache_read_input_tokens: 180, output_tokens: 5 } } })
    expect(p.meta.forkedFrom).toBe('orig')
    expect(p.stats.model).toBe('claude-haiku-5-5')
    expect(p.stats.models).toEqual(['claude-opus-5-5', 'claude-haiku-5-5'])
    expect(p.stats.contextTokens).toBe(200)
  })

  it('ignores subagent (sidechain) replies for the current model', () => {
    const p = new TranscriptParser()
    p.feed({ type: 'assistant', uuid: 'a1', message: { id: 'm1', role: 'assistant', model: 'claude-opus-5-5', content: [] } })
    p.feed({ type: 'assistant', uuid: 'a2', isSidechain: true, message: { id: 'm2', role: 'assistant', model: 'claude-haiku-5-5', content: [] } })
    expect(p.stats.model).toBe('claude-opus-5-5')
  })
})

describe("Claude desktop's session list", () => {
  it('parses a session file into the transcript id and what Clauditor shows', () => {
    const ref = parseDesktopSession({ sessionId: 'local_abc', cliSessionId: 'c1', title: 'Web', model: 'claude-opus-5-5', effort: 'max', permissionMode: 'bypassPermissions', isArchived: false, extra: 1 })
    expect(ref).toEqual({ cliSessionId: 'c1', hostSessionId: 'local_abc', title: 'Web', model: 'claude-opus-5-5', effort: 'max', permissionMode: 'bypassPermissions', archived: false })
    expect(parseDesktopSession({ sessionId: 'local_x' })).toBeNull()
    expect(parseDesktopSession(null)).toBeNull()
  })

  it('finds sessions by transcript id and follows changes on disk', () => {
    const root = tempDir()
    const folder = path.join(root, 'claude-code-sessions', 'org', 'acct')
    fs.mkdirSync(folder, { recursive: true })
    const file = path.join(folder, 'local_1.json')
    fs.writeFileSync(file, JSON.stringify({ sessionId: 'local_1', cliSessionId: 'cli-1', model: 'claude-opus-5-5', effort: 'high' }))
    fs.writeFileSync(path.join(folder, 'notes.json'), '{}')
    const ds = new DesktopSessions(() => [root])
    expect(ds.get('cli-1')?.effort).toBe('high')
    expect(ds.get('other')).toBeNull()

    // re-scan after the cache window: an edited file is read again, a removed one is forgotten
    fs.writeFileSync(file, JSON.stringify({ sessionId: 'local_1', cliSessionId: 'cli-1', model: 'claude-opus-5-5', effort: 'max', extra: 'longer content' }))
    ;(ds as unknown as { scannedAt: number }).scannedAt = 0
    expect(ds.get('cli-1')?.effort).toBe('max')
    fs.rmSync(file)
    ;(ds as unknown as { scannedAt: number }).scannedAt = 0
    expect(ds.get('cli-1')).toBeNull()
  })
})

describe('live registry grouping', () => {
  const entry = (pid: number, entrypoint: string, startedAt: number): LiveSessionInfo => ({
    pid,
    sessionId: 's1',
    cwd: 'C:\\p',
    status: 'idle',
    statusUpdatedAt: null,
    name: null,
    hostSessionId: null,
    entrypoint,
    kind: null,
    version: null,
    startedAt,
    peers: []
  })
  it('keeps the newest process and lists the others as peers', () => {
    const map = groupLive([entry(10, 'sdk-ts', 100), entry(20, 'claude-desktop', 200)])
    const s = map.get('s1')!
    expect(s.pid).toBe(20)
    expect(s.entrypoint).toBe('claude-desktop')
    expect(s.peers).toEqual([{ pid: 10, entrypoint: 'sdk-ts', status: 'idle' }])
  })
})

describe("Claude Code's defaults for a folder", () => {
  it('takes env first, then local, project and user settings', () => {
    const home = tempDir()
    const cwd = tempDir()
    fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ model: 'fable[1m]', effortLevel: 'medium', modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } }))
    fs.mkdirSync(path.join(cwd, '.claude'))
    fs.writeFileSync(path.join(cwd, '.claude', 'settings.json'), JSON.stringify({ model: 'sonnet' }))
    fs.writeFileSync(path.join(cwd, '.claude', 'settings.local.json'), JSON.stringify({ effortLevel: 'low' }))

    const d = claudeDefaults(home, cwd, {})
    expect(d.model).toEqual({ value: 'sonnet', source: 'project' })
    expect(d.effort).toEqual({ value: 'low', source: 'local' })
    expect(d.modelEfforts['claude-opus-5-5']).toEqual({ value: 'xhigh', source: 'user' })

    expect(claudeDefaults(home, null, {}).model).toEqual({ value: 'fable[1m]', source: 'user' })
    const env = claudeDefaults(home, cwd, { ANTHROPIC_MODEL: 'haiku', CLAUDE_CODE_EFFORT_LEVEL: 'high' })
    expect(env.model).toEqual({ value: 'haiku', source: 'env' })
    expect(env.effort).toEqual({ value: 'high', source: 'env' })
  })

  it('copes with missing or broken settings files', () => {
    const home = tempDir()
    fs.writeFileSync(path.join(home, 'settings.json'), '{ not json')
    expect(claudeDefaults(home, path.join(home, 'nope'), {})).toEqual({ model: null, effort: null, modelEfforts: {} })
  })
})

describe("Claude Code's /context numbers", () => {
  it('maps the measurement and drops empty rows', () => {
    const u = toContextUsage(
      {
        model: 'claude-opus-5-5',
        totalTokens: 21204,
        maxTokens: 1000000,
        rawMaxTokens: 1000000,
        percentage: 2,
        autoCompactThreshold: 967000,
        isAutoCompactEnabled: true,
        categories: [
          { name: 'System prompt', tokens: 141, kind: 'used' },
          { name: 'Messages', tokens: 0, kind: 'used' },
          { name: 'Free space', tokens: 945796, kind: 'free' },
          { name: 'Odd', tokens: 5, kind: 'weird' }
        ],
        memoryFiles: [{ path: 'C:\\p\\CLAUDE.md', type: 'Project', tokens: 300 }]
      },
      1
    )
    expect(u).toMatchObject({ model: 'claude-opus-5-5', used: 21204, limit: 1000000, percent: 2, autoCompactAt: 967000, autoCompactEnabled: true, measuredAt: 1 })
    expect(u?.categories.map((c) => c.name)).toEqual(['System prompt', 'Free space'])
    expect(u?.memoryFiles).toHaveLength(1)
    expect(toContextUsage({ totalTokens: 5 })).toBeNull()
    expect(toContextUsage({ totalTokens: 50, maxTokens: 200, isAutoCompactEnabled: false, autoCompactThreshold: 150 })?.autoCompactAt).toBeNull()
  })
})
