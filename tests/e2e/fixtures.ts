// Test harness: a throw-away Claude home (~/.claude look-alike) with a fake live session,
// a workspace folder, and helpers that append transcript records exactly like Claude Code.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'

export interface Harness {
  root: string
  home: string
  workspace: string
  sessionId: string
  transcript: string
  app: ElectronApplication
  win: Page
  append(rec: Record<string, unknown>): void
  setStatus(status: 'busy' | 'idle'): void
  claudeWrite(file: string, content: string): Promise<void>
  /** `late`: the file changes before the tool call is logged (what Claude Code really does) */
  claudeEdit(file: string, oldString: string, newString: string, opts?: { late?: boolean }): Promise<void>
  close(): Promise<void>
}

const ts = () => new Date().toISOString()

export interface Probe {
  doc(p: string): { text: string; disk: string; dirty: boolean; conflict: boolean; pendingCreate: boolean } | null
  dirty(): string[]
  activeSession(): string | null
  follow(): boolean
  tabs(): { kind: string; title: string; active: boolean; preview: boolean }[]
  claudeDecorations(p: string): number
}

/** Evaluate a function against the renderer's window.__clauditor test hooks (null until booted). */
export function probe<T>(h: { win: Page }, fn: (t: Probe, arg: string) => T, arg = ''): Promise<T> {
  return h.win.evaluate(
    ([src, a]) => {
      const t = (window as unknown as { __clauditor?: unknown }).__clauditor
      return t ? new Function('t', 'a', `return (${src})(t, a)`)(t, a) : null
    },
    [fn.toString(), arg] as const
  ) as Promise<T>
}

export interface Seedable {
  workspace: string
  home: string
  sessionId: string
  transcript: string
  append(rec: Record<string, unknown>): void
}

