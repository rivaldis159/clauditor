import path from 'node:path'
import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { launch, probe, type Harness } from './fixtures'

let h: Harness
test.afterEach(async () => {
  await h?.close()
})

const original = Array.from({ length: 80 }, (_, i) => `baris ${i + 1}: isi awal`).join('\n') + '\n'

// Claude Code writes the file before the tool call reaches the transcript. Clauditor must still
// show the change (rewind + replay) and highlight it, for files open or not yet open.
test('edits that land on disk before their tool call are still replayed and highlighted', async () => {
  h = await launch({ files: { 'catatan.txt': original } })
  await expect.poll(() => probe(h, (t) => t.activeSession())).toBe(h.sessionId)
  const file = path.join(h.workspace, 'catatan.txt')

  // 1) file not open yet
  await h.claudeEdit('catatan.txt', 'baris 70: isi awal', 'baris 70: DIUBAH oleh Claude\nbaris 70b: baris baru', { late: true })
  const afterFirst = fs.readFileSync(file, 'utf8')
  await expect.poll(() => probe(h, (t, p) => t.doc(p)?.text ?? '', file), { timeout: 20_000 }).toBe(afterFirst)
  await expect.poll(() => probe(h, (t, p) => t.claudeDecorations(p), file)).toBeGreaterThan(0)
  // the view follows the change near the end of the file
  await expect.poll(async () => ((await probe(h, (t, p) => (t as unknown as { visibleLines(p: string): number[] | null }).visibleLines(p), file)) ?? [0, 0])[1]).toBeGreaterThan(60)
  expect((await probe(h, (t, p) => t.doc(p), file))?.dirty).toBe(false)

  // 2) file already open
  await h.claudeEdit('catatan.txt', 'baris 10: isi awal', 'baris 10: juga diubah', { late: true })
  const afterSecond = fs.readFileSync(file, 'utf8')
  await expect.poll(() => probe(h, (t, p) => t.doc(p)?.text ?? '', file), { timeout: 20_000 }).toBe(afterSecond)
  expect((await probe(h, (t, p) => t.doc(p), file))?.dirty).toBe(false)
  await h.win.screenshot({ path: 'test-results/follow-late.png' })
})
