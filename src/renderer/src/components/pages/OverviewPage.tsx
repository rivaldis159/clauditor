import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, FileDiff, FileText, Play, Sparkles, Table2 } from 'lucide-react'
import type { ModelOption, SessionFileChange, TimelineEvent, ToolEvent } from '@shared/types'
import { FileIcon } from '@/lib/fileIcons'
import { clock, compact, date, duration, num, usd } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { invoke } from '@/lib/ipc'
import { contextView, effortName, modelLabel, sessionEffort, sessionModel } from '@/lib/claudeInfo'
import * as P from '@/lib/paths'
import { useApp } from '@/state/app'
import { useClaude } from '@/state/claude'
import { useEditors } from '@/state/editors'
import { originFor, runnerForSession, sessionTitle, useSessions } from '@/state/sessions'
import { SERIES, seriesOf, toolMeta } from '@/components/agent/toolInfo'

type SeriesKey = (typeof SERIES)[number]['key']
const NO_MODELS: ModelOption[] = []

function Tile({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  )
}

function Legend() {
  const t = useT()
  return (
    <div className="legend">
      {SERIES.map((s) => (
        <span key={s.key} className="legend-item">
          <span className="legend-swatch" style={{ background: s.color }} />
          {t(s.label)}
        </span>
      ))}
    </div>
  )
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

function ToolBars({ tools }: { tools: ToolEvent[] }) {
  const t = useT()
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const rows = useMemo(() => {
    const m = new Map<string, number>()
    for (const tool of tools) m.set(tool.name, (m.get(tool.name) ?? 0) + 1)
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, count]) => ({ name, count, series: seriesOf(toolMeta(name).category) }))
  }, [tools])
  const max = Math.max(1, ...rows.map((r) => r.count))
  const total = tools.length || 1
  const labelW = 132
  const valueW = 56
  const barMax = Math.max(40, width - labelW - valueW - 8)
  const rowH = 26
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={rows.length * rowH + 4} role="img" aria-label={t('Tool usage by type')}>
        {rows.map((r, i) => {
          const w = Math.max(3, (r.count / max) * barMax)
          const y = i * rowH + 5
          const color = SERIES.find((s) => s.key === r.series)!.color
          const label = r.name.startsWith('mcp__') ? r.name.split('__').slice(1).join(' › ') : r.name
          return (
            <g key={r.name} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} className="bar-row">
              <rect x={0} y={y - 4} width={width} height={rowH} fill="transparent" />
              <text x={labelW - 10} y={y + 12} textAnchor="end" className="chart-label">
                {label.length > 18 ? `${label.slice(0, 17)}…` : label}
              </text>
              <path
                d={`M${labelW},${y} h${w - 4} a4,4 0 0 1 4,4 v8 a4,4 0 0 1 -4,4 h${-(w - 4)} z`}
                fill={color}
                opacity={hover === null || hover === i ? 1 : 0.45}
              />
              <text x={labelW + w + 6} y={y + 12} className="chart-value">
                {num(r.count)}
              </text>
              {hover === i && (
                <text x={labelW + w + 6 + String(num(r.count)).length * 7 + 6} y={y + 12} className="chart-muted">
                  {Math.round((r.count / total) * 100)}%
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

interface Bucket {
  start: number
  end: number
  counts: Record<SeriesKey, number>
  total: number
}

function ActivityChart({ events, first, last }: { events: TimelineEvent[]; first: number; last: number }) {
  const t = useT()
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const height = 150
  const padL = 34
  const padB = 22
  const plotW = Math.max(60, width - padL - 6)
  const plotH = height - padB - 8
  const buckets = useMemo(() => {
    const span = Math.max(60_000, last - first)
    const n = Math.max(6, Math.min(48, Math.floor(plotW / 14)))
    const size = span / n
    const list: Bucket[] = Array.from({ length: n }, (_, i) => ({
      start: first + i * size,
      end: first + (i + 1) * size,
      counts: { edit: 0, read: 0, search: 0, shell: 0, agent: 0, other: 0 },
      total: 0
    }))
    for (const ev of events) {
      if (ev.kind !== 'tool') continue
      const i = Math.min(n - 1, Math.max(0, Math.floor((ev.ts - first) / size)))
      const key = seriesOf(toolMeta(ev.name).category)
      list[i].counts[key]++
      list[i].total++
    }
    return list
  }, [events, first, last, plotW])
  const max = Math.max(1, ...buckets.map((b) => b.total))
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : max <= 100 ? 20 : Math.ceil(max / 5 / 10) * 10
  const top = Math.ceil(max / step) * step
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step)
  const slot = plotW / buckets.length
  const barW = Math.min(24, Math.max(4, slot - 3))
  const y = (v: number) => 8 + plotH - (v / top) * plotH
  const hb = hover !== null ? buckets[hover] : null

  return (
    <div className="chart" ref={ref}>
      <div className="chart-tools">
        <Legend />
        <button className={`icon-btn sm${table ? ' on' : ''}`} data-tip={t('Show as table')} onClick={() => setTable(!table)}>
          <Table2 size={14} />
        </button>
      </div>
      {table ? (
        <div className="viz-table-wrap">
          <table className="viz-table">
            <thead>
              <tr>
                <th>{t('Time')}</th>
                {SERIES.map((s) => (
                  <th key={s.key}>{t(s.label)}</th>
                ))}
                <th>{t('Total')}</th>
              </tr>
            </thead>
            <tbody>
              {buckets
                .filter((b) => b.total > 0)
                .map((b) => (
                  <tr key={b.start}>
                    <td>
                      {clock(b.start)}–{clock(b.end)}
                    </td>
                    {SERIES.map((s) => (
                      <td key={s.key}>{b.counts[s.key] || ''}</td>
                    ))}
                    <td>{b.total}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-plot">
          <svg width={width} height={height} role="img" aria-label={t('Tool activity over the session')}>
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={padL} x2={padL + plotW} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'chart-axis' : 'chart-grid'} />
                <text x={padL - 6} y={y(tick) + 4} textAnchor="end" className="chart-tick">
                  {tick}
                </text>
              </g>
            ))}
            {buckets.map((b, i) => {
              const x = padL + i * slot + (slot - barW) / 2
              let acc = 0
              const segs = SERIES.filter((s) => b.counts[s.key] > 0)
              return (
                <g key={i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                  <rect x={padL + i * slot} y={8} width={slot} height={plotH} fill="transparent" />
                  {segs.map((s, si) => {
                    const v = b.counts[s.key]
                    const y0 = y(acc)
                    const y1 = y(acc + v)
                    acc += v
                    const isTop = si === segs.length - 1
                    const h = Math.max(1, y0 - y1 - (isTop ? 0 : 2))
                    const r = isTop ? Math.min(4, h / 2, barW / 2) : 0
                    return (
                      <path
                        key={s.key}
                        d={`M${x},${y0} v${-(h - r)} ${r ? `a${r},${r} 0 0 1 ${r},${-r}` : ''} h${barW - 2 * r} ${r ? `a${r},${r} 0 0 1 ${r},${r}` : ''} v${h - r} z`}
                        fill={s.color}
                        opacity={hover === null || hover === i ? 1 : 0.5}
                      />
                    )
                  })}
                </g>
              )
            })}
            <text x={padL} y={height - 5} className="chart-tick">
              {clock(first)}
            </text>
            <text x={padL + plotW} y={height - 5} textAnchor="end" className="chart-tick">
              {clock(last)}
            </text>
          </svg>
          {hb && hb.total > 0 && (
            <div className="chart-tip" style={{ left: Math.min(Math.max(0, padL + (hover ?? 0) * slot - 70), width - 180) }}>
              <div className="chart-tip-title">
                {clock(hb.start)}–{clock(hb.end)} · {t.n(hb.total, '{n} step', '{n} steps')}
              </div>
              {SERIES.filter((s) => hb.counts[s.key] > 0).map((s) => (
                <div key={s.key} className="chart-tip-row">
                  <span className="legend-swatch" style={{ background: s.color }} />
                  <span className="grow">{t(s.label)}</span>
                  <span>{hb.counts[s.key]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FilesTable({ files, sessionId, cwd }: { files: SessionFileChange[]; sessionId: string; cwd: string | null }) {
  const t = useT()
  const root = useApp((s) => s.workspace?.root ?? null)
  const maxDelta = Math.max(1, ...files.map((f) => f.added + f.removed))
  const sorted = [...files].sort((a, b) => b.added + b.removed - (a.added + a.removed))
  return (
    <div className="files-table">
      <div className="ft-head">
        <span>{t('File')}</span>
        <span>{t('Edits')}</span>
        <span>{t('Changes')}</span>
        <span />
      </div>
      {sorted.map((f) => {
        const total = f.added + f.removed
        const w = (total / maxDelta) * 100
        return (
          <div key={f.path} className="ft-row">
            <span className="ft-file">
              <FileIcon name={P.basename(f.path)} size={15} />
              <span className="ft-name">{P.basename(f.path)}</span>
              <span className="ft-dir truncate">{P.dirHint(f.path, root ?? cwd)}</span>
              {f.created && <span className="chip ft-new">{t('new')}</span>}
            </span>
            <span className="ft-num">{f.edits}</span>
            <span className="ft-delta">
              <span className="ft-bar" style={{ width: `${Math.max(4, w)}%` }}>
                <span className="ft-bar-add" style={{ flex: f.added }} />
                <span className="ft-bar-del" style={{ flex: f.removed }} />
              </span>
              <span className={f.added ? 'plus' : 'plus zero'}>+{num(f.added)}</span>
              <span className={f.removed ? 'minus' : 'minus zero'}>−{num(f.removed)}</span>
            </span>
            <span className="ft-actions">
              <button
                className="icon-btn sm"
                data-tip={t('Whole-session diff (before Claude ↔ now)')}
                onClick={() =>
                  useEditors.getState().openTab({
                    kind: 'diff',
                    key: `session:${sessionId}:${P.key(f.path)}`,
                    path: f.path,
                    title: t('{name} · Claude session', { name: P.basename(f.path) }),
                    left: { kind: 'backup', sessionId, backup: f.created ? null : f.backup, label: f.created ? t('Did not exist') : t('Before session') },
                    right: { kind: 'file', label: t('Now') }
                  })
                }
              >
                <FileDiff size={14} />
              </button>
              <button className="icon-btn sm" data-tip={t('Open file')} onClick={() => useEditors.getState().openFile(f.path, { preview: false })}>
                <FileText size={14} />
              </button>
            </span>
          </div>
        )
      })}
      {files.length === 0 && <div className="empty-state">{t('This session did not change any files.')}</div>}
    </div>
  )
}

export function OverviewPage({ sessionId }: { sessionId: string }) {
  const t = useT()
  const data = useSessions((s) => s.data[sessionId])
  useEffect(() => {
    if (!useSessions.getState().data[sessionId]) void useSessions.getState().open(sessionId)
  }, [sessionId])
  const tools = useMemo(() => (data?.events.filter((e) => e.kind === 'tool') ?? []) as ToolEvent[], [data?.events])
  const models = useClaude((s) => s.env?.models) ?? NO_MODELS
  const runners = useSessions((s) => s.runners)
  if (!data) return <div className="page center muted">{t('Loading session…')}</div>
  const { meta, stats } = data
  const runner = runnerForSession({ runners }, sessionId)
  const model = sessionModel(meta, stats, runner, models)
  const effort = sessionEffort(meta, runner, model.row, null)
  const context = contextView(stats, runner, model.row)
  const first = stats.firstTs ?? meta.createdAt
  const last = stats.lastTs ?? meta.updatedAt
  const totalTokens = stats.inputTokens + stats.outputTokens + stats.cacheReadTokens + stats.cacheCreationTokens
  const errors = tools.filter((tool) => tool.status === 'error').length
  const denied = tools.filter((tool) => tool.status === 'denied').length
  const created = data.files.filter((f) => f.created).length

  return (
    <div className="page overview">
      <div className="ov-inner">
        <header className="ov-head">
          <div className="ov-kicker">
            <Sparkles size={13} /> {t('Session overview')} · {originFor(meta).label}
          </div>
          <h1 className="ov-title">{sessionTitle(meta)}</h1>
          <div className="ov-sub">
            {meta.cwd && <span data-tip={meta.cwd}>{P.basename(meta.cwd)}</span>}
            <span className="sep">·</span>
            <span>
              {date(first)} {clock(first)} – {clock(last)}
            </span>
            {stats.models.length > 0 && (
              <>
                <span className="sep">·</span>
                <span data-tip={stats.models.join(', ')}>{stats.models.map((id) => modelLabel(models, id)).join(', ')}</span>
              </>
            )}
          </div>
          <div className="ov-actions">
            <button className="btn btn-sm" onClick={() => void useSessions.getState().activate(sessionId)}>
              <Sparkles size={13} /> {t('Show in Claude panel')}
            </button>
            <button className="btn btn-sm" onClick={() => useEditors.getState().openTab({ kind: 'replay', sessionId, title: t('Replay · {title}', { title: sessionTitle(meta) }) })}>
              <Play size={13} /> {t('Replay')}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => void invoke('desktop:openSession', sessionId)}>
              <ExternalLink size={13} /> Claude desktop
            </button>
          </div>
        </header>

        <div className="tiles">
          <Tile label={t('Conversation turns')} value={num(stats.turns)} />
          <Tile label={t('Tool calls')} value={compact(stats.toolCalls)} sub={errors || denied ? t('{errors} failed · {denied} denied', { errors, denied }) : t('all succeeded')} />
          <Tile label={t('Files changed')} value={num(data.files.length)} sub={t.n(created, '{n} new file', '{n} new files')} />
          <Tile
            label={t('Lines')}
            value={`+${compact(stats.linesAdded)}`}
            sub={t.rich('{lines} removed', { lines: <span className={stats.linesRemoved ? 'minus' : 'minus zero'}>−{compact(stats.linesRemoved)}</span> })}
          />
          <Tile label={t('Tokens')} value={compact(totalTokens)} sub={stats.costUSD ? `≈ ${usd(stats.costUSD)}` : t('{tokens} output', { tokens: compact(stats.outputTokens) })} />
          <Tile label={t('Duration')} value={duration(last - first)} />
        </div>

        <div className="ov-grid">
          <section className="card">
            <h2>{t('Activity over the session')}</h2>
            <ActivityChart events={data.events} first={first} last={last} />
          </section>
          <section className="card">
            <h2>{t('Most used tools')}</h2>
            <ToolBars tools={tools} />
          </section>
        </div>

        <section className="card">
          <h2>{t('Files changed by Claude')}</h2>
          <FilesTable files={data.files} sessionId={sessionId} cwd={data.cwd} />
        </section>

        <div className="ov-grid">
          <section className="card">
            <h2>{t('Model and context')}</h2>
            <table className="viz-table tokens">
              <tbody>
                <tr>
                  <td>{t('Model')}</td>
                  <td>{model.label ? <span data-tip={model.id ?? undefined}>{model.label}</span> : '—'}</td>
                </tr>
                {effort.source !== 'unknown' && !effort.unsupported && (
                  <tr>
                    <td>{t('Effort')}</td>
                    <td>{effort.level ? effortName(t, effort.level) : t('effort::Default')}</td>
                  </tr>
                )}
                <tr>
                  <td>{t('Context window')}</td>
                  <td>{model.row?.contextWindow ? t('{n} tokens', { n: num(model.row.contextWindow) }) : '—'}</td>
                </tr>
                <tr>
                  <td>{t('Context in use')}</td>
                  <td>{context ? (context.percent !== null ? t('{used} tokens ({pct}%)', { used: num(context.used), pct: num(context.percent) }) : t('{used} tokens', { used: num(context.used) })) : '—'}</td>
                </tr>
                {context?.autoCompactAt ? (
                  <tr>
                    <td>{t('Auto-compacts at')}</td>
                    <td>{t('{n} tokens', { n: num(context.autoCompactAt) })}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
          <section className="card">
            <h2>{t('Token usage')}</h2>
            <table className="viz-table tokens">
              <tbody>
                <tr>
                  <td>{t('New input')}</td>
                  <td>{num(stats.inputTokens)}</td>
                </tr>
                <tr>
                  <td>{t('Output')}</td>
                  <td>{num(stats.outputTokens)}</td>
                </tr>
                <tr>
                  <td>{t('Read from cache')}</td>
                  <td>{num(stats.cacheReadTokens)}</td>
                </tr>
                <tr>
                  <td>{t('Written to cache')}</td>
                  <td>{num(stats.cacheCreationTokens)}</td>
                </tr>
                {stats.costUSD !== null && (
                  <tr>
                    <td>{t('Estimated cost')}</td>
                    <td>{usd(stats.costUSD)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  )
}
