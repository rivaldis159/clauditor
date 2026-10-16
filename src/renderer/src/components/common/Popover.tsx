import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * A floating card anchored to an element: below it (or above when there is no room), kept inside
 * the window. Closes on a click outside, Escape, window resize or blur.
 */
export function Popover({
  anchor,
  onClose,
  place = 'below',
  align = 'start',
  width,
  className,
  label,
  children
}: {
  anchor: HTMLElement
  onClose(): void
  place?: 'below' | 'above'
  align?: 'start' | 'end'
  width: number
  className?: string
  label?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const place_ = () => {
      const a = anchor.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const h = el.scrollHeight
      const below = vh - a.bottom - 10
      const above = a.top - 10
      const up = place === 'above' ? above >= Math.min(h, 260) || above > below : below < Math.min(h, 260) && above > below
      const room = Math.max(160, up ? above : below)
      const height = Math.min(h, room)
      let left = align === 'end' ? a.right - width : a.left
      left = Math.max(8, Math.min(left, vw - width - 8))
      const top = up ? a.top - 6 - height : a.bottom + 6
      setPos({ left: Math.round(left), top: Math.round(Math.max(8, top)), maxHeight: Math.floor(room) })
    }
    place_()
    const ro = new ResizeObserver(place_)
    ro.observe(el)
    return () => ro.disconnect()
  }, [anchor, place, align, width])

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        anchor.focus()
      }
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={ref}
      className={`popover${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-label={label}
      style={pos ? { left: pos.left, top: pos.top, width, maxHeight: pos.maxHeight } : { left: -9999, top: -9999, width }}
    >
      {children}
    </div>,
    document.body
  )
}
