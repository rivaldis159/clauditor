// Welcome page and Settings → Claude (integration facts, model/effort pickers), for visual checks.
import fs from 'node:fs'
import path from 'node:path'

export default async function ({ win, outDir, shot }) {
  const log = (m) => fs.appendFileSync(path.join(outDir, 'settings.txt'), `${m}\n`)
  await win.waitForSelector('.welcome', { timeout: 30000 })
  await win.waitForTimeout(3500) // first Claude probe (models) finishes in the background
  await shot('w1-welcome')
  await win.keyboard.press('Control+,')
  await win.waitForTimeout(800)
  await win.locator('.set-nav-item', { hasText: 'Claude' }).click()
  await win.waitForTimeout(800)
  await shot('w2-settings-claude')
  log(`kv: ${(await win.locator('.set-kv').first().innerText().catch(() => '')).replace(/\n/g, ' | ')}`)
  const options = await win.locator('.set-row').filter({ has: win.locator('select') }).allInnerTexts()
  log(`selects: ${options.map((o) => o.replace(/\n/g, ' / ')).join(' || ')}`)
  const fonts = await win.evaluate(() => [...document.fonts].filter((f) => f.family.includes('Anthropic')).map((f) => `${f.family} ${f.style} ${f.status}`))
  log(`fonts: ${fonts.join(', ')}`)
}
