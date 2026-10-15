// Dev helper: launch the built app with Playwright, capture screenshots + console errors.
// usage: node scripts/shot.mjs <outDir> [--folder <path>] [--theme dark|light] [--wait ms] [--script file.mjs]
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const outDir = path.resolve(args[0] ?? 'shots')
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
fs.mkdirSync(outDir, { recursive: true })
const userData = path.resolve(opt('userdata', path.join(outDir, 'userdata')))
fs.mkdirSync(userData, { recursive: true })
const theme = opt('theme', 'dark')
const settingsFile = path.join(userData, 'settings.json')
let settings = {}
try {
  settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
} catch {}
settings.theme = theme
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2))

const env = { ...process.env, CLAUDITOR_USER_DATA: userData }
const folder = opt('folder')
if (folder) env.CLAUDITOR_OPEN_FOLDER = process.env.CLAUDITOR_OPEN_FOLDER = path.resolve(folder)
if (opt('claude-home')) env.CLAUDITOR_CLAUDE_HOME = path.resolve(opt('claude-home'))

// --exe dist/win-unpacked/Clauditor.exe checks the packaged build instead of the dev tree
const packagedExe = opt('exe')
const app = await electron.launch({
  executablePath: packagedExe ? path.resolve(packagedExe) : path.resolve('node_modules/electron/dist/electron.exe'),
  args: packagedExe ? [] : ['.'],
  env,
  timeout: 60000
})
const logs = []
const consoleFile = path.join(outDir, 'console.txt')
fs.writeFileSync(consoleFile, '')
const mainFile = path.join(outDir, 'main.txt')
fs.writeFileSync(mainFile, '')
app.process().stdout?.on('data', (d) => fs.appendFileSync(mainFile, d))
app.process().stderr?.on('data', (d) => fs.appendFileSync(mainFile, d))
const win = await app.firstWindow()
win.on('console', (m) => {
  const line = `[${m.type()}] ${m.text()}`
  fs.appendFileSync(consoleFile, `${line}\n`)
  if (m.type() === 'error' || m.type() === 'warning') logs.push(line)
})
win.on('pageerror', (e) => {
  const line = `[pageerror] ${e.message}\n${e.stack ?? ''}`
  fs.appendFileSync(consoleFile, `${line}\n`)
  logs.push(line)
})
const size = opt('size', '1500x920').split('x').map(Number)
await app.evaluate(({ BrowserWindow }, [w, h]) => {
  const bw = BrowserWindow.getAllWindows()[0]
  bw.unmaximize()
  bw.setSize(w, h)
  bw.center()
}, size)
await win.waitForTimeout(Number(opt('wait', '4000')))
const script = opt('script')
if (script) {
  const mod = await import(pathToUrl(path.resolve(script)))
  await mod.default({ app, win, outDir, shot: (name) => win.screenshot({ path: path.join(outDir, `${name}.png`) }) })
} else {
  await win.screenshot({ path: path.join(outDir, `main-${theme}.png`) })
}
console.log(`screens → ${outDir}`)
console.log(logs.length ? logs.slice(0, 40).join('\n') : 'no console errors')
await app.close()

function pathToUrl(p) {
  return `file:///${p.replace(/\\/g, '/')}`
}
