import { create } from 'zustand'
import type { TerminalInfo, TerminalProfile, TerminalProfileId } from '@shared/types'
import { t } from '@/lib/i18n'
import { errorText, invoke } from '@/lib/ipc'
import { useApp } from './app'

export interface TermEntry extends TerminalInfo {
  exitCode: number | null
}

let creating = 0
/** True while a terminal is being spawned (avoids double creation on first open). */
export const isCreatingTerminal = () => creating > 0

interface TerminalStore {
  terminals: TermEntry[]
  activeId: string | null
  profiles: TerminalProfile[]
  loadProfiles(): Promise<void>
  create(opts?: { profile?: TerminalProfileId; cwd?: string; name?: string; extraArgs?: string[]; cols?: number; rows?: number }): Promise<TermEntry | null>
  kill(id: string): Promise<void>
  setActive(id: string): void
  markExited(id: string, code: number): void
  rename(id: string, name: string): void
}

export const useTerminals = create<TerminalStore>((set, get) => ({
  terminals: [],
  activeId: null,
  profiles: [],

  async loadProfiles() {
    set({ profiles: await invoke('terminal:profiles') })
  },

  async create(opts = {}) {
    const ws = useApp.getState().workspace
    const cwd = opts.cwd ?? ws?.root ?? useApp.getState().info?.userData ?? 'C:\\'
    creating++
    try {
      const info = await invoke('terminal:create', {
        cwd,
        profile: opts.profile,
        cols: opts.cols ?? 100,
        rows: opts.rows ?? 24,
        name: opts.name,
        extraArgs: opts.extraArgs
      })
      const entry: TermEntry = { ...info, exitCode: null }
      set({ terminals: [...get().terminals, entry], activeId: entry.id })
      useApp.getState().setPanelTab('terminal')
      useApp.getState().togglePanel(true)
      return entry
    } catch (err) {
      useApp.getState().toast({ level: 'error', title: t("Couldn't open terminal"), detail: errorText(err) })
      return null
    } finally {
      creating--
    }
  },

  async kill(id) {
    await invoke('terminal:kill', id)
    const terminals = get().terminals.filter((t) => t.id !== id)
    const activeId = get().activeId === id ? (terminals[terminals.length - 1]?.id ?? null) : get().activeId
    set({ terminals, activeId })
  },

  setActive(id) {
    set({ activeId: id })
  },

  markExited(id, code) {
    set({ terminals: get().terminals.map((t) => (t.id === id ? { ...t, exitCode: code } : t)) })
  },

  rename(id, name) {
    set({ terminals: get().terminals.map((t) => (t.id === id ? { ...t, name } : t)) })
  }
}))
