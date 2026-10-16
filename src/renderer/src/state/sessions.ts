import { create } from 'zustand'
import type {
  ClaudeAuthStatus,
  Effort,
  LiveSessionInfo,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  ProjectGroup,
  PromptInput,
  RunnerInfo,
  RunnerStartOptions,
  RunnerStreamUpdate,
  SessionFileChange,
  SessionMeta,
  SessionStats,
  SessionUpdate,
  TimelineEvent,
  TodoItem
} from '@shared/types'
import { t } from '@/lib/i18n'
import { errorText, invoke } from '@/lib/ipc'
import * as P from '@/lib/paths'
import { useApp } from './app'
import { useTerminals } from './terminals'

export interface SessionData {
  meta: SessionMeta
  events: TimelineEvent[]
  stats: SessionStats
  todos: TodoItem[] | null
  files: SessionFileChange[]
  cwd: string | null
  rev: number
}

type UpdateListener = (u: SessionUpdate, data: SessionData) => void

interface SessionsStore {
  groups: ProjectGroup[]
  live: LiveSessionInfo[]
  listLoading: boolean
  listLoadedAt: number
  data: Record<string, SessionData>
  opening: Record<string, true>
  activeId: string | null
  follow: boolean
  runners: Record<string, RunnerInfo>
  streams: Record<string, RunnerStreamUpdate>
  permissions: PermissionRequest[]
  subagents: Record<string, TimelineEvent[]>
  starting: boolean
  auth: ClaudeAuthStatus | null

  refreshList(): Promise<void>
  setLive(list: LiveSessionInfo[]): void
  open(id: string): Promise<SessionData | null>
  activate(id: string | null, opts?: { follow?: boolean }): Promise<void>
  close(id: string): void
  applyUpdate(u: SessionUpdate): void
  setFollow(on: boolean): void
  loadSubagent(sessionId: string, agentId: string): Promise<TimelineEvent[]>

  startRun(opts: Omit<RunnerStartOptions, 'model' | 'permissionMode' | 'effort'> & Partial<Pick<RunnerStartOptions, 'model' | 'permissionMode' | 'effort'>>): Promise<RunnerInfo | null>
  send(runId: string, prompt: PromptInput): Promise<void>
  interrupt(runId: string): Promise<void>
  stop(runId: string): Promise<void>
  respond(req: PermissionRequest, decision: PermissionDecision): Promise<void>
  setMode(runId: string, mode: PermissionMode): Promise<void>
  setModel(runId: string, model: string): Promise<void>
  setEffort(runId: string, effort: Effort | ''): Promise<void>
  onRunnerState(info: RunnerInfo): void
  onStream(u: RunnerStreamUpdate): void
  addPermission(r: PermissionRequest): void
  removePermission(runId: string, requestId: string): void
  checkAuth(force?: boolean): Promise<ClaudeAuthStatus | null>
  setAuth(st: ClaudeAuthStatus): void
}

const loginAction = () => [{ label: t('Sign in'), command: 'claude.login' }]
const loginTerminals = new Set<string>()

/** Opens `claude auth login` in a terminal; the user signs in there (Clauditor never handles credentials). */
export async function loginClaude(): Promise<void> {
  const term = await useTerminals.getState().create({ profile: 'claude', name: t('Claude Code sign-in'), extraArgs: ['auth', 'login'] })
  if (term) loginTerminals.add(term.id)
}

export async function onTerminalExited(id: string): Promise<void> {
  if (!loginTerminals.delete(id)) return
  const st = await useSessions.getState().checkAuth(true)
  if (st?.loggedIn) useApp.getState().toast({ level: 'success', title: t('Claude Code is signed in'), detail: t('Claude can now work directly from the Clauditor panel.') })
  else if (st?.loggedIn === false) useApp.getState().toast({ level: 'warning', title: t('Claude Code is not signed in'), detail: t("Sign-in didn't finish. Try again, then follow the steps in the browser until it's done."), actions: loginAction() })
}

const indexes = new Map<string, Map<string, number>>()
const listeners = new Set<UpdateListener>()
const openRetries = new Map<string, number>()

