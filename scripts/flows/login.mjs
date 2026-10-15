// Signed-out experience: banner in the Claude panel, draft kept on send, settings row.
import fs from 'node:fs'
import path from 'node:path'

export default async function ({ win, outDir, shot }) {
  const log = (m) => fs.appendFileSync(path.join(outDir, 'login.txt'), `${new Date().toISOString()} ${m}\n`)
  await win.waitForSelector('.composer-input', { timeout: 30000 })
  const banner = await win.waitForSelector('.composer-login', { timeout: 30000 }).catch(() => null)
  log(`banner: ${banner ? await banner.textContent() : 'none'}`)
  await shot('l1-banner')
  const box = await win.locator('.agent-panel').boundingBox()
  if (box) await win.screenshot({ path: path.join(outDir, 'l1-panel.png'), clip: box })

  await win.click('.composer-input')
  await win.keyboard.type('Buat berkas halo.txt berisi: Halo dari Clauditor.')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(4000)
  const draft = await win.inputValue('.composer-input')
  const toast = await win.locator('.toast .toast-title').allTextContents()
  log(`draft kept: ${JSON.stringify(draft)} | toasts: ${toast.join(' / ')}`)
  await shot('l2-send')

  await win.keyboard.press('Control+,')
  await win.waitForTimeout(800)
  await win.locator('.set-nav button', { hasText: 'Claude' }).first().click().catch((e) => log(`nav: ${e.message}`))
  await win.waitForTimeout(600)
  await shot('l3-settings')
  log(`settings row: ${await win.locator('.set-row', { hasText: 'Claude Code sign-in' }).first().textContent().catch(() => 'none')}`)
}
