// Domain types shared by the main process, preload and renderer.
import type { Locale } from './i18n'

export type { Locale }
export type ThemeSetting = 'dark' | 'light' | 'system'
export type Accent = 'orange' | 'blue' | 'violet' | 'green' | 'rose'
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions'
/** Effort levels come from Claude Code itself; newer releases may add levels beyond these. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | (string & {})

export interface EditorSettings {
  fontFamily: string
  fontSize: number
  lineHeight: number
  tabSize: number
  insertSpaces: boolean
  wordWrap: 'off' | 'on'
  minimap: boolean
  lineNumbers: 'on' | 'relative' | 'off'
  renderWhitespace: 'none' | 'selection' | 'boundary' | 'all'
  fontLigatures: boolean
  autoSave: 'off' | 'afterDelay' | 'onFocusChange'
  autoSaveDelay: number
  formatOnSave: boolean
  stickyScroll: boolean
  smoothScrolling: boolean
  bracketPairColorization: boolean
  gitGutter: boolean
}

export interface TerminalSettings {
  shell: string
  fontFamily: string
  fontSize: number
  cursorBlink: boolean
}

export interface ClaudeSettings {
  executablePath: string
  defaultModel: string
  defaultPermissionMode: PermissionMode
  defaultEffort: Effort | ''
  followLive: boolean
  followOpensFiles: boolean
  animateEdits: boolean
  notifyOnIdle: boolean
  ideBridge: boolean
  autoFollowWorkspace: boolean
  /** fetch the Agent SDK release that matches Claude desktop's Claude Code when it updates */
  syncSdk: boolean
}

export interface FilesSettings {
  exclude: string[]
  showHidden: boolean
  confirmDelete: boolean
}

export interface Settings {
  language: Locale
  theme: ThemeSetting
  accent: Accent
  uiFontSize: number
  editor: EditorSettings
  terminal: TerminalSettings
  claude: ClaudeSettings
  files: FilesSettings
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] }

export interface LayoutState {
  sidebarVisible: boolean
  sidebarWidth: number
  panelVisible: boolean
  panelHeight: number
  agentVisible: boolean
  agentWidth: number
  activeView: SidebarView
}

export type SidebarView = 'explorer' | 'search' | 'scm' | 'sessions'

export interface PersistedTab {
  kind: 'file'
  path: string
  pinned?: boolean
}

export interface WorkspaceSessionState {
  tabs: PersistedTab[]
  activePath: string | null
  expanded: string[]
  agentSessionId: string | null
}

export interface AppState {
  recentFolders: string[]
  lastFolder: string | null
  layout: LayoutState
  workspaces: Record<string, WorkspaceSessionState>
  hostSessionIds: Record<string, string>
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  userData: string
  claudeHome: string
  claudeExe: ClaudeExecutable | null
  initialFolder: string | null
  isPackaged: boolean
}

export interface ClaudeExecutable {
  path: string
  version: string | null
  source: 'settings' | 'desktop' | 'path' | 'sdk'
}

/* ---------------- Files ---------------- */

export interface FileEntry {
  name: string
  path: string
  kind: 'file' | 'dir'
  symlink?: boolean
  size?: number
  mtimeMs?: number
}

export type TextEncodingName = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'windows1252'

export interface FileContent {
  path: string
  kind: 'text' | 'binary' | 'image' | 'too-large' | 'missing'
  text: string
  encoding: TextEncodingName
  eol: 'LF' | 'CRLF'
  size: number
  mtimeMs: number
}

export interface WriteFileOptions {
  encoding?: TextEncodingName
  /** When set, the write fails if the file changed on disk after this mtime. */
  expectedMtimeMs?: number
  createDirs?: boolean
}

export interface WriteResult {
  ok: boolean
  mtimeMs: number
  conflict?: boolean
}

export interface FsChange {
  path: string
  type: 'change' | 'rename'
}

export interface FsChangeBatch {
  root: string
  changes: FsChange[]
}

export interface WorkspaceInfo {
  root: string
  name: string
}

/* ---------------- Search ---------------- */

export interface SearchQuery {
  root: string
  query: string
  isRegex: boolean
  matchCase: boolean
  wholeWord: boolean
  include: string
  exclude: string
  maxResults?: number
}

