// First run of the packaged app (no Agent SDK inside): the SDK must arrive from npm, then models load.
import fs from 'node:fs'
import path from 'node:path'

export default async function ({ win, outDir, shot }) {
  const log = (m) => fs.appendFileSync(path.join(outDir, 'first-run.txt'), `${new Date().toISOString()} ${m}\n`)
  await win.waitForSelector('.welcome', { timeout: 30000 })
  const t0 = Date.now()
  let env = null
  while (Date.now() - t0 < 90_000) {
    env = await win.evaluate(() => window.clauditor.invoke('claude:environment'))
    if (env.sdk.source !== 'none' && env.models.length) break
    await win.waitForTimeout(1000)
  }
  log(`after ${Date.now() - t0}ms: sdk=${JSON.stringify(env?.sdk)} cli=${env?.cli.version} models=${env?.models.map((m) => m.label).join(', ')}`)
  const userData = await win.evaluate(() => window.clauditor.invoke('app:info').then((i) => i.userData))
  const dir = path.join(userData, 'claude-sdk')
  log(`claude-sdk: ${fs.existsSync(dir) ? fs.readdirSync(dir).map((v) => `${v}[${fs.readdirSync(path.join(dir, v)).join(',')}]`).join(' ') : '(missing)'}`)
  await win.keyboard.press('Control+,')
  await win.waitForTimeout(800)
  await win.locator('.set-nav-item', { hasText: 'Claude' }).click()
  await win.waitForTimeout(800)
  await shot('f1-settings-claude')
}
