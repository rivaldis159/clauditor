// Claude Code IDE integration server. Claude Code discovers IDEs through lock files in
// ~/.claude/ide/<port>.lock and connects over WebSocket (subprotocol "mcp") with the header
// X-Claude-Code-Ide-Authorization. The IDE exposes MCP tools (openDiff, getDiagnostics, …)
// and pushes selection_changed / at_mentioned notifications.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import type { IdeBridgeStatus, IdeDiagnosticFile, IdeEditorState, IdeSelection } from '@shared/types'
import { t } from '../i18n'

interface Client {
  id: string
  ws: WebSocket
  connectedAt: number
  pid: number | null
}

type Content = { type: 'text'; text: string }[]

interface PendingDiff {
  tabName: string
  filePath: string
  resolve: (c: Content) => void
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required })

const TOOLS = [
  {
    name: 'openFile',
    description: 'Open a file in the editor and optionally select a range of text',
    inputSchema: obj(
      {
        filePath: { type: 'string', description: 'Path to the file to open' },
        preview: { type: 'boolean', description: 'Whether to open the file in preview mode' },
        startText: { type: 'string', description: 'Text pattern to find the start of the selection range' },
        endText: { type: 'string', description: 'Text pattern to find the end of the selection range' },
        selectToEndOfLine: { type: 'boolean' },
        makeFrontmost: { type: 'boolean' }
      },
      ['filePath']
    )
  },
  {
    name: 'openDiff',
    description: 'Open a diff view comparing the current file with proposed new contents and wait for the user to accept or reject it',
    inputSchema: obj(
      {
        old_file_path: { type: 'string' },
        new_file_path: { type: 'string' },
        new_file_contents: { type: 'string' },
        tab_name: { type: 'string' }
      },
      ['old_file_path', 'new_file_path', 'new_file_contents', 'tab_name']
    )
  },
  { name: 'getCurrentSelection', description: 'Get the current text selection in the active editor', inputSchema: obj({}) },
  { name: 'getLatestSelection', description: 'Get the most recent text selection, even if the editor lost focus', inputSchema: obj({}) },
  { name: 'getOpenEditors', description: 'Get the list of open editor tabs', inputSchema: obj({}) },
  { name: 'getWorkspaceFolders', description: 'Get the workspace folders open in the editor', inputSchema: obj({}) },
  {
    name: 'getDiagnostics',
    description: 'Get language diagnostics (errors, warnings) from the editor',
    inputSchema: obj({ uri: { type: 'string', description: 'Optional file URI; omit for all files' } })
  },
  { name: 'checkDocumentDirty', description: 'Check whether a document has unsaved changes', inputSchema: obj({ filePath: { type: 'string' } }, ['filePath']) },
  { name: 'saveDocument', description: 'Save a document with unsaved changes', inputSchema: obj({ filePath: { type: 'string' } }, ['filePath']) },
  { name: 'close_tab', description: 'Close a tab by name', inputSchema: obj({ tab_name: { type: 'string' } }, ['tab_name']) },
  { name: 'closeAllDiffTabs', description: 'Close all diff tabs opened by Claude', inputSchema: obj({}) }
]

const text = (t: string): Content => [{ type: 'text', text: t }]
const json = (v: unknown): Content => text(JSON.stringify(v, null, 2))

