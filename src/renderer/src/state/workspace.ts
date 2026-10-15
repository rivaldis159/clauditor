import type { PersistedTab } from '@shared/types'
import { t } from '@/lib/i18n'
import { errorText, invoke } from '@/lib/ipc'
import * as P from '@/lib/paths'
import { prompt, useApp } from './app'
import { useEditors } from './editors'
import { useExplorer } from './explorer'
import { useGit } from './git'
import { autoFollow } from './follow'
import { useSessions } from './sessions'
import { useActivity } from './activity'

let persistTimer: ReturnType<typeof setTimeout> | null = null

export function persistWorkspaceState(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    const ws = useApp.getState().workspace
    if (!ws) return
    const ed = useEditors.getState()
    const tabs: PersistedTab[] = []
    for (const g of ed.groups) for (const t of g.tabs) if (t.kind === 'file' && !tabs.some((x) => P.samePath(x.path, t.path))) tabs.push({ kind: 'file', path: t.path, pinned: !t.preview })
    const ex = useExplorer.getState()
    const expanded = Object.keys(ex.expanded)
      .map((k) => findOriginal(k))
      .filter((x): x is string => !!x)
    const agentSessionId = useSessions.getState().activeId
    void invoke('state:update', { workspaces: { [ws.root]: { tabs, activePath: ed.activePath(), expanded, agentSessionId } } })
  }, 600)
}

function findOriginal(k: string): string | null {
  const ex = useExplorer.getState()
  for (const entries of Object.values(ex.children)) {
    for (const e of entries) if (P.key(e.path) === k) return e.path
  }
  return null
}

export async function openFolder(path?: string | null): Promise<boolean> {
  const app = useApp.getState()
  const target = path ?? (await invoke('app:pickFolder'))
  if (!target) return false
  if (app.workspace && P.samePath(app.workspace.root, target)) return true
  if (!(await useEditors.getState().closeAll())) return false
  try {
    const info = await invoke('workspace:open', target)
    app.setWorkspace(info)
    useActivity.getState().clear()
    const persisted = await invoke('state:get')
    useApp.setState({ persisted })
    const st = persisted.workspaces[info.root]
    await useExplorer.getState().setRoot(info.root, st?.expanded ?? [])
    useGit.getState().refresh()
    // restore tabs
    const ed = useEditors.getState()
    for (const t of st?.tabs ?? []) {
      const exists = await invoke('fs:stat', t.path)
      if (exists.exists && exists.kind === 'file') ed.openFile(t.path, { preview: false, background: true })
    }
    if (st?.activePath) ed.openFile(st.activePath, { preview: false })
    // restore / pick a Claude session for the agent panel
    const sessions = useSessions.getState()
    const live = sessions.live.length ? sessions.live : await invoke('sessions:live')
    sessions.setLive(live)
    if (st?.agentSessionId) await sessions.activate(st.agentSessionId, { follow: app.settings.claude.followLive })
    else {
      const recent = await invoke('sessions:findForCwd', info.root)
      if (recent[0]) await sessions.activate(recent[0].id, { follow: app.settings.claude.followLive })
    }
    autoFollow(live)
    return true
  } catch (err) {
    app.toast({ level: 'error', title: t("Couldn't open folder"), detail: errorText(err) })
    return false
  }
}

export async function closeFolder(): Promise<void> {
  if (!(await useEditors.getState().closeAll())) return
  await invoke('workspace:close')
  useApp.getState().setWorkspace(null)
  await useExplorer.getState().setRoot(null)
  useGit.setState({ status: null, byPath: {}, dirtyDirs: {} })
  useActivity.getState().clear()
}

export async function newFile(parent?: string): Promise<void> {
  const root = useApp.getState().workspace?.root
  const dir = parent ?? root
  if (!dir) {
    useApp.getState().toast({ level: 'info', title: t('Open a folder first') })
    return
  }
  if (useApp.getState().layout.sidebarVisible && useApp.getState().layout.activeView === 'explorer') {
    await useExplorer.getState().startEdit({ mode: 'new-file', parent: dir, initial: '' })
    return
  }
  const name = await prompt(t('New file'), '', t('file-name.ts'), t('In {folder}', { folder: P.displayPath(dir, root) }))
  if (!name) return
  const full = P.join(dir, name)
  try {
    await invoke('fs:createFile', full)
    useEditors.getState().openFile(full, { preview: false, focus: true })
  } catch (err) {
    useApp.getState().toast({ level: 'error', title: t("Couldn't create file"), detail: errorText(err) })
  }
}