export interface SearchMatch {
  line: number
  column: number
  length: number
  preview: string
  /** offset of the match inside preview */
  previewOffset: number
}

export interface SearchFileResult {
  path: string
  matches: SearchMatch[]
}

export interface SearchProgress {
  searchId: string
  files: SearchFileResult[]
}

export interface SearchDone {
  searchId: string
  totalMatches: number
  totalFiles: number
  limitHit: boolean
  error?: string
  elapsedMs: number
}

/* ---------------- Terminal ---------------- */

export type TerminalProfileId = 'pwsh' | 'powershell' | 'cmd' | 'bash' | 'claude'

export interface TerminalProfile {
  id: TerminalProfileId
  label: string
  path: string
  args: string[]
  available: boolean
}

export interface TerminalCreateOptions {
  cwd: string
  profile?: TerminalProfileId
  cols: number
  rows: number
  name?: string
  /** extra args appended (claude profile: e.g. --resume <id>) */
  extraArgs?: string[]
}

export interface TerminalInfo {
  id: string
  pid: number
  name: string
  cwd: string
  profile: TerminalProfileId
}

/* ---------------- Git ---------------- */

export type GitCode = ' ' | 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | '!' | 'T'

export interface GitFileStatus {
  path: string
  relPath: string
  origPath?: string
  index: GitCode
  worktree: GitCode
  conflicted: boolean
}

export interface GitStatus {
  isRepo: boolean
  root: string | null
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
  error?: string
}

export interface GitBranch {
  name: string
  current: boolean
  remote: boolean
  upstream?: string
  lastCommit?: string
}

export interface GitCommitInfo {
  hash: string
  shortHash: string
  author: string
  date: number
  subject: string
}

export interface GitResult {
  ok: boolean
  output: string
}

/* ---------------- Claude sessions ---------------- */

export interface LiveSessionInfo {
  pid: number
  sessionId: string
  cwd: string
  status: string
  statusUpdatedAt: number | null
  name: string | null
  hostSessionId: string | null
  entrypoint: string | null
  kind: string | null
  version: string | null
  startedAt: number | null
  /** other live processes on the same session (e.g. Claude desktop and Clauditor at once) */
  peers: { pid: number; entrypoint: string | null; status: string }[]
}

/** A session as Claude desktop lists it, read from Claude desktop's own session files. */
export interface DesktopSessionRef {
  /** Claude desktop's id for the session (local_…), used by claude:// links */
  hostSessionId: string
  title: string | null
  /** model Claude desktop runs the session with, e.g. 'claude-opus-5-5' */
  model: string | null
  /** effort level picked in Claude desktop; null = Claude Code's default */
  effort: string | null
  permissionMode: string | null
  archived: boolean
}

export interface SessionMeta {
  id: string
  file: string
  projectSlug: string
  cwd: string | null
  title: string | null
  firstPrompt: string | null
  createdAt: number
  updatedAt: number
  size: number
  entrypoint: string | null
  gitBranch: string | null
  version: string | null
  live: LiveSessionInfo | null
  startedByClauditor: boolean
  /** set when Claude desktop lists this session: it belongs to Claude desktop */
  desktop: DesktopSessionRef | null
  /** the session this one was copied from (e.g. a Claude desktop session continued in Clauditor) */
  forkedFrom: string | null
}

export interface ProjectGroup {
  slug: string
  cwd: string | null
  sessions: SessionMeta[]
}

export interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

export interface ToolFileResult {
  path: string
  type: 'create' | 'update' | 'edit' | 'read'
  hunks: Hunk[]
  added: number
  removed: number
  /** full content written (Write tool) — kept for replay */
  content?: string
  originalFile?: string | null
  numLines?: number
  startLine?: number
}

export interface ToolShellResult {
  stdout: string
  stderr: string
  interrupted: boolean
  backgroundTaskId?: string
}

export interface ToolResult {
  isError: boolean
  text: string
  truncated: boolean
  file?: ToolFileResult
  shell?: ToolShellResult
  todos?: TodoItem[]
  filenames?: string[]
  numFiles?: number
  agentId?: string
}

interface BaseEvent {
  id: string
  ts: number
}

export interface PromptEvent extends BaseEvent {
  kind: 'prompt'
  text: string
  images: number
  origin: 'user' | 'scheduled' | 'task-notification' | 'command' | 'other'
}

