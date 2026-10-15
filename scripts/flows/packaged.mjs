// Smoke test for the packaged app: native terminal (node-pty), ripgrep search, Claude detection, IDE bridge.
import fs from 'node:fs'
import path from 'node:path'

export default async function ({ app, win, outDir, shot }) {
  const log = (m) => fs.appendFileSync(path.join(outDir, 'packaged.txt'), `${new Date().toISOString()} ${m}\n`)
  const meta = await app.evaluate(({ app: a }) => ({ packaged: a.isPackaged, version: a.getVersion(), exe: a.getPath('exe') }))
  log(`app: ${JSON.stringify(meta)}`)
  await win.waitForSelector('.composer-input', { timeout: 30000 })
  const info = await win.evaluate(async () => {
    const i = await window.clauditor.invoke('app:info')
    const ide = await window.clauditor.invoke('ide:status')
    return { claude: i.claudeExe, ide: { enabled: ide.enabled, port: ide.port } }
  })
  log(`info: ${JSON.stringify(info)}`)

  // terminal (node-pty from app.asar.unpacked)
  // xterm 6 paints on a canvas (WebGL), so the check is visual: p1-terminal must show "clauditor-ok-42"
  await win.keyboard.press('Control+`')
  const opened = await win.waitForSelector('.xterm-screen', { timeout: 20000 }).catch(() => null)
  log(`terminal mounted: ${!!opened} | toasts: ${JSON.stringify(await win.locator('.toast').allInnerTexts())}`)
  await win.waitForTimeout(2500)
  await win.click('.xterm-screen')
  await win.keyboard.type('Write-Output ("clauditor-ok-" + 6*7)')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(2000)
  await shot('p1-terminal')

  // ripgrep search
  await win.keyboard.press('Control+Shift+F')
  await win.waitForTimeout(400)
  await win.keyboard.type('Demo')
  await win.waitForTimeout(2500)
  const results = await win.locator('.search-results, .search-view').first().innerText().catch(() => '')
  log(`search: ${JSON.stringify(results.slice(0, 200))}`)
  await shot('p2-search')
}
