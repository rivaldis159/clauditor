import { useEffect, useRef, useState } from 'react'
import type { TimelineEvent } from '@shared/types'
import { clock } from '@/lib/format'
import { timelineJump } from '@/lib/bus'
import { useT, type T } from '@/lib/i18n'
import { useApp } from '@/state/app'
import { toolMeta, toolTarget, type ToolCategory } from './toolInfo'

interface Tick {
  x: number
  h: number
  color: string
  ev: TimelineEvent
}

const HEIGHT = 30

function category(ev: TimelineEvent): ToolCategory | 'prompt' | 'text' | 'error' | 'system' {
  if (ev.kind === 'prompt') return 'prompt'
  if (ev.kind === 'text' || ev.kind === 'thinking') return 'text'
  if (ev.kind === 'system') return ev.level === 'error' ? 'error' : 'system'
  if (ev.status === 'error' || ev.status === 'denied') return 'error'
  return toolMeta(ev.name).category
}

function describe(ev: TimelineEvent, root: string | null, t: T): string {
  if (ev.kind === 'prompt') return t('You: {text}', { text: ev.text.replace(/\s+/g, ' ').slice(0, 80) })
  if (ev.kind === 'text') return `Claude: ${ev.text.replace(/\s+/g, ' ').slice(0, 80)}`
  if (ev.kind === 'thinking') return t('Thinking')
  if (ev.kind === 'system') return (ev.i18n ? t(ev.text, ev.vars) : ev.text).slice(0, 80)
  const m = toolMeta(ev.name)
  const target = toolTarget(ev, root)
  return `${m.verb}${target ? ` ${target}` : ''}`
}

export function PulseStrip({ sessionId, events, live, startTs }: { sessionId: string; events: TimelineEvent[]; live: boolean; startTs: number | null }) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const ticksRef = useRef<Tick[]>([])
  const [hover, setHover] = useState<{ x: number; tick: Tick } | null>(null)
  const [width, setWidth] = useState(0)
  const theme = useApp((s) => s.theme)
  const accent = useApp((s) => s.settings.accent)
  const root = useApp((s) => s.workspace?.root ?? null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!live) return
    const t = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(t)
  }, [live])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(HEIGHT * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${HEIGHT}px`
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, HEIGHT)
    const css = getComputedStyle(document.documentElement)
    const color = (v: string) => css.getPropertyValue(v).trim()
    const colors: Record<string, string> = {
      edit: color('--cat-edit'),
      read: color('--cat-read'),
      shell: color('--cat-shell'),
      search: color('--cat-search'),
      web: color('--cat-search'),
      agent: color('--cat-agent'),
      plan: color('--cat-other'),
      mcp: color('--cat-other'),
      other: color('--cat-other'),
      prompt: color('--fg-0'),
      text: color('--fg-3'),
      error: color('--bad'),
      system: color('--fg-3')
    }
    // Long idle gaps (Claude waiting for you, overnight pauses) are compressed so the
    // strip shows working time rather than wall-clock time.
    const GAP = 3 * 60_000
    const SQUASH = 40_000
    const first = startTs ?? events[0]?.ts ?? now
    const eff: number[] = []
    const gaps: number[] = []
    let t = 0
    let prev = first
    for (const ev of events) {
      const dt = Math.max(0, ev.ts - prev)
      if (dt > GAP) gaps.push(t + SQUASH / 2)
      t += dt > GAP ? SQUASH : dt
      eff.push(t)
      prev = Math.max(prev, ev.ts)
    }
    if (live) {
      const dt = Math.max(0, now - prev)
      t += dt > GAP ? SQUASH : dt
    }
    const span = Math.max(1, t)
    const pad = 6
    const usable = width - pad * 2
    // baseline + compressed-gap markers
    ctx.fillStyle = color('--line-strong')
    ctx.fillRect(pad, HEIGHT - 7, usable, 1)
    ctx.fillStyle = color('--fg-3')
    for (const g of gaps) {
      const x = Math.round(pad + (g / span) * usable)
      for (let y = 4; y < HEIGHT - 8; y += 4) ctx.fillRect(x, y, 1, 2)
    }
    const ticks: Tick[] = []
    events.forEach((ev, i) => {
      const c = category(ev)
      const x = pad + (eff[i] / span) * usable
      const h = c === 'prompt' ? 20 : c === 'edit' ? 15 : c === 'error' ? 17 : c === 'shell' ? 12 : c === 'text' ? 6 : c === 'system' ? 5 : 9
      ticks.push({ x, h, color: colors[c], ev })
    })
    // draw low-priority marks first so edits and prompts stay on top
    const order = (t: Tick) => (t.h >= 15 ? 2 : t.h >= 9 ? 1 : 0)
    for (const layer of [0, 1, 2]) {
      for (const t of ticks) {
        if (order(t) !== layer) continue
        ctx.globalAlpha = layer === 0 ? 0.55 : 0.92
        ctx.fillStyle = t.color
        const w = t.h >= 15 ? 2 : 1.5
        ctx.fillRect(Math.round(t.x - w / 2), HEIGHT - 7 - t.h, w, t.h)
      }
    }
    ctx.globalAlpha = 1
    if (live) {
      ctx.fillStyle = colors.edit
      ctx.beginPath()
      ctx.arc(width - pad, HEIGHT - 6.5, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ticksRef.current = ticks
  }, [events, width, theme, accent, live, now, startTs])

  const nearest = (x: number): Tick | null => {
    let best: Tick | null = null
    let bd = 6
    for (const t of ticksRef.current) {
      const d = Math.abs(t.x - x) - (t.h >= 15 ? 1 : 0)
      if (d < bd) {
        bd = d
        best = t
      }
    }
    return best
  }

  return (
    <div className="pulse" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - r.left
          const t = nearest(x)
          setHover(t ? { x: t.x, tick: t } : null)
        }}
        onPointerLeave={() => setHover(null)}
        onClick={() => {
          if (hover) timelineJump.emit({ sessionId, eventId: hover.tick.ev.id })
        }}
        style={{ cursor: hover ? 'pointer' : 'default' }}
      />
      {hover && (
        <div className="pulse-tip" style={{ left: Math.max(4, Math.min(hover.x - 110, width - 224)) }}>
          <span className="pulse-tip-time">{clock(hover.tick.ev.ts, true)}</span>
          <span className="truncate">{describe(hover.tick.ev, root, t)}</span>
        </div>
      )}
    </div>
  )
}
