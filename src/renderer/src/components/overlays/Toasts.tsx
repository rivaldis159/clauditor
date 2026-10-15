import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { runCommand } from '@/lib/commands'
import { useT } from '@/lib/i18n'
import { useApp } from '@/state/app'

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert }

export function Toasts() {
  const t = useT()
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.level]
        return (
          <div key={toast.id} className={`toast ${toast.level}`}>
            <Icon size={16} className="toast-icon" />
            <div className="toast-body">
              <div className="toast-title">{toast.title}</div>
              {toast.detail && <div className="toast-detail selectable">{toast.detail}</div>}
              {toast.actions && toast.actions.length > 0 && (
                <div className="toast-actions">
                  {toast.actions.map((a) => (
                    <button
                      key={a.label}
                      className="btn btn-sm"
                      onClick={() => {
                        dismiss(toast.id)
                        runCommand(a.command)
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="icon-btn sm toast-x" onClick={() => dismiss(toast.id)} aria-label={t('Close')}>
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
