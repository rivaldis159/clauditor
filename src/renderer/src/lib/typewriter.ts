// Replays an edit as if Claude were typing it: deletions vanish, insertions appear
// progressively. The model is mutated with applyEdits (no undo entries); callers commit the
// final disk state afterwards.
import type { LineEdit } from '@shared/lineEdits'
import { monaco } from './monaco'
import { useActivity } from '@/state/activity'

const frame = () => new Promise<number>((r) => requestAnimationFrame(r))

export interface TypeOptions {
  maxMs?: number
  path: string
  onPosition?: (pos: monaco.Position) => void
}

export async function typeEdits(ed: monaco.editor.ICodeEditor | undefined, model: monaco.editor.ITextModel, edits: LineEdit[], opts: TypeOptions): Promise<void> {
  const total = edits.reduce((n, e) => n + e.text.length, 0)
  const maxMs = opts.maxMs ?? 1600
  // characters per millisecond: quick for small edits, capped total duration for big ones
  const speed = Math.max(0.9, total / maxMs)
  const ro = ed?.getRawOptions().readOnly
  ed?.updateOptions({ readOnly: true })
  useActivity.getState().setTyping(opts.path, true)
  let delta = 0
  let aborted = false
  const onModelChange = ed?.onDidChangeModel(() => {
    aborted = true
  })
  try {
    for (const e of [...edits].sort((a, b) => a.oldStart - b.oldStart)) {
      const start = e.oldStart + delta
      const end = e.oldEnd + delta
      if (end > start) {
        const range = monaco.Range.fromPositions(model.getPositionAt(start), model.getPositionAt(end))
        model.applyEdits([{ range, text: '' }])
      }
      let typed = 0
      let last = performance.now()
      while (typed < e.text.length) {
        if (aborted || model.isDisposed()) {
          const pos = model.getPositionAt(start + typed)
          model.applyEdits([{ range: monaco.Range.fromPositions(pos, pos), text: e.text.slice(typed) }])
          typed = e.text.length
          break
        }
        const now = await frame()
        const n = Math.max(1, Math.round(speed * Math.max(8, now - last)))
        last = now
        let chunkEnd = Math.min(e.text.length, typed + n)
        if (e.text[chunkEnd - 1] === '\r' && e.text[chunkEnd] === '\n') chunkEnd++
        const chunk = e.text.slice(typed, chunkEnd)
        const pos = model.getPositionAt(start + typed)
        model.applyEdits([{ range: monaco.Range.fromPositions(pos, pos), text: chunk }])
        typed = chunkEnd
        const caret = model.getPositionAt(start + typed)
        opts.onPosition?.(caret)
        if (ed && ed.getModel() === model) ed.revealPositionInCenterIfOutsideViewport(caret, monaco.editor.ScrollType.Smooth)
      }
      delta += e.text.length - (e.oldEnd - e.oldStart)
    }
  } finally {
    onModelChange?.dispose()
    if (ed && !model.isDisposed()) ed.updateOptions({ readOnly: ro ?? false })
    useActivity.getState().setTyping(opts.path, false)
  }
}
