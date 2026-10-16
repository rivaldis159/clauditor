// Runs Claude Code sessions from inside Clauditor through the official Agent SDK, using the same
// claude.exe that Claude desktop ships. Transcripts land in ~/.claude/projects like any other
// session, so the observer pipeline renders them; this service adds live token streaming and
// interactive permission prompts.
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import type {
  ClaudeAuthStatus,
  ContextUsage,
  Effort,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  PermissionSuggestionLite,
  PromptInput,
  RunnerInfo,
  RunnerStartOptions,
  RunnerStreamUpdate,
  StreamBlock
} from '@shared/types'
import { t } from '../../i18n'
import type { Sdk } from './sdk'

type Query = import('@anthropic-ai/claude-agent-sdk').Query
type SDKUserMessage = import('@anthropic-ai/claude-agent-sdk').SDKUserMessage
type PermissionResult = import('@anthropic-ai/claude-agent-sdk').PermissionResult
type PermissionUpdate = import('@anthropic-ai/claude-agent-sdk').PermissionUpdate

class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private waiters: ((r: IteratorResult<T>) => void)[] = []
  private closed = false

  push(item: T): void {
    if (this.closed) return
    const w = this.waiters.shift()
    if (w) w({ value: item, done: false })
    else this.items.push(item)
  }

  close(): void {
    this.closed = true
    for (const w of this.waiters) w({ value: undefined as never, done: true })
    this.waiters = []
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift() as T, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      }
    }
  }
}

interface Pending {
  req: PermissionRequest
  suggestions: PermissionUpdate[]
  resolve: (r: PermissionResult) => void
}

interface StreamMsg {
  messageId: string
  blocks: StreamBlock[]
}

interface Run {
  info: RunnerInfo
  queue: AsyncQueue<SDKUserMessage>
  query: Query | null
  abort: AbortController
  pending: Map<string, Pending>
  stream: StreamMsg | null
  streamTimer: NodeJS.Timeout | null
  stderr: string
}

function userMessage(p: PromptInput): SDKUserMessage {
  const content: Record<string, unknown>[] = []
  for (const img of p.images ?? []) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })
  }
  if (p.text.trim()) content.push({ type: 'text', text: p.text })
  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    origin: { kind: 'human' }
  } as unknown as SDKUserMessage
}

function describeSuggestion(s: PermissionUpdate): string {
  const any = s as Record<string, any>
  switch (any.type) {
    case 'addRules': {
      const rules = (any.rules ?? []).map((r: { toolName: string; ruleContent?: string }) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName)).join(', ')
      const deny = any.behavior === 'deny'
      if (any.destination === 'session') return deny ? t('Deny {rules} for this session', { rules }) : t('Allow {rules} for this session', { rules })
      if (any.destination === 'localSettings') return deny ? t('Deny {rules} in this project', { rules }) : t('Allow {rules} in this project', { rules })
      return deny ? t('Always deny {rules}', { rules }) : t('Always allow {rules}', { rules })
    }
    case 'setMode':
      return t('Switch mode to {mode}', { mode: String(any.mode) })
    case 'addDirectories':
      return t('Allow access to {dirs}', { dirs: (any.directories ?? []).join(', ') })
    default:
      return any.type ? String(any.type) : t('Permission rule')
  }
}

const AUTH_ERROR = /failed to authenticate|authentication[_ ]error|oauth (session|token)|not logged in|invalid (api key|x-api-key|bearer)|run \/login|\b401\b|unauthori[sz]ed/i

type RawContextUsage = {
  model?: string
  totalTokens?: number
  maxTokens?: number
  rawMaxTokens?: number
  percentage?: number
  autoCompactThreshold?: number
  isAutoCompactEnabled?: boolean
  categories?: { name?: string; tokens?: number; kind?: string }[]
  memoryFiles?: { path?: string; type?: string; tokens?: number }[]
}

