// Renders the GitHub social preview (1280×640): the app on the left, name and pitch on the right.
// Uses the open fonts bundled for the app (Instrument Serif, IBM Plex Sans, JetBrains Mono).
// usage: node scripts/demo/social-preview.mjs <app-screenshot-1280x800.png> <out.png>
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const [shot, out] = process.argv.slice(2).map((p) => p && path.resolve(p))
if (!shot || !out) {
  console.error('usage: node scripts/demo/social-preview.mjs <app-screenshot.png> <out.png>')
  process.exit(1)
}
const url = (p) => pathToFileURL(p).href
const font = (pkg, file) => url(path.join(root, 'node_modules', pkg, 'files', file))

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Instrument Serif'; src: url('${font('@fontsource/instrument-serif', 'instrument-serif-latin-400-normal.woff2')}'); }
@font-face { font-family: 'IBM Plex Sans'; font-weight: 400; src: url('${font('@fontsource/ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff2')}'); }
@font-face { font-family: 'IBM Plex Sans'; font-weight: 500; src: url('${font('@fontsource/ibm-plex-sans', 'ibm-plex-sans-latin-500-normal.woff2')}'); }
@font-face { font-family: 'JetBrains Mono'; font-weight: 100 800; src: url('${font('@fontsource-variable/jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2')}'); }
:root { --ink: #f0eee6; --soft: #d3cfc5; --muted: #9a968d; --accent: #f0773f; }
html, body { margin: 0; width: 1280px; height: 640px; overflow: hidden; background: #131215; }
body { position: relative; color: var(--ink); font-family: 'IBM Plex Sans', sans-serif; }
.bg {
  position: absolute; inset: 0;
  background:
    radial-gradient(560px 420px at 30% 52%, rgba(240, 119, 63, 0.18), transparent 70%),
    radial-gradient(520px 380px at 84% 40%, rgba(240, 119, 63, 0.08), transparent 70%),
    linear-gradient(180deg, #18171b 0%, #111013 100%);
}
.dots {
  position: absolute; inset: 0;
  background-image: radial-gradient(rgba(240, 238, 230, 0.08) 1px, transparent 1.4px);
  background-size: 22px 22px;
  -webkit-mask-image: linear-gradient(90deg, transparent 50%, #000 75%, #000 100%);
}
/* the window runs off the left edge and fades in; the shadow follows the fade */
.shot-wrap { position: absolute; left: -196px; top: 44px; filter: drop-shadow(0 28px 44px rgba(0, 0, 0, 0.6)); }
.shot {
  position: relative; width: 896px; height: 560px; border-radius: 14px; overflow: hidden;
  -webkit-mask-image: linear-gradient(90deg, transparent 196px, rgba(0, 0, 0, 0.35) 250px, #000 340px);
}
.shot img { display: block; width: 100%; height: 100%; }
.shot::after { content: ''; position: absolute; inset: 0; border-radius: 14px; box-shadow: inset 0 0 0 1px rgba(240, 238, 230, 0.12); }
.copy { position: absolute; left: 768px; right: 64px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; }
/* negative margins line the tile edge and the C of the wordmark up with the text below */
.logo { width: 84px; height: 84px; margin: 0 0 22px -4px; filter: drop-shadow(0 12px 22px rgba(0, 0, 0, 0.55)); }
h1 { margin: 0 0 18px -3px; font: 400 112px/0.92 'Instrument Serif', serif; letter-spacing: -0.5px; }
.tag { margin: 0 0 30px; font: 400 27px/1.36 'IBM Plex Sans', sans-serif; color: var(--soft); }
.tag em { font-style: normal; color: var(--accent); }
.chips { display: flex; flex-wrap: wrap; gap: 9px; }
.chip { padding: 9px 14px; border-radius: 999px; font: 500 16px/1 'IBM Plex Sans', sans-serif; color: #e6e2d8; border: 1px solid rgba(240, 238, 230, 0.16); background: rgba(240, 238, 230, 0.05); }
.url { margin-top: 28px; font: 500 16px/1 'JetBrains Mono', monospace; color: var(--muted); letter-spacing: 0.2px; }
</style></head>
<body>
  <div class="bg"></div>
  <div class="dots"></div>
  <div class="shot-wrap"><div class="shot"><img src="${url(shot)}"></div></div>
  <div class="copy">
    <img class="logo" src="${url(path.join(root, 'build', 'icon.svg'))}">
    <h1>Clauditor</h1>
    <p class="tag">Watch Claude Code build your project <em>live</em>, in a real code editor.</p>
    <div class="chips"><span class="chip">Free &amp; open source · MIT</span><span class="chip">Windows</span><span class="chip">Unofficial</span></div>
    <div class="url">github.com/rivaldis159/clauditor</div>
  </div>
</body></html>`

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-'))
const page = path.join(tmp, 'preview.html')
const job = path.join(tmp, 'job.json')
fs.writeFileSync(page, html)
fs.writeFileSync(job, JSON.stringify({ html: page, width: 1280, height: 640, crops: [{ x: 0, y: 0, width: 1280, height: 640, out }] }))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const electron = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
execFileSync(electron, [path.join(root, 'scripts', 'icon-render.cjs'), job], { stdio: 'inherit', env })
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`social preview → ${out}`)
