import { create } from 'zustand'
import type { GitBranch, GitFileStatus, GitResult, GitStatus } from '@shared/types'
import { t, tn } from '@/lib/i18n'
import { errorText, invoke } from '@/lib/ipc'
import * as P from '@/lib/paths'
import { confirm, useApp } from './app'

interface GitStore {
  status: GitStatus | null
  byPath: Record<string, GitFileStatus>
  dirtyDirs: Record<string, 'M' | 'A' | 'U' | 'C'>
  loading: boolean
  busy: string | null
  message: string
  branches: GitBranch[]
  generating: boolean

  refresh(): void
  refreshNow(): Promise<void>
  setMessage(m: string): void
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  discard(paths: string[]): Promise<void>
  commit(opts?: { amend?: boolean }): Promise<boolean>
  loadBranches(): Promise<void>
  checkout(branch: string, create?: boolean): Promise<void>
  sync(action: 'fetch' | 'pull' | 'push'): Promise<void>
  init(): Promise<void>
  generateMessage(): Promise<void>
}

let timer: ReturnType<typeof setTimeout> | null = null

function root(): string | null {
  return useApp.getState().workspace?.root ?? null
}

/** `label` shows in the status bar while running (the SCM view checks for 'commit'), so git verbs stay untranslated. */
async function run(label: string, fn: () => Promise<GitResult>, okToast?: string): Promise<boolean> {
  useGit.setState({ busy: label })
  try {
    const r = await fn()
    if (!r.ok) {
      useApp.getState().toast({ level: 'error', title: t('Git: {action} failed', { action: label }), detail: r.output.slice(0, 600) })
      return false
    }
    if (okToast) useApp.getState().toast({ level: 'success', title: okToast })
    return true
  } catch (err) {
    useApp.getState().toast({ level: 'error', title: t('Git: {action} failed', { action: label }), detail: errorText(err) })
    return false
  } finally {
    useGit.setState({ busy: null })
    await useGit.getState().refreshNow()
  }
}

export function gitLetter(f: GitFileStatus): { letter: string; color: string; label: string } {
  if (f.conflicted) return { letter: 'C', color: 'var(--git-conflict)', label: t('Conflict') }
  if (f.index === '?') return { letter: 'U', color: 'var(--git-untracked)', label: t('Untracked') }
  const c = f.worktree !== ' ' ? f.worktree : f.index
  switch (c) {
    case 'A':
      return { letter: 'A', color: 'var(--git-added)', label: t('Added') }
    case 'D':
      return { letter: 'D', color: 'var(--git-deleted)', label: t('Deleted') }
    case 'R':
      return { letter: 'R', color: 'var(--git-renamed)', label: t('Renamed') }
    default:
      return { letter: 'M', color: 'var(--git-modified)', label: t('Modified') }
  }
}

export const useGit = create<GitStore>((set, get) => ({
  status: null,
  byPath: {},
  dirtyDirs: {},
  loading: false,
  busy: null,
  message: '',
  branches: [],
  generating: false,

  refresh() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void get().refreshNow(), 350)
  },

  async refreshNow() {
    const r = root()
    if (!r) {
      set({ status: null, byPath: {}, dirtyDirs: {} })
      return
    }
    set({ loading: true })
    try {
      const status = await invoke('git:status', r)
      const byPath: Record<string, GitFileStatus> = {}
      const dirtyDirs: Record<string, 'M' | 'A' | 'U' | 'C'> = {}
      for (const f of status.files) {
        byPath[P.key(f.path)] = f
        const letter = gitLetter(f).letter
        const rank = letter === 'C' ? 'C' : letter === 'U' ? 'U' : letter === 'A' ? 'A' : 'M'
        let d = P.dirname(f.path)
        while (status.root && P.isSameOrInside(d, status.root)) {
          const k = P.key(d)
          if (!dirtyDirs[k] || rank === 'C') dirtyDirs[k] = rank
          if (P.samePath(d, status.root)) break
          d = P.dirname(d)
        }
      }
      set({ status, byPath, dirtyDirs })
    } catch {
      set({ status: null, byPath: {}, dirtyDirs: {} })
    } finally {
      set({ loading: false })
    }
  },

  setMessage(m) {
    set({ message: m })
  },

  async stage(paths) {
    const r = root()
    if (r) await run('stage', () => invoke('git:stage', r, paths))
  },

  async unstage(paths) {
    const r = root()
    if (r) await run('unstage', () => invoke('git:unstage', r, paths))
  },

  async discard(paths) {
    const r = root()
    if (!r) return
    const ok = await confirm(
      paths.length === 1 ? t('Discard changes to {name}?', { name: P.basename(paths[0]) }) : tn(paths.length, 'Discard changes to {n} file?', 'Discard changes to {n} files?'),
      t('Uncommitted changes will be reverted to the last committed version. New files are moved to the Recycle Bin.'),
      t('Discard changes'),
      true
    )
    if (ok) await run(t('discard changes'), () => invoke('git:discard', r, paths))
  },

  async commit(opts = {}) {
    const r = root()
    const msg = get().message.trim()
    if (!r || !msg) return false
    const st = get().status
    const staged = st?.files.some((f) => f.index !== ' ' && f.index !== '?') ?? false
    if (!staged && !opts.amend) {
      const all = await confirm(t('No staged changes'), t('Stage all changes and commit?'), t('Stage all & commit'))
      if (!all) return false
      const ok = await run('stage', () => invoke('git:stage', r, st?.files.map((f) => f.path) ?? []))
      if (!ok) return false
    }
    const ok = await run('commit', () => invoke('git:commit', r, msg, opts), t('Commit successful'))
    if (ok) set({ message: '' })
    return ok
  },

  async loadBranches() {
    const r = root()
    if (r) set({ branches: await invoke('git:branches', r) })
  },

  async checkout(branch, create) {
    const r = root()
    if (r) await run(create ? t('create branch') : t('switch branch'), () => invoke('git:checkout', r, branch, create), create ? t('Created branch {branch}', { branch }) : t('Switched to {branch}', { branch }))
  },

  async sync(action) {
    const r = root()
    const labels = { fetch: 'fetch', pull: 'pull', push: 'push' }
    if (r) await run(labels[action], () => invoke('git:sync', r, action), action === 'push' ? t('Push complete') : action === 'pull' ? t('Pull complete') : undefined)
  },

  async init() {
    const r = root()
    if (r) await run('init', () => invoke('git:init', r), t('Git repository created'))
  },

  async generateMessage() {
    const r = root()
    if (!r || get().generating) return
    set({ generating: true })
    try {
      let diff = await invoke('git:diff', r, true)
      if (!diff.trim()) diff = await invoke('git:diff', r, false)
      if (!diff.trim()) {
        useApp.getState().toast({ level: 'info', title: t('No changes to summarize') })
        return
      }
      const prompt =
        t('Write one concise git commit message for the following diff. The first line is at most 72 characters, in the imperative mood, optionally followed by a blank line and short bullet points if needed. Reply with ONLY the commit message, without quotes or explanation.') +
        '\n\n' +
        diff.slice(0, 60000)
      const text = await invoke('runner:oneShot', r, prompt)
      set({ message: text.replace(/^```[a-z]*\n?|```$/g, '').trim() })
    } catch (err) {
      useApp.getState().toast({ level: 'error', title: t("Claude couldn't write a commit message"), detail: errorText(err) })
    } finally {
      set({ generating: false })
    }
  }
}))