export function uriToPath(uri: string): string {
  let p = uri.replace(/^file:\/\//i, '')
  try {
    p = decodeURIComponent(p)
  } catch {
    /* keep raw */
  }
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
  return path.normalize(p)
}

const fileUri = (p: string) => pathToFileURL(p).href
const same = (a: string, b: string) => path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()

export class IdeBridge extends EventEmitter {
  private wss: WebSocketServer | null = null
  private port: number | null = null
  private token = randomUUID()
  private lockFile: string | null = null
  private clients = new Map<string, Client>()
  private folders: string[] = []
  private selection: IdeSelection | null = null
  private latestSelection: IdeSelection | null = null
  private selectionTimer: NodeJS.Timeout | null = null
  private diagnostics: IdeDiagnosticFile[] = []
  private editors: IdeEditorState = { openEditors: [], dirty: [] }
  private pendingDiffs = new Map<string, PendingDiff>()
  private pendingSaves = new Map<string, (ok: boolean) => void>()
  private error: string | null = null

  constructor(
    private readonly claudeHome: string,
    private readonly version: string
  ) {
    super()
  }

  get running(): boolean {
    return this.wss !== null
  }

  get activePort(): number | null {
    return this.port
  }

  status(): IdeBridgeStatus {
    return {
      enabled: this.running,
      port: this.port,
      lockFile: this.lockFile,
      clients: [...this.clients.values()].map((c) => ({ id: c.id, connectedAt: c.connectedAt, pid: c.pid })),
      error: this.error
    }
  }

  private emitStatus(): void {
    this.emit('status', this.status())
  }

  start(): Promise<void> {
    if (this.wss) return Promise.resolve()
    return new Promise((resolve) => {
      const wss = new WebSocketServer({
        host: '127.0.0.1',
        port: 0,
        maxPayload: 64 * 1024 * 1024,
        handleProtocols: (protocols) => (protocols.has('mcp') ? 'mcp' : false),
        verifyClient: (info, cb) => {
          const header = info.req.headers['x-claude-code-ide-authorization']
          const ok = (Array.isArray(header) ? header[0] : header) === this.token
          if (ok) cb(true)
          else cb(false, 401, 'Unauthorized')
        }
      })
      wss.on('listening', () => {
        const addr = wss.address()
        this.port = typeof addr === 'object' && addr ? addr.port : null
        this.wss = wss
        this.error = null
        this.writeLock()
        this.emitStatus()
        resolve()
      })
      wss.on('error', (err) => {
        this.error = err.message
        this.emitStatus()
        resolve()
      })
      wss.on('connection', (ws) => this.onConnection(ws))
    })
  }

  stop(): void {
    for (const c of this.clients.values()) c.ws.close()
    this.clients.clear()
    for (const d of this.pendingDiffs.values()) d.resolve(text('TAB_CLOSED'))
    this.pendingDiffs.clear()
    this.wss?.close()
    this.wss = null
    this.removeLock()
    this.port = null
    this.emitStatus()
  }

  setFolders(folders: string[]): void {
    this.folders = folders
    if (this.wss) this.writeLock()
  }

  private writeLock(): void {
    if (!this.port) return
    const dir = path.join(this.claudeHome, 'ide')
    try {
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `${this.port}.lock`)
      const body = {
        pid: process.pid,
        workspaceFolders: this.folders,
        ideName: 'Clauditor',
        transport: 'ws',
        runningInWindows: process.platform === 'win32',
        authToken: this.token
      }
      fs.writeFileSync(file, JSON.stringify(body), 'utf8')
      this.lockFile = file
    } catch (err) {
      this.error = t('Cannot write the lock file: {error}', { error: (err as Error).message })
    }
  }

  private removeLock(): void {
    if (!this.lockFile) return
    try {
      fs.unlinkSync(this.lockFile)
    } catch {
      /* already gone */
    }
    this.lockFile = null
  }

  private onConnection(ws: WebSocket): void {
    const client: Client = { id: randomUUID(), ws, connectedAt: Date.now(), pid: null }
    this.clients.set(client.id, client)
    this.emitStatus()
    ws.on('message', (data) => {
      let msg: unknown
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }
      const list = Array.isArray(msg) ? msg : [msg]
      for (const m of list) void this.onMessage(client, m as Record<string, any>)
    })
    ws.on('close', () => {
      this.clients.delete(client.id)
      this.emitStatus()
    })
    ws.on('error', () => {})
  }

  private send(client: Client, payload: unknown): void {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(payload))
  }

  private broadcast(method: string, params: unknown): number {
    let n = 0
    for (const c of this.clients.values()) {
      this.send(c, { jsonrpc: '2.0', method, params })
      n++
    }
    return n
  }

  private async onMessage(client: Client, msg: Record<string, any>): Promise<void> {
    if (!msg || typeof msg.method !== 'string') return
    const isRequest = msg.id !== undefined && msg.id !== null
    if (!isRequest) {
      if (msg.method === 'ide_connected' && typeof msg.params?.pid === 'number') {
        client.pid = msg.params.pid
        this.emitStatus()
      }
      return
    }
    try {
      const result = await this.request(msg.method, msg.params ?? {})
      this.send(client, { jsonrpc: '2.0', id: msg.id, result })
    } catch (err) {
      const e = err as { code?: number; message?: string }
      this.send(client, { jsonrpc: '2.0', id: msg.id, error: { code: e.code ?? -32603, message: e.message ?? String(err) } })
    }
  }

  private async request(method: string, params: Record<string, any>): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
          capabilities: { tools: { listChanged: true }, logging: {} },
          serverInfo: { name: 'clauditor', title: 'Clauditor', version: this.version }
        }
      case 'ping':
      case 'logging/setLevel':
        return {}
      case 'tools/list':
        return { tools: TOOLS }
      case 'resources/list':
        return { resources: [] }
      case 'resources/templates/list':
        return { resourceTemplates: [] }
      case 'prompts/list':
        return { prompts: [] }
      case 'tools/call': {
        const content = await this.callTool(String(params.name), params.arguments ?? {})
        return { content }
      }
      default:
        throw { code: -32601, message: `Method not found: ${method}` }
    }
  }

  private selectionPayload(sel: IdeSelection | null) {
    if (!sel) return { success: false, message: 'No active editor found' }
    return {
      success: true,
      text: sel.text,
      filePath: sel.filePath,
      fileUrl: fileUri(sel.filePath),
      selection: { start: sel.start, end: sel.end, isEmpty: sel.isEmpty }
    }
  }

  private async callTool(name: string, args: Record<string, any>): Promise<Content> {
    switch (name) {
      case 'openFile': {
        const filePath = String(args.filePath ?? '')
        this.emit('openFile', {
          filePath,
          startText: typeof args.startText === 'string' ? args.startText : undefined,
          endText: typeof args.endText === 'string' ? args.endText : undefined,
          preview: !!args.preview
        })
        return text(`Opened file: ${filePath}`)
      }
      case 'openDiff':
        return new Promise<Content>((resolve) => {
          const requestId = randomUUID()
          const filePath = String(args.old_file_path ?? args.new_file_path ?? '')
          const tabName = String(args.tab_name ?? path.basename(filePath))
          this.pendingDiffs.set(requestId, { tabName, filePath, resolve })
          this.emit('openDiff', { requestId, filePath, newContents: String(args.new_file_contents ?? ''), tabName })
        })
      case 'close_tab': {
        const tabName = String(args.tab_name ?? '')
        for (const [id, d] of this.pendingDiffs) {
          if (d.tabName === tabName) {
            this.pendingDiffs.delete(id)
            d.resolve(text('TAB_CLOSED'))
          }
        }
        this.emit('closeTab', { tabName })
        return text('TAB_CLOSED')
      }
      case 'closeAllDiffTabs': {
        const n = this.pendingDiffs.size
        for (const d of this.pendingDiffs.values()) d.resolve(text('TAB_CLOSED'))
        this.pendingDiffs.clear()
        this.emit('closeAllDiffs')
        return text(`CLOSED_${n}_DIFF_TABS`)
      }
      case 'getDiagnostics': {
        if (typeof args.uri === 'string' && args.uri) {
          const target = uriToPath(args.uri)
          const match = this.diagnostics.filter((d) => same(uriToPath(d.uri), target))
          return json(match.length ? match : [{ uri: fileUri(target), diagnostics: [] }])
        }
        return json(this.diagnostics)
      }
      case 'getCurrentSelection':
        return json(this.selectionPayload(this.selection))
      case 'getLatestSelection':
        return json(this.selectionPayload(this.latestSelection ?? this.selection))
      case 'getOpenEditors':
        return json({
          tabs: this.editors.openEditors.map((e) => ({
            uri: fileUri(e.filePath),
            isActive: e.isActive,
            label: path.basename(e.filePath),
            languageId: e.languageId,
            isDirty: e.isDirty
          }))
        })
      case 'getWorkspaceFolders':
        return json({
          success: true,
          folders: this.folders.map((f) => ({ name: path.basename(f), uri: fileUri(f), path: f })),
          rootPath: this.folders[0] ?? null
        })
      case 'checkDocumentDirty': {
        const fp = String(args.filePath ?? '')
        const open = this.editors.openEditors.some((e) => same(e.filePath, fp))
        if (!open) return json({ success: false, message: `Document not open: ${fp}` })
        return json({ success: true, filePath: fp, isDirty: this.editors.dirty.some((d) => same(d, fp)), isUntitled: false })
      }
      case 'saveDocument': {
        const fp = String(args.filePath ?? '')
        if (!this.editors.dirty.some((d) => same(d, fp))) return json({ success: true, filePath: fp, saved: false, message: 'Document has no unsaved changes' })
        const ok = await new Promise<boolean>((resolve) => {
          const requestId = randomUUID()
          this.pendingSaves.set(requestId, resolve)
          this.emit('saveDocument', { filePath: fp, requestId })
          setTimeout(() => {
            if (this.pendingSaves.delete(requestId)) resolve(false)
          }, 8000)
        })
        return json({ success: ok, filePath: fp, saved: ok, message: ok ? 'Document saved' : 'Failed to save document' })
      }
      default:
        throw { code: -32602, message: `Unknown tool: ${name}` }
    }
  }

  diffResult(requestId: string, r: { accepted: boolean; content?: string; closed?: boolean }): void {
    const d = this.pendingDiffs.get(requestId)
    if (!d) return
    this.pendingDiffs.delete(requestId)
    if (r.closed) d.resolve(text('TAB_CLOSED'))
    else if (r.accepted) d.resolve([{ type: 'text', text: 'FILE_SAVED' }, { type: 'text', text: r.content ?? '' }])
    else d.resolve([{ type: 'text', text: 'DIFF_REJECTED' }, { type: 'text', text: d.tabName }])
  }

  saved(requestId: string, ok: boolean): void {
    const r = this.pendingSaves.get(requestId)
    if (!r) return
    this.pendingSaves.delete(requestId)
    r(ok)
  }

  setSelection(sel: IdeSelection | null): void {
    this.selection = sel
    if (sel && !sel.isEmpty) this.latestSelection = sel
    if (this.selectionTimer) clearTimeout(this.selectionTimer)
    this.selectionTimer = setTimeout(() => {
      this.selectionTimer = null
      if (!this.clients.size || !sel) return
      this.broadcast('selection_changed', {
        text: sel.text,
        filePath: sel.filePath,
        fileUrl: fileUri(sel.filePath),
        selection: { start: sel.start, end: sel.end, isEmpty: sel.isEmpty }
      })
    }, 150)
  }

  setDiagnostics(files: IdeDiagnosticFile[]): void {
    this.diagnostics = files
  }

  setEditors(state: IdeEditorState): void {
    this.editors = state
  }

  atMention(filePath: string, lineStart?: number, lineEnd?: number): number {
    return this.broadcast('at_mentioned', { filePath, lineStart, lineEnd })
  }

  /** Environment that makes a `claude` started from Clauditor's terminal attach to this bridge. */
  terminalEnv(): Record<string, string> {
    if (!this.port) return {}
    return { CLAUDE_CODE_SSE_PORT: String(this.port), ENABLE_IDE_INTEGRATION: 'true' }
  }
}
