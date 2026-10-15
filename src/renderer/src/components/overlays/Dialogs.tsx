import { useEffect, useRef, useState } from 'react'
import { useApp, type DialogRequest } from '@/state/app'

function Dialog({ d }: { d: DialogRequest }) {
  const [value, setValue] = useState(d.input?.value ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const close = useApp((s) => s.closeDialog)
  const primary = d.buttons.find((b) => b.kind === 'primary' || b.kind === 'danger') ?? d.buttons[d.buttons.length - 1]

  useEffect(() => {
    if (d.input) {
      const el = inputRef.current
      el?.focus()
      if (el && d.input.select) el.setSelectionRange(d.input.select[0], d.input.select[1])
    } else primaryRef.current?.focus()
  }, [d])

  return (
    <div
      className="dialog-backdrop"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          close(d.id, null)
        }
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={`${d.id}-t`}>
        <div className="dialog-title" id={`${d.id}-t`}>
          {d.title}
        </div>
        {d.message && <div className="dialog-message">{d.message}</div>}
        {d.detail && <div className="dialog-detail selectable">{d.detail}</div>}
        {d.input && (
          <input
            ref={inputRef}
            className="input dialog-input"
            value={value}
            placeholder={d.input.placeholder}
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') close(d.id, primary.value, value)
            }}
          />
        )}
        <div className="dialog-buttons">
          {d.buttons.map((b) => (
            <button
              key={b.value}
              ref={b === primary ? primaryRef : undefined}
              className={`btn${b.kind === 'primary' ? ' btn-primary' : b.kind === 'danger' ? ' btn-danger' : b.kind === 'ghost' ? ' btn-ghost' : ''}`}
              onClick={() => close(d.id, b.value, value)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function Dialogs() {
  const dialogs = useApp((s) => s.dialogs)
  if (!dialogs.length) return null
  return <Dialog key={dialogs[0].id} d={dialogs[0]} />
}
