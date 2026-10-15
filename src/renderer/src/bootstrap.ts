import { applyMonacoTheme } from '@/lib/monaco'
import { installKeybindings } from '@/lib/commands'
import { t, tn } from '@/lib/i18n'
import { invoke, on } from '@/lib/ipc'
import { useApp } from '@/state/app'
import { onTerminalExited, useSessions } from '@/state/sessions'
import { useSearch } from '@/state/search'
import { useTerminals } from '@/state/terminals'
import { useEditors } from '@/state/editors'
import { dirtyPaths, getDoc, isDirty, saveDoc } from '@/state/documents'
import { autoFollow, handleFsBatch, initFollow } from '@/state/follow'
import { initIdeBridge } from '@/state/ide'
import { initAutosave } from '@/state/autosave'
import { editorsShowing } from '@/state/editorActions'
import { openFolder, persistWorkspaceState } from '@/state/workspace'
import { useExplorer } from '@/state/explorer'
import { setupCommands, openWelcome, retitleTabs } from './commands'
import { remeasureTerminals, writeTerminal } from '@/components/panel/terminalHost'
import { onClaudeFontsChanged } from '@/lib/claudeFonts'
import { initClaudeEnvironment } from '@/state/claude'

function applyTheme() {
  const { theme, settings } = useApp.getState()
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.accent = settings.accent
  root.style.setProperty('--fs-md', `${settings.uiFontSize}px`)
  root.style.setProperty('--fs-sm', `${settings.uiFontSize - 1}px`)
  root.style.setProperty('--fs-xs', `${settings.uiFontSize - 2}px`)
  root.style.setProperty('--fs-lg', `${settings.uiFontSize + 1}px`)
  applyMonacoTheme(theme)
  const styles = getComputedStyle(root)
  void invoke('app:setTitleBarTheme', { background: styles.getPropertyValue('--bg-0').trim(), symbol: styles.getPropertyValue('--fg-1').trim() })
}

/** Read-only probes used by the end-to-end tests. */
function exposeTestHooks() {
  ;(window as unknown as { __clauditor: unknown }).__clauditor = {
    doc(path: string) {
      const d = getDoc(path)
      if (!d) return null
      return { text: d.model.getValue(), disk: d.diskText, dirty: isDirty(d), conflict: d.conflict, pendingCreate: d.pendingCreate }
    },
    dirty: () => dirtyPaths(),
    activeSession: () => useSessions.getState().activeId,
    /** lets a test exercise the "run fails on login" path even when the preflight knows the answer */
    forgetAuth: () => useSessions.setState({ auth: null }),
    follow: () => useSessions.getState().follow,
    tabs: () => useEditors.getState().groups.flatMap((g) => g.tabs.map((t) => ({ kind: t.kind, title: t.title, active: g.activeId === t.id, preview: t.preview }))),
    layout(path: string) {
      const ed = editorsShowing(path)[0]
      const l = ed?.getLayoutInfo()
      return l ? { width: l.width, contentLeft: l.contentLeft, contentWidth: l.contentWidth, minimapLeft: l.minimap.minimapLeft, minimapWidth: l.minimap.minimapWidth, render: l.minimap.renderMinimap, vscroll: l.verticalScrollbarWidth } : null
    },
    visibleLines(path: string) {
      const ed = editorsShowing(path)[0]
      const r = ed?.getVisibleRanges()[0]
      return r ? [r.startLineNumber, r.endLineNumber] : null
    },
    claudeDecorations(path: string) {
      const d = getDoc(path)
      if (!d) return 0
      return d.model.getAllDecorations().filter((x) => x.options.className === 'claude-line-flash' || x.options.linesDecorationsClassName === 'claude-gutter').length
    }
  }
}

