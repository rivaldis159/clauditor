import type { AppState, DeepPartial, Settings } from './types'

/** Claude's code font first (loaded from the Claude desktop install), then open fallbacks. */
export const EDITOR_FONT = "'Anthropic Mono', 'JetBrains Mono Variable', 'Cascadia Code', Consolas, 'Courier New', monospace"
export const TERMINAL_FONT = "'Anthropic Mono', 'JetBrains Mono Variable', 'Cascadia Mono', Consolas, 'Courier New', monospace"
/** Defaults of earlier releases; settings still holding them follow the new defaults. */
export const LEGACY_FONTS: Record<string, string> = {
  "'JetBrains Mono Variable', 'Cascadia Code', Consolas, 'Courier New', monospace": EDITOR_FONT,
  "'JetBrains Mono Variable', 'Cascadia Mono', Consolas, 'Courier New', monospace": TERMINAL_FONT
}

export function defaultSettings(): Settings {
  return {
    language: 'en',
    theme: 'dark',
    accent: 'orange',
    uiFontSize: 13,
    editor: {
      fontFamily: EDITOR_FONT,
      fontSize: 14,
      lineHeight: 22,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: 'off',
      minimap: true,
      lineNumbers: 'on',
      renderWhitespace: 'selection',
      fontLigatures: true,
      autoSave: 'afterDelay',
      autoSaveDelay: 1000,
      formatOnSave: false,
      stickyScroll: true,
      smoothScrolling: true,
      bracketPairColorization: true,
      gitGutter: true
    },
    terminal: {
      shell: 'auto',
      fontFamily: TERMINAL_FONT,
      fontSize: 13,
      cursorBlink: true
    },
    claude: {
      executablePath: '',
      defaultModel: '',
      defaultPermissionMode: 'default',
      defaultEffort: '',
      followLive: true,
      followOpensFiles: true,
      animateEdits: true,
      notifyOnIdle: true,
      ideBridge: true,
      autoFollowWorkspace: true,
      syncSdk: true
    },
    files: {
      exclude: ['.git', 'node_modules/.cache', '__pycache__', '.DS_Store', 'Thumbs.db'],
      showHidden: true,
      confirmDelete: true
    }
  }
}

export function defaultAppState(): AppState {
  return {
    recentFolders: [],
    lastFolder: null,
    layout: {
      sidebarVisible: true,
      sidebarWidth: 272,
      panelVisible: false,
      panelHeight: 248,
      agentVisible: true,
      agentWidth: 440,
      activeView: 'explorer'
    },
    workspaces: {},
    hostSessionIds: {}
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Merge `patch` into `base`, returning a new object; arrays and primitives replace. */
export function deepMerge<T>(base: T, patch: DeepPartial<T> | unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    const cur = (base as Record<string, unknown>)[k]
    out[k] = isPlainObject(cur) && isPlainObject(v) ? deepMerge(cur, v) : v
  }
  return out as T
}

/** Keep only keys known by the defaults so stale/unknown keys never leak into the app. */
export function conform<T>(defaults: T, raw: unknown): T {
  if (!isPlainObject(defaults)) return (raw === undefined || raw === null ? defaults : raw) as T
  const src = isPlainObject(raw) ? raw : {}
  const out: Record<string, unknown> = {}
  for (const [k, dv] of Object.entries(defaults)) {
    const rv = src[k]
    if (rv === undefined) out[k] = dv
    else if (isPlainObject(dv)) out[k] = conform(dv, rv)
    else if (Array.isArray(dv)) out[k] = Array.isArray(rv) ? rv : dv
    else if (dv === null) out[k] = rv
    else out[k] = typeof rv === typeof dv ? rv : dv
  }
  return out as T
}
