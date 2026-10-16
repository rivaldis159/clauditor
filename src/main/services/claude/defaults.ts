// What "Default" means for Claude Code in a folder: the model and effort its own settings pick when
// Clauditor passes none — environment variables first, then .claude/settings.local.json and
// .claude/settings.json in the folder, then ~/.claude/settings.json. Shown next to "Default" so the
// pickers say which model will really answer.
import fs from 'node:fs'
import path from 'node:path'
import type { ClaudeDefaults, ClaudeSettingSource } from '@shared/types'

function readJson(file: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function claudeDefaults(claudeHome: string, cwd: string | null, env: NodeJS.ProcessEnv = process.env): ClaudeDefaults {
  const layers: { source: ClaudeSettingSource; data: Record<string, unknown> | null }[] = []
  if (cwd) {
    layers.push({ source: 'local', data: readJson(path.join(cwd, '.claude', 'settings.local.json')) })
    layers.push({ source: 'project', data: readJson(path.join(cwd, '.claude', 'settings.json')) })
  }
  layers.push({ source: 'user', data: readJson(path.join(claudeHome, 'settings.json')) })

  const envModel = text(env.ANTHROPIC_MODEL)
  let model: ClaudeDefaults['model'] = envModel ? { value: envModel, source: 'env' } : null
  const envEffort = text(env.CLAUDE_CODE_EFFORT_LEVEL)
  let effort: ClaudeDefaults['effort'] = envEffort && envEffort !== 'unset' ? { value: envEffort, source: 'env' } : null
  const modelEfforts: ClaudeDefaults['modelEfforts'] = {}

  for (const { source, data } of layers) {
    if (!data) continue
    const m = text(data.model)
    if (!model && m) model = { value: m, source }
    const e = text(data.effortLevel)
    if (!effort && e) effort = { value: e, source }
    const per = data.modelSettings
    if (per && typeof per === 'object') {
      for (const [name, cfg] of Object.entries(per as Record<string, unknown>)) {
        const level = cfg && typeof cfg === 'object' ? text((cfg as Record<string, unknown>).effortLevel) : null
        if (level && !modelEfforts[name]) modelEfforts[name] = { value: level, source }
      }
    }
  }
  return { model, effort, modelEfforts }
}
