import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, Brain, CalendarClock, ChevronRight, CircleAlert, Image as ImageIcon, Info, Sparkles, TerminalSquare, TriangleAlert, User } from 'lucide-react'
import type { PromptEvent, RunnerStreamUpdate, SystemEvent, ThinkingEvent, TimelineEvent, ToolEvent } from '@shared/types'
import { clock, duration } from '@/lib/format'
import { timelineJump } from '@/lib/bus'
import { useT } from '@/lib/i18n'
import { Markdown } from './Markdown'
import { ToolCard } from './ToolCard'
import { StreamView } from './StreamView'

export type TimelineFilter = 'all' | 'changes' | 'chat'

const PromptItem = memo(function PromptItem({ ev }: { ev: PromptEvent }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  if (ev.origin === 'task-notification') {
    return (
      <div className="tl-system info">
        <TerminalSquare size={13} />
        <span className="truncate">{ev.text}</span>
        <span className="tl-time">{clock(ev.ts)}</span>
      </div>
    )
  }
  if (ev.origin === 'scheduled') {
    const name = /name="([^"]+)"/.exec(ev.text)?.[1]
    return (
      <div className={`tl-prompt scheduled${open ? ' open' : ''}`}>
        <button className="tl-prompt-head" onClick={() => setOpen(!open)}>
          <CalendarClock size={14} />
          <span className="grow truncate">{name ? t('Scheduled task: {name}', { name }) : t('Scheduled task')}</span>
          <span className="tl-time">{clock(ev.ts)}</span>
          <ChevronRight size={13} className="tc-chev" />
        </button>
        {open && <Markdown text={ev.text.replace(/<\/?scheduled-task[^>]*>/g, '')} />}
      </div>
    )
  }
  const long = ev.text.length > 900
  return (
    <div className={`tl-prompt${ev.origin === 'command' ? ' command' : ''}`}>
      <div className="tl-prompt-meta">
        <User size={12} strokeWidth={2} />
        <span>{t('You')}</span>
        {ev.images > 0 && (
          <span className="tl-images">
            <ImageIcon size={12} /> {ev.images}
          </span>
        )}
        <span className="tl-time">{clock(ev.ts)}</span>
      </div>
      <div className={`tl-prompt-body${long && !open ? ' clipped' : ''}`}>{ev.origin === 'command' ? <code className="inline-code">{ev.text}</code> : <Markdown text={ev.text} />}</div>
      {long && (
        <button className="link-btn" onClick={() => setOpen(!open)}>
          {open ? t('Show less') : t('Show all')}
        </button>
      )}
    </div>
  )
})

const ThinkingItem = memo(function ThinkingItem({ ev }: { ev: ThinkingEvent }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <div className={`tl-thinking${open ? ' open' : ''}`}>
      <button className="thinking-head" onClick={() => setOpen(!open)}>
        <Brain size={13} strokeWidth={1.8} />
        <span>{t('Thought process')}</span>
        <ChevronRight size={12} className="tc-chev" />
      </button>
      {open && <div className="thinking-body selectable">{ev.text}</div>}
    </div>
  )
})

function SystemItem({ ev }: { ev: SystemEvent }) {
  const t = useT()
  const Icon = ev.level === 'error' ? CircleAlert : ev.level === 'warning' ? TriangleAlert : Info
  return (
    <div className={`tl-system ${ev.level}`}>
      <Icon size={13} />
      <span className="tl-system-text selectable">{ev.i18n ? t(ev.text, ev.vars) : ev.text}</span>
      <span className="tl-time">{clock(ev.ts)}</span>
    </div>
  )
}

function Item({ ev, sessionId, cwd, live }: { ev: TimelineEvent; sessionId: string; cwd: string | null; live: boolean }) {
  switch (ev.kind) {
    case 'prompt':
      return <PromptItem ev={ev} />
    case 'text':
      return (
        <div className="tl-text">
          <Markdown text={ev.text} />
        </div>
      )
    case 'thinking':
      return <ThinkingItem ev={ev} />
    case 'tool':
      return <ToolCard ev={ev} sessionId={sessionId} cwd={cwd} live={live} />
    case 'system':
      return <SystemItem ev={ev} />
  }
}

