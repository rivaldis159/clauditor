// Live follow test: wait until Clauditor follows the active Claude session, then record frames.
import fs from 'node:fs'
import path from 'node:path'

export default async function ({ win, outDir, shot }) {
  const deadline = Date.now() + 60_000
  let title = ''
  while (Date.now() < deadline) {
    title = (await win.locator('.agent-title').first().textContent().catch(() => '')) ?? ''
    if (title) break
    await win.waitForTimeout(500)
  }
  fs.writeFileSync(path.join(outDir, 'ready.txt'), `following: ${title}\n`)
  await shot('f00-following')
  // record frames while Claude works
  const frames = Number(process.env.FOLLOW_FRAMES ?? 60)
  for (let i = 1; i <= frames; i++) {
    await win.waitForTimeout(1500)
    const tabs = await win.locator('.tab .tab-label').allTextContents()
    fs.appendFileSync(path.join(outDir, 'frames.txt'), `${i}\t${new Date().toISOString()}\t${tabs.join(' | ')}\n`)
    await shot(`f${String(i).padStart(2, '0')}`)
    if (fs.existsSync(path.join(outDir, 'stop.txt'))) break
  }
}