/** Claude Code's /context numbers in the shape the UI shows. */
export function toContextUsage(u: RawContextUsage, at = Date.now()): ContextUsage | null {
  const limit = Number(u.rawMaxTokens || u.maxTokens) || 0
  const used = Number(u.totalTokens) || 0
  if (!limit) return null
  const kinds = new Set(['used', 'free', 'buffer', 'deferred'])
  return {
    model: String(u.model ?? ''),
    used,
    limit,
    percent: typeof u.percentage === 'number' ? u.percentage : Math.round((used / limit) * 100),
    autoCompactAt: u.isAutoCompactEnabled && u.autoCompactThreshold ? u.autoCompactThreshold : null,
    autoCompactEnabled: !!u.isAutoCompactEnabled,
    categories: (u.categories ?? [])
      .filter((c) => (c.tokens ?? 0) > 0 && kinds.has(String(c.kind)))
      .map((c) => ({ name: String(c.name ?? ''), tokens: Number(c.tokens) || 0, kind: c.kind as ContextUsage['categories'][number]['kind'] })),
    memoryFiles: (u.memoryFiles ?? []).filter((f) => f.path).map((f) => ({ path: String(f.path), type: String(f.type ?? ''), tokens: Number(f.tokens) || 0 })),
    measuredAt: at
  }
}

export function loginHint(): string {
  return t('Claude Code in Clauditor is not signed in, or its login has expired. Click "Sign in" to log in once in a terminal. Sessions from Claude desktop can still be followed without signing in.')
}

/** One readable paragraph out of an SDK error: no ANSI codes, no minified-source dumps. */
export function clipError(text: string, max = 600): string {
  const lines = text
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && l.length < 400 && !/^at\s/.test(l))
  let out = ''
  for (const l of lines) {
    if (out.length + l.length + 1 > max) break
    out += (out ? '\n' : '') + l
  }
  return out || text.trim().slice(0, max)
}

export class ClaudeRunner extends EventEmitter {
  private runs = new Map<string, Run>()
  private auth: ClaudeAuthStatus | null = null
  private authCheck: Promise<ClaudeAuthStatus> | null = null

  constructor(
    private readonly executable: () => string | null,
    private readonly extraEnv: () => Record<string, string>,
    /** the Agent SDK in use: bundled, or synced to Claude desktop's Claude Code version */
    private readonly loadSdk: () => Promise<Sdk>,
    /** the Claude data folder Clauditor reads (~/.claude unless overridden) */
    private readonly claudeHome: string = path.join(os.homedir(), '.claude')
  ) {
    super()
  }

  /**
   * Copies a session into a new one (fresh ids, records marked `forkedFrom`) so Clauditor can
   * continue it without writing into a transcript another app owns. Pure file work, no model call.
   */
  private async fork(sdk: Sdk, sessionId: string, cwd: string, title: string | undefined): Promise<string> {
    // the SDK reads CLAUDE_CONFIG_DIR at call time; point it at the folder Clauditor reads
    const before = process.env.CLAUDE_CONFIG_DIR
    const swap = path.resolve(before ?? path.join(os.homedir(), '.claude')) !== path.resolve(this.claudeHome)
    if (swap) process.env.CLAUDE_CONFIG_DIR = this.claudeHome
    try {
      try {
        return (await sdk.forkSession(sessionId, { dir: cwd, title })).sessionId
      } catch {
        // the transcript may sit under another project folder name: search them all
        return (await sdk.forkSession(sessionId, { title })).sessionId
      }
    } finally {
      if (swap) {
        if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR
        else process.env.CLAUDE_CONFIG_DIR = before
      }
    }
  }

  /** True while any run is alive; the SDK is only swapped between runs. */
  get busy(): boolean {
    return [...this.runs.values()].some((r) => r.info.state !== 'stopped' && r.info.state !== 'error')
  }

