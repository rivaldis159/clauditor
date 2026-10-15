import { create } from 'zustand'
import type { SearchDone, SearchFileResult, SearchProgress, SearchQuery } from '@shared/types'
import { t, tn } from '@/lib/i18n'
import { errorText, invoke } from '@/lib/ipc'
import { confirm, useApp } from './app'
import { reloadDoc } from './documents'

interface SearchStore {
  query: string
  replace: string
  showReplace: boolean
  isRegex: boolean
  matchCase: boolean
  wholeWord: boolean
  include: string
  exclude: string
  showFilters: boolean
  searchId: string | null
  results: SearchFileResult[]
  collapsed: Record<string, true>
  done: SearchDone | null
  running: boolean

  set(patch: Partial<SearchStore>): void
  run(): Promise<void>
  cancel(): void
  onProgress(p: SearchProgress): void
  onDone(d: SearchDone): void
  replaceAll(): Promise<void>
  toggleCollapsed(path: string): void
}

let debounce: ReturnType<typeof setTimeout> | null = null

export const useSearch = create<SearchStore>((set, get) => ({
  query: '',
  replace: '',
  showReplace: false,
  isRegex: false,
  matchCase: false,
  wholeWord: false,
  include: '',
  exclude: '',
  showFilters: false,
  searchId: null,
  results: [],
  collapsed: {},
  done: null,
  running: false,

  set(patch) {
    set(patch)
    const keys = Object.keys(patch)
    if (keys.some((k) => ['query', 'isRegex', 'matchCase', 'wholeWord', 'include', 'exclude'].includes(k))) {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => void get().run(), 260)
    }
  },

  async run() {
    const root = useApp.getState().workspace?.root
    const st = get()
    if (st.searchId) void invoke('search:cancel', st.searchId)
    if (!root || !st.query.trim()) {
      set({ searchId: null, results: [], done: null, running: false })
      return
    }
    const q: SearchQuery = { root, query: st.query, isRegex: st.isRegex, matchCase: st.matchCase, wholeWord: st.wholeWord, include: st.include, exclude: st.exclude }
    set({ results: [], done: null, running: true, collapsed: {} })
    try {
      const id = await invoke('search:start', q)
      set({ searchId: id })
    } catch (err) {
      set({ running: false })
      useApp.getState().toast({ level: 'error', title: t('Search failed'), detail: errorText(err) })
    }
  },

  cancel() {
    const id = get().searchId
    if (id) void invoke('search:cancel', id)
    set({ running: false })
  },

  onProgress(p) {
    if (p.searchId !== get().searchId) return
    set({ results: [...get().results, ...p.files] })
  },

  onDone(d) {
    if (d.searchId !== get().searchId) return
    set({ done: d, running: false })
  },

  async replaceAll() {
    const st = get()
    const root = useApp.getState().workspace?.root
    if (!root || !st.results.length) return
    const total = st.results.reduce((n, f) => n + f.matches.length, 0)
    const ok = await confirm(
      t('Replace {matches} in {files}?', { matches: tn(total, '{n} match', '{n} matches'), files: tn(st.results.length, '{n} file', '{n} files') }),
      t('"{query}" will be replaced with "{replace}". This changes files on disk.', { query: st.query, replace: st.replace }),
      t('Replace all'),
      true
    )
    if (!ok) return
    const q: SearchQuery = { root, query: st.query, isRegex: st.isRegex, matchCase: st.matchCase, wholeWord: st.wholeWord, include: st.include, exclude: st.exclude }
    let replaced = 0
    for (const f of st.results) {
      try {
        replaced += await invoke('search:replaceInFile', f.path, q, st.replace)
        await reloadDoc(f.path)
      } catch (err) {
        useApp.getState().toast({ level: 'error', title: t("Couldn't replace in {path}", { path: f.path }), detail: errorText(err) })
      }
    }
    useApp.getState().toast({ level: 'success', title: tn(replaced, 'Replaced {n} match', 'Replaced {n} matches') })
    await get().run()
  },

  toggleCollapsed(path) {
    const c = { ...get().collapsed }
    if (c[path]) delete c[path]
    else c[path] = true
    set({ collapsed: c })
  }
}))
