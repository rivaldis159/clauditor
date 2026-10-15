import { Logo } from '@/components/common/Logo'
import { getCommand, prettyKeys, runCommand } from '@/lib/commands'
import { useT } from '@/lib/i18n'

const HINTS = ['workbench.palette', 'workbench.quickOpen', 'claude.focusComposer', 'claude.follow', 'terminal.toggle']

export function EmptyEditor() {
  const t = useT()
  return (
    <div className="empty-editor">
      <div className="empty-editor-mark">
        <Logo size={64} />
      </div>
      <div className="empty-editor-hints">
        {HINTS.map((id) => {
          const c = getCommand(id)
          if (!c) return null
          return (
            <button key={id} className="hint-row" onClick={() => runCommand(id)}>
              <span className="hint-label">{t(c.title)}</span>
              <span className="hint-keys">
                {prettyKeys(c.keys).map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
