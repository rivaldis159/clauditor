import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TranscriptParser, countPatch, stripReminders } from '../../src/main/services/claude/transcript'
import { parseTranscriptFile } from '../../src/main/services/claude/session-store'
import type { ToolEvent } from '../../src/shared/types'

const ts = (n: number) => new Date(Date.UTC(2026, 9, 14, 10, 0, n)).toISOString()

function rec(o: Record<string, unknown>) {
  return JSON.stringify({ sessionId: 's1', cwd: 'C:\\proj', version: '2.1.295', entrypoint: 'claude-desktop', ...o })
}

describe('TranscriptParser', () => {
  it('builds prompt, text and tool events with results and file stats', () => {
    const p = new TranscriptParser()
    p.feedLine(rec({ type: 'user', uuid: 'u1', timestamp: ts(0), message: { role: 'user', content: 'Buat fungsi tambah <system-reminder>abaikan</system-reminder>' } }))
    p.feedLine(
      rec({
        type: 'assistant',
        uuid: 'a1',
        timestamp: ts(1),
        message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Baik, saya buat.' }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 } }
      })
    )
    p.feedLine(
      rec({
        type: 'assistant',
        uuid: 'a2',
        timestamp: ts(2),
        message: {
          id: 'm1',
          model: 'claude-opus-5-5',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: 'C:\\proj\\a.ts', old_string: 'x', new_string: 'y\nz' } }],
          usage: { input_tokens: 10, output_tokens: 9, cache_read_input_tokens: 100 }
        }
      })
    )
    const first = p.drain()
    expect(first.added.map((e) => e.kind)).toEqual(['prompt', 'text', 'tool'])
    expect((first.added[0] as { text: string }).text).toBe('Buat fungsi tambah')
    expect(p.stats.outputTokens).toBe(9)
    expect(p.stats.inputTokens).toBe(10)

    p.feedLine(
      rec({
        type: 'user',
        uuid: 'u2',
        timestamp: ts(3),
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'The file has been updated successfully.' }] },
        toolUseResult: {
          filePath: 'C:\\proj\\a.ts',
          oldString: 'x',
          newString: 'y\nz',
          originalFile: null,
          structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-x', '+y', '+z'] }]
        }
      })
    )
    const second = p.drain()
    expect(second.added).toHaveLength(0)
    expect(second.updated).toHaveLength(1)
    const tool = second.updated[0] as ToolEvent
    expect(tool.status).toBe('done')
    expect(tool.result?.file?.added).toBe(2)
    expect(tool.result?.file?.removed).toBe(1)
    expect(p.stats.linesAdded).toBe(2)
    expect(p.fileChanges()).toHaveLength(1)
    expect(p.stats.turns).toBe(1)
    expect(p.meta.firstPrompt).toBe('Buat fungsi tambah')
  })

  it('marks denied tools, tracks todos, titles and file-history backups', () => {
    const p = new TranscriptParser()
    p.feedLine(rec({ type: 'assistant', uuid: 'a1', timestamp: ts(1), message: { id: 'm', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'rm -rf /' } }] } }))
    p.feedLine(
      rec({
        type: 'user',
        uuid: 'u1',
        timestamp: ts(2),
        toolDenialKind: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: "The user doesn't want to proceed with this tool use." }] }
      })
    )
    p.feedLine(
      rec({
        type: 'assistant',
        uuid: 'a2',
        timestamp: ts(3),
        message: { id: 'm2', content: [{ type: 'tool_use', id: 't2', name: 'TodoWrite', input: { todos: [{ content: 'Langkah 1', status: 'in_progress', activeForm: 'Mengerjakan langkah 1' }] } }] }
      })
    )
    p.feedLine(JSON.stringify({ type: 'custom-title', customTitle: 'Judul sesi', sessionId: 's1' }))
    p.feedLine(
      JSON.stringify({
        type: 'file-history-snapshot',
        messageId: 'x',
        snapshot: {
          trackedFileBackups: {
            'src\\a.ts': { backupFileName: 'abc@v1', version: 1, realParentDir: 'C:\\proj\\src' },
            'src\\b.ts': { backupFileName: null, version: 1, realParentDir: 'C:\\proj\\src' }
          }
        }
      })
    )
    const tool = p.events.find((e) => e.kind === 'tool' && e.name === 'Bash') as ToolEvent
    expect(tool.status).toBe('denied')
    expect(p.todos?.[0].status).toBe('in_progress')
    expect(p.meta.title).toBe('Judul sesi')
    expect(p.backupFor('C:\\proj\\src\\a.ts')?.name).toBe('abc@v1')
    expect(p.backupFor('C:\\proj\\src\\b.ts')?.name).toBeNull()
  })

  it('handles slash commands, interrupts and task notifications', () => {
    const p = new TranscriptParser()
    p.feedLine(rec({ type: 'user', uuid: 'u1', timestamp: ts(0), message: { content: '<command-name>/review</command-name>\n<command-args>src</command-args>' } }))
    p.feedLine(rec({ type: 'user', uuid: 'u2', timestamp: ts(1), message: { content: '[Request interrupted by user]' } }))
    p.feedLine(
      rec({
        type: 'attachment',
        uuid: 'u3',
        timestamp: ts(2),
        attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: '<task-notification><summary>Build selesai</summary></task-notification>' }
      })
    )
    const kinds = p.events.map((e) => (e.kind === 'prompt' ? `${e.origin}:${e.text}` : `${e.kind}:${'text' in e ? e.text : ''}`))
    expect(kinds).toEqual(['command:/review src', 'system:Stopped by user', 'task-notification:Build selesai'])
    const notice = p.events.find((e) => e.kind === 'system')
    expect(notice && 'i18n' in notice && notice.i18n).toBe(true)
  })

  it('counts patches and strips reminders', () => {
    expect(countPatch([{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' a', '-b', '+c', '+d'] }])).toEqual({ added: 2, removed: 1 })
    expect(stripReminders('halo <system-reminder>x\ny</system-reminder> dunia')).toBe('halo  dunia')
  })
})

describe('real transcripts (smoke)', () => {
  const dir = path.join(os.homedir(), '.claude', 'projects')
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .flatMap((slug) => {
          try {
            return fs
              .readdirSync(path.join(dir, slug))
              .filter((n) => n.endsWith('.jsonl'))
              .map((n) => path.join(dir, slug, n))
          } catch {
            return []
          }
        })
        .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)
        .slice(0, 3)
    : []

  it.skipIf(files.length === 0)('parses the largest local transcripts quickly', async () => {
    for (const f of files) {
      const p = new TranscriptParser()
      const t0 = performance.now()
      await parseTranscriptFile(f, p)
      const ms = performance.now() - t0
      const tools = p.events.filter((e) => e.kind === 'tool') as ToolEvent[]
      const unresolved = tools.filter((t) => t.status === 'running').length
      console.log(
        `${path.basename(f)} ${(fs.statSync(f).size / 1e6).toFixed(1)}MB → ${p.events.length} events, ${tools.length} tools (${unresolved} open), ` +
          `${p.fileChanges().length} files, +${p.stats.linesAdded}/-${p.stats.linesRemoved}, out ${p.stats.outputTokens} tok, ${ms.toFixed(0)} ms, title=${p.meta.title}`
      )
      expect(p.events.length).toBeGreaterThan(0)
    }
  })
})
