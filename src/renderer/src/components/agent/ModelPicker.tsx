// Composer pickers for the model and the effort level, with what each choice means: Claude Code's
// own model descriptions and context windows, what "Default" resolves to, and plain-language effort
// levels. Replaces bare <select>s that could only show a name.
import { Fragment, useCallback, useRef, useState } from 'react'
import { Check, ChevronDown, Cpu } from 'lucide-react'
import type { ClaudeDefaults, Effort, ModelOption } from '@shared/types'
import { Popover } from '@/components/common/Popover'
import { compact } from '@/lib/format'
import { useT } from '@/lib/i18n'
import {
  claudeText,
  defaultEffort,
  defaultModel,
  effortHint,
  effortName,
  effortRank,
  settingSourceLabel,
  shortModelLabel
} from '@/lib/claudeInfo'
import { useClaude } from '@/state/claude'
import { EffortBars } from './SessionInfo'

export function ModelPicker({
  models,
  value,
  defaults,
  cwd,
  live,
  onChange
}: {
  models: ModelOption[]
  value: string
  defaults: ClaudeDefaults | null
  cwd: string | null
  /** a run is going: a change applies from Claude's next turn */
  live: boolean
  onChange(value: string): void
}) {
  const t = useT()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const rows = models.length ? models : [{ value: '', label: t('Default'), description: '' } as ModelOption]
  const selected = rows.find((m) => m.value === value) ?? rows[0]
  const def = defaultModel(models, defaults)
  const defLabel = def.value ? shortModelLabel(def.value.label) : def.id
  // "Default · Opus 5.5": a narrow composer keeps just the model name
  const label = selected.value ? (
    shortModelLabel(selected.label)
  ) : defLabel ? (
    <>
      <span className="composer-pick-prefix">{t('Default')} · </span>
      {defLabel}
    </>
  ) : (
    t('Default')
  )

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`composer-pick${open ? ' open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) void useClaude.getState().loadDefaults(cwd)
          setOpen(!open)
        }}
        data-tip={open ? undefined : t('Model: which Claude answers')}
      >
        <Cpu size={12} strokeWidth={2} />
        <span className="composer-pick-label">{label}</span>
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open && ref.current && (
        <Popover anchor={ref.current} onClose={close} place="above" width={344} className="pick-pop" label={t('Model')}>
          <div className="pick-head">
            <span className="pick-title">{t('Model')}</span>
            <span className="pick-sub">{live ? t("Switches from Claude's next turn") : t('For your next message')}</span>
          </div>
          <div className="pick-list" role="listbox" aria-label={t('Model')}>
            {rows.map((m, i) => {
              const on = m.value === selected.value
              // Claude Code lists its current models by alias first, then pinned versions by full id
              const firstPinned = /^claude-/.test(m.value) && !/^claude-/.test(rows[i - 1]?.value ?? '')
              const window = m.value ? m.contextWindow : (def.value?.contextWindow ?? m.contextWindow)
              const desc = m.value
                ? claudeText(t, m.description)
                : def.source
                  ? t('Uses {model}, set in {source}', { model: defLabel ?? '', source: settingSourceLabel(t, def.source) })
                  : defLabel
                    ? t("Uses {model}, Claude Code's recommendation", { model: defLabel })
                    : t('Claude Code picks the model')
              return (
                <Fragment key={m.value || 'default'}>
                  {firstPinned && <div className="pick-group">{t('Specific versions')}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={`pick-row${on ? ' on' : ''}`}
                    onClick={() => {
                      onChange(m.value)
                      close()
                    }}
                  >
                    <span className="pick-check">{on && <Check size={13} strokeWidth={2.4} />}</span>
                    <span className="pick-main">
                      <span className="pick-name">{m.value ? shortModelLabel(m.label) : t('Default')}</span>
                      {desc && <span className="pick-desc">{desc}</span>}
                    </span>
                    {window ? <span className="pick-meta" data-tip={t('Context window: how much of the conversation Claude can keep in mind')}>{t('{n} context', { n: compact(window) })}</span> : null}
                  </button>
                </Fragment>
              )
            })}
          </div>
        </Popover>
      )}
    </>
  )
}

export function EffortPicker({
  levels,
  value,
  model,
  defaults,
  live,
  onChange
}: {
  levels: Effort[]
  value: Effort | ''
  model: ModelOption | null
  defaults: ClaudeDefaults | null
  live: boolean
  onChange(value: Effort | ''): void
}) {
  const t = useT()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const current = levels.includes(value as Effort) ? value : ''
  const def = defaultEffort(defaults, model)
  const shown = current || def?.value || ''

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`composer-pick effort${open ? ' open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-tip={open ? undefined : t('Effort: how long Claude thinks before answering')}
      >
        <EffortBars rank={effortRank(shown)} />
        <span className="composer-pick-label">{current ? effortName(t, current) : t('effort::Default')}</span>
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open && ref.current && (
        <Popover anchor={ref.current} onClose={close} place="above" width={316} className="pick-pop" label={t('Effort')}>
          <div className="pick-head">
            <span className="pick-title">{t('Effort')}</span>
            <span className="pick-sub">{live ? t("Applies from Claude's next turn") : t('For your next message')}</span>
          </div>
          <div className="pick-intro">{t('How long Claude thinks before it answers. More effort means deeper reasoning, but slower replies and more tokens.')}</div>
          <div className="pick-list" role="listbox" aria-label={t('Effort')}>
            {(['', ...levels] as (Effort | '')[]).map((level) => {
              const on = level === current
              return (
                <button
                  key={level || 'default'}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`pick-row${on ? ' on' : ''}`}
                  onClick={() => {
                    onChange(level)
                    close()
                  }}
                >
                  <span className="pick-check">{on && <Check size={13} strokeWidth={2.4} />}</span>
                  <span className="pick-main">
                    <span className="pick-name">
                      {level && <EffortBars rank={effortRank(level)} />}
                      {level ? effortName(t, level) : t('effort::Default')}
                    </span>
                    <span className="pick-desc">
                      {level
                        ? effortHint(t, level)
                        : def
                          ? t('Claude Code uses {level}, set in {source}.', { level: effortName(t, def.value), source: settingSourceLabel(t, def.source ?? 'user') })
                          : t("Claude Code uses the model's own default level.")}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </Popover>
      )}
    </>
  )
}
