// Claude's fonts (Anthropic Sans, Anthropic Serif, Anthropic Mono) are not bundled with Clauditor:
// they are Anthropic's own and ship with Claude desktop. The main process finds them in the
// Claude install (their file names change with every Claude release) and this module registers
// them, so the UI matches Claude and follows its font updates. Without Claude installed, the CSS
// stacks fall back to the bundled open fonts.
import type { ClaudeEnvironment } from '@shared/types'
import { monaco } from '@/lib/monaco'

type FontKey = keyof ClaudeEnvironment['fonts']

const FACES: { key: FontKey; family: string; style: 'normal' | 'italic' }[] = [
  { key: 'sans', family: 'Anthropic Sans', style: 'normal' },
  { key: 'sansItalic', family: 'Anthropic Sans', style: 'italic' },
  { key: 'serif', family: 'Anthropic Serif', style: 'normal' },
  { key: 'mono', family: 'Anthropic Mono', style: 'normal' }
]

const active = new Map<FontKey, { url: string; face: FontFace }>()
const listeners = new Set<() => void>()

/** Notified after Claude's fonts were (re)registered, e.g. so terminals can re-measure cells. */
export function onClaudeFontsChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function claudeFontsActive(): boolean {
  return active.size > 0
}

/** Registers (or swaps, after a Claude update) the Anthropic font faces. */
export async function applyClaudeFonts(fonts: ClaudeEnvironment['fonts']): Promise<void> {
  let changed = false
  await Promise.all(
    FACES.map(async ({ key, family, style }) => {
      const url = fonts[key]
      const cur = active.get(key)
      if (cur?.url === url) return
      if (cur) {
        document.fonts.delete(cur.face)
        active.delete(key)
        changed = true
      }
      if (!url) return
      // variable files cover the whole weight range; the static "Web" cuts are regular weight
      const weight = /variable/i.test(url) ? '100 900' : '400'
      try {
        const face = new FontFace(family, `url("${url}") format("woff2")`, { style, weight, display: 'swap' })
        await face.load()
        document.fonts.add(face)
        active.set(key, { url, face })
        changed = true
      } catch (err) {
        console.warn(`[fonts] ${family} ${style} not loaded:`, err)
      }
    })
  )
  document.documentElement.dataset.claudeFonts = active.size ? 'on' : 'off'
  if (!changed) return
  // Monaco caches glyph widths per font: measure again with the new faces
  monaco.editor.remeasureFonts()
  for (const fn of listeners) fn()
}
