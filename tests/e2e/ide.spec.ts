// End-to-end check of the Claude Code IDE protocol: a WebSocket MCP client behaves like the
// Claude Code CLI (lock-file discovery, auth header, openDiff accept/reject, selection events).
import fs from 'node:fs'
import path from 'node:path'
import WebSocket from 'ws'
import { expect, test } from '@playwright/test'
import { launch, probe, type Harness } from './fixtures'

let h: Harness
test.afterEach(async () => {
  await h?.close()
})

interface Rpc {
  call(method: string, params?: unknown): Promise<any>
  notify(method: string, params?: unknown): void
  notifications: { method: string; params: any }[]
  close(): void
}

function connect(port: number, token: string): Promise<Rpc> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, ['mcp'], { headers: { 'X-Claude-Code-Ide-Authorization': token } })
    let id = 0
    const pending = new Map<number, (v: any) => void>()
    const notifications: Rpc['notifications'] = []
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)!(msg)
        pending.delete(msg.id)
      } else if (msg.method) notifications.push({ method: msg.method, params: msg.params })
    })
    ws.on('open', () =>
      resolve({
        call(method, params) {
          const n = ++id
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }))
          return new Promise((r) => pending.set(n, r))
        },
        notify(method, params) {
          ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }))
        },
        notifications,
        close: () => ws.close()
      })
    )
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
    ws.on('error', reject)
  })
}

test('Claude Code IDE bridge: discovery, openDiff accept/reject, workspace and selection', async () => {
  h = await launch({ files: { 'src/a.ts': 'export const a = 1\n' }, status: 'idle' })
  await expect.poll(() => probe(h, (t) => (t ? 'ready' : null))).toBe('ready')

  // lock file written for Claude Code to discover
  const ideDir = path.join(h.home, 'ide')
  await expect.poll(() => fs.readdirSync(ideDir).filter((f) => f.endsWith('.lock')).length).toBe(1)
  const lockName = fs.readdirSync(ideDir).find((f) => f.endsWith('.lock'))!
  const lock = JSON.parse(fs.readFileSync(path.join(ideDir, lockName), 'utf8'))
  const port = Number(lockName.replace('.lock', ''))
  expect(lock.ideName).toBe('Clauditor')
  expect(lock.transport).toBe('ws')
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(ideDir, lockName), 'utf8')).workspaceFolders).toContain(h.workspace)

  // wrong token is refused
  await expect(connect(port, 'salah')).rejects.toThrow(/401/)

  const rpc = await connect(port, lock.authToken)
  const init = await rpc.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: 'test' } })
  expect(init.result.serverInfo.name).toBe('clauditor')
  rpc.notify('notifications/initialized')
  rpc.notify('ide_connected', { pid: 4242 })
  const tools = await rpc.call('tools/list', {})
  const names = tools.result.tools.map((t: { name: string }) => t.name)
  expect(names).toEqual(expect.arrayContaining(['openDiff', 'openFile', 'getDiagnostics', 'getCurrentSelection', 'getWorkspaceFolders', 'close_tab', 'closeAllDiffTabs']))
  await expect(h.win.locator('.sb-ide')).toHaveText(/IDE · 1/)

  const folders = await rpc.call('tools/call', { name: 'getWorkspaceFolders', arguments: {} })
  expect(JSON.parse(folders.result.content[0].text).folders[0].path).toBe(h.workspace)

  // openDiff → accept (after tweaking nothing)
  const file = path.join(h.workspace, 'src', 'a.ts')
  const accepted = rpc.call('tools/call', { name: 'openDiff', arguments: { old_file_path: file, new_file_path: file, new_file_contents: 'export const a = 2\n', tab_name: 'a.ts (Claude)' } })
  await expect(h.win.locator('.ide-proposal')).toBeVisible()
  await h.win.screenshot({ path: 'test-results/ide-diff.png' })
  await h.win.locator('.ide-proposal .btn-primary').click()
  const res1 = await accepted
  expect(res1.result.content[0].text).toBe('FILE_SAVED')
  expect(res1.result.content[1].text).toBe('export const a = 2\n')
  await expect(h.win.locator('.ide-proposal')).toHaveCount(0)

  // openDiff → reject
  const rejected = rpc.call('tools/call', { name: 'openDiff', arguments: { old_file_path: file, new_file_path: file, new_file_contents: 'export const a = 3\n', tab_name: 'a.ts (Claude 2)' } })
  await expect(h.win.locator('.ide-proposal')).toBeVisible()
  await h.win.locator('.ide-proposal .btn-danger').click()
  const res2 = await rejected
  expect(res2.result.content[0].text).toBe('DIFF_REJECTED')

  // openFile + selection notifications reach the client
  await rpc.call('tools/call', { name: 'openFile', arguments: { filePath: file, startText: 'const', endText: 'a' } })
  await expect.poll(() => probe(h, (t) => t.tabs().find((x) => x.active)?.title ?? '')).toBe('a.ts')
  await h.win.locator('.code-host .view-lines').first().click()
  await h.win.keyboard.press('Control+A')
  await expect.poll(() => rpc.notifications.some((n) => n.method === 'selection_changed' && String(n.params?.filePath ?? '').endsWith('a.ts'))).toBe(true)
  const sel = await rpc.call('tools/call', { name: 'getCurrentSelection', arguments: {} })
  expect(JSON.parse(sel.result.content[0].text).success).toBe(true)
  rpc.close()
})
