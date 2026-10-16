// The agent header's model · effort · context strip and the card it opens: which model answers,
// how hard it thinks, and how full the context window is, in plain words.
import { useCallback, useRef, useState } from 'react'
import { ChevronDown, Cpu } from 'lucide-react'
import type { ModelOption, RunnerInfo, SessionMeta, SessionStats } from '@shared/types'
import { Popover } from '@/components/common/Popover'
import { compact, num, usd } from '@/lib/format'
import { useT, type T } from '@/lib/i18n'
import {
  claudeText,
  contextTone,
  contextView,
  effortHint,
  effortLabel,
  effortName,
  effortRank,
  modelLabel,
  sessionEffort,
  sessionModel,
  settingSourceLabel,
  type ContextView,
  type SessionEffortView,
  type SessionModelView
} from '@/lib/claudeInfo'
import { useClaude, useClaudeDefaults } from '@/state/claude'

const NO_MODELS: ModelOption[] = []

/** Five bars, filled up to the level: a glanceable effort gauge. */
export function EffortBars({ rank }: { rank: number }) {
  return (
    <span className="effort-bars" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= rank ? 'on' : undefined} />
      ))}
    </span>
  )
}

export function EffortScale({ rank }: { rank: number }) {
  return (
    <span className="effort-scale" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= rank ? 'on' : undefined} />
      ))}
    </span>
  )
}

/** Used part of the window, with a tick where Claude Code auto-compacts. */
export function ContextBar({ view }: { view: ContextView }) {
  if (!view.limit) return null
  const used = Math.min(100, (view.used / view.limit) * 100)
  const mark = view.autoCompactAt ? Math.min(100, (view.autoCompactAt / view.limit) * 100) : null
  return (
    <div className="ctx-bar" aria-hidden="true">
      <span className={`ctx-bar-fill tone-${contextTone(view)}`} style={{ width: `${Math.max(used, 0.8)}%` }} />
      {mark !== null && <span className="ctx-bar-mark" style={{ left: `calc(${mark}% - 1px)` }} />}
    </div>
  )
}

function useSessionFacts(meta: SessionMeta, stats: SessionStats, runner: RunnerInfo | null) {
  const models = useClaude((s) => s.env?.models) ?? NO_MODELS
  const defaults = useClaudeDefaults(meta.cwd)
  const model = sessionModel(meta, stats, runner, models)
  const effort = sessionEffort(meta, runner, model.row, defaults)
  const context = contextView(stats, runner, model.row)
  return { models, defaults, model, effort, context }
}

export function ModelStrip({ meta, stats, runner }: { meta: SessionMeta; stats: SessionStats; runner: RunnerInfo | null }) {
  const t = useT()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const facts = useSessionFacts(meta, stats, runner)
  const { model, effort, context } = facts
  if (!model.id && !context) return null
  const tone = context ? contextTone(context) : 'ok'
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`model-strip${open ? ' open' : ''}`}
        aria-expanded={open}
        onClick={() => {
          if (!open) void useClaude.getState().loadDefaults(meta.cwd)
          setOpen(!open)
        }}
        data-tip={open ? undefined : t('Model, effort and context window: click for details')}
      >
        {model.id && (
          <span className="ms-item ms-model">
            <Cpu size={12} strokeWidth={2} />
            <span className="truncate">{model.label}</span>
          </span>
        )}
        {effort.source !== 'unknown' && !effort.unsupported && (
          <span className="ms-item ms-effort" data-tip={effort.level ? effortLabel(t, effort.level) : t('Default effort')}>
            <EffortBars rank={effortRank(effort.level)} />
            <span className="ms-effort-name">{effort.level ? effortName(t, effort.level) : t('effort::Default')}</span>
          </span>
        )}
        <span className="grow" />
        {context && (
          <span
            className={`ms-item ms-context tone-${tone}`}
            data-tip={context.limit !== null ? t('{used} of {limit} tokens', { used: num(context.used), limit: num(context.limit) }) : t('{used} tokens', { used: num(context.used) })}
          >
            {context.limit !== null && (
              <span className="ms-meter">
                <span style={{ width: `${Math.max(3, Math.min(100, (context.used / context.limit) * 100))}%` }} />
              </span>
            )}
            <span>{context.percent !== null ? t('Context {pct}%', { pct: num(context.percent) }) : t('Context {used}', { used: compact(context.used) })}</span>
            {context.limit !== null && <span className="ms-context-of">{t('{used} / {limit}', { used: compact(context.used), limit: compact(context.limit) })}</span>}
          </span>
        )}
        <ChevronDown size={12} strokeWidth={2} className="ms-chev" />
      </button>
      {open && ref.current && (
        <Popover anchor={ref.current} onClose={close} width={372} align="end" className="si-pop" label={t('Model, effort and context')}>
          <SessionInfoCard meta={meta} stats={stats} facts={facts} />
        </Popover>
      )}
    </>
  )
}

