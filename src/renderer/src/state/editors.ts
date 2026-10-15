import { create } from 'zustand'
import { t, tn } from '@/lib/i18n'
import * as P from '@/lib/paths'
import { closeDoc, dirtyPaths, getDoc, isDirty, onDocsChanged, renameDoc, saveDoc } from './documents'
import { useApp } from './app'

export type DiffSide =
  | { kind: 'text'; text: string; label: string }
  | { kind: 'git'; ref: string; label: string }
  | { kind: 'file'; label: string }
  | { kind: 'backup'; sessionId: string; backup: string | null; label: string }

interface TabBase {
  id: string
  title: string
  preview: boolean
}

export type Tab =
  | (TabBase & { kind: 'file'; path: string })
  | (TabBase & { kind: 'diff'; path: string; left: DiffSide; right: DiffSide; key: string })
  | (TabBase & { kind: 'ide-diff'; path: string; requestId: string; newContents: string; tabName: string })
  | (TabBase & { kind: 'welcome' })
  | (TabBase & { kind: 'settings' })
  | (TabBase & { kind: 'overview'; sessionId: string })
  | (TabBase & { kind: 'replay'; sessionId: string })
  | (TabBase & { kind: 'markdown'; path: string })

export type TabInput = Tab extends infer T ? (T extends Tab ? Omit<T, 'id' | 'preview'> & { preview?: boolean } : never) : never

export interface Group {
  id: string
  tabs: Tab[]
  activeId: string | null
  mru: string[]
}

export interface RevealRequest {
  path: string
  line: number
  column?: number
  endLine?: number
  endColumn?: number
  nonce: number
  highlight?: boolean
}

export interface OpenOptions {
  preview?: boolean
  groupId?: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  focus?: boolean
  highlight?: boolean
  /** do not change the active tab when the file is already open elsewhere */
  background?: boolean
}

interface EditorStore {
  groups: Group[]
  activeGroupId: string
  dirty: Record<string, true>
  conflicts: Record<string, true>
  deleted: Record<string, true>
  closedStack: Tab[]
  reveal: RevealRequest | null
  focusNonce: number

  openFile(path: string, opts?: OpenOptions): void
  openTab(input: TabInput, opts?: { groupId?: string; preview?: boolean; background?: boolean }): string
  findTab(pred: (t: Tab) => boolean): { group: Group; tab: Tab } | null
  setActive(groupId: string, tabId: string): void
  focusGroup(groupId: string): void
  pin(groupId: string, tabId: string): void
  closeTab(groupId: string, tabId: string, opts?: { force?: boolean }): Promise<boolean>
  closeOthers(groupId: string, tabId: string): Promise<void>
  closeToRight(groupId: string, tabId: string): Promise<void>
  closeAll(opts?: { force?: boolean }): Promise<boolean>
  closeWhere(pred: (t: Tab) => boolean): void
  reopenClosed(): void
  cycle(dir: 1 | -1): void
  split(): void
  moveTab(fromGroupId: string, tabId: string, toGroupId: string, index?: number): void
  reorder(groupId: string, tabId: string, index: number): void
  activeTab(): Tab | null
  activePath(): string | null
  saveActive(): Promise<void>
  saveAll(): Promise<number>
  renamePath(oldPath: string, newPath: string): void
  syncDocFlags(): void
}

let seq = 0
const newId = () => `tab${++seq}`
const firstGroup: Group = { id: 'g1', tabs: [], activeId: null, mru: [] }

function tabKey(t: TabInput | Tab): string {
  switch (t.kind) {
    case 'file':
      return `file:${P.key(t.path)}`
    case 'diff':
      return `diff:${t.key}`
    case 'ide-diff':
      return `ide:${t.requestId}`
    case 'overview':
      return `overview:${t.sessionId}`
    case 'replay':
      return `replay:${t.sessionId}`
    case 'markdown':
      return `md:${P.key(t.path)}`
    default:
      return t.kind
  }
}

function filePathOf(t: Tab): string | null {
  return t.kind === 'file' ? t.path : null
}

function stillReferenced(groups: Group[], path: string): boolean {
  const k = P.key(path)
  return groups.some((g) => g.tabs.some((t) => (t.kind === 'file' || t.kind === 'diff' || t.kind === 'markdown') && P.key(t.path) === k))
}

