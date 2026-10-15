// Builds the app icons from build/icon.svg: build/icon.png (512), resources/icon.png (256) and a
// multi-size build/icon.ico. Sizes up to 32 px use build/icon-small.svg (heavier strokes) when present.
// usage: node scripts/make-icons.mjs [--preview <svg,svg,...> <out.png>]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const electron = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'))
const fileUrl = (p) => `file:///${p.replace(/\\/g, '/')}`

/** Lays images out on one page, renders it once and writes each image region as a PNG. */
function render(items, background = 'transparent') {
  let x = 0
  let height = 0
  const placed = items.map((it) => {
    const p = { ...it, x, y: 0 }
    x += it.size + 8
    height = Math.max(height, it.size)
    return p
  })
  const html = path.join(tmp, `page-${Date.now()}.html`)
  fs.writeFileSync(
    html,
    `<!doctype html><html><body style="margin:0;background:${background};overflow:hidden">${placed
      .map((p) => `<img src="${fileUrl(p.svg)}" width="${p.size}" height="${p.size}" style="position:absolute;left:${p.x}px;top:0;display:block">`)
      .join('')}</body></html>`
  )
  const job = path.join(tmp, `job-${Date.now()}.json`)
  fs.writeFileSync(job, JSON.stringify({ html, width: x, height, crops: placed.map((p) => ({ x: p.x, y: 0, width: p.size, height: p.size, out: p.out })) }))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  execFileSync(electron, [path.join(root, 'scripts', 'icon-render.cjs'), job], { stdio: 'inherit', env })
}

/** ICO with PNG-encoded entries (supported since Windows Vista). */
function writeIco(pngs, out) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const dir = Buffer.alloc(16 * pngs.length)
  let offset = 6 + dir.length
  pngs.forEach(({ size, data }, i) => {
    const e = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, e)
    dir.writeUInt8(size >= 256 ? 0 : size, e + 1)
    dir.writeUInt16LE(1, e + 4)
    dir.writeUInt16LE(32, e + 6)
    dir.writeUInt32LE(data.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  fs.writeFileSync(out, Buffer.concat([header, dir, ...pngs.map((p) => p.data)]))
}

const args = process.argv.slice(2)
if (args[0] === '--preview') {
  // each variant at several sizes, rendered on a light and a dark strip
  const svgs = args[1].split(',').map((s) => path.resolve(s))
  const sizes = [256, 96, 48, 32, 24, 16]
  const out = path.resolve(args[2])
  const strips = []
  for (const bg of ['#f3f1ec', '#1b1b1b']) {
    for (const svg of svgs) {
      const items = sizes.map((size) => ({ svg, size, out: path.join(tmp, `p-${strips.length}-${size}.png`) }))
      render(items, bg)
      strips.push(items)
    }
  }
  // stitch strips into one image via a second render of the PNGs
  const rows = strips.map((items, i) => `<div style="display:flex;gap:14px;align-items:flex-end;padding:10px;background:${i < svgs.length ? '#f3f1ec' : '#1b1b1b'}">${items.map((it) => `<img src="${fileUrl(it.out)}" width="${it.size}" height="${it.size}">`).join('')}</div>`)
  const html = path.join(tmp, 'sheet.html')
  fs.writeFileSync(html, `<!doctype html><html><body style="margin:0">${rows.join('')}</body></html>`)
  const job = path.join(tmp, 'sheet.json')
  const w = 256 + 96 + 48 + 32 + 24 + 16 + 14 * 5 + 20
  const h = strips.length * 276
  fs.writeFileSync(job, JSON.stringify({ html, width: w, height: h, crops: [{ x: 0, y: 0, width: w, height: h, out }] }))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  execFileSync(electron, [path.join(root, 'scripts', 'icon-render.cjs'), job], { stdio: 'inherit', env })
  console.log(`preview → ${out}`)
} else {
  const big = path.join(root, 'build', 'icon.svg')
  const small = fs.existsSync(path.join(root, 'build', 'icon-small.svg')) ? path.join(root, 'build', 'icon-small.svg') : big
  const icoSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
  const items = icoSizes.map((size) => ({ svg: size <= 32 ? small : big, size, out: path.join(tmp, `ico-${size}.png`) }))
  items.push({ svg: big, size: 512, out: path.join(root, 'build', 'icon.png') })
  render(items)
  fs.copyFileSync(path.join(tmp, 'ico-256.png'), path.join(root, 'resources', 'icon.png'))
  writeIco(icoSizes.map((size) => ({ size, data: fs.readFileSync(path.join(tmp, `ico-${size}.png`)) })), path.join(root, 'build', 'icon.ico'))
  console.log('icons → build/icon.png, build/icon.ico, resources/icon.png')
}
fs.rmSync(tmp, { recursive: true, force: true })
