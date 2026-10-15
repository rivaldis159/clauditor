// Ephemeral "what is Claude doing right now" state, used for live highlights across the UI.
import { create } from 'zustand'
import * as P from '@/lib/paths'

export interface CursorMark {
  path: string
  line: number
  column: number
  ts: number
}

interface ActivityStore {
  /** path key → last time Claude changed it (active session only) */
  touched: Record<string, number>
  /** path key → tool currently running on it (Edit/Write/Read) */
  working: Record<string, { tool: string; since: number }>
  typing: Record<string, true>
  cursor: CursorMark | null
  markTouched(path: string): void
  setWorking(path: string, tool: string | null): void
  setTyping(path: string, on: boolean): void
  setCursor(c: CursorMark | null): void
  clear(): void
}

export const useActivity = create<ActivityStore>((set, get) => ({
  touched: {},
  working: {},
  typing: {},
  cursor: null,

  markTouched(path) {
    set({ touched: { ...get().touched, [P.key(path)]: Date.now() } })
  },

  setWorking(path, tool) {
    const working = { ...get().working }
    if (tool) working[P.key(path)] = { tool, since: Date.now() }
    else delete working[P.key(path)]
    set({ working })
  },

  setTyping(path, on) {
    const typing = { ...get().typing }
    if (on) typing[P.key(path)] = true
    else delete typing[P.key(path)]
    set({ typing })
  },

  setCursor(c) {
    set({ cursor: c })
  },

  clear() {
    set({ touched: {}, working: {}, typing: {}, cursor: null })
  }
}))