function keep(ev: TimelineEvent, filter: TimelineFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'chat') return ev.kind === 'prompt' || ev.kind === 'text' || ev.kind === 'system'
  if (ev.kind === 'prompt') return true
  if (ev.kind !== 'tool') return false
  const t = ev as ToolEvent
  return ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell'].includes(t.name)
}

interface Props {
  sessionId: string
  events: TimelineEvent[]
  cwd: string | null
  live: boolean
  busy: boolean
  busySince: number | null
  stream: RunnerStreamUpdate | null
  filter: TimelineFilter
  footer?: React.ReactNode
}

export function Timeline({ sessionId, events, cwd, live, busy, busySince, stream, filter, footer }: Props) {
  const t = useT()
  const scrollRef = useRef<HTMLDivElement>(null)
  const items = useMemo(() => events.filter((e) => keep(e, filter)), [events, filter])
  const [atBottom, setAtBottom] = useState(true)
  const stick = useRef(true)
  const [now, setNow] = useState(Date.now())
  const virt = useVirtualizer({
    count: items.length + 1,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      const ev = items[i]
      if (!ev) return 60
      return ev.kind === 'tool' ? 34 : ev.kind === 'prompt' ? 70 : ev.kind === 'text' ? 90 : 30
    },
    overscan: 8,
    getItemKey: (i) => items[i]?.id ?? '__footer'
  })

  useEffect(() => {
    if (!busy) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [busy])

  // keep pinned to the newest event while the user hasn't scrolled away
  useLayoutEffect(() => {
    if (stick.current && items.length) virt.scrollToIndex(items.length, { align: 'end' })
  }, [items.length, stream, busy, virt])

  useEffect(() => {
    stick.current = true
    setAtBottom(true)
    requestAnimationFrame(() => virt.scrollToIndex(items.length, { align: 'end' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    return timelineJump.on(({ sessionId: sid, eventId }) => {
      if (sid !== sessionId) return
      const i = items.findIndex((e) => e.id === eventId)
      if (i >= 0) {
        stick.current = false
        setAtBottom(false)
        virt.scrollToIndex(i, { align: 'center' })
        window.setTimeout(() => {
          const el = scrollRef.current?.querySelector(`[data-ev="${CSS.escape(eventId)}"]`)
          el?.classList.add('jump-flash')
          window.setTimeout(() => el?.classList.remove('jump-flash'), 1400)
        }, 120)
      }
    })
  }, [items, sessionId, virt])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    stick.current = bottom
    if (bottom !== atBottom) setAtBottom(bottom)
  }

  return (
    <div className="timeline-wrap">
      <div className="timeline" ref={scrollRef} onScroll={onScroll}>
        <div className="timeline-inner" style={{ height: virt.getTotalSize() }}>
          {virt.getVirtualItems().map((vi) => {
            const ev = items[vi.index]
            return (
              <div key={vi.key} ref={virt.measureElement} data-index={vi.index} data-ev={ev?.id} className="tl-slot" style={{ transform: `translateY(${vi.start}px)` }}>
                {ev ? (
                  <Item ev={ev} sessionId={sessionId} cwd={cwd} live={live} />
                ) : (
                  <div className="tl-footer">
                    {stream && <StreamView stream={stream} />}
                    {busy && !stream && (
                      <div className="working-line">
                        <Sparkles size={13} />
                        <span className="shimmer">{busySince ? t('Claude is working · {time}', { time: duration(now - busySince) }) : t('Claude is working')}</span>
                      </div>
                    )}
                    {footer}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {!atBottom && (
        <button
          className="jump-latest"
          onClick={() => {
            stick.current = true
            setAtBottom(true)
            virt.scrollToIndex(items.length, { align: 'end' })
          }}
        >
          <ArrowDown size={13} strokeWidth={2.2} /> {t('Latest')}
        </button>
      )}
    </div>
  )
}
