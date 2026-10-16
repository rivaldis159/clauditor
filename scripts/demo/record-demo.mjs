// Records the README demo: Claude desktop works on a small project (a scripted, English session)
// while Clauditor follows it live. Frames come from Chromium's DevTools screencast (lossless PNG,
// sent only when the page repaints), so idle stretches cost nothing.
//
// usage: npm run demo   (build, record into .demo/, then docs/demo.gif and docs/social-preview.png)
//   node scripts/demo/record-demo.mjs <framesDir>     frames + frames.json + poster.png
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { structuredPatch } from 'diff'
import { _electron as electron } from 'playwright'

const outDir = path.resolve(process.argv[2] ?? 'demo-frames')
const WIDTH = 1280
const HEIGHT = 800
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- a small git project, and a Claude home holding one Claude desktop session for it
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'clauditor-demo-')))
const home = path.join(root, 'claude-home')
const workspace = path.join(root, 'weather-cli')
const userData = path.join(root, 'userdata')
const desktopData = path.join(root, 'desktop-data')
for (const d of [home, workspace, userData, path.join(home, 'sessions'), path.join(home, 'ide')]) fs.mkdirSync(d, { recursive: true })

const files = {
  'package.json': `{
  "name": "weather-cli",
  "version": "0.3.0",
  "type": "module",
  "bin": { "weather": "dist/index.js" },
  "scripts": { "build": "tsc", "test": "vitest run" }
}
`,
  'README.md': `# weather-cli

Prints the current weather for any city.

    npx weather-cli Jakarta
`,
  'src/weather.ts': `export interface Weather {
  tempC: number
  summary: string
}

const API = 'https://wttr.in'

export async function fetchWeather(city: string) {
  const url = \`\${API}/\${encodeURIComponent(city)}?format=j1\`
  const data = await (await fetch(url)).json()
  const now = data.current_condition[0]
  return {
    tempC: Number(now.temp_C),
    summary: now.weatherDesc[0].value.toLowerCase()
  } satisfies Weather
}
`,
  'src/format.ts': `import type { Weather } from './weather.js'

export function formatReport(city: string, w: Weather) {
  return \`\${city}: \${w.tempC.toFixed(1)}°C, \${w.summary}\`
}
`,
  'src/index.ts': `import { fetchWeather } from './weather.js'
import { formatReport } from './format.js'

const city = process.argv[2] ?? 'Jakarta'

const weather = await fetchWeather(city)
console.log(formatReport(city, weather))
`
}
for (const [name, content] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(workspace, name)), { recursive: true })
  fs.writeFileSync(path.join(workspace, name), content)
}
const git = (...args) => execFileSync('git', ['-c', 'user.name=weather-cli', '-c', 'user.email=dev@example.com', ...args], { cwd: workspace, stdio: 'ignore' })
git('init', '-q', '-b', 'main')
git('add', '-A')
git('commit', '-q', '-m', 'weather-cli 0.3.0')

const title = 'Add an --imperial flag to weather-cli'
const prompt = 'Add an --imperial flag to the weather CLI that prints Fahrenheit, and cover both units with tests.'
const sessionId = randomUUID()
const slug = workspace.replace(/[^A-Za-z0-9]/g, '-')
fs.mkdirSync(path.join(home, 'projects', slug), { recursive: true })
const transcript = path.join(home, 'projects', slug, `${sessionId}.jsonl`)
const base = { sessionId, cwd: workspace, version: '2.1.295', entrypoint: 'claude-desktop', gitBranch: 'main' }
let parent = null
const append = (rec) => {
  const uuid = randomUUID()
  fs.appendFileSync(transcript, `${JSON.stringify({ parentUuid: parent, isSidechain: false, uuid, timestamp: new Date().toISOString(), ...base, ...rec })}\n`)
  parent = uuid
}
let msg = 0
// the conversation grows with every step, as a real one does
const usage = () => ({ input_tokens: 2400, output_tokens: 180, cache_read_input_tokens: 38_200 + msg * 2600 })
const assistant = (content) => append({ type: 'assistant', message: { id: `msg_demo_${++msg}`, role: 'assistant', model: 'claude-opus-5-5', content, usage: usage() } })
const say = (text) => assistant([{ type: 'text', text }])
let tools = 0
const toolUse = (name, input) => {
  const id = `toolu_demo_${++tools}`
  assistant([{ type: 'tool_use', id, name, input }])
  return id
}
const toolResult = (id, text, toolUseResult) => append({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, toolUseResult })

