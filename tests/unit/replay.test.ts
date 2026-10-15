import { describe, expect, it } from 'vitest'
import { buildReplay } from '../../src/shared/replay'
import type { ToolEvent } from '../../src/shared/types'

let n = 0
function tool(name: string, input: Record<string, unknown>, file?: Partial<NonNullable<NonNullable<ToolEvent['result']>['file']>>): ToolEvent {
  n++
  return {
    kind: 'tool',
    id: `t${n}`,
    toolUseId: `t${n}`,
    ts: n * 1000,
    name,
    input,
    status: 'done',
    result: file ? { isError: false, text: '', truncated: false, file: { path: String(input.file_path), type: 'edit', hunks: [], added: 1, removed: 0, ...file } } : undefined
  }
}

describe('buildReplay', () => {
  it('replays from a backup through edits', () => {
    const p = 'C:\\p\\a.ts'
    const events = [
      tool('Edit', { file_path: p, old_string: 'one', new_string: 'ONE' }, {}),
      tool('Edit', { file_path: p, old_string: 'two', new_string: 'TWO\nthree' }, {})
    ]
    const steps = buildReplay(events, new Map([[p.toLowerCase(), { backup: 'one\ntwo\n' }]]))
    expect(steps.map((s) => s.after)).toEqual(['ONE\ntwo\n', 'ONE\nTWO\nthree\n'])
    expect(steps.every((s) => s.exact)).toBe(true)
  })

  it('starts empty for created files and handles MultiEdit', () => {
    const p = 'C:\\p\\new.ts'
    const events = [
      tool('Write', { file_path: p, content: 'let a = 1\nlet b = 2\n' }, { type: 'create' }),
      tool('MultiEdit', { file_path: p, edits: [{ old_string: 'a = 1', new_string: 'a = 10' }, { old_string: 'b = 2', new_string: 'b = 20' }] }, {})
    ]
    const steps = buildReplay(events, new Map())
    expect(steps[0].before).toBe('')
    expect(steps[1].after).toBe('let a = 10\nlet b = 20\n')
  })

  it('reconstructs the base by undoing edits from the disk content', () => {
    const p = 'C:\\p\\b.ts'
    const events = [tool('Edit', { file_path: p, old_string: 'x', new_string: 'y' }, { originalFile: null })]
    const steps = buildReplay(events, new Map([[p.toLowerCase(), { disk: 'a y b' }]]))
    expect(steps[0].before).toBe('a x b')
    expect(steps[0].after).toBe('a y b')
  })

  it('keeps CRLF files CRLF', () => {
    const p = 'C:\\p\\c.txt'
    const events = [tool('Edit', { file_path: p, old_string: 'b\nc', new_string: 'B\nC' }, {})]
    const steps = buildReplay(events, new Map([[p.toLowerCase(), { backup: 'a\r\nb\r\nc\r\n' }]]))
    expect(steps[0].after).toBe('a\r\nB\r\nC\r\n')
  })

  it('flags edits that no longer match', () => {
    const p = 'C:\\p\\d.ts'
    const events = [tool('Edit', { file_path: p, old_string: 'missing', new_string: 'x' }, {})]
    const steps = buildReplay(events, new Map([[p.toLowerCase(), { backup: 'abc' }]]))
    expect(steps[0].exact).toBe(false)
    expect(steps[0].after).toBe('abc')
  })
})