export async function bootstrap(): Promise<void> {
  exposeTestHooks()
  await useApp.getState().init()
  applyTheme()
  // Claude's fonts and model list, before the first paint when Claude is installed
  onClaudeFontsChanged(remeasureTerminals)
  await initClaudeEnvironment()
  let lastTheme = `${useApp.getState().theme}/${useApp.getState().settings.accent}/${useApp.getState().settings.uiFontSize}`
  let lastLanguage = useApp.getState().settings.language
  document.documentElement.lang = lastLanguage
  useApp.subscribe((s) => {
    const key = `${s.theme}/${s.settings.accent}/${s.settings.uiFontSize}`
    if (key !== lastTheme) {
      lastTheme = key
      applyTheme()
    }
    if (s.settings.language !== lastLanguage) {
      lastLanguage = s.settings.language
      document.documentElement.lang = lastLanguage
      retitleTabs()
    }
  })
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const s = useApp.getState()
    if (s.settings.theme === 'system') useApp.setState({ theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' })
  })

  setupCommands()
  installKeybindings()
  initFollow()
  initIdeBridge()
  initAutosave()

  on('fs:changed', handleFsBatch)
  on('search:progress', (p) => useSearch.getState().onProgress(p))
  on('search:done', (d) => useSearch.getState().onDone(d))
  on('terminal:data', ({ id, data }) => writeTerminal(id, data))
  on('terminal:exit', ({ id, exitCode }) => {
    useTerminals.getState().markExited(id, exitCode)
    void onTerminalExited(id)
  })
  on('sessions:update', (u) => useSessions.getState().applyUpdate(u))
  on('sessions:live', (list) => {
    useSessions.getState().setLive(list)
    autoFollow(list)
  })
  let listTimer: ReturnType<typeof setTimeout> | null = null
  on('sessions:listChanged', () => {
    if (listTimer) return
    listTimer = setTimeout(() => {
      listTimer = null
      void useSessions.getState().refreshList()
    }, 400)
  })
  on('runner:state', (info) => useSessions.getState().onRunnerState(info))
  on('runner:stream', (u) => useSessions.getState().onStream(u))
  on('runner:permission', (r) => useSessions.getState().addPermission(r))
  on('runner:permissionResolved', ({ runId, requestId }) => useSessions.getState().removePermission(runId, requestId))
  on('runner:auth', (st) => useSessions.getState().setAuth(st))
  // after signing in from a browser or another terminal, coming back to Clauditor clears the banner
  window.addEventListener('focus', () => {
    const auth = useSessions.getState().auth
    if (auth?.loggedIn === false && Date.now() - auth.checkedAt > 10_000) void useSessions.getState().checkAuth(true)
  })
  on('settings:changed', (settings) => {
    const theme = settings.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : settings.theme
    useApp.setState({ settings, theme })
  })
  on('app:maximized', (m) => useApp.setState({ maximized: m }))
  on('app:openFolder', (folder) => void openFolder(folder))
  on('app:beforeQuit', async () => {
    void invoke('app:quitAck')
    const dirty = dirtyPaths()
    if (dirty.length) {
      const r = await useApp.getState().ask({
        title: tn(dirty.length, 'Save changes to {n} file before quitting?', 'Save changes to {n} files before quitting?'),
        message: dirty.map((d) => d.split('\\').pop()).join(', '),
        buttons: [
          { label: t('Cancel'), value: 'cancel', kind: 'ghost' },
          { label: t("Don't save"), value: 'discard', kind: 'ghost' },
          { label: t('Save & quit'), value: 'save', kind: 'primary' }
        ]
      })
      if (r.button === 'cancel' || r.button === null) return
      if (r.button === 'save') for (const d of dirty) await saveDoc(d)
    }
    persistWorkspaceState()
    await new Promise((res) => setTimeout(res, 50))
    await invoke('app:confirmQuit')
  })

  // persist per-workspace UI state whenever tabs or the tree change
  useEditors.subscribe(persistWorkspaceState)
  useExplorer.subscribe((s, prev) => {
    if (s.expanded !== prev.expanded) persistWorkspaceState()
  })

  const [live] = await Promise.all([invoke('sessions:live'), useSessions.getState().refreshList(), useTerminals.getState().loadProfiles()])
  useSessions.getState().setLive(live)
  useSessions.setState({ follow: useApp.getState().settings.claude.followLive })
  void useSessions.getState().checkAuth()

  const { info, persisted } = useApp.getState()
  const folder = info?.initialFolder ?? persisted.lastFolder
  let opened = false
  if (folder) {
    const st = await invoke('fs:stat', folder)
    if (st.exists && st.kind === 'dir') opened = await openFolder(folder)
  }
  if (!opened) openWelcome()
  else if (!useEditors.getState().activeTab()) openWelcome()
}
