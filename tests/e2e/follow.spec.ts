import path from 'node:path'
import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { launch, probe, type Harness } from './fixtures'

let h: Harness

test.afterEach(async () => {
  await h?.close()
})

test('follows a live Claude desktop session: new file is typed, edits are applied and highlighted', async () => {
  h = await launch({ files: { 'index.html': '<h1>Halo</h1>\n' } })
  // auto-follow picks the busy session working in this folder
  await expect.poll(() => probe(h, (t) => t.activeSession())).toBe(h.sessionId)
  await expect(h.win.locator('.agent-title')).toHaveText('Sesi demo Clauditor')

  // Claude creates a new file
  const content = Array.from({ length: 30 }, (_, i) => `export const nilai${i} = ${i} // baris ${i + 1}`).join('\n') + '\n'
  await h.claudeWrite('src/nilai.ts', content)
  const file = path.join(h.workspace, 'src', 'nilai.ts')
  await expect.poll(() => probe(h, (t) => t.tabs().find((x) => x.active)?.title ?? '')).toBe('nilai.ts')
  await expect.poll(() => probe(h, (t, p) => t.doc(p)?.text ?? '', file), { timeout: 20_000 }).toBe(content)
  const afterWrite = await probe(h, (t, p) => t.doc(p), file)
  expect(afterWrite?.dirty).toBe(false)
  expect(afterWrite?.conflict).toBe(false)
  await h.win.screenshot({ path: 'test-results/follow-write.png' })

  // Claude edits it
  await h.claudeEdit('src/nilai.ts', 'export const nilai5 = 5 // baris 6', 'export const nilai5 = 500 // diubah Claude\nexport const tambahan = true')
  const expected = fs.readFileSync(file, 'utf8')
  await expect.poll(() => probe(h, (t, p) => t.doc(p)?.text ?? '', file), { timeout: 20_000 }).toBe(expected)
  const afterEdit = await probe(h, (t, p) => t.doc(p), file)
  expect(afterEdit?.dirty).toBe(false)
  await expect.poll(() => probe(h, (t, p) => t.claudeDecorations(p), file)).toBeGreaterThan(0)
  await expect(h.win.locator('.tool-card .tc-target', { hasText: 'nilai.ts' }).first()).toBeVisible()
  await h.win.screenshot({ path: 'test-results/follow-edit.png' })
})