export async function launch(
  opts: {
    files?: Record<string, string>
    status?: 'busy' | 'idle'
    title?: string
    settings?: Record<string, unknown>
    beforeLaunch?: (s: Seedable) => void
  } = {}
): Promise<Harness> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clauditor-e2e-'))
  const home = path.join(root, 'claude-home')
  const workspace = path.join(root, 'proyek-demo')
  const userData = path.join(root, 'userdata')
  for (const d of [home, workspace, userData, path.join(home, 'sessions'), path.join(home, 'ide')]) fs.mkdirSync(d, { recursive: true })
  for (const [name, content] of Object.entries(opts.files ?? {})) {
    fs.mkdirSync(path.dirname(path.join(workspace, name)), { recursive: true })
    fs.writeFileSync(path.join(workspace, name), content)
  }
  const sessionId = randomUUID()
  const slug = workspace.replace(/[^A-Za-z0-9]/g, '-')
  fs.mkdirSync(path.join(home, 'projects', slug), { recursive: true })
  const transcript = path.join(home, 'projects', slug, `${sessionId}.jsonl`)
  const base = { sessionId, cwd: workspace, version: '2.1.295', entrypoint: 'claude-desktop', gitBranch: '' }
  let parent: string | null = null
  const append = (rec: Record<string, unknown>) => {
    const uuid = randomUUID()
    fs.appendFileSync(transcript, `${JSON.stringify({ parentUuid: parent, isSidechain: false, uuid, timestamp: ts(), ...base, ...rec })}\n`)
    parent = uuid
  }
  append({ type: 'user', message: { role: 'user', content: 'Buat halaman demo untuk Clauditor' } })
  append({ type: 'custom-title', customTitle: opts.title ?? 'Sesi demo Clauditor' })
  const registry = path.join(home, 'sessions', `${process.pid}.json`)
  const setStatus = (status: 'busy' | 'idle') =>
    fs.writeFileSync(
      registry,
      JSON.stringify({
        pid: process.pid,
        sessionId,
        cwd: workspace,
        startedAt: Date.now() - 60_000,
        version: '2.1.295',
        kind: 'interactive',
        entrypoint: 'claude-desktop',
        hostSessionId: 'local_e2e',
        name: opts.title ?? 'Sesi demo Clauditor',
        status,
        statusUpdatedAt: Date.now()
      })
    )
  setStatus(opts.status ?? 'busy')
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ theme: 'dark', ...(opts.settings ?? {}) }))
  opts.beforeLaunch?.({ workspace, home, sessionId, transcript, append })

  const app = await electron.launch({
    executablePath: path.resolve('node_modules/electron/dist/electron.exe'),
    args: ['.'],
    env: { ...process.env, CLAUDITOR_CLAUDE_HOME: home, CLAUDITOR_USER_DATA: userData, CLAUDITOR_OPEN_FOLDER: workspace },
    timeout: 60_000
  })
  const win = await app.firstWindow()
  const logPath = path.join(root, 'renderer.log')
  win.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') fs.appendFileSync(logPath, `[${m.type()}] ${m.text()}\n`)
  })
  win.on('pageerror', (e) => {
    fs.appendFileSync(logPath, `[pageerror] ${e.message}\n${e.stack ?? ''}\n`)
    console.log(`[renderer pageerror] ${e.message}\n${e.stack ?? ''}`)
  })
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0]
    bw.unmaximize()
    bw.setSize(1500, 920)
  })

  let n = 0
  const toolUse = (name: string, input: Record<string, unknown>) => {
    const id = `toolu_e2e_${++n}`
    append({ type: 'assistant', message: { id: `msg_${n}`, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }], usage: { input_tokens: 10, output_tokens: 20 } } })
    return id
  }
  const toolResult = (id: string, text: string, toolUseResult: unknown) =>
    append({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, toolUseResult })

  return {
    root,
    home,
    workspace,
    sessionId,
    transcript,
    app,
    win,
    append,
    setStatus,
    async claudeWrite(file, content) {
      const abs = path.join(workspace, file)
      const existed = fs.existsSync(abs)
      const original = existed ? fs.readFileSync(abs, 'utf8') : null
      const id = toolUse('Write', { file_path: abs, content })
      await new Promise((r) => setTimeout(r, 700))
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, content)
      toolResult(id, `File created successfully at: ${abs}`, { type: existed ? 'update' : 'create', filePath: abs, content, structuredPatch: [], originalFile: original })
    },
    async claudeEdit(file, oldString, newString, editOpts = {}) {
      const abs = path.join(workspace, file)
      const before = fs.readFileSync(abs, 'utf8')
      const after = before.replace(oldString, newString)
      let id: string
      if (editOpts.late) {
        fs.writeFileSync(abs, after)
        await new Promise((r) => setTimeout(r, 300))
        id = toolUse('Edit', { file_path: abs, old_string: oldString, new_string: newString })
      } else {
        id = toolUse('Edit', { file_path: abs, old_string: oldString, new_string: newString })
        await new Promise((r) => setTimeout(r, 500))
        fs.writeFileSync(abs, after)
      }
      const startLine = before.slice(0, before.indexOf(oldString)).split('\n').length
      const oldLines = oldString.split('\n')
      const newLines = newString.split('\n')
      toolResult(id, `The file ${abs} has been updated successfully.`, {
        filePath: abs,
        oldString,
        newString,
        originalFile: null,
        replaceAll: false,
        userModified: false,
        structuredPatch: [{ oldStart: startLine, oldLines: oldLines.length, newStart: startLine, newLines: newLines.length, lines: [...oldLines.map((l) => `-${l}`), ...newLines.map((l) => `+${l}`)] }]
      })
    },
    async close() {
      // a "save changes?" dialog would block a graceful close; tests never want to wait for it
      const closed = await Promise.race([app.close().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 8000))]).catch(() => false)
      if (!closed) await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
      try {
        fs.rmSync(root, { recursive: true, force: true })
      } catch {
        /* files may still be locked briefly on Windows */
      }
    }
  }
}
