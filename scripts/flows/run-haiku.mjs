// One tiny real run from the Claude panel (Haiku, no tools): streaming, result, timeline.
import fs from 'node:fs'
import path from 'node:path'

export default async function ({ win, outDir, shot }) {
  const log = (m) => fs.appendFileSync(path.join(outDir, 'run.txt'), `${new Date().toISOString()} ${m}\n`)
  await win.waitForSelector('.composer-input', { timeout: 30000 })
  await win.waitForTimeout(1500)
  await win.selectOption('.composer .composer-select >> nth=0', 'haiku').catch((e) => log(`model: ${e.message}`))
  await win.click('.composer-input')
  await win.keyboard.type('Reply with exactly one word: ready')
  const t0 = Date.now()
  await win.keyboard.press('Enter')
  log('sent')
  let answer = ''
  while (Date.now() - t0 < 120_000) {
    const toast = await win.locator('.toast .toast-title').allTextContents()
    if (toast.length) log(`toast: ${toast.join(' / ')}`)
    answer = (await win.locator('.tl-text').allInnerTexts().catch(() => [])).join(' | ')
    if (/ready/i.test(answer)) break
    await win.waitForTimeout(700)
  }
  log(`answer after ${Date.now() - t0}ms: ${answer.slice(0, 200)}`)
  await win.waitForTimeout(1500)
  await shot('h1-run')
  log(`header: ${(await win.locator('.agent-head').first().innerText().catch(() => '')).replace(/\n/g, ' | ')}`)
}
