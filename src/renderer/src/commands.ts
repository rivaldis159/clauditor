import { LOCALES, translate } from '@shared/i18n'
import { registerCommands } from '@/lib/commands'
import { invoke } from '@/lib/ipc'
import { focusComposer } from '@/lib/bus'
import { t, tk, tn } from '@/lib/i18n'
import * as P from '@/lib/paths'
import { useApp } from '@/state/app'
import { useEditors, type Tab } from '@/state/editors'
import { useExplorer } from '@/state/explorer'
import { useGit } from '@/state/git'
import { loginClaude, useSessions, runnerForSession, sessionTitle } from '@/state/sessions'
import { useTerminals } from '@/state/terminals'
import { useActivity } from '@/state/activity'
import { closeFolder, newFile, openFolder } from '@/state/workspace'
import { mentionSelection } from '@/state/ide'
import { editorsShowing, focusedEditor } from '@/state/editorActions'
import { getDoc } from '@/state/documents'

const app = () => useApp.getState()
const ed = () => useEditors.getState()
const hasWs = () => !!useApp.getState().workspace
const hasFile = () => useEditors.getState().activeTab()?.kind === 'file'

const OVERVIEW_TITLE = tk('Overview · {title}')
const REPLAY_TITLE = tk('Replay · {title}')

const markdownTitle = (path: string) => t('Preview {name}', { name: P.basename(path) })

export function openSettings() {
  ed().openTab({ kind: 'settings', title: t('Settings') })
}

export function openWelcome() {
  ed().openTab({ kind: 'welcome', title: t('Welcome') })
}

/** The session part of an overview/replay tab title, when `title` has that shape in any language. */
function sessionPart(title: string, key: string): string | null {
  for (const { value } of LOCALES) {
    const [head, tail = ''] = translate(value, key, { title: '\u0000' }).split('\u0000')
    if (title.length >= head.length + tail.length && title.startsWith(head) && title.endsWith(tail)) return title.slice(head.length, title.length - tail.length)
  }
  return null
}

/** Title of a tab opened with translated text, in the current language; null for other tabs. */
function localizedTitle(tab: Tab): string | null {
  switch (tab.kind) {
    case 'settings':
      return t('Settings')
    case 'welcome':
      return t('Welcome')
    case 'markdown':
      return markdownTitle(tab.path)
    case 'overview':
    case 'replay': {
      const key = tab.kind === 'overview' ? OVERVIEW_TITLE : REPLAY_TITLE
      const part = sessionPart(tab.title, key)
      if (part === null) return null
      const s = useSessions.getState()
      const meta = s.data[tab.sessionId]?.meta ?? s.groups.flatMap((g) => g.sessions).find((m) => m.id === tab.sessionId)
      return t(key, { title: meta ? sessionTitle(meta) : part })
    }
    default:
      return null
  }
}

/** Tab titles are stored as plain text: re-translate them after the UI language changes. */
export function retitleTabs(): void {
  const retitle = (tab: Tab): Tab => {
    const title = localizedTitle(tab)
    return title === null || title === tab.title ? tab : { ...tab, title }
  }
  const st = ed()
  const groups = st.groups.map((g) => {
    const tabs = g.tabs.map(retitle)
    return tabs.every((x, i) => x === g.tabs[i]) ? g : { ...g, tabs }
  })
  const closedStack = st.closedStack.map(retitle)
  if (groups.some((g, i) => g !== st.groups[i]) || closedStack.some((x, i) => x !== st.closedStack[i])) useEditors.setState({ groups, closedStack })
}

export async function newDesktopSession(prompt?: string) {
  const ws = app().workspace
  if (!ws) {
    app().toast({ level: 'info', title: t('Open a project folder first'), detail: t('The Claude desktop session will be created for that folder.') })
    return
  }
  const r = await invoke('desktop:newSession', ws.root, prompt)
  if (!r.ok) app().toast({ level: 'error', title: t('Claude desktop is not responding'), detail: t('Make sure the Claude app is installed.') })
}

