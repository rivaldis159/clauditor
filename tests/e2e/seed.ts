// Seeds a realistic Claude Code session (and git repo) into a launched harness.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const FORM_BEFORE = `export interface Pendaftaran {
  nama: string
  email: string
}

export function kirim(data: Pendaftaran) {
  return fetch('/api/daftar', { method: 'POST', body: JSON.stringify(data) })
}
`

const FORM_AFTER = `import { emailValid } from './validasi'

export interface Pendaftaran {
  nama: string
  email: string
}

export function kirim(data: Pendaftaran) {
  if (!emailValid(data.email)) throw new Error('Email tidak valid')
  return fetch('/api/daftar', { method: 'POST', body: JSON.stringify(data) })
}
`

const VALIDASI = `/** Validasi alamat email sederhana untuk formulir pendaftaran. */
export function emailValid(email: string): boolean {
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email.trim())
}
`

function git(cwd: string, ...args: string[]) {
  execFileSync('git', ['-c', 'user.name=Clauditor', '-c', 'user.email=clauditor@example.invalid', ...args], { cwd, stdio: 'ignore' })
}

export function seedGitRepo(workspace: string): void {
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true })
  fs.writeFileSync(path.join(workspace, 'src', 'form.ts'), FORM_BEFORE)
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Formulir Pendaftaran\n\nContoh proyek untuk Clauditor.\n')
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'formulir', version: '1.0.0', scripts: { test: 'vitest run' } }, null, 2) + '\n')
  git(workspace, 'init', '-q', '-b', 'main')
  git(workspace, 'add', '-A')
  git(workspace, 'commit', '-q', '-m', 'Awal proyek')
}

export function seedRichSession(h: { workspace: string; home: string; sessionId: string; transcript: string; append(rec: Record<string, unknown>): void }): void {
  const ws = h.workspace
  const form = path.join(ws, 'src', 'form.ts')
  const validasi = path.join(ws, 'src', 'validasi.ts')
  let n = 100
  const tool = (name: string, input: Record<string, unknown>, text: string, toolUseResult?: unknown, isError = false) => {
    const id = `toolu_seed_${++n}`
    h.append({ type: 'assistant', message: { id: `msg_s${n}`, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }], usage: { input_tokens: 1200, output_tokens: 180, cache_read_input_tokens: 24000 } } })
    h.append({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }] }, toolUseResult })
    return id
  }
  const say = (text: string) => h.append({ type: 'assistant', message: { id: `msg_t${++n}`, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], usage: { input_tokens: 900, output_tokens: 240 } } })
  const think = (text: string) => h.append({ type: 'assistant', message: { id: `msg_k${++n}`, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: text, signature: 'x' }] } })

  h.append({ type: 'user', message: { role: 'user', content: 'Tambahkan validasi email di formulir pendaftaran, lalu jalankan tesnya.' } })
  think('Saya perlu melihat struktur proyek dan fungsi kirim() sebelum menambahkan validasi. Validasi sebaiknya di modul terpisah agar mudah dites.')
  say('Baik — saya periksa dulu struktur proyeknya.')
  tool('Glob', { pattern: 'src/**/*.ts' }, 'src\\form.ts', { filenames: ['src\\form.ts'], numFiles: 1, durationMs: 12, truncated: false })
  tool('Read', { file_path: form }, FORM_BEFORE, { type: 'text', file: { filePath: form, content: FORM_BEFORE, numLines: 8, startLine: 1, totalLines: 8 } })
  tool(
    'TodoWrite',
    {
      todos: [
        { content: 'Buat modul validasi email', status: 'completed', activeForm: 'Membuat modul validasi email' },
        { content: 'Panggil validasi di kirim()', status: 'in_progress', activeForm: 'Memanggil validasi di kirim()' },
        { content: 'Jalankan tes', status: 'pending', activeForm: 'Menjalankan tes' }
      ]
    },
    'Todos have been modified successfully.',
    { oldTodos: [], newTodos: [] }
  )
  // file-history backup of form.ts before the session touched it
  const backupName = `${randomUUID().slice(0, 16).replace(/-/g, '')}@v1`
  fs.mkdirSync(path.join(h.home, 'file-history', h.sessionId), { recursive: true })
  fs.writeFileSync(path.join(h.home, 'file-history', h.sessionId, backupName), FORM_BEFORE)
  h.append({
    type: 'file-history-snapshot',
    messageId: randomUUID(),
    snapshot: {
      messageId: randomUUID(),
      trackedFileBackups: {
        'src\\form.ts': { backupFileName: backupName, version: 1, backupTime: new Date().toISOString(), realParentDir: path.join(ws, 'src') },
        'src\\validasi.ts': { backupFileName: null, version: 1, backupTime: new Date().toISOString(), realParentDir: path.join(ws, 'src') }
      },
      timestamp: new Date().toISOString()
    },
    isSnapshotUpdate: false
  })
  fs.writeFileSync(validasi, VALIDASI)
  tool('Write', { file_path: validasi, content: VALIDASI }, `File created successfully at: ${validasi}`, { type: 'create', filePath: validasi, content: VALIDASI, structuredPatch: [], originalFile: null })
  fs.writeFileSync(form, FORM_AFTER)
  tool(
    'Edit',
    { file_path: form, old_string: "export interface Pendaftaran {", new_string: "import { emailValid } from './validasi'\n\nexport interface Pendaftaran {" },
    `The file ${form} has been updated successfully.`,
    {
      filePath: form,
      oldString: 'export interface Pendaftaran {',
      newString: "import { emailValid } from './validasi'\n\nexport interface Pendaftaran {",
      originalFile: FORM_BEFORE,
      structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 5, lines: ["+import { emailValid } from './validasi'", '+', ' export interface Pendaftaran {', '   nama: string', '   email: string'] }],
      userModified: false,
      replaceAll: false
    }
  )
  tool(
    'Bash',
    { command: 'npm test', description: 'Jalankan tes' },
    '',
    { stdout: '\n> formulir@1.0.0 test\n> vitest run\n\n ✓ validasi.test.ts (3 tests) 4ms\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)\n', stderr: '', interrupted: false, isImage: false }
  )
  tool('Grep', { pattern: 'emailValid', path: ws, output_mode: 'files_with_matches' }, 'Found 2 files', { mode: 'files_with_matches', filenames: ['src\\form.ts', 'src\\validasi.ts'], numFiles: 2 })
  // a subagent run
  const agentId = 'a1b2c3d4e5f6a7b8c'
  const taskId = tool('Task', { description: 'Tinjau keamanan validasi', subagent_type: 'Explore', prompt: 'Periksa apakah regex email aman dari ReDoS.' }, 'Regex aman: tidak ada kuantifier bersarang.', { agentId, status: 'completed' })
  const subDir = path.join(path.dirname(h.transcript), h.sessionId, 'subagents')
  fs.mkdirSync(subDir, { recursive: true })
  fs.writeFileSync(path.join(subDir, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: 'Explore', description: 'Tinjau keamanan validasi', toolUseId: taskId }))
  const sub = [
    { type: 'user', isSidechain: true, uuid: randomUUID(), timestamp: new Date().toISOString(), message: { role: 'user', content: 'Periksa apakah regex email aman dari ReDoS.' } },
    { type: 'assistant', isSidechain: true, uuid: randomUUID(), timestamp: new Date().toISOString(), message: { id: 'sm1', content: [{ type: 'tool_use', id: 'sub_t1', name: 'Read', input: { file_path: validasi } }] } },
    { type: 'user', isSidechain: true, uuid: randomUUID(), timestamp: new Date().toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: 'sub_t1', content: VALIDASI }] }, toolUseResult: { type: 'text', file: { filePath: validasi, numLines: 4 } } }
  ]
  fs.writeFileSync(path.join(subDir, `agent-${agentId}.jsonl`), sub.map((r) => JSON.stringify(r)).join('\n') + '\n')
  say(
    [
      'Selesai. Ringkasan perubahan:',
      '',
      '- **`src/validasi.ts`** — fungsi `emailValid()` baru.',
      '- **`src/form.ts`** — `kirim()` menolak email yang tidak valid.',
      '',
      '```ts',
      "if (!emailValid(data.email)) throw new Error('Email tidak valid')",
      '```',
      '',
      '| Tes | Hasil |',
      '|---|---|',
      '| validasi.test.ts | 3 lulus |'
    ].join('\n')
  )
  h.append({ type: 'cost-state', sessionId: h.sessionId, totalCostUSD: 0.42, totalLinesAdded: 9, totalLinesRemoved: 0 })
}
