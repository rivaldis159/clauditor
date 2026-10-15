import path from 'node:path'
import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { launch, probe, type Harness } from './fixtures'

let h: Harness
test.afterEach(async () => {
  await h?.close()
})

// Regression: a long Markdown file created by Claude must end up clean (not dirty) after the typing animation.
test('a long real-world file written by Claude stays clean after typing', async () => {
  h = await launch()
  await expect.poll(() => probe(h, (t) => t.activeSession())).toBe(h.sessionId)
  const content = fs.readFileSync(path.resolve('README.md'), 'utf8')
  await h.claudeWrite('README.md', content)
  const file = path.join(h.workspace, 'README.md')
  await expect.poll(() => probe(h, (t, p) => t.doc(p)?.text ?? '', file), { timeout: 20_000 }).toBe(content)
  await h.win.waitForTimeout(2500)
  const st = await probe(h, (t, p) => t.doc(p), file)
  await h.win.screenshot({ path: 'test-results/follow-readme.png' })
  expect(st?.dirty).toBe(false)
  expect(st?.conflict).toBe(false)
  expect(fs.readFileSync(file, 'utf8')).toBe(content)
})