const registry = path.join(home, 'sessions', `${process.pid}.json`)
const setStatus = (status) =>
  fs.writeFileSync(
    registry,
    JSON.stringify({ pid: process.pid, sessionId, cwd: workspace, startedAt: Date.now() - 60_000, version: '2.1.295', kind: 'interactive', entrypoint: 'claude-desktop', hostSessionId: 'local_demo', name: title, status, statusUpdatedAt: Date.now() })
  )

append({ type: 'user', message: { role: 'user', content: prompt } })
append({ type: 'custom-title', customTitle: title })
setStatus('idle')
// Claude desktop's own record of the session: the model and effort it runs it with
const desktopFolder = path.join(desktopData, 'claude-code-sessions', 'org', 'account')
fs.mkdirSync(desktopFolder, { recursive: true })
fs.writeFileSync(path.join(desktopFolder, 'local_demo.json'), JSON.stringify({ sessionId: 'local_demo', cliSessionId: sessionId, title, model: 'claude-opus-5-5', effort: 'high', permissionMode: 'acceptEdits', isArchived: false }))
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'en', editor: { fontSize: 13, minimap: false } }))
const abs = (f) => path.join(workspace, f)
fs.writeFileSync(
  path.join(userData, 'state.json'),
  JSON.stringify({
    layout: { sidebarVisible: true, sidebarWidth: 220, panelVisible: false, panelHeight: 220, agentVisible: true, agentWidth: 440, activeView: 'explorer' },
    workspaces: { [workspace]: { tabs: [{ kind: 'file', path: abs('src/index.ts'), pinned: true }], activePath: abs('src/index.ts'), expanded: [abs('src')], agentSessionId: sessionId } }
  })
)

// ---- Claude's tools, logged the way Claude Code logs them (the file changes, then the result)
async function read(file) {
  const content = fs.readFileSync(abs(file), 'utf8')
  const lines = content.split('\n').length
  const id = toolUse('Read', { file_path: abs(file) })
  await sleep(400)
  toolResult(id, content, { type: 'text', file: { filePath: abs(file), content, numLines: lines, startLine: 1, totalLines: lines } })
}
async function edit(file, oldString, newString) {
  const before = fs.readFileSync(abs(file), 'utf8')
  if (!before.includes(oldString)) throw new Error(`edit: text not found in ${file}`)
  const after = before.replace(oldString, newString)
  const id = toolUse('Edit', { file_path: abs(file), old_string: oldString, new_string: newString })
  await sleep(500)
  fs.writeFileSync(abs(file), after)
  const { hunks } = structuredPatch(file, file, before, after, '', '', { context: 3 })
  toolResult(id, `The file ${abs(file)} has been updated successfully.`, {
    filePath: abs(file),
    oldString,
    newString,
    originalFile: before,
    replaceAll: false,
    userModified: false,
    structuredPatch: hunks.map(({ oldStart, oldLines, newStart, newLines, lines }) => ({ oldStart, oldLines, newStart, newLines, lines }))
  })
}
async function write(file, content) {
  const id = toolUse('Write', { file_path: abs(file), content })
  await sleep(500)
  fs.mkdirSync(path.dirname(abs(file)), { recursive: true })
  fs.writeFileSync(abs(file), content)
  toolResult(id, `File created successfully at: ${abs(file)}`, { type: 'create', filePath: abs(file), content, structuredPatch: [], originalFile: null })
}
async function bash(command, description, stdout) {
  const id = toolUse('Bash', { command, description })
  await sleep(1500)
  toolResult(id, stdout, { stdout, stderr: '', interrupted: false, isImage: false })
}
let shownTodos = []
async function todos(states) {
  const next = [
    { content: 'Parse an --imperial flag in the CLI', activeForm: 'Parsing the --imperial flag', status: states[0] },
    { content: 'Convert temperatures in the formatter', activeForm: 'Converting temperatures', status: states[1] },
    { content: 'Add tests for both units', activeForm: 'Adding tests', status: states[2] }
  ]
  const id = toolUse('TodoWrite', { todos: next })
  await sleep(250)
  toolResult(id, 'Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable', { oldTodos: shownTodos, newTodos: next })
  shownTodos = next
}