function modelSourceText(t: T, m: SessionModelView): string | null {
  switch (m.source) {
    case 'desktop':
      return t('Claude desktop')
    case 'clauditor':
      return t('Clauditor')
    case 'transcript':
      return t('From the transcript')
    default:
      return null
  }
}

function effortSourceText(t: T, e: SessionEffortView, desktop: boolean): string {
  switch (e.source) {
    case 'desktop':
      return t('Picked in Claude desktop for this session.')
    case 'clauditor':
      return t('Picked in Clauditor for this session.')
    case 'settings':
      return e.setting ? t('Not picked here, so Claude Code uses its default from {source}.', { source: settingSourceLabel(t, e.setting) }) : t("Claude Code's default.")
    case 'default':
      return desktop ? t("Not changed in Claude desktop, so Claude Code uses the model's own default level.") : t("Not picked, so Claude Code uses the model's own default level.")
    default:
      return t('Not recorded for this session: only Claude desktop and Clauditor note which effort they use.')
  }
}

function SessionInfoCard({ meta, stats, facts }: { meta: SessionMeta; stats: SessionStats; facts: ReturnType<typeof useSessionFacts> }) {
  const t = useT()
  const { models, model, effort, context } = facts
  const row = model.row
  const badge = modelSourceText(t, model)
  const rank = effortRank(effort.level)
  const total = stats.inputTokens + stats.outputTokens + stats.cacheReadTokens + stats.cacheCreationTokens
  const tone = context ? contextTone(context) : 'ok'
  const roomLeft = context?.autoCompactAt ? context.autoCompactAt - context.used : null
  const usedRows = context?.categories.filter((c) => c.kind === 'used' || c.kind === 'buffer') ?? []
  const free = context?.categories.find((c) => c.kind === 'free')

  return (
    <div className="si-card">
      <section className="si-sec">
        <div className="si-head">
          <span className="si-title">{t('Model')}</span>
          {badge && <span className={`si-badge src-${model.source}`}>{badge}</span>}
        </div>
        <div className="si-model-name">{model.label || t('Not known yet')}</div>
        {row?.description && <div className="si-desc">{claudeText(t, row.description)}</div>}
        <dl className="si-facts">
          {model.id && (
            <>
              <dt>{t('Model ID')}</dt>
              <dd className="mono">{model.id}</dd>
            </>
          )}
          {row?.contextWindow ? (
            <>
              <dt>{t('Context window')}</dt>
              <dd>{t('{n} tokens', { n: num(row.contextWindow) })}</dd>
            </>
          ) : null}
          {model.others.length > 0 && (
            <>
              <dt>{t('Also used here')}</dt>
              <dd>{model.others.map((id) => modelLabel(models, id)).join(', ')}</dd>
            </>
          )}
          {model.nextInDesktop && (
            <>
              <dt>{t('Next reply')}</dt>
              <dd>{t('{model}, picked in Claude desktop', { model: modelLabel(models, model.nextInDesktop) })}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="si-sec">
        <div className="si-head">
          <span className="si-title">{t('Effort')}</span>
        </div>
        {effort.unsupported ? (
          <div className="si-desc">{t('This model has no effort setting.')}</div>
        ) : (
          <>
            {effort.level ? (
              <>
                <div className="si-effort">
                  <EffortScale rank={rank} />
                  <span className="si-effort-name">{effortLabel(t, effort.level)}</span>
                </div>
                <div className="si-desc">{effortHint(t, effort.level)}</div>
              </>
            ) : (
              <div className="si-desc">{t('Effort is how long Claude thinks before it answers: more effort means deeper reasoning, but slower replies and more tokens.')}</div>
            )}
            <div className="si-note">{effortSourceText(t, effort, !!meta.desktop)}</div>
          </>
        )}
      </section>

      <section className="si-sec">
        <div className="si-head">
          <span className="si-title">{t('Context window')}</span>
          {context?.percent !== null && context?.percent !== undefined && <span className={`si-pct tone-${tone}`}>{t('{pct}% used', { pct: num(context.percent) })}</span>}
        </div>
        {context ? (
          <>
            <ContextBar view={context} />
            <div className="si-big">
              {context.limit !== null ? t('{used} of {limit} tokens', { used: num(context.used), limit: num(context.limit) }) : t('{used} tokens', { used: num(context.used) })}
            </div>
            <div className="si-desc">{t("Everything Claude keeps in mind for its next reply: your messages, its answers, the files it read and the tools it can use.")}</div>
            {context.autoCompactAt && context.limit ? (
              <div className="si-note">
                {t('At {at} tokens ({pct}%) Claude Code auto-compacts: it summarizes older messages so the work can go on.', {
                  at: num(context.autoCompactAt),
                  pct: num(Math.round((context.autoCompactAt / context.limit) * 100))
                })}
                {roomLeft !== null && roomLeft > 0 ? ` ${t('{n} tokens to go.', { n: num(roomLeft) })}` : ''}
              </div>
            ) : context.autoCompactEnabled === false ? (
              <div className="si-note">{t('Auto-compact is turned off in your Claude Code settings.')}</div>
            ) : null}
            {usedRows.length > 0 && (
              <ul className="si-breakdown">
                {usedRows.map((c) => (
                  <li key={c.name}>
                    <span className="bd-name">{claudeText(t, c.name)}</span>
                    <span className="bd-val">{compact(c.tokens)}</span>
                    <span className="bd-bar">
                      <span className={c.kind === 'buffer' ? 'buffer' : undefined} style={{ width: `${context.limit ? Math.max(1, (c.tokens / context.limit) * 100) : 0}%` }} />
                    </span>
                  </li>
                ))}
                {free && (
                  <li className="free">
                    <span className="bd-name">{claudeText(t, free.name)}</span>
                    <span className="bd-val">{compact(free.tokens)}</span>
                  </li>
                )}
              </ul>
            )}
            <div className="si-note">
              {context.measured === 'claude'
                ? t('Measured by Claude Code after its latest reply.')
                : context.limit !== null
                  ? t("From the size of Claude's latest reply in the transcript.")
                  : t("From the size of Claude's latest reply. The window size of this model is not known yet.")}
            </div>
          </>
        ) : (
          <div className="si-desc">{t("Shown after Claude's first reply.")}</div>
        )}
      </section>

      <section className="si-sec">
        <div className="si-head">
          <span className="si-title">{t('Tokens in this session')}</span>
        </div>
        <dl className="si-facts si-tokens">
          <dt>{t('New input')}</dt>
          <dd>{num(stats.inputTokens)}</dd>
          <dt>{t('Output')}</dt>
          <dd>{num(stats.outputTokens)}</dd>
          <dt>{t('Read from cache')}</dt>
          <dd>{num(stats.cacheReadTokens)}</dd>
          <dt>{t('Written to cache')}</dt>
          <dd>{num(stats.cacheCreationTokens)}</dd>
          <dt className="strong">{t('Total')}</dt>
          <dd className="strong">{num(total)}</dd>
          {stats.costUSD !== null && (
            <>
              <dt>{t('Estimated cost')}</dt>
              <dd>{usd(stats.costUSD)}</dd>
            </>
          )}
        </dl>
        <div className="si-note">{t('Cache reads are parts of the conversation Claude reads again from the prompt cache: much cheaper and faster than new input.')}</div>
      </section>
    </div>
  )
}

