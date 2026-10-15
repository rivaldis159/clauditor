import { useRef, useState } from 'react'

interface Props {
  /** 'x' resizes widths (vertical bar), 'y' resizes heights (horizontal bar) */
  axis: 'x' | 'y'
  size: number
  min: number
  max: number
  /** +1 when dragging right/down grows the pane, -1 when it shrinks it */
  sign: 1 | -1
  onResize(size: number): void
  onReset?(): void
  className?: string
}

export function Sash({ axis, size, min, max, sign, onResize, onReset, className }: Props) {
  const start = useRef<{ pos: number; size: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  return (
    <div
      className={`sash sash-${axis}${dragging ? ' dragging' : ''}${className ? ` ${className}` : ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { pos: axis === 'x' ? e.clientX : e.clientY, size }
        setDragging(true)
        document.body.classList.add(axis === 'x' ? 'resizing-x' : 'resizing-y')
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        const delta = (axis === 'x' ? e.clientX : e.clientY) - start.current.pos
        const next = Math.round(Math.min(max, Math.max(min, start.current.size + sign * delta)))
        onResize(next)
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId)
        start.current = null
        setDragging(false)
        document.body.classList.remove('resizing-x', 'resizing-y')
      }}
      onDoubleClick={onReset}
    />
  )
}
