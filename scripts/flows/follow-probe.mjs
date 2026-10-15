// Real-world follow probe: log document + view state every second while Claude edits a file.
import fs from 'node:fs'
import path from 'node:path'

export default async function ({ win, outDir, shot }) {
  const target = process.env.PROBE_FILE
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const id = await win.evaluate(() => window.__clauditor?.activeSession() ?? null)
    if (id) break
    await win.waitForTimeout(500)
  }
  fs.writeFileSync(path.join(outDir, 'ready.txt'), 'ready\n')
  for (let i = 1; i <= 70; i++) {
    await win.waitForTimeout(1000)
    const st = await win.evaluate((p) => {
      const t = window.__clauditor
      const d = t.doc(p)
      return {
        tabs: t.tabs().map((x) => `${x.title}${x.active ? '*' : ''}${x.preview ? '~' : ''}`).join(' | '),
        doc: d ? { len: d.text.length, disk: d.disk.length, dirty: d.dirty, conflict: d.conflict, pending: d.pendingCreate } : null,
        view: t.visibleLines(p),
        decos: t.claudeDecorations(p)
      }
    }, target)
    fs.appendFileSync(path.join(outDir, 'probe.txt'), `${i}\t${JSON.stringify(st)}\n`)
    if (i % 3 === 0) await shot(`p${String(i).padStart(2, '0')}`)
    if (fs.existsSync(path.join(outDir, 'stop.txt'))) break
  }
}
