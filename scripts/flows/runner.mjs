// Real Claude Code run from Clauditor's panel: stream, permission prompt, file created.
import fs from 'node:fs'
import path from 'node:path'

export default async function ({ win, outDir, shot }) {
  const ws = process.env.CLAUDITOR_OPEN_FOLDER
  const log = (m) => fs.appendFileSync(path.join(outDir, 'runner.txt'), `${new Date().toISOString()} ${m}\n`)
  await win.waitForSelector('.composer-input', { timeout: 30000 })
  await win.selectOption('.composer .composer-select >> nth=0', 'haiku').catch((e) => log(`model select: ${e.message}`))
  await win.click('.composer-input')
  await win.keyboard.type('Buat berkas halo.txt berisi satu baris: Halo dari Clauditor. Jangan lakukan hal lain.')
  await shot('r1-typed')
  await win.keyboard.press('Enter')
  log('sent')
  let streamed = false
  let permitted = false
  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    if (!streamed && (await win.locator('.stream').count())) {
      streamed = true
      await shot('r2-streaming')
      log('streaming visible')
    }
    if (!permitted && (await win.locator('.perm-card').count())) {
      await win.waitForTimeout(400)
      await shot('r3-permission')
      log(`permission: ${await win.locator('.perm-card .perm-head').first().textContent()}`)
      await win.locator('.perm-card .btn-primary').first().click()
      permitted = true
    }
    if (fs.existsSync(path.join(ws, 'halo.txt'))) {
      log(`file created: ${JSON.stringify(fs.readFileSync(path.join(ws, 'halo.txt'), 'utf8'))}`)
      break
    }
    const err = await win.locator('.toast.error .toast-detail').first().textContent().catch(() => null)
    if (err) {
      log(`error toast: ${err}`)
      await shot('r-error')
      break
    }
    await win.waitForTimeout(500)
  }
  await win.waitForTimeout(6000)
  await shot('r4-done')
  const title = await win.locator('.agent-title').first().textContent().catch(() => '')
  const cards = await win.locator('.tool-card .tc-title').allTextContents()
  log(`session: ${title} | cards: ${cards.join(' / ')}`)
}