export function onSessionUpdate(fn: UpdateListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function buildIndex(id: string, events: TimelineEvent[]) {
  const m = new Map<string, number>()
  events.forEach((e, i) => m.set(e.id, i))
  indexes.set(id, m)
}

export function runnerForSession(s: Pick<SessionsStore, 'runners'>, sessionId: string | null): RunnerInfo | null {
  if (!sessionId) return null
  let best: RunnerInfo | null = null
  for (const r of Object.values(s.runners)) {
    if (r.sessionId !== sessionId) continue
    if (!best || r.startedAt > best.startedAt) best = r
  }
  return best
}

export const useSessions = create<SessionsStore>((set, get) => ({
  groups: [],
  live: [],
  listLoading: false,
  listLoadedAt: 0,
  data: {},
  opening: {},
  activeId: null,
  follow: true,
  runners: {},
  streams: {},
  permissions: [],
  subagents: {},
  starting: false,
  auth: null,

  async refreshList() {
    if (get().listLoading) return
    set({ listLoading: true })
    try {
      const groups = await invoke('sessions:list')
      set({ groups, listLoadedAt: Date.now() })
    } catch (err) {
      useApp.getState().toast({ level: 'error', title: t("Couldn't load Claude sessions"), detail: errorText(err) })
    } finally {
      set({ listLoading: false })
    }
  },

  setLive(list) {
    set({ live: list })
    // keep open sessions' live info fresh
    const data = { ...get().data }
    let changed = false
    const key = (l: LiveSessionInfo | null) => (l ? `${l.status}|${l.pid}|${(l.peers ?? []).map((p) => `${p.pid}:${p.status}`).join(',')}` : '')
    for (const [id, d] of Object.entries(data)) {
      const live = list.find((l) => l.sessionId === id) ?? null
      if (key(live) !== key(d.meta.live)) {
        data[id] = { ...d, meta: { ...d.meta, live }, rev: d.rev + 1 }
        changed = true
      }
    }
    if (changed) set({ data })
  },

  async open(id) {
    const existing = get().data[id]
    if (existing) return existing
    if (get().opening[id]) {
      return new Promise((resolve) => {
        const unsub = useSessions.subscribe((s) => {
          if (s.data[id] || !s.opening[id]) {
            unsub()
            resolve(s.data[id] ?? null)
          }
        })
      })
    }
    set({ opening: { ...get().opening, [id]: true } })
    try {
      const snap = await invoke('sessions:open', id)
      if (!snap) return null
      const d: SessionData = { meta: snap.meta, events: snap.events, stats: snap.stats, todos: snap.todos, files: snap.files, cwd: snap.cwd, rev: 1 }
      buildIndex(id, snap.events)
      set({ data: { ...get().data, [id]: d } })
      return d
    } catch (err) {
      useApp.getState().toast({ level: 'error', title: t("Couldn't open session"), detail: errorText(err) })
      return null
    } finally {
      const opening = { ...get().opening }
      delete opening[id]
      set({ opening })
    }
  },

  async activate(id, opts = {}) {
    const prev = get().activeId
    set({ activeId: id, follow: opts.follow ?? get().follow })
    if (id) {
      useApp.getState().toggleAgent(true)
      await get().open(id)
    }
    if (prev && prev !== id && !Object.values(get().runners).some((r) => r.sessionId === prev && r.state !== 'stopped')) {
      // keep data cached but stop tailing sessions that are no longer shown
      get().close(prev)
    }
    const ws = useApp.getState().workspace
    if (ws) {
      const st = useApp.getState().persisted.workspaces[ws.root]
      void invoke('state:update', {
        workspaces: { [ws.root]: { tabs: st?.tabs ?? [], activePath: st?.activePath ?? null, expanded: st?.expanded ?? [], agentSessionId: id } }
      })
    }
  },

  close(id) {
    if (!get().data[id]) return
    void invoke('sessions:close', id)
    const data = { ...get().data }
    delete data[id]
    indexes.delete(id)
    set({ data })
  },

  applyUpdate(u) {
    const d = get().data[u.sessionId]
    if (!d) return
    let events: TimelineEvent[]
    if (u.reset) {
      events = u.added
      buildIndex(u.sessionId, events)
    } else {
      events = d.events.slice()
      let idx = indexes.get(u.sessionId)
      if (!idx) {
        buildIndex(u.sessionId, events)
        idx = indexes.get(u.sessionId)!
      }
      for (const ev of u.updated) {
        const i = idx.get(ev.id)
        if (i !== undefined) events[i] = ev
      }
      for (const ev of u.added) {
        const i = idx.get(ev.id)
        if (i !== undefined) events[i] = ev
        else {
          idx.set(ev.id, events.length)
          events.push(ev)
        }
      }
    }
    const next: SessionData = { meta: u.meta, events, stats: u.stats, todos: u.todos, files: u.files, cwd: d.cwd ?? u.meta.cwd, rev: d.rev + 1 }
    set({ data: { ...get().data, [u.sessionId]: next } })
    for (const l of listeners) l(u, next)
  },

  setFollow(on) {
    set({ follow: on })
  },

  async loadSubagent(sessionId, agentId) {
    const key = `${sessionId}:${agentId}`
    const cached = get().subagents[key]
    const live = get().data[sessionId]?.meta.live
    if (cached && !live) return cached
    const events = await invoke('sessions:subagentEvents', sessionId, agentId)
    set({ subagents: { ...get().subagents, [key]: events } })
    return events
  },

  async startRun(opts) {
    const s = useApp.getState().settings.claude
    set({ starting: true })
    try {
      if (get().auth?.loggedIn === false) {
        // signed out: re-check (the user may have logged in elsewhere) instead of starting a doomed run
        const st = await get().checkAuth(true)
        if (st?.loggedIn === false) {
          useApp.getState().toast({ id: 'claude-login', level: 'warning', title: t('Sign in to Claude Code first'), detail: t('Your message is still in the composer. Send it again after signing in.'), actions: loginAction() })
          return null
        }
      }
      const info = await invoke('runner:start', {
        cwd: opts.cwd,
        prompt: opts.prompt,
        resumeSessionId: opts.resumeSessionId,
        fork: opts.fork,
        forkTitle: opts.forkTitle,
        model: opts.model ?? (s.defaultModel || undefined),
        permissionMode: opts.permissionMode ?? s.defaultPermissionMode,
        effort: opts.effort ?? s.defaultEffort
      })
      set({ runners: { ...get().runners, [info.runId]: info } })
      if (info.sessionId) await get().activate(info.sessionId, { follow: true })
      return info
    } catch (err) {
      useApp.getState().toast({ level: 'error', title: t("Couldn't start Claude Code"), detail: errorText(err) })
      return null
    } finally {
      set({ starting: false })
    }
  },

  async send(runId, prompt) {
    try {
      await invoke('runner:send', runId, prompt)
    } catch (err) {
      useApp.getState().toast({ level: 'error', title: t('Message not sent'), detail: errorText(err) })
    }
  },

  async interrupt(runId) {
    await invoke('runner:interrupt', runId)
  },

  async stop(runId) {
    await invoke('runner:stop', runId)
  },

  async respond(req, decision) {
    get().removePermission(req.runId, req.requestId)
    await invoke('runner:respond', req.runId, req.requestId, decision)
  },

  async setMode(runId, mode) {
    try {
      await invoke('runner:setMode', runId, mode)
    } catch (err) {
      useApp.getState().toast({ level: 'error', title: t("Couldn't change mode"), detail: errorText(err) })
    }
  },

  async setModel(runId, model) {
    try {
      await invoke('runner:setModel', runId, model)
    } catch (err) {
      useApp.getState().toast({ level: 'error', title: t("Couldn't change model"), detail: errorText(err) })
    }
  },

  async setEffort(runId, effort) {
    try {
      await invoke('runner:setEffort', runId, effort)
    } catch (err) {
      useApp.getState().toast({ level: 'error', title: t("Couldn't change effort"), detail: errorText(err) })
    }
  },

  onRunnerState(info) {
    const prev = get().runners[info.runId]
    set({ runners: { ...get().runners, [info.runId]: info } })
    if (info.sessionId && (!prev?.sessionId || prev.sessionId !== info.sessionId)) {
      // the transcript appears a moment after init; retry opening briefly
      const tryOpen = async () => {
        const d = await get().open(info.sessionId!)
        if (d) {
          if (!get().activeId || get().activeId === prev?.sessionId || get().activeId === null) await get().activate(info.sessionId!, { follow: true })
          else if (get().activeId !== info.sessionId) await get().activate(info.sessionId!, { follow: true })
          openRetries.delete(info.runId)
          return
        }
        const n = (openRetries.get(info.runId) ?? 0) + 1
        openRetries.set(info.runId, n)
        if (n < 30) setTimeout(tryOpen, 400)
      }
      void tryOpen()
    }
    if (info.needsLogin && get().auth?.loggedIn !== false) set({ auth: { loggedIn: false, method: null, checkedAt: Date.now() } })
    if (info.error && prev?.error !== info.error && (info.state === 'error' || info.lastResult?.isError)) {
      if (info.needsLogin) useApp.getState().toast({ id: 'claude-login', level: 'warning', title: t('Sign in to Claude Code first'), detail: info.error, actions: loginAction() })
      else useApp.getState().toast({ level: 'error', title: info.state === 'error' ? t('Claude Code stopped') : t("Claude's turn failed"), detail: info.error })
    }
    if (info.state === 'stopped' || info.state === 'error') {
      const streams = { ...get().streams }
      delete streams[info.runId]
      set({ streams, permissions: get().permissions.filter((p) => p.runId !== info.runId) })
    }
  },

  onStream(u) {
    const streams = { ...get().streams }
    if (u.done) delete streams[u.runId]
    else streams[u.runId] = u
    set({ streams })
  },

  addPermission(r) {
    if (get().permissions.some((p) => p.requestId === r.requestId)) return
    set({ permissions: [...get().permissions, r] })
  },

  removePermission(runId, requestId) {
    set({ permissions: get().permissions.filter((p) => !(p.runId === runId && p.requestId === requestId)) })
  },

  async checkAuth(force) {
    try {
      const st = await invoke('runner:authStatus', force)
      set({ auth: st })
      return st
    } catch {
      return get().auth
    }
  },

  setAuth(st) {
    set({ auth: st })
  }
}))

/** Live sessions (Claude desktop or CLI) running in the workspace folder or below it. */
export function liveForWorkspace(live: LiveSessionInfo[], root: string | null): LiveSessionInfo[] {
  if (!root) return []
  return live.filter((l) => l.cwd && P.isSameOrInside(l.cwd, root)).sort((a, b) => (b.statusUpdatedAt ?? 0) - (a.statusUpdatedAt ?? 0))
}

/** Live sessions running in a parent folder of the workspace (they may be building it). */
export function liveAboveWorkspace(live: LiveSessionInfo[], root: string | null): LiveSessionInfo[] {
  if (!root) return []
  return live.filter((l) => l.cwd && P.isInside(root, l.cwd))
}

export function sessionTitle(meta: Pick<SessionMeta, 'title' | 'firstPrompt' | 'id'> | null | undefined): string {
  if (!meta) return t('Session')
  const title = meta.title?.trim()
  if (title) return title
  const first = meta.firstPrompt?.trim()
  if (first) {
    // the main process reports scheduled-task sessions with an English marker
    const task = /^Scheduled task(?:: (.+))?$/.exec(first)
    if (task) return task[1] ? t('Scheduled task: {name}', { name: task[1] }) : t('Scheduled task')
    return first
  }
  return t('Session {id}', { id: meta.id.slice(0, 8) })
}

/** Where a session comes from, for the header: Claude desktop, a copy continued in Clauditor, the CLI… */
export function originFor(meta: Pick<SessionMeta, 'entrypoint' | 'desktop' | 'forkedFrom'>): { label: string; tip: string | null } {
  if (meta.desktop) return { label: 'Claude desktop', tip: null }
  if (meta.forkedFrom) return { label: t('Copy in Clauditor'), tip: t('Continued in Clauditor from a copy of another session. The original is left as it was.') }
  return { label: originLabel(meta.entrypoint), tip: null }
}

export function originLabel(entrypoint: string | null | undefined): string {
  switch (entrypoint) {
    case 'claude-desktop':
      return 'Claude desktop'
    case 'cli':
      return 'CLI'
    case 'sdk-ts':
    case 'sdk-py':
      return 'Clauditor / SDK'
    case 'claude-vscode':
      return 'VS Code'
    default:
      return entrypoint ? entrypoint : 'Claude Code'
  }
}
