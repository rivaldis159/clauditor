// Typed IPC contract. Every channel the renderer may use is declared here; the preload
// script only forwards channels listed in these maps.
import type {
  AppInfo,
  AppState,
  ClaudeAuthStatus,
  ClaudeEnvironment,
  ClaudeUpdateNotice,
  DeepPartial,
  FileContent,
  FileEntry,
  FsChangeBatch,
  GitBranch,
  GitCommitInfo,
  GitResult,
  GitStatus,
  IdeBridgeStatus,
  IdeDiagnosticFile,
  IdeEditorState,
  IdeOpenDiffRequest,
  IdeOpenFileRequest,
  IdeSelection,
  LiveSessionInfo,
  ModelOption,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  ProjectGroup,
  PromptInput,
  RunnerInfo,
  RunnerStartOptions,
  RunnerStreamUpdate,
  SearchDone,
  SearchProgress,
  SearchQuery,
  SessionMeta,
  SessionSnapshot,
  SessionUpdate,
  Settings,
  SubagentInfo,
  TerminalCreateOptions,
  TerminalInfo,
  TerminalProfile,
  TimelineEvent,
  ToastMessage,
  WorkspaceInfo,
  WriteFileOptions,
  WriteResult
} from './types'

export interface InvokeMap {
  // app & window
  'app:info': () => AppInfo
  'app:openExternal': (url: string) => void
  'app:revealPath': (path: string) => void
  'app:openPath': (path: string) => string
  'app:pickFolder': (title?: string) => string | null
  'app:pickFile': (title?: string) => string | null
  'app:setTitleBarTheme': (theme: { background: string; symbol: string }) => void
  'app:windowAction': (action: 'minimize' | 'maximize' | 'close' | 'devtools' | 'reload' | 'zoomIn' | 'zoomOut' | 'zoomReset' | 'fullscreen') => void
  'app:isMaximized': () => boolean
  'app:notify': (title: string, body: string) => void
  'app:confirmQuit': () => void
  'app:quitAck': () => void

  // settings & persisted state
  'settings:get': () => Settings
  'settings:update': (patch: DeepPartial<Settings>) => Settings
  'state:get': () => AppState
  'state:update': (patch: Partial<AppState>) => void

  // workspace & files
  'workspace:open': (root: string) => WorkspaceInfo
  'workspace:close': () => void
  'fs:readDir': (dir: string) => FileEntry[]
  'fs:readFile': (path: string) => FileContent
  'fs:writeFile': (path: string, text: string, opts?: WriteFileOptions) => WriteResult
  'fs:stat': (path: string) => { exists: boolean; kind: 'file' | 'dir' | null; size: number; mtimeMs: number }
  'fs:createFile': (path: string) => void
  'fs:createDir': (path: string) => void
  'fs:rename': (from: string, to: string) => void
  'fs:trash': (path: string) => void
  'fs:copy': (from: string, to: string) => void
  'fs:listFiles': (root: string) => string[]

  // search
  'search:start': (query: SearchQuery) => string
  'search:cancel': (searchId: string) => void
  'search:replaceInFile': (path: string, query: SearchQuery, replacement: string) => number

  // terminal
  'terminal:profiles': () => TerminalProfile[]
  'terminal:create': (opts: TerminalCreateOptions) => TerminalInfo
  'terminal:kill': (id: string) => void
  'terminal:list': () => TerminalInfo[]

  // git
  'git:status': (root: string) => GitStatus
  'git:stage': (root: string, paths: string[]) => GitResult
  'git:unstage': (root: string, paths: string[]) => GitResult
  'git:discard': (root: string, paths: string[]) => GitResult
  'git:commit': (root: string, message: string, opts?: { amend?: boolean; all?: boolean }) => GitResult
  'git:branches': (root: string) => GitBranch[]
  'git:checkout': (root: string, branch: string, create?: boolean) => GitResult
  'git:show': (root: string, path: string, ref: string) => string | null
  'git:log': (root: string, limit: number) => GitCommitInfo[]
  'git:sync': (root: string, action: 'fetch' | 'pull' | 'push') => GitResult
  'git:init': (root: string) => GitResult
  'git:diff': (root: string, staged: boolean) => string