export interface TextEvent extends BaseEvent {
  kind: 'text'
  text: string
  model?: string
}

export interface ThinkingEvent extends BaseEvent {
  kind: 'thinking'
  text: string
}

export type ToolStatus = 'running' | 'done' | 'error' | 'denied'

export interface ToolEvent extends BaseEvent {
  kind: 'tool'
  toolUseId: string
  name: string
  input: Record<string, unknown>
  status: ToolStatus
  result?: ToolResult
  endTs?: number
}

export interface SystemEvent extends BaseEvent {
  kind: 'system'
  level: 'info' | 'warning' | 'error'
  subtype: string
  /** raw text, or an English template when `i18n` is set (translated in the UI with `vars`) */
  text: string
  i18n?: boolean
  vars?: Record<string, string>
}

export type TimelineEvent = PromptEvent | TextEvent | ThinkingEvent | ToolEvent | SystemEvent

export interface SessionStats {
  turns: number
  toolCalls: number
  toolCounts: Record<string, number>
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUSD: number | null
  models: string[]
  /** model of Claude's latest reply in the main conversation */
  model: string | null
  linesAdded: number
  linesRemoved: number
  firstTs: number | null
  lastTs: number | null
  /** tokens Claude read for its latest reply (input + cache): the conversation's size in the context window */
  contextTokens: number
}

export interface SessionFileChange {
  path: string
  edits: number
  added: number
  removed: number
  created: boolean
  /** backup file name of the version before the session first touched it (file-history) */
  backup: string | null
  firstTs: number
  lastTs: number
}

export interface SessionSnapshot {
  meta: SessionMeta
  events: TimelineEvent[]
  stats: SessionStats
  todos: TodoItem[] | null
  files: SessionFileChange[]
  cwd: string | null
}

export interface SessionUpdate {
  sessionId: string
  /** when true the renderer must replace its event list with `added` */
  reset?: boolean
  added: TimelineEvent[]
  updated: TimelineEvent[]
  stats: SessionStats
  todos: TodoItem[] | null
  files: SessionFileChange[]
  meta: SessionMeta
}

export interface SubagentInfo {
  agentId: string
  toolUseId: string | null
  agentType: string | null
  description: string | null
  file: string
}

/* ---------------- Runner (Claude Code via Agent SDK) ---------------- */

export interface PromptImage {
  mediaType: string
  data: string
}

export interface PromptInput {
  text: string
  images?: PromptImage[]
}

export interface RunnerStartOptions {
  cwd: string
  prompt: PromptInput
  model?: string
  permissionMode?: PermissionMode
  effort?: Effort | ''
  resumeSessionId?: string
  /** continue in a copy of `resumeSessionId` (used for Claude desktop's sessions), titled `forkTitle` */
  fork?: boolean
  forkTitle?: string
}

export type RunnerState = 'starting' | 'running' | 'idle' | 'stopped' | 'error'

/** How full the context window is, as Claude Code itself measures it (`/context`). */
export interface ContextUsage {
  model: string
  used: number
  limit: number
  percent: number
  /** Claude Code summarizes older messages once the conversation reaches this many tokens */
  autoCompactAt: number | null
  autoCompactEnabled: boolean
  categories: { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }[]
  memoryFiles: { path: string; type: string; tokens: number }[]
  measuredAt: number
}

export interface RunnerInfo {
  runId: string
  sessionId: string | null
  cwd: string
  state: RunnerState
  model: string | null
  permissionMode: PermissionMode
  effort: Effort | ''
  error: string | null
  /** the run failed because Claude Code is not signed in (or the login expired) */
  needsLogin: boolean
  startedAt: number
  lastResult: RunnerResultSummary | null
  /** context window usage after Claude's latest reply (null until measured) */
  context: ContextUsage | null
  /** the session this run continues a copy of */
  forkedFrom: string | null
}

/** What "Default" stands for in a folder: the model / effort Claude Code's own settings pick. */
export interface ClaudeDefaults {
  model: { value: string; source: ClaudeSettingSource } | null
  /** effortLevel for every model */
  effort: { value: string; source: ClaudeSettingSource } | null
  /** modelSettings.<model>.effortLevel (what /effort saves), keyed by model name */
  modelEfforts: Record<string, { value: string; source: ClaudeSettingSource }>
}

export type ClaudeSettingSource = 'env' | 'local' | 'project' | 'user'

