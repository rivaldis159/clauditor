import { describe, expect, it } from 'vitest'
import { clipError } from '../../src/main/services/claude/runner'

describe('clipError', () => {
  it('keeps short messages intact', () => {
    expect(clipError('Failed to authenticate: OAuth session expired')).toBe('Failed to authenticate: OAuth session expired')
  })

  it('drops ANSI codes, stack frames and minified source dumps', () => {
    const minified = `var a=function(){${'x'.repeat(5000)}}`
    const text = `\x1b[31mClaude Code process exited with code 1\x1b[0m\n${minified}\n    at ChildProcess.exithandler (node:child_process:422:12)\nsee logs`
    const out = clipError(text)
    expect(out).toBe('Claude Code process exited with code 1\nsee logs')
  })

  it('caps the total length', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i} ${'y'.repeat(40)}`).join('\n')
    const out = clipError(text, 200)
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out.startsWith('line 0')).toBe(true)
  })

  it('falls back to a truncated slice when every line is noise', () => {
    const out = clipError('z'.repeat(1000), 120)
    expect(out).toHaveLength(120)
  })
})
