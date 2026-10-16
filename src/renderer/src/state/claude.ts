// What Claude desktop provides right now (versions, fonts, models, effort levels), as reported by
// the main process; updated live when Claude updates.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { ClaudeDefaults, ClaudeEnvironment, ClaudeUpdateNotice, Effort, ModelOption } from '@shared/types'
import { applyClaudeFonts } from '@/lib/claudeFonts'
import { t } from '@/lib/i18n'
import { errorText, invoke, on } from '@/lib/ipc'
import { useApp } from './app'

interface ClaudeStore {
  env: ClaudeEnvironment | null
  checking: boolean
  /** Claude Code's own model / effort defaults per folder ('' = no folder) */
  defaults: Record<string, ClaudeDefaults>
  refresh(): Promise<void>
  loadDefaults(cwd: string | null): Promise<ClaudeDefaults | null>
}

export const useClaude = create<ClaudeStore>((set, get) => ({
  env: null,
  checking: false,
  defaults: {},
  async loadDefaults(cwd) {
    try {
      const d = await invoke('claude:defaults', cwd)
      set({ defaults: { ...get().defaults, [cwd ?? '']: d } })
      return d
    } catch {
      return null
    }
  },
  async refresh() {
    if (get().checking) return
    set({ checking: true })
    try {
      const env = await invoke('claude:refresh')
      set({ env })
      void applyClaudeFonts(env.fonts)
    } catch (err) {
      useApp.getState().toast({ level: 'error', title: t('Could not check Claude'), detail: errorText(err) })
    } finally {
      set({ checking: false })
    }
  }
}))

/** Claude Code's defaults for a folder, loaded on first use (call `loadDefaults` to re-read). */
export function useClaudeDefaults(cwd: string | null): ClaudeDefaults | null {
  const key = cwd ?? ''
  const d = useClaude((s) => s.defaults[key])
  useEffect(() => {
    if (!d) void useClaude.getState().loadDefaults(key || null)
  }, [key, d])
  return d ?? null
}

/** Effort levels used when Claude's model list is not known yet. */
export const FALLBACK_EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** The model row a picker value stands for ('' is Claude's "Default" row). */
export function modelFor(models: ModelOption[], value: string): ModelOption | null {
  return models.find((m) => m.value === value) ?? (value ? null : (models.find((m) => !m.value) ?? null))
}

/** Effort levels offered for a model value; [] when the model has no effort control. */
export function effortsFor(models: ModelOption[], value: string): Effort[] {
  if (!models.length) return FALLBACK_EFFORTS
  const m = modelFor(models, value)
  return m ? (m.effortLevels ?? []) : FALLBACK_EFFORTS
}

function notify(n: ClaudeUpdateNotice): void {
  const title =
    n.what === 'desktop'
      ? t('Claude desktop updated to {version}', { version: n.to ?? '' })
      : n.what === 'cli'
        ? t('Claude Code updated to {version}', { version: n.to ?? '' })
        : t('Agent SDK updated to {version}', { version: n.to ?? '' })
  const detail = n.what === 'sdk' ? t('Clauditor now drives Claude Code with the matching SDK.') : t('Clauditor picked up the new version automatically.')
  useApp.getState().toast({ level: 'info', title, detail })
}

let started = false

/** Loads the current environment (fonts are applied before the first paint when possible). */
export async function initClaudeEnvironment(): Promise<void> {
  if (started) return
  started = true
  on('claude:environment', (env) => {
    useClaude.setState({ env })
    void applyClaudeFonts(env.fonts)
  })
  on('claude:update', notify)
  try {
    const env = await invoke('claude:environment')
    useClaude.setState({ env })
    await applyClaudeFonts(env.fonts)
  } catch {
    /* main process not ready: the 'claude:environment' event will follow */
  }
}
