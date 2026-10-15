import { ChevronRight } from 'lucide-react'
import { FileIcon } from '@/lib/fileIcons'
import * as P from '@/lib/paths'
import { useApp } from '@/state/app'
import { useExplorer } from '@/state/explorer'

export function Breadcrumbs({ path }: { path: string }) {
  const root = useApp((s) => s.workspace?.root ?? null)
  const inside = root && P.isInside(path, root)
  const parts = inside ? P.segments(P.relative(root, path)) : P.segments(path)
  const base = inside ? root : ''
  return (
    <div className="breadcrumbs">
      {parts.map((seg, i) => {
        const last = i === parts.length - 1
        const full = inside ? P.join(base!, ...parts.slice(0, i + 1)) : parts.slice(0, i + 1).join(P.SEP)
        return (
          <span key={full} className={`crumb${last ? ' last' : ''}`}>
            {last && <FileIcon name={seg} size={14} />}
            <button
              className="crumb-btn truncate"
              onClick={() => {
                useApp.getState().setLayout({ sidebarVisible: true, activeView: 'explorer' })
                void useExplorer.getState().reveal(full)
              }}
            >
              {seg}
            </button>
            {!last && <ChevronRight size={13} strokeWidth={1.8} className="crumb-sep" />}
          </span>
        )
      })}
    </div>
  )
}
