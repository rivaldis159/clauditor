import { create } from 'zustand'
import type { FileEntry } from '@shared/types'
import { invoke } from '@/lib/ipc'
import * as P from '@/lib/paths'
import { useApp } from './app'

export interface EditState {
  mode: 'new-file' | 'new-folder' | 'rename'
  parent: string
  target?: string
  initial: string
}

export interface Row {
  entry: FileEntry
  depth: number
  expanded: boolean
  loading: boolean
  editing?: EditState
}

interface ExplorerStore {
  root: string | null
  children: Record<string, FileEntry[]>
  expanded: Record<string, true>
  loading: Record<string, true>
  selected: string | null
  editing: EditState | null
  version: number

  setRoot(root: string | null, expanded?: string[]): Promise<void>
  load(dir: string): Promise<void>
  toggle(dir: string): Promise<void>
  expand(dir: string): Promise<void>
  collapseAll(): void
  reveal(path: string): Promise<void>
  select(path: string | null): void
  refresh(dirs: string[]): Promise<void>
  refreshAll(): Promise<void>
  startEdit(e: EditState): Promise<void>
  cancelEdit(): void
}

const hidden = (name: string) => {
  const ex = useApp.getState().settings.files.exclude
  return ex.includes(name)
}

export const useExplorer = create<ExplorerStore>((set, get) => ({
  root: null,
  children: {},
  expanded: {},
  loading: {},
  selected: null,
  editing: null,
  version: 0,

  async setRoot(root, expanded = []) {
    const exp: Record<string, true> = {}
    for (const e of expanded) exp[P.key(e)] = true
    set({ root, children: {}, expanded: exp, selected: null, editing: null })
    if (!root) return
    await get().load(root)
    await Promise.all(expanded.map((d) => get().load(d).catch(() => undefined)))
  },

  async load(dir) {
    const k = P.key(dir)
    set({ loading: { ...get().loading, [k]: true } })
    try {
      const entries = (await invoke('fs:readDir', dir)).filter((e) => !hidden(e.name))
      set({ children: { ...get().children, [k]: entries }, version: get().version + 1 })
    } catch {
      const children = { ...get().children }
      delete children[k]
      const expanded = { ...get().expanded }
      delete expanded[k]
      set({ children, expanded })
    } finally {
      const loading = { ...get().loading }
      delete loading[k]
      set({ loading })
    }
  },

  async toggle(dir) {
    const k = P.key(dir)
    if (get().expanded[k]) {
      const expanded = { ...get().expanded }
      delete expanded[k]
      set({ expanded })
    } else {
      await get().expand(dir)
    }
  },

  async expand(dir) {
    const k = P.key(dir)
    set({ expanded: { ...get().expanded, [k]: true } })
    if (!get().children[k]) await get().load(dir)
  },

  collapseAll() {
    set({ expanded: {} })
  },

  async reveal(path) {
    const root = get().root
    if (!root || !P.isInside(path, root)) return
    const chain: string[] = []
    let d = P.dirname(path)
    while (P.isSameOrInside(d, root) && !P.samePath(d, root)) {
      chain.unshift(d)
      const parent = P.dirname(d)
      if (parent === d) break
      d = parent
    }
    for (const dir of chain) await get().expand(dir)
    set({ selected: P.normalize(path) })
  },

  select(path) {
    set({ selected: path })
  },

  async refresh(dirs) {
    const known = get().children
    const unique = [...new Set(dirs.map((d) => P.key(d)))]
    await Promise.all(
      unique
        .filter((k) => known[k])
        .map((k) => {
          const dir = dirs.find((d) => P.key(d) === k)!
          return get().load(dir)
        })
    )
  },

  async refreshAll() {
    const root = get().root
    if (!root) return
    const dirs = Object.keys(get().children)
    const original = new Map<string, string>()
    const collect = (dir: string) => {
      original.set(P.key(dir), dir)
      for (const e of get().children[P.key(dir)] ?? []) if (e.kind === 'dir') collect(e.path)
    }
    collect(root)
    await Promise.all(dirs.map((k) => original.get(k)).filter(Boolean).map((d) => get().load(d!)))
  },

  async startEdit(e) {
    if (e.mode !== 'rename') await get().expand(e.parent)
    set({ editing: e })
  },

  cancelEdit() {
    set({ editing: null })
  }
}))

/** Flatten the visible tree for the virtual list. */
export function visibleRows(s: Pick<ExplorerStore, 'root' | 'children' | 'expanded' | 'loading' | 'editing'>): Row[] {
  const rows: Row[] = []
  if (!s.root) return rows
  const walk = (dir: string, depth: number) => {
    const entries = s.children[P.key(dir)] ?? []
    const ed = s.editing
    let pending: Row | null = null
    if (ed && ed.mode !== 'rename' && P.samePath(ed.parent, dir)) {
      const fake: FileEntry = { name: '', path: P.join(dir, '\u0000new'), kind: ed.mode === 'new-folder' ? 'dir' : 'file' }
      pending = { entry: fake, depth, expanded: false, loading: false, editing: ed }
    }
    // new folders go before files, new files before the first file
    let inserted = false
    for (const e of entries) {
      if (pending && !inserted && (pending.entry.kind === 'dir' || e.kind === 'file')) {
        rows.push(pending)
        inserted = true
      }
      const k = P.key(e.path)
      const expanded = e.kind === 'dir' && !!s.expanded[k]
      const editing = ed?.mode === 'rename' && ed.target && P.samePath(ed.target, e.path) ? ed : undefined
      rows.push({ entry: e, depth, expanded, loading: !!s.loading[k], editing })
      if (expanded) walk(e.path, depth + 1)
    }
    if (pending && !inserted) rows.push(pending)
  }
  walk(s.root, 0)
  return rows
}