// ---- launch Clauditor (the build in out/) at a fixed size and scale
const app = await electron.launch({
  executablePath: path.resolve('node_modules/electron/dist/electron.exe'),
  args: ['.', '--force-device-scale-factor=1'],
  env: { ...process.env, CLAUDITOR_CLAUDE_HOME: home, CLAUDITOR_USER_DATA: userData, CLAUDITOR_OPEN_FOLDER: workspace, CLAUDITOR_DESKTOP_DATA: desktopData },
  timeout: 60_000
})
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log(`[renderer] ${e.message}`))
await app.evaluate(({ BrowserWindow }, size) => {
  const bw = BrowserWindow.getAllWindows()[0]
  bw.unmaximize()
  bw.setContentSize(size.w, size.h)
  bw.center()
}, { w: WIDTH, h: HEIGHT })
// Clauditor asks Claude Code for its models (and their context windows) at start: wait for it
const envFile = path.join(userData, 'claude-environment.json')
const probed = () => {
  try {
    return JSON.parse(fs.readFileSync(envFile, 'utf8')).models.some((m) => m.contextWindow)
  } catch {
    return false
  }
}
for (let t = Date.now(); !probed() && Date.now() - t < 45_000; ) await sleep(500)
await sleep(2000)

// Windows draws the window controls on top of the page, so they never reach the screencast;
// paint look-alikes (same glyph font, size and colors as the title bar overlay) for the recording.
await win.evaluate(() => {
  const bar = document.createElement('div')
  bar.id = 'demo-caption-buttons'
  bar.style.cssText = 'position:fixed;top:0;right:0;height:38px;display:flex;z-index:2147483647;pointer-events:none;background:#141416'
  // Segoe Fluent Icons: ChromeMinimize, ChromeMaximize, ChromeClose
  for (const glyph of [0xe921, 0xe922, 0xe8bb]) {
    const b = document.createElement('div')
    b.textContent = String.fromCharCode(glyph)
    b.style.cssText = "width:46px;height:38px;display:flex;align-items:center;justify-content:center;font:10px 'Segoe Fluent Icons','Segoe MDL2 Assets';color:#c8c8ce"
    bar.appendChild(b)
  }
  document.body.appendChild(bar)
})
await sleep(300)

// ---- record
const frames = []
const cdp = await win.context().newCDPSession(win)
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId: frame }) => {
  const file = `${String(frames.length).padStart(5, '0')}.png`
  fs.writeFileSync(path.join(outDir, file), Buffer.from(data, 'base64'))
  frames.push({ file, t: metadata.timestamp * 1000 })
  cdp.send('Page.screencastFrameAck', { sessionId: frame }).catch(() => {})
})
await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 2 })
// the screencast only sends repainted frames: repaint once (an invisible colour nudge) so it starts now
await win.evaluate(() => {
  document.getElementById('demo-caption-buttons').style.background = '#141417'
})
const started = Date.now()
await sleep(1800)