export const useEditors = create<EditorStore>((set, get) => ({
  groups: [firstGroup],
  activeGroupId: 'g1',
  dirty: {},
  conflicts: {},
  deleted: {},
  closedStack: [],
  reveal: null,
  focusNonce: 0,

  openFile(path, opts = {}) {
    const p = P.normalize(path)
    const st = get()
    const groupId = opts.groupId ?? st.activeGroupId
    const want = `file:${P.key(p)}`
    // already open in the target group?
    let found = st.groups.find((g) => g.id === groupId)?.tabs.find((t) => tabKey(t) === want)
    let gid = groupId
    if (!found) {
      for (const g of st.groups) {
        const t = g.tabs.find((x) => tabKey(x) === want)
        if (t) {
          found = t
          gid = g.id
          break
        }
      }
    }
    if (found) {
      if (opts.preview === false && found.preview) get().pin(gid, found.id)
      if (!opts.background) get().setActive(gid, found.id)
    } else {
      get().openTab({ kind: 'file', path: p, title: P.basename(p) }, { groupId, preview: opts.preview ?? true, background: opts.background })
    }
    if (opts.line) {
      set({ reveal: { path: p, line: opts.line, column: opts.column, endLine: opts.endLine, endColumn: opts.endColumn, nonce: Date.now(), highlight: opts.highlight } })
    }
    if (opts.focus) set({ focusNonce: get().focusNonce + 1 })
  },

  openTab(input, opts = {}) {
    const st = get()
    const groupId = opts.groupId ?? st.activeGroupId
    const key = tabKey(input)
    for (const g of st.groups) {
      const existing = g.tabs.find((t) => tabKey(t) === key)
      if (existing) {
        if (input.kind === 'ide-diff' || input.kind === 'diff') {
          // refresh content
          set({ groups: st.groups.map((gg) => (gg.id !== g.id ? gg : { ...gg, tabs: gg.tabs.map((t) => (t.id === existing.id ? ({ ...t, ...input } as Tab) : t)) })) })
        }
        if (!opts.background) get().setActive(g.id, existing.id)
        return existing.id
      }
    }
    const preview = opts.preview ?? input.preview ?? false
    const tab = { ...input, id: newId(), preview } as Tab
    const groups = st.groups.map((g) => {
      if (g.id !== groupId) return g
      let tabs = [...g.tabs]
      const activeIdx = tabs.findIndex((t) => t.id === g.activeId)
      // a new preview replaces the existing preview tab (if clean)
      const previewIdx = preview ? tabs.findIndex((t) => t.preview && !(filePathOf(t) && isDirty(getDoc(filePathOf(t)!)))) : -1
      let insertAt = activeIdx >= 0 ? activeIdx + 1 : tabs.length
      if (previewIdx >= 0) {
        const old = tabs[previewIdx]
        tabs.splice(previewIdx, 1, tab)
        insertAt = -1
        queueMicrotask(() => {
          const fp = filePathOf(old)
          if (fp && !stillReferenced(get().groups, fp)) closeDoc(fp)
        })
      }
      if (insertAt >= 0) tabs.splice(insertAt, 0, tab)
      tabs = tabs.slice()
      return {
        ...g,
        tabs,
        activeId: opts.background && g.activeId ? g.activeId : tab.id,
        mru: opts.background ? [...g.mru, tab.id] : [tab.id, ...g.mru.filter((id) => tabs.some((t) => t.id === id))]
      }
    })
    set({ groups, activeGroupId: opts.background ? st.activeGroupId : groupId })
    return tab.id
  },

  findTab(pred) {
    for (const group of get().groups) {
      const tab = group.tabs.find(pred)
      if (tab) return { group, tab }
    }
    return null
  },

  setActive(groupId, tabId) {
    set({
      activeGroupId: groupId,
      groups: get().groups.map((g) => (g.id !== groupId ? g : { ...g, activeId: tabId, mru: [tabId, ...g.mru.filter((id) => id !== tabId)] }))
    })
  },

  focusGroup(groupId) {
    if (get().activeGroupId !== groupId) set({ activeGroupId: groupId })
  },

  pin(groupId, tabId) {
    set({ groups: get().groups.map((g) => (g.id !== groupId ? g : { ...g, tabs: g.tabs.map((t) => (t.id === tabId ? { ...t, preview: false } : t)) })) })
  },

  async closeTab(groupId, tabId, opts = {}) {
    const g = get().groups.find((x) => x.id === groupId)
    const tab = g?.tabs.find((t) => t.id === tabId)
    if (!g || !tab) return true
    const fp = filePathOf(tab)
    if (fp && !opts.force) {
      const doc = getDoc(fp)
      const otherRefs = get().groups.some((gg) => gg.tabs.some((t) => t.id !== tabId && t.kind === 'file' && P.samePath(t.path, fp)))
      if (doc && isDirty(doc) && !otherRefs) {
        const r = await useApp.getState().ask({
          title: t('Save changes to {name}?', { name: P.basename(fp) }),
          message: t("Your changes will be lost if you don't save them."),
          buttons: [
            { label: t('Cancel'), value: 'cancel', kind: 'ghost' },
            { label: t("Don't save"), value: 'discard', kind: 'ghost' },
            { label: t('Save'), value: 'save', kind: 'primary' }
          ]
        })
        if (r.button === 'save') {
          const res = await saveDoc(fp)
          if (res !== 'saved' && res !== 'clean') return false
        } else if (r.button !== 'discard') return false
      }
    }
    if (tab.kind === 'ide-diff') {
      // closing an IDE diff without choosing counts as "tab closed" for Claude Code
      void import('./ide').then((m) => m.resolveIdeDiff(tab.requestId, { accepted: false, closed: true }))
    }
    const state = get()
    const groups = state.groups
      .map((gg) => {
        if (gg.id !== groupId) return gg
        const idx = gg.tabs.findIndex((t) => t.id === tabId)
        const tabs = gg.tabs.filter((t) => t.id !== tabId)
        const mru = gg.mru.filter((id) => id !== tabId)
        let activeId = gg.activeId
        if (activeId === tabId) activeId = mru.find((id) => tabs.some((t) => t.id === id)) ?? tabs[Math.min(idx, tabs.length - 1)]?.id ?? null
        return { ...gg, tabs, mru, activeId }
      })
      .filter((gg, i, arr) => gg.tabs.length > 0 || arr.length === 1 || i === 0)
    const activeGroupId = groups.some((gg) => gg.id === state.activeGroupId) ? state.activeGroupId : groups[0].id
    set({ groups, activeGroupId, closedStack: [tab, ...state.closedStack].slice(0, 20) })
    if (fp && !stillReferenced(groups, fp)) closeDoc(fp)
    return true
  },

  async closeOthers(groupId, tabId) {
    const g = get().groups.find((x) => x.id === groupId)
    if (!g) return
    for (const t of g.tabs.filter((x) => x.id !== tabId)) if (!(await get().closeTab(groupId, t.id))) return
  },

  async closeToRight(groupId, tabId) {
    const g = get().groups.find((x) => x.id === groupId)
    if (!g) return
    const idx = g.tabs.findIndex((t) => t.id === tabId)
    for (const t of g.tabs.slice(idx + 1)) if (!(await get().closeTab(groupId, t.id))) return
  },

  async closeAll(opts = {}) {
    if (!opts.force) {
      const dirty = dirtyPaths()
      if (dirty.length) {
        const r = await useApp.getState().ask({
          title: tn(dirty.length, 'Save changes to {n} file?', 'Save changes to {n} files?'),
          message: dirty.map((d) => P.basename(d)).join(', '),
          buttons: [
            { label: t('Cancel'), value: 'cancel', kind: 'ghost' },
            { label: t("Don't save"), value: 'discard', kind: 'ghost' },
            { label: t('Save all'), value: 'save', kind: 'primary' }
          ]
        })
        if (r.button === 'save') {
          for (const d of dirty) await saveDoc(d)
        } else if (r.button !== 'discard') return false
      }
    }
    for (const g of get().groups) for (const t of g.tabs) if (t.kind === 'file') closeDoc(t.path)
    set({ groups: [{ id: 'g1', tabs: [], activeId: null, mru: [] }], activeGroupId: 'g1' })
    return true
  },

  closeWhere(pred) {
    const groups = get().groups.map((g) => {
      const tabs = g.tabs.filter((t) => !pred(t))
      const activeId = tabs.some((t) => t.id === g.activeId) ? g.activeId : (tabs[0]?.id ?? null)
      return { ...g, tabs, activeId, mru: g.mru.filter((id) => tabs.some((t) => t.id === id)) }
    })
    set({ groups })
  },

  reopenClosed() {
    const [tab, ...rest] = get().closedStack
    if (!tab) return
    set({ closedStack: rest })
    if (tab.kind === 'file') get().openFile(tab.path, { preview: false })
    else if (tab.kind !== 'ide-diff') get().openTab(tab as TabInput)
  },

  cycle(dir) {
    const st = get()
    const g = st.groups.find((x) => x.id === st.activeGroupId)
    if (!g || g.tabs.length < 2) return
    const idx = g.tabs.findIndex((t) => t.id === g.activeId)
    const next = g.tabs[(idx + dir + g.tabs.length) % g.tabs.length]
    get().setActive(g.id, next.id)
  },

  split() {
    const st = get()
    const g = st.groups.find((x) => x.id === st.activeGroupId)
    const tab = g?.tabs.find((t) => t.id === g.activeId)
    if (st.groups.length >= 3) return
    const id = `g${Date.now().toString(36)}`
    const copy = tab && tab.kind !== 'ide-diff' ? ({ ...tab, id: newId(), preview: false } as Tab) : null
    const ng: Group = { id, tabs: copy ? [copy] : [], activeId: copy?.id ?? null, mru: copy ? [copy.id] : [] }
    const idx = st.groups.findIndex((x) => x.id === st.activeGroupId)
    const groups = [...st.groups]
    groups.splice(idx + 1, 0, ng)
    set({ groups, activeGroupId: id })
  },

  moveTab(fromGroupId, tabId, toGroupId, index) {
    const st = get()
    const from = st.groups.find((g) => g.id === fromGroupId)
    const tab = from?.tabs.find((t) => t.id === tabId)
    if (!from || !tab) return
    if (fromGroupId === toGroupId) {
      if (index !== undefined) get().reorder(fromGroupId, tabId, index)
      return
    }
    let groups = st.groups.map((g) => {
      if (g.id === fromGroupId) {
        const tabs = g.tabs.filter((t) => t.id !== tabId)
        const mru = g.mru.filter((id) => id !== tabId)
        return { ...g, tabs, mru, activeId: g.activeId === tabId ? (mru[0] ?? tabs[0]?.id ?? null) : g.activeId }
      }
      if (g.id === toGroupId) {
        const tabs = [...g.tabs.filter((t) => tabKey(t) !== tabKey(tab))]
        tabs.splice(index ?? tabs.length, 0, tab)
        return { ...g, tabs, activeId: tab.id, mru: [tab.id, ...g.mru] }
      }
      return g
    })
    groups = groups.filter((g) => g.tabs.length > 0 || g.id === toGroupId)
    if (!groups.length) groups = [{ id: 'g1', tabs: [], activeId: null, mru: [] }]
    set({ groups, activeGroupId: toGroupId })
  },

  reorder(groupId, tabId, index) {
    set({
      groups: get().groups.map((g) => {
        if (g.id !== groupId) return g
        const tabs = [...g.tabs]
        const from = tabs.findIndex((t) => t.id === tabId)
        if (from < 0) return g
        const [t] = tabs.splice(from, 1)
        tabs.splice(Math.max(0, Math.min(index > from ? index - 1 : index, tabs.length)), 0, t)
        return { ...g, tabs }
      })
    })
  },

  activeTab() {
    const st = get()
    const g = st.groups.find((x) => x.id === st.activeGroupId) ?? st.groups[0]
    return g?.tabs.find((t) => t.id === g.activeId) ?? null
  },

  activePath() {
    const t = get().activeTab()
    return t && (t.kind === 'file' || t.kind === 'diff' || t.kind === 'markdown' || t.kind === 'ide-diff') ? t.path : null
  },

  async saveActive() {
    const t = get().activeTab()
    if (!t || t.kind !== 'file') return
    const { saveWithFormat } = await import('./editorActions')
    await saveWithFormat(t.path)
  },

  async saveAll() {
    let n = 0
    for (const p of dirtyPaths()) {
      const r = await saveDoc(p)
      if (r === 'saved') n++
    }
    return n
  },

  renamePath(oldPath, newPath) {
    const isDir = !P.extname(oldPath) && !getDoc(oldPath)
    const remap = (p: string) => {
      if (P.samePath(p, oldPath)) return newPath
      if (isDir && P.isInside(p, oldPath)) return P.join(newPath, P.relative(oldPath, p))
      return p
    }
    const touched = new Set<string>()
    const groups = get().groups.map((g) => ({
      ...g,
      tabs: g.tabs.map((t) => {
        if (t.kind !== 'file' && t.kind !== 'markdown') return t
        const np = remap(t.path)
        if (np === t.path) return t
        touched.add(t.path)
        return { ...t, path: np, title: P.basename(np) }
      })
    }))
    for (const p of touched) renameDoc(p, remap(p))
    set({ groups })
  },

  syncDocFlags() {
    const dirty: Record<string, true> = {}
    const conflicts: Record<string, true> = {}
    const deleted: Record<string, true> = {}
    for (const p of dirtyPaths()) dirty[P.key(p)] = true
    for (const g of get().groups) {
      for (const t of g.tabs) {
        if (t.kind !== 'file') continue
        const d = getDoc(t.path)
        if (d?.conflict) conflicts[P.key(t.path)] = true
        if (d?.deleted) deleted[P.key(t.path)] = true
      }
    }
    const st = get()
    const same = (a: Record<string, true>, b: Record<string, true>) => {
      const ka = Object.keys(a)
      return ka.length === Object.keys(b).length && ka.every((k) => b[k])
    }
    if (!same(dirty, st.dirty) || !same(conflicts, st.conflicts) || !same(deleted, st.deleted)) set({ dirty, conflicts, deleted })
    // editing a preview tab pins it
    for (const g of st.groups) for (const t of g.tabs) if (t.preview && t.kind === 'file' && dirty[P.key(t.path)]) get().pin(g.id, t.id)
  }
}))

onDocsChanged(() => useEditors.getState().syncDocFlags())
