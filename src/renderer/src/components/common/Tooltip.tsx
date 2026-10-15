import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface TipState {
  text: string
  keys?: string
  x: number
  y: number
  place: 'below' | 'above' | 'right'
}

/** One global tooltip driven by `data-tip` (and optional `data-tip-keys`, `data-tip-place`) attributes. */
export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null)
  const timer = useRef<number | null>(null)
  const current = useRef<HTMLElement | null>(null)
  const elRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    const hide = () => {
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = null
      current.current = null
      setTip(null)
    }
    const over = (e: PointerEvent) => {
      const target = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null
      if (target === current.current) return
      hide()
      if (!target) return
      current.current = target
      timer.current = window.setTimeout(() => {
        if (!target.isConnected) return
        const r = target.getBoundingClientRect()
        const place = (target.dataset.tipPlace as TipState['place']) ?? 'below'
        setTip({
          text: target.dataset.tip ?? '',
          keys: target.dataset.tipKeys,
          x: place === 'right' ? r.right + 8 : r.left + r.width / 2,
          y: place === 'above' ? r.top - 6 : place === 'right' ? r.top + r.height / 2 : r.bottom + 6,
          place
        })
      }, 520)
    }
    document.addEventListener('pointerover', over)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('wheel', hide, { passive: true })
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('wheel', hide)
      window.removeEventListener('blur', hide)
    }
  }, [])

  useEffect(() => {
    if (!tip || !elRef.current) {
      setPos(null)
      return
    }
    const r = elRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = tip.place === 'right' ? tip.x : tip.x - r.width / 2
    let top = tip.place === 'above' ? tip.y - r.height : tip.place === 'right' ? tip.y - r.height / 2 : tip.y
    left = Math.max(6, Math.min(left, vw - r.width - 6))
    if (top + r.height > vh - 6) top = tip.y - r.height - 30
    top = Math.max(6, top)
    setPos({ left: Math.round(left), top: Math.round(top) })
  }, [tip])

  if (!tip || !tip.text) return null
  return createPortal(
    <div ref={elRef} className="tooltip" style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}>
      <span>{tip.text}</span>
      {tip.keys && (
        <span className="tooltip-keys">
          {tip.keys.split('+').map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
        </span>
      )}
    </div>,
    document.body
  )
}