// Claude desktop starts on the prompt; Clauditor already follows the session (restored with the folder)
setStatus('busy')
say("I'll add an `--imperial` flag: parse it in the CLI entry point, convert the temperature in the formatter, then cover both units with tests.")
await sleep(2400)
await todos(['in_progress', 'pending', 'pending'])
await sleep(1000)
await read('src/index.ts')
await sleep(900)
await edit(
  'src/index.ts',
  "import { fetchWeather } from './weather.js'\nimport { formatReport } from './format.js'\n\nconst city = process.argv[2] ?? 'Jakarta'",
  "import { parseArgs } from 'node:util'\nimport { fetchWeather } from './weather.js'\nimport { formatReport } from './format.js'\n\nconst { values, positionals } = parseArgs({\n  allowPositionals: true,\n  options: { imperial: { type: 'boolean' } }\n})\nconst city = positionals[0] ?? 'Jakarta'\nconst units = values.imperial ? 'imperial' : 'metric'"
)
await sleep(2600)
await edit('src/index.ts', 'console.log(formatReport(city, weather))', 'console.log(formatReport(city, weather, units))')
await sleep(1800)
await todos(['completed', 'in_progress', 'pending'])
await sleep(900)
await read('src/format.ts')
await sleep(700)
await edit(
  'src/format.ts',
  'export function formatReport(city: string, w: Weather) {\n  return `${city}: ${w.tempC.toFixed(1)}°C, ${w.summary}`\n}',
  "export type Units = 'metric' | 'imperial'\n\nconst toF = (c: number) => (c * 9) / 5 + 32\n\nexport function formatReport(\n  city: string,\n  w: Weather,\n  units: Units = 'metric'\n) {\n  const temp = units === 'imperial' ? toF(w.tempC) : w.tempC\n  const unit = units === 'imperial' ? '°F' : '°C'\n  return `${city}: ${temp.toFixed(1)}${unit}, ${w.summary}`\n}"
)
await sleep(3000)
await todos(['completed', 'completed', 'in_progress'])
await sleep(900)
await write(
  'src/format.test.ts',
  "import { describe, expect, it } from 'vitest'\nimport { formatReport } from './format.js'\n\nconst sunny = { tempC: 30, summary: 'sunny' }\n\ndescribe('formatReport', () => {\n  it('uses Celsius by default', () => {\n    const out = formatReport('Jakarta', sunny)\n    expect(out).toBe('Jakarta: 30.0°C, sunny')\n  })\n\n  it('prints Fahrenheit with --imperial', () => {\n    const out = formatReport('Jakarta', sunny, 'imperial')\n    expect(out).toBe('Jakarta: 86.0°F, sunny')\n  })\n})\n"
)
// poster for the social preview: the new file just typed in, still highlighted, with Claude's caret
await sleep(1000)
await win.screenshot({ path: path.join(outDir, 'poster.png') })
await sleep(2200)
await bash('npm test', 'Run the test suite', ' ✓ src/format.test.ts (2 tests) 3ms\n\n Test Files  1 passed (1)\n      Tests  2 passed (2)\n   Duration  412ms')
await sleep(1200)
await todos(['completed', 'completed', 'completed'])
await sleep(900)
say('Done — `weather Jakarta --imperial` now prints Fahrenheit.\n\n- **src/index.ts** parses the flag with `parseArgs`\n- **src/format.ts** converts °C to °F\n- **src/format.test.ts** covers both units (2 tests pass)')
await sleep(700)
setStatus('idle')
await sleep(3500)

await cdp.send('Page.stopScreencast')
await sleep(300)
fs.writeFileSync(path.join(outDir, 'frames.json'), JSON.stringify({ width: WIDTH, height: HEIGHT, frames }, null, 1))
console.log(`${frames.length} frames over ${((Date.now() - started) / 1000).toFixed(1)}s → ${outDir}`)

const closed = await Promise.race([app.close().then(() => true), sleep(8000).then(() => false)]).catch(() => false)
if (!closed) await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
try {
  fs.rmSync(root, { recursive: true, force: true })
} catch {
  /* Windows may hold the folder briefly */
}