  private childEnv(): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
    delete env.ELECTRON_RUN_AS_NODE
    return Object.assign(env, this.extraEnv())
  }

  private setAuth(next: ClaudeAuthStatus): void {
    const changed = next.loggedIn !== this.auth?.loggedIn || next.method !== this.auth?.method
    this.auth = next
    if (changed) this.emit('auth', { ...next })
  }

  /** Asks the CLI itself (`claude auth status`), so it matches what a run will see. */
  authStatus(force = false): Promise<ClaudeAuthStatus> {
    if (!force && this.auth && Date.now() - this.auth.checkedAt < 60_000) return Promise.resolve(this.auth)
    if (this.authCheck) return this.authCheck
    const exe = this.executable()
    if (!exe) {
      this.setAuth({ loggedIn: null, method: null, checkedAt: Date.now() })
      return Promise.resolve(this.auth!)
    }
    this.authCheck = new Promise<ClaudeAuthStatus>((resolve) => {
      // exits 1 when signed out but still prints the JSON status
      execFile(exe, ['auth', 'status', '--json'], { windowsHide: true, timeout: 20_000, env: this.childEnv() }, (_err, stdout) => {
        let status: ClaudeAuthStatus = { loggedIn: null, method: null, checkedAt: Date.now() }
        const out = String(stdout ?? '')
        try {
          const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as { loggedIn?: unknown; authMethod?: unknown }
          if (typeof j.loggedIn === 'boolean') {
            status = { loggedIn: j.loggedIn, method: typeof j.authMethod === 'string' && j.authMethod !== 'none' ? j.authMethod : null, checkedAt: Date.now() }
          }
        } catch {
          /* older CLI without `auth status` */
        }
        this.setAuth(status)
        resolve(status)
      })
    }).finally(() => {
      this.authCheck = null
    })
    return this.authCheck
  }

  list(): RunnerInfo[] {
    return [...this.runs.values()].map((r) => r.info)
  }

  pending(): PermissionRequest[] {
    return [...this.runs.values()].flatMap((r) => [...r.pending.values()].map((p) => p.req))
  }

  private emitState(run: Run): void {
    this.emit('state', { ...run.info })
  }

  async start(opts: RunnerStartOptions): Promise<RunnerInfo> {
    const exe = this.executable()
    if (!exe) throw new Error(t('Claude Code was not found. Install Claude desktop or set the location of claude.exe in Settings.'))
    const sdk = await this.loadSdk()
    const runId = randomUUID()
    const mode: PermissionMode = opts.permissionMode ?? 'default'
    let resume = opts.resumeSessionId || undefined
    let forkOnStart = false
    if (resume && opts.fork) {
      // a copy keeps the source transcript (e.g. Claude desktop's) untouched
      if (typeof sdk.forkSession === 'function') resume = await this.fork(sdk, resume, opts.cwd, opts.forkTitle)
      else forkOnStart = true // older SDK: the CLI makes the copy when the run starts
    }
    const run: Run = {
      info: {
        runId,
        sessionId: forkOnStart ? null : (resume ?? null),
        cwd: opts.cwd,
        state: 'starting',
        model: opts.model || null,
        permissionMode: mode,
        effort: (opts.effort ?? '') as Effort | '',
        error: null,
        needsLogin: false,
        startedAt: Date.now(),
        lastResult: null,
        context: null,
        forkedFrom: opts.fork && opts.resumeSessionId ? opts.resumeSessionId : null
      },
      queue: new AsyncQueue<SDKUserMessage>(),
      query: null,
      abort: new AbortController(),
      pending: new Map(),
      stream: null,
      streamTimer: null,
      stderr: ''
    }
    this.runs.set(runId, run)
    run.queue.push(userMessage(opts.prompt))
    const env = this.childEnv()

    run.query = sdk.query({
      prompt: run.queue,
      options: {
        cwd: opts.cwd,
        pathToClaudeCodeExecutable: exe,
        model: opts.model || undefined,
        permissionMode: mode,
        allowDangerouslySkipPermissions: mode === 'bypassPermissions',
        effort: (opts.effort || undefined) as never,
        resume,
        forkSession: forkOnStart || undefined,
        includePartialMessages: true,
        settingSources: ['user', 'project', 'local'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        abortController: run.abort,
        env,
        canUseTool: (toolName, input, o) => this.ask(run, toolName, input, o),
        stderr: (data: string) => {
          run.stderr = (run.stderr + data).slice(-8000)
        }
      }
    })
    void this.consume(run)
    this.emitState(run)
    return { ...run.info }
  }

  private ask(run: Run, toolName: string, input: Record<string, unknown>, o: Record<string, any>): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const requestId = randomUUID()
      const suggestions: PermissionUpdate[] = Array.isArray(o.suggestions) ? o.suggestions : []
      const req: PermissionRequest = {
        runId: run.info.runId,
        requestId,
        toolName,
        toolUseId: typeof o.toolUseID === 'string' ? o.toolUseID : null,
        input,
        suggestions: suggestions.map((s): PermissionSuggestionLite => ({ label: describeSuggestion(s), raw: s })),
        title: typeof o.title === 'string' ? o.title : null,
        description: typeof o.description === 'string' ? o.description : null,
        blockedPath: typeof o.blockedPath === 'string' ? o.blockedPath : null,
        createdAt: Date.now()
      }
      run.pending.set(requestId, { req, suggestions, resolve })
      this.emit('permission', req)
      const signal: AbortSignal | undefined = o.signal
      signal?.addEventListener('abort', () => {
        if (run.pending.delete(requestId)) {
          resolve({ behavior: 'deny', message: 'Request cancelled' })
          this.emit('permissionResolved', { runId: run.info.runId, requestId })
        }
      })
    })
  }

  respond(runId: string, requestId: string, decision: PermissionDecision): void {
    const run = this.runs.get(runId)
    const p = run?.pending.get(requestId)
    if (!run || !p) return
    run.pending.delete(requestId)
    if (decision.behavior === 'allow') {
      p.resolve({
        behavior: 'allow',
        updatedInput: decision.updatedInput ?? p.req.input,
        updatedPermissions: decision.remember && p.suggestions.length ? p.suggestions : undefined
      })
    } else {
      p.resolve({ behavior: 'deny', message: decision.message || 'Denied by the user', interrupt: decision.interrupt })
    }
    this.emit('permissionResolved', { runId, requestId })
  }

  private async consume(run: Run): Promise<void> {
    try {
      for await (const msg of run.query as AsyncIterable<Record<string, any>>) {
        if (process.env.CLAUDITOR_DEBUG_RUNNER) console.log('[runner]', msg.type, msg.subtype ?? '', msg.type === 'stream_event' ? msg.event?.type : '')
        this.handle(run, msg)
      }
      if (run.info.state !== 'error') run.info.state = 'stopped'
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (process.env.CLAUDITOR_DEBUG_RUNNER) console.error('[runner] stopped:', clipError(message), run.stderr.slice(-2000))
      if (run.info.state !== 'error') {
        const aborted = run.abort.signal.aborted
        run.info.state = aborted ? 'stopped' : 'error'
        if (!aborted) run.info.error = this.explain(run, message)
      }
    } finally {
      for (const [id, p] of run.pending) {
        p.resolve({ behavior: 'deny', message: 'Session ended' })
        this.emit('permissionResolved', { runId: run.info.runId, requestId: id })
      }
      run.pending.clear()
      this.flushStream(run, true)
      this.emitState(run)
    }
  }

  private explain(run: Run, message: string): string {
    if (AUTH_ERROR.test(message) || AUTH_ERROR.test(run.stderr.slice(-2000))) {
      run.info.needsLogin = true
      this.setAuth({ loggedIn: false, method: null, checkedAt: Date.now() })
      return loginHint()
    }
    const tail = clipError(run.stderr.trim().split('\n').slice(-4).join('\n'), 300)
    const head = clipError(message, 400)
    return tail && !head.includes(tail) ? `${head}\n${tail}` : head
  }

  /**
   * Ends a run that cannot continue (e.g. signed out) while keeping its error state. Closing the
   * prompt stream lets the CLI finish writing its transcript and exit on its own; the abort is
   * only a backstop.
   */
  private dispose(run: Run): void {
    run.queue.close()
    this.runs.delete(run.info.runId)
    setTimeout(() => {
      run.abort.abort()
      try {
        run.query?.close()
      } catch {
        /* already gone */
      }
    }, 5000).unref()
  }

  private handle(run: Run, msg: Record<string, any>): void {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          run.info.sessionId = msg.session_id ?? run.info.sessionId
          run.info.model = msg.model ?? run.info.model
          if (msg.permissionMode) run.info.permissionMode = msg.permissionMode
          run.info.state = 'running'
          this.emitState(run)
        } else if (msg.subtype === 'session_state_changed' || msg.subtype === 'status') {
          /* informational */
        }
        break
      case 'stream_event':
        this.onStreamEvent(run, msg.event)
        break
      case 'assistant':
        if (run.stream && msg.message?.id === run.stream.messageId) this.flushStream(run, true)
        if (run.info.state !== 'running') {
          run.info.state = 'running'
          this.emitState(run)
        }
        break
      case 'result':
        this.flushStream(run, true)
        run.info.state = 'idle'
        run.info.lastResult = {
          isError: !!msg.is_error,
          durationMs: Number(msg.duration_ms) || 0,
          numTurns: Number(msg.num_turns) || 0,
          costUSD: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null,
          text: typeof msg.result === 'string' ? msg.result : null
        }
        if (msg.is_error) {
          run.info.error = this.explain(run, typeof msg.result === 'string' ? msg.result : String(msg.subtype ?? t('Failed')))
        } else if (this.auth?.loggedIn !== true) {
          this.setAuth({ loggedIn: true, method: this.auth?.method ?? null, checkedAt: Date.now() })
        }
        if (run.info.needsLogin) {
          // a signed-out CLI cannot recover inside this process; the next prompt starts a fresh one
          run.info.state = 'error'
          this.emitState(run)
          this.dispose(run)
          break
        }
        this.emitState(run)
        this.emit('result', { ...run.info })
        void this.measureContext(run)
        break
      default:
        break
    }
  }

  private onStreamEvent(run: Run, ev: Record<string, any>): void {
    if (!ev || typeof ev !== 'object') return
    switch (ev.type) {
      case 'message_start':
        this.flushStream(run, true)
        run.stream = { messageId: ev.message?.id ?? randomUUID(), blocks: [] }
        break
      case 'content_block_start': {
        if (!run.stream) run.stream = { messageId: randomUUID(), blocks: [] }
        const cb = ev.content_block ?? {}
        const type = cb.type === 'tool_use' || cb.type === 'server_tool_use' ? 'tool_use' : cb.type === 'thinking' ? 'thinking' : 'text'
        run.stream.blocks[ev.index] = {
          index: ev.index,
          type,
          toolName: cb.name,
          toolUseId: cb.id,
          text: type === 'text' ? (cb.text ?? '') : type === 'thinking' ? (cb.thinking ?? '') : ''
        }
        this.scheduleStream(run)
        break
      }
      case 'content_block_delta': {
        const b = run.stream?.blocks[ev.index]
        if (!b) break
        const d = ev.delta ?? {}
        if (d.type === 'text_delta') b.text += d.text ?? ''
        else if (d.type === 'thinking_delta') b.text += d.thinking ?? ''
        else if (d.type === 'input_json_delta') b.text += d.partial_json ?? ''
        this.scheduleStream(run)
        break
      }
      case 'message_stop':
        this.scheduleStream(run)
        break
      default:
        break
    }
  }

  private scheduleStream(run: Run): void {
    if (run.streamTimer) return
    run.streamTimer = setTimeout(() => {
      run.streamTimer = null
      this.flushStream(run, false)
    }, 45)
  }

  private flushStream(run: Run, done: boolean): void {
    if (run.streamTimer) {
      clearTimeout(run.streamTimer)
      run.streamTimer = null
    }
    const s = run.stream
    if (!s) return
    const update: RunnerStreamUpdate = { runId: run.info.runId, messageId: s.messageId, blocks: s.blocks.filter(Boolean).map((b) => ({ ...b })), done }
    this.emit('stream', update)
    if (done) run.stream = null
  }

  send(runId: string, prompt: PromptInput): void {
    const run = this.runs.get(runId)
    if (!run) throw new Error(t('Session not found'))
    if (run.info.state === 'stopped' || run.info.state === 'error') throw new Error(t('This session has stopped — start or resume a new one'))
    run.info.error = null
    run.queue.push(userMessage(prompt))
    run.info.state = 'running'
    this.emitState(run)
  }

  async interrupt(runId: string): Promise<void> {
    const run = this.runs.get(runId)
    if (!run?.query) return
    try {
      await run.query.interrupt()
    } catch {
      /* already idle */
    }
  }

  stop(runId: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    run.queue.close()
    run.abort.abort()
    try {
      run.query?.close()
    } catch {
      /* ignore */
    }
    run.info.state = 'stopped'
    this.emitState(run)
    this.runs.delete(runId)
  }

  async setMode(runId: string, mode: PermissionMode): Promise<void> {
    const run = this.runs.get(runId)
    if (!run?.query) return
    await run.query.setPermissionMode(mode)
    run.info.permissionMode = mode
    this.emitState(run)
  }

  async setModel(runId: string, model: string): Promise<void> {
    const run = this.runs.get(runId)
    if (!run?.query) return
    await run.query.setModel(model || undefined)
    run.info.model = model || null
    this.emitState(run)
    // a different model can mean a different context window
    if (run.info.state === 'idle') void this.measureContext(run)
  }

  /** Changes the effort for the next turns ('' = back to Claude Code's default for the model). */
  async setEffort(runId: string, effort: Effort | ''): Promise<void> {
    const run = this.runs.get(runId)
    if (!run?.query) return
    if (typeof run.query.applyFlagSettings !== 'function') throw new Error(t('This version of Claude Code cannot change the effort during a session.'))
    await run.query.applyFlagSettings({ effortLevel: (effort || null) as never })
    run.info.effort = effort
    this.emitState(run)
  }

  /** Claude Code's own context measurement (local estimate, no model call), after a turn. */
  private async measureContext(run: Run): Promise<void> {
    const q = run.query as (Query & { getContextUsage?: (o?: { detail?: 'summary' | 'full' }) => Promise<RawContextUsage> }) | null
    if (!q || typeof q.getContextUsage !== 'function') return
    try {
      const usage = toContextUsage(await q.getContextUsage({ detail: 'summary' }))
      if (!usage || !this.runs.has(run.info.runId)) return
      run.info.context = usage
      this.emitState(run)
    } catch {
      /* the CLI predates /context data, or the run ended meanwhile */
    }
  }

  /** Single-turn, tool-less request (e.g. commit message drafting). */
  async oneShot(cwd: string, prompt: string): Promise<string> {
    const exe = this.executable()
    if (!exe) throw new Error(t('Claude Code was not found. Install Claude desktop or set the location of claude.exe in Settings.'))
    const sdk = await this.loadSdk()
    const q = sdk.query({
      prompt,
      options: {
        cwd,
        pathToClaudeCodeExecutable: exe,
        model: 'haiku',
        maxTurns: 1,
        tools: [],
        settingSources: [],
        persistSession: false,
        permissionMode: 'default'
      }
    })
    let text = ''
    let failure: string | null = null
    try {
      for await (const msg of q as AsyncIterable<Record<string, any>>) {
        if (msg.type !== 'result') continue
        if (msg.is_error) {
          failure = typeof msg.result === 'string' ? msg.result : t('Failed')
          break
        }
        text = typeof msg.result === 'string' ? msg.result : text
      }
    } catch (err) {
      failure ??= err instanceof Error ? err.message : String(err)
    } finally {
      q.close()
    }
    if (failure !== null) {
      if (AUTH_ERROR.test(failure)) {
        this.setAuth({ loggedIn: false, method: null, checkedAt: Date.now() })
        throw new Error(loginHint())
      }
      throw new Error(clipError(failure))
    }
    return text.trim()
  }

  stopAll(): void {
    for (const id of [...this.runs.keys()]) this.stop(id)
  }
}