/** Result of `claude auth status`; loggedIn is null when the check itself could not run. */
export interface ClaudeAuthStatus {
  loggedIn: boolean | null
  method: string | null
  checkedAt: number
}

export interface RunnerResultSummary {
  isError: boolean
  durationMs: number
  numTurns: number
  costUSD: number | null
  text: string | null
}

export interface StreamBlock {
  index: number
  type: 'text' | 'thinking' | 'tool_use'
  toolName?: string
  toolUseId?: string
  text: string
}

export interface RunnerStreamUpdate {
  runId: string
  messageId: string
  blocks: StreamBlock[]
  done: boolean
}

export interface PermissionSuggestionLite {
  label: string
  raw: unknown
}

export interface PermissionRequest {
  runId: string
  requestId: string
  toolName: string
  toolUseId: string | null
  input: Record<string, unknown>
  suggestions: PermissionSuggestionLite[]
  title: string | null
  description: string | null
  blockedPath: string | null
  createdAt: number
}

export type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; remember?: boolean }
  | { behavior: 'deny'; message: string; interrupt?: boolean }

/** A model offered by Claude Code (`supportedModels`), so the picker matches Claude's own. */
export interface ModelOption {
  value: string
  label: string
  description: string
  /** canonical model id the alias resolves to, e.g. 'claude-opus-5-5' */
  resolvedModel?: string | null
  /** effort levels this model accepts; empty when it has no effort control */
  effortLevels?: Effort[]
  supportsFastMode?: boolean
  supportsAutoMode?: boolean
  /** context window in tokens, as Claude Code reports it for this model */
  contextWindow?: number | null
  /** conversation size (tokens) at which Claude Code auto-compacts; null when auto-compact is off */
  autoCompactAt?: number | null
}

/* ---------------- Claude integration ---------------- */

/** Where Claude desktop is installed and what it ships; re-detected when Claude updates. */
export interface ClaudeEnvironment {
  desktop: { version: string | null; root: string | null; kind: 'msix' | 'squirrel' | null }
  cli: { path: string | null; version: string | null; source: ClaudeExecutable['source'] | null }
  /** Agent SDK that drives the CLI: downloaded from npm to match Claude's version ('none' until then); 'bundled' in development */
  sdk: { version: string | null; claudeCodeVersion: string | null; source: 'bundled' | 'synced' | 'none' }
  /** Claude's own fonts as loadable URLs (not bundled with Clauditor); null when not found */
  fonts: { sans: string | null; sansItalic: string | null; serif: string | null; mono: string | null }
  models: ModelOption[]
  outputStyles: string[]
  checkedAt: number
}

/** Emitted when Claude desktop or its Claude Code changed while Clauditor was running. */
export interface ClaudeUpdateNotice {
  what: 'desktop' | 'cli' | 'sdk'
  from: string | null
  to: string | null
}

/* ---------------- IDE bridge ---------------- */

export interface IdeClient {
  id: string
  connectedAt: number
  pid: number | null
}

export interface IdeBridgeStatus {
  enabled: boolean
  port: number | null
  lockFile: string | null
  clients: IdeClient[]
  error: string | null
}

export interface IdeOpenDiffRequest {
  requestId: string
  filePath: string
  newContents: string
  tabName: string
}

export interface IdeOpenFileRequest {
  filePath: string
  line?: number
  endLine?: number
  startText?: string
  endText?: string
  preview?: boolean
}

export interface IdeSelection {
  filePath: string
  text: string
  start: { line: number; character: number }
  end: { line: number; character: number }
  isEmpty: boolean
}

export interface IdeDiagnosticFile {
  uri: string
  diagnostics: {
    message: string
    severity: 'Error' | 'Warning' | 'Info' | 'Hint'
    source?: string
    code?: string
    range: { start: { line: number; character: number }; end: { line: number; character: number } }
  }[]
}

export interface IdeEditorState {
  openEditors: { filePath: string; isActive: boolean; isDirty: boolean; languageId: string }[]
  dirty: string[]
}

/* ---------------- Notifications ---------------- */

export interface ToastMessage {
  id: string
  level: 'info' | 'success' | 'warning' | 'error'
  title: string
  detail?: string
  actions?: { label: string; command: string; args?: unknown }[]
  timeout?: number
}