  // claude sessions (observer)
  'sessions:list': () => ProjectGroup[]
  'sessions:live': () => LiveSessionInfo[]
  'sessions:open': (sessionId: string) => SessionSnapshot | null
  'sessions:close': (sessionId: string) => void
  'sessions:meta': (sessionId: string) => SessionMeta | null
  'sessions:backup': (sessionId: string, backupFile: string) => string | null
  'sessions:subagents': (sessionId: string) => SubagentInfo[]
  'sessions:subagentEvents': (sessionId: string, agentId: string) => TimelineEvent[]
  'sessions:findForCwd': (cwd: string) => SessionMeta[]
  'sessions:revealTranscript': (sessionId: string) => void

  // claude desktop deep links
  'desktop:openSession': (sessionId: string) => { ok: boolean; url: string }
  'desktop:newSession': (folder: string, prompt?: string) => { ok: boolean; url: string }

  // runner (Claude Code driven by Clauditor)
  'runner:start': (opts: RunnerStartOptions) => RunnerInfo
  'runner:send': (runId: string, prompt: PromptInput) => void
  'runner:interrupt': (runId: string) => void
  'runner:stop': (runId: string) => void
  'runner:list': () => RunnerInfo[]
  'runner:respond': (runId: string, requestId: string, decision: PermissionDecision) => void
  'runner:setMode': (runId: string, mode: PermissionMode) => void
  'runner:setModel': (runId: string, model: string) => void
  'runner:models': () => ModelOption[]
  'runner:pending': () => PermissionRequest[]
  'runner:oneShot': (cwd: string, prompt: string) => string
  'runner:authStatus': (force?: boolean) => ClaudeAuthStatus

  // Claude desktop integration (versions, fonts, models; follows Claude updates)
  'claude:environment': () => ClaudeEnvironment
  'claude:refresh': () => ClaudeEnvironment

  // IDE bridge (Claude Code IDE protocol)
  'ide:status': () => IdeBridgeStatus
  'ide:diffResult': (requestId: string, result: { accepted: boolean; content?: string; closed?: boolean }) => void
  'ide:atMention': (filePath: string, lineStart?: number, lineEnd?: number) => number
}

export interface EventMap {
  'fs:changed': FsChangeBatch
  'search:progress': SearchProgress
  'search:done': SearchDone
  'terminal:data': { id: string; data: string }
  'terminal:exit': { id: string; exitCode: number }
  'sessions:update': SessionUpdate
  'sessions:live': LiveSessionInfo[]
  'sessions:listChanged': void
  'runner:state': RunnerInfo
  'runner:stream': RunnerStreamUpdate
  'runner:permission': PermissionRequest
  'runner:permissionResolved': { runId: string; requestId: string }
  'runner:auth': ClaudeAuthStatus
  'claude:environment': ClaudeEnvironment
  'claude:update': ClaudeUpdateNotice
  'ide:status': IdeBridgeStatus
  'ide:openFile': IdeOpenFileRequest
  'ide:openDiff': IdeOpenDiffRequest
  'ide:closeTab': { tabName: string }
  'ide:closeAllDiffs': void
  'ide:saveDocument': { filePath: string; requestId: string }
  'app:openFolder': string
  'app:toast': ToastMessage
  'app:maximized': boolean
  'app:beforeQuit': void
  'settings:changed': Settings
}

export interface SendMap {
  'terminal:input': [id: string, data: string]
  'terminal:resize': [id: string, cols: number, rows: number]
  'ide:selection': [selection: IdeSelection | null]
  'ide:diagnostics': [files: IdeDiagnosticFile[]]
  'ide:editors': [state: IdeEditorState]
  'ide:saved': [requestId: string, ok: boolean]
}

export type InvokeChannel = keyof InvokeMap
export type EventChannel = keyof EventMap
export type SendChannel = keyof SendMap

export interface ClauditorBridge {
  invoke<K extends InvokeChannel>(channel: K, ...args: Parameters<InvokeMap[K]>): Promise<Awaited<ReturnType<InvokeMap[K]>>>
  send<K extends SendChannel>(channel: K, ...args: SendMap[K]): void
  on<K extends EventChannel>(channel: K, listener: (payload: EventMap[K]) => void): () => void
  pathForFile(file: File): string
  platform: string
}

export const INVOKE_PREFIXES = ['app:', 'settings:', 'state:', 'workspace:', 'fs:', 'search:', 'terminal:', 'git:', 'sessions:', 'desktop:', 'runner:', 'ide:', 'claude:']
