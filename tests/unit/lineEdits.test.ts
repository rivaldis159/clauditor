import { describe, expect, it } from 'vitest'
import { applyLineEdits, computeLineEdits } from '../../src/shared/lineEdits'

function rnd(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function randomText(r: () => number, eol: string): string {
  const lines: string[] = []
  const n = Math.floor(r() * 12)
  for (let i = 0; i < n; i++) lines.push(['a', 'b', 'c', '', 'const x = 1', '  return y'][Math.floor(r() * 6)])
  let t = lines.join(eol)
  if (r() < 0.5) t += eol
  return t
}

function mutate(r: () => number, text: string, eol: string): string {
  const lines = text.split(/\r?\n/)
  const ops = 1 + Math.floor(r() * 4)
  for (let k = 0; k < ops; k++) {
    const i = Math.floor(r() * (lines.length + 1))
    const op = r()
    if (op < 0.33) lines.splice(i, 0, `new ${Math.floor(r() * 100)}`)
    else if (op < 0.66 && lines.length) lines.splice(Math.min(i, lines.length - 1), 1)
    else if (lines.length) lines[Math.min(i, lines.length - 1)] = `chg ${Math.floor(r() * 100)}`
  }
  return lines.join(eol)
}

describe('computeLineEdits', () => {
  const cases: [string, string][] = [
    ['a\nb\nc', 'a\nX\nc'],
    ['a\nb', 'a\nb\n'],
    ['a\nb\n', 'a\nb'],
    ['a\nb', 'a\nc'],
    ['', 'hello\nworld\n'],
    ['hello\nworld\n', ''],
    ['a\nb\nc\nd', 'b\nd'],
    ['x', 'y\nx\nz']
  ]
  it.each(cases)('transforms %j into %j', (a, b) => {
    const { edits } = computeLineEdits(a, b)
    expect(applyLineEdits(a, edits)).toBe(b)
  })

  it('reports added ranges in new-line numbers', () => {
    const { change } = computeLineEdits('a\nb\nc', 'a\nX\nY\nc')
    expect(change.added).toEqual([[2, 3]])
  })

  it('survives randomized round trips with LF and CRLF', () => {
    for (const eol of ['\n', '\r\n']) {
      const r = rnd(eol.length * 97)
      for (let t = 0; t < 1500; t++) {
        const a = randomText(r, eol)
        const b = mutate(r, a, eol)
        const { edits } = computeLineEdits(a, b, eol)
        expect(applyLineEdits(a, edits)).toBe(b)
      }
    }
  })
})
