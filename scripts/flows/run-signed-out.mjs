// A run that starts while signed out must end cleanly: one login toast, no hang, draft handling sane.
import fs from 'node:fs'
import path from 'node:path'

export default async function ({ win, outDir, shot }) {
  const log = (m) => fs.appendFileSync(path.join(outDir, 'run.txt'), `${new Date().toISOString()} ${m}\n`)
  await win.waitForSelector('.composer-input', { timeout: 30000 })
  await win.waitForSelector('.composer-login', { timeout: 30000 }).catch(() => null)
  await win.evaluate(() => window.__clauditor.forgetAuth())
  await win.click('.composer-input')
  await win.keyboard.type('Balas hanya dengan kata: siap')
  const t0 = Date.now()
  await win.keyboard.press('Enter')
  log('sent')
  let toast = null
  while (Date.now() - t0 < 60_000) {
    toast = await win.locator('.toast .toast-title').allTextContents()
    if (toast.length) break
    await win.waitForTimeout(250)
  }
  log(`toast after ${Date.now() - t0}ms: ${toast?.join(' / ')}`)
  // the renderer must stay responsive
  const t1 = Date.now()
  const alive = await win.evaluate(() => document.querySelectorAll('.toast').length)
  log(`evaluate roundtrip ${Date.now() - t1}ms, toasts=${alive}`)
  await win.waitForTimeout(3000)
  log(`toasts later: ${(await win.locator('.toast .toast-title').allTextContents()).join(' / ')}`)
  log(`detail: ${(await win.locator('.toast .toast-detail').allTextContents()).join(' / ')}`)
  log(`banner back: ${await win.locator('.composer-login').count()} | active session: ${await win.evaluate(() => window.__clauditor.activeSession())}`)
  await win.waitForTimeout(3000)
  log(`timeline errors: ${JSON.stringify(await win.locator('.tl-system.error .tl-system-text').allTextContents())}`)
  await shot('s1-after')
}
