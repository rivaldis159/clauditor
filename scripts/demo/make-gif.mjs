// Turns the screencast frames from record-demo.mjs into a small looping GIF: one global palette,
// frames resampled to a steady rate, and each frame stored as only the rectangle that changed
// (pixels inside it that did not change are transparent, so the previous frame shows through).
//
// usage: node scripts/demo/make-gif.mjs <framesDir> <out.gif> [--fps=15] [--hold=3500]
import fs from 'node:fs'
import path from 'node:path'
import gifenc from 'gifenc'
import { PNG } from 'pngjs'

const { GIFEncoder, quantize, applyPalette } = gifenc
const [dir, out] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const option = (name, fallback) => {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? Number(arg.slice(name.length + 3)) : fallback
}
const FPS = option('fps', 15)
const HOLD_MS = option('hold', 3500)
if (!dir || !out) {
  console.error('usage: node scripts/demo/make-gif.mjs <framesDir> <out.gif> [--fps=15] [--hold=3500]')
  process.exit(1)
}

const { frames } = JSON.parse(fs.readFileSync(path.join(dir, 'frames.json'), 'utf8'))
if (!frames.length) throw new Error('no frames recorded')

// at every tick, show the newest frame painted by then
const step = 1000 / FPS
const picks = []
for (let tick = frames[0].t, i = 0; tick <= frames.at(-1).t; tick += step) {
  while (i + 1 < frames.length && frames[i + 1].t <= tick) i++
  if (picks.at(-1)?.file !== frames[i].file) picks.push({ file: frames[i].file, at: tick })
}
if (picks.at(-1).file !== frames.at(-1).file) picks.push({ file: frames.at(-1).file, at: frames.at(-1).t })

/** RGBA pixels in a fresh buffer (gifenc reads them through a Uint32Array view of the whole buffer) */
function load(file) {
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, file)))
  return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) }
}

// one palette for the whole animation, built from frames spread over the recording
const first = load(picks[0].file)
const W = first.width
const H = first.height
const samples = Math.min(24, picks.length)
const pool = new Uint8Array(W * H * 4 * samples)
for (let s = 0; s < samples; s++) {
  const pick = picks[Math.round((s * (picks.length - 1)) / Math.max(1, samples - 1))]
  pool.set(load(pick.file).rgba, s * W * H * 4)
}
const palette = quantize(pool, 255, { format: 'rgb565' })
const TRANSPARENT = palette.length
const colorTable = [...palette, [0, 0, 0]]

const gif = GIFEncoder({ auto: false })
gif.writeHeader()
let previous = null
let pending = null
let pendingAt = 0
let written = 0

function flush(delay) {
  if (!pending) return
  const at = gif.bytesView().length
  if (pending.full) {
    gif.writeFrame(pending.index, W, H, { first: true, palette: colorTable, repeat: 0, delay })
  } else {
    gif.writeFrame(pending.index, pending.w, pending.h, { delay, transparent: true, transparentIndex: TRANSPARENT, dispose: 1 })
    // gifenc always places frames at 0,0: patch left/top in the image descriptor, which follows
    // the 8-byte graphic control extension
    const bytes = gif.bytesView()
    bytes[at + 9] = pending.x & 0xff
    bytes[at + 10] = pending.x >> 8
    bytes[at + 11] = pending.y & 0xff
    bytes[at + 12] = pending.y >> 8
  }
  written++
  pending = null
}

for (const pick of picks) {
  const { width, height, rgba } = pick === picks[0] ? first : load(pick.file)
  if (width !== W || height !== H) throw new Error(`${pick.file} is ${width}×${height}, expected ${W}×${H}`)
  const index = applyPalette(rgba, palette, 'rgb565')
  if (!previous) {
    pending = { full: true, index }
    pendingAt = pick.at
    previous = index
    continue
  }
  let x0 = W
  let y0 = H
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < H; y++) {
    const row = y * W
    for (let x = 0; x < W; x++) {
      if (index[row + x] !== previous[row + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        y1 = y
      }
    }
  }
  if (x1 < 0) continue // nothing visible changed: the pending frame simply stays up longer
  flush(pick.at - pendingAt)
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const sub = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = (y + y0) * W + x0
    for (let x = 0; x < w; x++) {
      const v = index[row + x]
      sub[y * w + x] = v === previous[row + x] ? TRANSPARENT : v
    }
  }
  pending = { full: false, index: sub, x: x0, y: y0, w, h }
  pendingAt = pick.at
  previous = index
}
flush(HOLD_MS)
gif.finish()

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
fs.writeFileSync(out, gif.bytesView())
const seconds = (picks.at(-1).at - picks[0].at + HOLD_MS) / 1000
console.log(`${out}: ${W}×${H}, ${written} frames, ${seconds.toFixed(1)}s, ${palette.length} colours, ${(fs.statSync(out).size / 1048576).toFixed(2)} MB`)
