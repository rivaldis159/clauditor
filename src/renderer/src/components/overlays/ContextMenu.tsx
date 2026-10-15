import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '@/state/app'

export function ContextMenu() {
  const menu = useApp((s) => s.contextMenu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [active, setActive] = useState(-1)

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null)
      return
    }
    const r = ref.current.getBoundingClientRect()
    let left = menu.x
    let top = menu.y
    if (left + r.width > window.innerWidth - 6) left = Math.max(6, window.innerWidth - r.width - 6)
    if (top + r.height > window.innerHeight - 6) top = Math.max(6, menu.y - r.height)
    setPos({ left: Math.round(left), top: Math.round(top) })
    setActive(-1)
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const close = () => useApp.getState().closeContextMenu()
    const onKey = (e: KeyboardEvent) => {
      const items = menu.items
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        let i = active
        for (let n = 0; n < items.length; n++) {
          i = (i + d + items.length) % items.length
          if (!items[i].separator && !items[i].disabled) break
        }
        setActive(i)
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault()
        const it = items[active]
        close()
        it.run?.()
      }
    }
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menu, active])

  if (!menu) return null
  return createPortal(
    <div ref={ref} className="ctx-menu" style={pos ?? { left: menu.x, top: menu.y, visibility: 'hidden' }} onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((it, i) =>
        it.separator ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            className={`ctx-item${it.danger ? ' danger' : ''}${i === active ? ' active' : ''}`}
            disabled={it.disabled}
            onPointerEnter={() => setActive(i)}
            onClick={() => {
              useApp.getState().closeContextMenu()
              it.run?.()
            }}
          >
            <span className="ctx-icon">{it.icon}</span>
            <span className="ctx-label">{it.label}</span>
            {it.shortcut && <span className="ctx-shortcut">{it.shortcut}</span>}
          </button>
        )
      )}
    </div>,
    document.body
  )
}