export async function openActiveInDesktop() {
  const id = useSessions.getState().activeId
  if (!id) return
  const r = await invoke('desktop:openSession', id)
  if (!r.ok) app().toast({ level: 'error', title: t("Couldn't open Claude desktop") })
}

export function selectionReference(): string | null {
  const path = ed().activePath()
  if (!path) return null
  const e = editorsShowing(path)[0]
  const sel = e?.getSelection()
  const model = e?.getModel()
  const root = app().workspace?.root
  const rel = P.displayPath(path, root)
  if (!e || !sel || !model || sel.isEmpty()) return `@${rel}`
  const text = model.getValueInRange(sel)
  const lang = model.getLanguageId()
  return `@${rel}#L${sel.startLineNumber}-${sel.endLineNumber}\n\`\`\`${lang}\n${text}\n\`\`\``
}

export function setupCommands() {
  const GENERAL = tk('General')
  const FILE = tk('File')
  const EDITOR = tk('Editor')
  const VIEW = tk('View')
  const TERMINAL = tk('Terminal')
  const CLAUDE = tk('Claude')
  const GIT = tk('Git')
  const HELP = tk('Help')
  registerCommands([
    { id: 'workbench.palette', title: tk('Command palette'), category: GENERAL, keys: 'Ctrl+Shift+P|F1', allowInInput: true, run: () => app().openPalette('commands') },
    { id: 'workbench.quickOpen', title: tk('Quick open file…'), category: GENERAL, keys: 'Ctrl+P|Ctrl+E', allowInInput: true, run: () => app().openPalette('files') },
    { id: 'workbench.recent', title: tk('Open recent folder…'), category: FILE, keys: 'Ctrl+R', run: () => app().openPalette('recent') },
    { id: 'workbench.gotoLine', title: tk('Go to line…'), category: EDITOR, when: hasFile, run: () => app().openPalette('goto', ':') },
    { id: 'file.openFolder', title: tk('Open folder…'), category: FILE, keys: 'Ctrl+O', run: () => void openFolder() },
    { id: 'file.closeFolder', title: tk('Close folder'), category: FILE, when: hasWs, run: () => void closeFolder() },
    { id: 'file.new', title: tk('New file…'), category: FILE, keys: 'Ctrl+N', run: () => void newFile() },
    { id: 'file.save', title: tk('Save'), category: FILE, keys: 'Ctrl+S', allowInInput: true, run: () => void ed().saveActive() },
    {
      id: 'file.saveAll',
      title: tk('Save all'),
      category: FILE,
      keys: 'Ctrl+Alt+S',
      run: async () => {
        const n = await ed().saveAll()
        if (n) app().toast({ level: 'success', title: tn(n, 'Saved {n} file', 'Saved {n} files') })
      }
    },
    {
      id: 'editor.close',
      title: tk('Close tab'),
      category: EDITOR,
      keys: 'Ctrl+W|Ctrl+F4',
      run: () => {
        const st = ed()
        const g = st.groups.find((x) => x.id === st.activeGroupId)
        if (g?.activeId) void st.closeTab(g.id, g.activeId)
      }
    },
    { id: 'editor.closeAll', title: tk('Close all tabs'), category: EDITOR, run: () => void ed().closeAll() },
    { id: 'editor.reopen', title: tk('Reopen closed tab'), category: EDITOR, keys: 'Ctrl+Shift+T', run: () => ed().reopenClosed() },
    { id: 'editor.next', title: tk('Next tab'), category: EDITOR, keys: 'Ctrl+Tab|Ctrl+PageDown', allowInInput: true, run: () => ed().cycle(1) },
    { id: 'editor.prev', title: tk('Previous tab'), category: EDITOR, keys: 'Ctrl+Shift+Tab|Ctrl+PageUp', allowInInput: true, run: () => ed().cycle(-1) },
    { id: 'editor.split', title: tk('Split editor right'), category: EDITOR, keys: 'Ctrl+\\', run: () => ed().split() },
    {
      id: 'editor.markdownPreview',
      title: tk('Open Markdown preview'),
      category: EDITOR,
      keys: 'Ctrl+Shift+V',
      when: () => /\.(md|markdown|mdx)$/i.test(ed().activePath() ?? ''),
      run: () => {
        const p = ed().activePath()
        if (p) ed().openTab({ kind: 'markdown', path: p, title: markdownTitle(p) })
      }
    },
    {
      id: 'editor.revealInExplorer',
      title: tk('Reveal file in Explorer'),
      category: EDITOR,
      when: () => !!ed().activePath(),
      run: () => {
        const p = ed().activePath()
        if (!p) return
        app().setLayout({ sidebarVisible: true, activeView: 'explorer' })
        void useExplorer.getState().reveal(p)
      }
    },
    {
      id: 'editor.revealInOs',
      title: tk('Reveal in File Explorer'),
      category: EDITOR,
      when: () => !!ed().activePath(),
      run: () => void invoke('app:revealPath', ed().activePath()!)
    },
    {
      id: 'editor.copyPath',
      title: tk('Copy file path'),
      category: EDITOR,
      when: () => !!ed().activePath(),
      run: () => void navigator.clipboard.writeText(ed().activePath()!)
    },
    {
      id: 'editor.copyRelativePath',
      title: tk('Copy relative path'),
      category: EDITOR,
      when: () => !!ed().activePath() && hasWs(),
      run: () => void navigator.clipboard.writeText(P.displayPath(ed().activePath()!, app().workspace?.root))
    },
    {
      id: 'editor.format',
      title: tk('Format document'),
      category: EDITOR,
      keys: 'Shift+Alt+F',
      allowInInput: true,
      when: hasFile,
      run: () => {
        const p = ed().activePath()
        const e = (p && editorsShowing(p)[0]) || focusedEditor()
        void e?.getAction('editor.action.formatDocument')?.run()
      }
    },
    { id: 'view.sidebar', title: tk('Show/hide sidebar'), category: VIEW, keys: 'Ctrl+B', allowInInput: true, run: () => app().toggleSidebar() },
    { id: 'view.panel', title: tk('Show/hide panel'), category: VIEW, keys: 'Ctrl+J', allowInInput: true, run: () => app().togglePanel() },
    { id: 'view.agent', title: tk('Show/hide Claude panel'), category: VIEW, keys: 'Ctrl+Alt+B', allowInInput: true, run: () => app().toggleAgent() },
    { id: 'view.explorer', title: tk('Explorer'), category: VIEW, keys: 'Ctrl+Shift+E', run: () => app().setLayout({ sidebarVisible: true, activeView: 'explorer' }) },
    { id: 'view.search', title: tk('Search in files'), category: VIEW, keys: 'Ctrl+Shift+F', allowInInput: true, run: () => app().setLayout({ sidebarVisible: true, activeView: 'search' }) },
    { id: 'view.scm', title: tk('Source control (Git)'), category: VIEW, keys: 'Ctrl+Shift+G', run: () => app().setLayout({ sidebarVisible: true, activeView: 'scm' }) },
    { id: 'view.sessions', title: tk('Claude sessions'), category: VIEW, keys: 'Ctrl+Shift+A', run: () => app().setLayout({ sidebarVisible: true, activeView: 'sessions' }) },
    { id: 'view.problems', title: tk('Problems'), category: VIEW, keys: 'Ctrl+Shift+M', run: () => (app().setPanelTab('problems'), app().togglePanel(true)) },
    {
      id: 'terminal.toggle',
      title: tk('Show/hide terminal'),
      category: TERMINAL,
      keys: 'Ctrl+`',
      allowInInput: true,
      run: () => {
        // the terminal view creates the first terminal itself when it becomes visible
        const a = app()
        if (a.layout.panelVisible && a.panelTab === 'terminal') a.togglePanel(false)
        else {
          a.setPanelTab('terminal')
          a.togglePanel(true)
        }
      }
    },
    { id: 'terminal.new', title: tk('New terminal'), category: TERMINAL, keys: 'Ctrl+Shift+`', allowInInput: true, run: () => void useTerminals.getState().create() },
    {
      id: 'terminal.claude',
      title: tk('New Claude Code (CLI) terminal'),
      category: CLAUDE,
      run: () => void useTerminals.getState().create({ profile: 'claude', name: 'Claude Code' })
    },
    { id: 'claude.login', title: tk('Sign in to Claude Code'), category: CLAUDE, run: () => void loginClaude() },
    {
      id: 'claude.focusComposer',
      title: tk('Message Claude'),
      category: CLAUDE,
      keys: 'Ctrl+L',
      allowInInput: true,
      run: () => {
        app().toggleAgent(true)
        focusComposer.emit({})
      }
    },
    {
      id: 'claude.addSelection',
      title: tk('Add selection to Claude message'),
      category: CLAUDE,
      keys: 'Ctrl+Alt+L',
      allowInInput: true,
      when: () => !!ed().activePath(),
      run: () => {
        const ref = selectionReference()
        app().toggleAgent(true)
        focusComposer.emit({ text: ref ? `${ref}\n` : undefined })
      }
    },
    { id: 'claude.mention', title: tk('Send selection to Claude Code (IDE)'), category: CLAUDE, keys: 'Ctrl+Alt+K', allowInInput: true, run: () => void mentionSelection() },
    {
      id: 'claude.follow',
      title: tk('Follow Claude (on/off)'),
      category: CLAUDE,
      keys: 'Ctrl+Alt+F',
      allowInInput: true,
      run: () => {
        const s = useSessions.getState()
        s.setFollow(!s.follow)
        app().toast({ level: 'info', title: s.follow ? t('Follow mode turned off') : t('Follow mode turned on'), detail: s.follow ? undefined : t('Clauditor will open the files Claude is editing.') })
      }
    },
    {
      id: 'claude.newSession',
      title: tk('New Claude session in Clauditor'),
      category: CLAUDE,
      keys: 'Ctrl+Alt+N',
      run: () => {
        void useSessions.getState().activate(null)
        app().toggleAgent(true)
        focusComposer.emit({})
      }
    },
    { id: 'claude.newDesktop', title: tk('New session in Claude desktop'), category: CLAUDE, when: hasWs, run: () => void newDesktopSession() },
    { id: 'claude.openInDesktop', title: tk('Open this session in Claude desktop'), category: CLAUDE, when: () => !!useSessions.getState().activeId, run: () => void openActiveInDesktop() },
    { id: 'claude.sessions', title: tk('Search Claude sessions…'), category: CLAUDE, keys: 'Ctrl+Alt+P', allowInInput: true, run: () => app().openPalette('sessions') },
    {
      id: 'claude.overview',
      title: tk('Active session overview'),
      category: CLAUDE,
      when: () => !!useSessions.getState().activeId,
      run: () => {
        const s = useSessions.getState()
        const id = s.activeId!
        ed().openTab({ kind: 'overview', sessionId: id, title: t(OVERVIEW_TITLE, { title: sessionTitle(s.data[id]?.meta) }) })
      }
    },
    {
      id: 'claude.replay',
      title: tk('Replay active session'),
      category: CLAUDE,
      when: () => !!useSessions.getState().activeId,
      run: () => {
        const s = useSessions.getState()
        const id = s.activeId!
        ed().openTab({ kind: 'replay', sessionId: id, title: t(REPLAY_TITLE, { title: sessionTitle(s.data[id]?.meta) }) })
      }
    },
    {
      id: 'claude.interrupt',
      title: tk('Stop Claude (Clauditor session)'),
      category: CLAUDE,
      keys: 'Ctrl+Alt+Backspace',
      when: () => {
        const s = useSessions.getState()
        return runnerForSession(s, s.activeId)?.state === 'running'
      },
      run: () => {
        const s = useSessions.getState()
        const r = runnerForSession(s, s.activeId)
        if (r) void s.interrupt(r.runId)
      }
    },
    { id: 'claude.clearHighlights', title: tk('Clear Claude highlights'), category: CLAUDE, run: () => useActivity.getState().clear() },
    { id: 'claude.refreshSessions', title: tk('Reload session list'), category: CLAUDE, run: () => void useSessions.getState().refreshList() },
    { id: 'git.commit', title: tk('Commit'), category: GIT, when: () => !!useGit.getState().status?.isRepo, run: () => void useGit.getState().commit() },
    { id: 'git.refresh', title: tk('Refresh Git status'), category: GIT, run: () => void useGit.getState().refreshNow() },
    { id: 'git.checkout', title: tk('Switch branch…'), category: GIT, when: () => !!useGit.getState().status?.isRepo, run: () => app().openPalette('branches') },
    { id: 'git.pull', title: tk('Pull'), category: GIT, when: () => !!useGit.getState().status?.isRepo, run: () => void useGit.getState().sync('pull') },
    { id: 'git.push', title: tk('Push'), category: GIT, when: () => !!useGit.getState().status?.isRepo, run: () => void useGit.getState().sync('push') },
    { id: 'git.fetch', title: tk('Fetch'), category: GIT, when: () => !!useGit.getState().status?.isRepo, run: () => void useGit.getState().sync('fetch') },
    { id: 'git.init', title: tk('Initialize Git repository'), category: GIT, when: () => hasWs() && !useGit.getState().status?.isRepo, run: () => void useGit.getState().init() },
    { id: 'git.generateMessage', title: tk('Generate commit message with Claude'), category: GIT, when: () => !!useGit.getState().status?.isRepo, run: () => void useGit.getState().generateMessage() },
    { id: 'app.settings', title: tk('Settings'), category: GENERAL, keys: 'Ctrl+,', allowInInput: true, run: openSettings },
    { id: 'app.welcome', title: tk('Welcome page'), category: HELP, run: openWelcome },
    {
      id: 'app.toggleTheme',
      title: tk('Toggle dark/light theme'),
      category: VIEW,
      keys: 'Ctrl+Alt+T',
      run: () => void app().updateSettings({ theme: app().theme === 'dark' ? 'light' : 'dark' })
    },
    { id: 'app.zoomIn', title: tk('Zoom in'), category: VIEW, keys: 'Ctrl+=|Ctrl+Shift+=', allowInInput: true, run: () => void invoke('app:windowAction', 'zoomIn') },
    { id: 'app.zoomOut', title: tk('Zoom out'), category: VIEW, keys: 'Ctrl+-', allowInInput: true, run: () => void invoke('app:windowAction', 'zoomOut') },
    { id: 'app.zoomReset', title: tk('Reset zoom'), category: VIEW, keys: 'Ctrl+0', allowInInput: true, run: () => void invoke('app:windowAction', 'zoomReset') },
    { id: 'app.fullscreen', title: tk('Full screen'), category: VIEW, keys: 'F11', allowInInput: true, run: () => void invoke('app:windowAction', 'fullscreen') },
    { id: 'app.devtools', title: tk('Developer tools'), category: HELP, keys: 'Ctrl+Shift+I', allowInInput: true, run: () => void invoke('app:windowAction', 'devtools') },
    { id: 'app.reload', title: tk('Reload window'), category: HELP, run: () => void invoke('app:windowAction', 'reload') },
    {
      id: 'app.revealDirty',
      title: tk('Force save active file (overwrite disk)'),
      category: FILE,
      when: () => {
        const p = ed().activePath()
        return !!p && !!getDoc(p)?.conflict
      },
      run: async () => {
        const { saveDoc } = await import('@/state/documents')
        const p = ed().activePath()
        if (p) await saveDoc(p, true)
      }
    }
  ])
}
