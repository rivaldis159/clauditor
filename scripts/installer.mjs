// Wraps dist/win-unpacked (from `electron-builder --dir`) into dist/Clauditor-Setup-<version>.exe with Inno Setup.
// ISCC is looked up in $ISCC, then in the default per-user and machine-wide install folders.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const candidates = [
  process.env.ISCC,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe'
].filter(Boolean)
const iscc = candidates.find((p) => fs.existsSync(p))
if (!iscc) {
  console.error('Inno Setup 6 (ISCC.exe) not found. Install it from https://jrsoftware.org/isdl.php or set ISCC.')
  process.exit(1)
}
if (!fs.existsSync(path.join(root, 'dist', 'win-unpacked', 'Clauditor.exe'))) {
  console.error('dist/win-unpacked/Clauditor.exe is missing: run `electron-builder --win --dir` first.')
  process.exit(1)
}
execFileSync(iscc, [`/DAppVersion=${pkg.version}`, '/Q', path.join(root, 'build', 'installer.iss')], { stdio: 'inherit' })
console.log(`installer → dist/Clauditor-Setup-${pkg.version}.exe`)
