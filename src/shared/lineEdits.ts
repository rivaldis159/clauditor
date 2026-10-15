// Minimal line-based edits that transform one text into another. Ranges use Monaco's
// 1-based line/column convention and refer to the ORIGINAL text, so they can be applied
// in a single batch; offsets allow sequential (animated) application.
import { diffArrays } from 'diff'

export interface LineEdit {
  startLine: number
  startCol: number
  endLine: number
  endCol: number
  text: string
  /** character offsets in the original text */
  oldStart: number
  oldEnd: number
}

export interface LineChange {
  /** 1-based inclusive line ranges in the new text that were inserted or modified */
  added: [number, number][]
  /** new-text line numbers after which lines were removed */
  removedAt: number[]
  insertedChars: number
}

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/)
}

export function computeLineEdits(oldText: string, newText: string, eol = '\n'): { edits: LineEdit[]; change: LineChange } {
  const A = splitLines(oldText)
  const B = splitLines(newText)
  const n = A.length
  const eolLen = eol.length
  const lineStart: number[] = new Array(n + 1)
  lineStart[0] = 0
  for (let i = 0; i < n; i++) lineStart[i + 1] = lineStart[i] + A[i].length + (i < n - 1 ? eolLen : 0)
  const maxCol = (line: number) => A[line - 1].length + 1
  const off = (line: number, col: number) => lineStart[line - 1] + col - 1

  const edits: LineEdit[] = []
  const change: LineChange = { added: [], removedAt: [], insertedChars: 0 }
  const parts = diffArrays(A, B)

  let s = 0 // old index
  let ns = 0 // new index
  const push = (startLine: number, startCol: number, endLine: number, endCol: number, text: string) => {
    edits.push({ startLine, startCol, endLine, endCol, text, oldStart: off(startLine, startCol), oldEnd: off(endLine, endCol) })
  }

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    const count = p.count ?? p.value.length
    if (!p.added && !p.removed) {
      s += count
      ns += count
      continue
    }
    let removed: string[] = []
    let added: string[] = []
    if (p.removed) {
      removed = p.value
      const nx = parts[i + 1]
      if (nx?.added) {
        added = nx.value
        i++
      }
    } else {
      added = p.value
      const nx = parts[i + 1]
      if (nx?.removed) {
        removed = nx.value
        i++
      }
    }
    const e = s + removed.length
    if (added.length > 0) {
      const body = added.join(eol)
      if (removed.length === 0) {
        if (s < n) push(s + 1, 1, s + 1, 1, body + eol)
        else push(n, maxCol(n), n, maxCol(n), eol + body)
      } else if (e < n) {
        push(s + 1, 1, e + 1, 1, body + eol)
      } else {
        push(s + 1, 1, n, maxCol(n), body)
      }
      change.added.push([ns + 1, ns + added.length])
      change.insertedChars += body.length
    } else if (removed.length > 0) {
      if (e < n) push(s + 1, 1, e + 1, 1, '')
      else if (s > 0) push(s, maxCol(s), n, maxCol(n), '')
      else push(1, 1, n, maxCol(n), '')
      change.removedAt.push(Math.max(ns, 1))
    }
    s = e
    ns += added.length
  }
  // Edits may touch (e.g. an insertion right before a tail deletion across an empty line);
  // merge those so every range is strictly disjoint, as Monaco requires.
  const merged: LineEdit[] = []
  for (const ed of edits) {
    const prev = merged[merged.length - 1]
    if (prev && prev.oldEnd >= ed.oldStart) {
      merged[merged.length - 1] = {
        startLine: prev.startLine,
        startCol: prev.startCol,
        endLine: ed.oldEnd >= prev.oldEnd ? ed.endLine : prev.endLine,
        endCol: ed.oldEnd >= prev.oldEnd ? ed.endCol : prev.endCol,
        text: prev.text + oldText.slice(prev.oldEnd, Math.max(prev.oldEnd, ed.oldStart)) + ed.text,
        oldStart: prev.oldStart,
        oldEnd: Math.max(prev.oldEnd, ed.oldEnd)
      }
    } else merged.push(ed)
  }
  return { edits: merged, change }
}

/** Apply edits computed against `oldText` (used by tests and as a fallback). */
export function applyLineEdits(oldText: string, edits: LineEdit[]): string {
  let out = oldText
  for (const ed of [...edits].sort((a, b) => b.oldStart - a.oldStart)) {
    out = out.slice(0, ed.oldStart) + ed.text + out.slice(ed.oldEnd)
  }
  return out
}
