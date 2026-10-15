import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, Copy, FilePlus, FolderOpen, FolderPlus, ListCollapse, MessageSquarePlus, Pencil, RefreshCw, SquareTerminal, Trash } from 'lucide-react'
import { FileIcon, FolderIcon } from '@/lib/fileIcons'
import { errorText, invoke } from '@/lib/ipc'
import * as P from '@/lib/paths'
import { focusComposer } from '@/lib/bus'
import { useT } from '@/lib/i18n'
import { confirm, useApp } from '@/state/app'
import { useExplorer, visibleRows, type Row } from '@/state/explorer'
import { useEditors } from '@/state/editors'
import { gitLetter, useGit } from '@/state/git'
import { useActivity } from '@/state/activity'
import { useTerminals } from '@/state/terminals'
import { openFolder } from '@/state/workspace'

const ROW_H = 22
const INVALID = /[\\/:*?"<>|]/

function NameInput({ row }: { row: Row }) {
  const t = useT()
  const ed = row.editing!
  const [value, setValue] = useState(ed.initial)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = ed.initial.lastIndexOf('.')
    el.setSelectionRange(0, ed.mode === 'rename' && dot > 0 && row.entry.kind === 'file' ? dot : ed.initial.length)
  }, [ed, row.entry.kind])

  const validate = (v: string) => {
    if (!v.trim()) return t("Name can't be empty")
    if (v.split(/[\\/]/).some((part) => INVALID.test(part.replace(/[\\/]/g, '')))) return t('Name contains invalid characters')
    return null
  }

  const commit = async () => {
    if (done.current) return
    const v = value.trim()
    if (ed.mode === 'rename' && v === ed.initial) {
      done.current = true
      useExplorer.getState().cancelEdit()
      return
    }
    const err = validate(v)
    if (err) {
      if (!v) {
        done.current = true
        useExplorer.getState().cancelEdit()
      } else setError(err)
      return
    }
    done.current = true
    const ex = useExplorer.getState()
    try {
      if (ed.mode === 'rename' && ed.target) {
        const target = P.join(P.dirname(ed.target), v)
        await invoke('fs:rename', ed.target, target)
        useEditors.getState().renamePath(ed.target, target)
        ex.cancelEdit()
        await ex.refresh([P.dirname(ed.target), P.dirname(target)])
        ex.select(target)
      } else {
        const full = P.join(ed.parent, v.replace(/\//g, '\\'))
        if (ed.mode === 'new-folder') await invoke('fs:createDir', full)
        else await invoke('fs:createFile', full)
        ex.cancelEdit()
        await ex.refresh([ed.parent, P.dirname(full)])
        if (ed.mode === 'new-file') useEditors.getState().openFile(full, { preview: false, focus: true })
        ex.select(full)
      }
    } catch (e) {
      done.current = false
      setError(errorText(e))
    }
  }

  return (
    <div className="tree-input-wrap">
      <input
        ref={ref}
        className={`tree-input${error ? ' invalid' : ''}`}
        value={value}
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value)
          setError(null)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') void commit()
          if (e.key === 'Escape') {
            done.current = true
            useExplorer.getState().cancelEdit()
          }
        }}
        onBlur={() => void commit()}
      />
      {error && <div className="tree-input-error">{error}</div>}
    </div>
  )
}

function TreeRow({ row, selected, activePath, onContext }: { row: Row; selected: boolean; activePath: string | null; onContext(e: React.MouseEvent, row: Row): void }) {
  const t = useT()
  const { entry, depth, expanded } = row
  const gitFile = useGit((s) => s.byPath[P.key(entry.path)])
  const gitDir = useGit((s) => (entry.kind === 'dir' ? s.dirtyDirs[P.key(entry.path)] : undefined))
  const touched = useActivity((s) => s.touched[P.key(entry.path)])
  const working = useActivity((s) => s.working[P.key(entry.path)])
  const g = gitFile ? gitLetter(gitFile) : null
  const isActive = activePath !== null && P.samePath(activePath, entry.path)
  const indent = 8 + depth * 12

  if (row.editing) {
    return (
      <div className="tree-row editing" style={{ paddingLeft: indent }}>
        <span className="tree-chev" />
        {entry.kind === 'dir' ? <FolderIcon name={row.editing.initial || 'folder'} open={false} /> : <FileIcon name={row.editing.initial || 'baru.txt'} />}
        <NameInput row={row} />
      </div>
    )
  }

  return (
    <div
      className={`tree-row${selected ? ' selected' : ''}${isActive ? ' active' : ''}${working ? ' working' : ''}`}
      style={{ paddingLeft: indent }}
      onClick={(e) => {
        const ex = useExplorer.getState()
        ex.select(entry.path)
        if (entry.kind === 'dir') void ex.toggle(entry.path)
        else useEditors.getState().openFile(entry.path, { preview: !e.ctrlKey })
      }}
      onDoubleClick={() => {
        if (entry.kind === 'file') useEditors.getState().openFile(entry.path, { preview: false })
      }}
      onContextMenu={(e) => onContext(e, row)}
      draggable={false}
      data-path={entry.path}
    >
      {depth > 0 && <span className="tree-guides" style={{ width: indent - 8 }} />}
      <span className="tree-chev">{entry.kind === 'dir' && <ChevronRight size={14} strokeWidth={2} className={expanded ? 'open' : ''} />}</span>
      {entry.kind === 'dir' ? <FolderIcon name={entry.name} open={expanded} /> : <FileIcon name={entry.name} />}
      <span className="tree-name truncate" style={g ? { color: g.color } : gitDir ? { color: gitDir === 'C' ? 'var(--git-conflict)' : 'var(--git-modified)' } : undefined}>
        {entry.name}
      </span>
      {working && <span className="tree-working" data-tip={working.tool === 'Read' ? t('Claude is reading') : t('Claude is editing')} />}
      {!working && touched && <span className="tree-claude" data-tip={t('Changed by Claude in this session')} />}
      {g ? (
        <span className="tree-git" style={{ color: g.color }} data-tip={g.label}>
          {g.letter}
        </span>
      ) : gitDir ? (
        <span className="tree-git-dot" style={{ background: gitDir === 'C' ? 'var(--git-conflict)' : 'var(--git-modified)' }} />
      ) : null}
    </div>
  )
}

export function ExplorerView() {
  const t = useT()
  const workspace = useApp((s) => s.workspace)
  const recent = useApp((s) => s.persisted.recentFolders)
  const root = useExplorer((s) => s.root)
  const children = useExplorer((s) => s.children)
  const expanded = useExplorer((s) => s.expanded)
  const loading = useExplorer((s) => s.loading)
  const editing = useExplorer((s) => s.editing)
  const selected = useExplorer((s) => s.selected)
  const activePath = useEditors((s) => {
    const g = s.groups.find((x) => x.id === s.activeGroupId)
    const tab = g?.tabs.find((x) => x.id === g.activeId)
    return tab && tab.kind === 'file' ? tab.path : null
  })
  const rows = useMemo(() => visibleRows({ root, children, expanded, loading, editing }), [root, children, expanded, loading, editing])
  const scrollRef = useRef<HTMLDivElement>(null)
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 12 })
  const [rootOpen, setRootOpen] = useState(true)

  // reveal the active editor's file
  useEffect(() => {
    if (activePath && root && P.isInside(activePath, root)) void useExplorer.getState().reveal(activePath)
  }, [activePath, root])

  useEffect(() => {
    if (!selected) return
    const i = rows.findIndex((r) => P.samePath(r.entry.path, selected))
    if (i >= 0) virt.scrollToIndex(i, { align: 'auto' })
  }, [selected, rows, virt])

  const parentFor = (row: Row | null) => {
    if (!row) return root!
    return row.entry.kind === 'dir' ? row.entry.path : P.dirname(row.entry.path)
  }

  const removeEntry = async (path: string) => {
    const s = useApp.getState().settings.files
    if (s.confirmDelete) {
      const ok = await confirm(
        t('Move "{name}" to the Recycle Bin?', { name: P.basename(path) }),
        t('You can restore it from the Windows Recycle Bin.'),
        t('Move to Recycle Bin'),
        true
      )
      if (!ok) return
    }
    try {
      await invoke('fs:trash', path)
      useEditors.getState().closeWhere((tab) => (tab.kind === 'file' || tab.kind === 'markdown') && P.isSameOrInside(tab.path, path))
      await useExplorer.getState().refresh([P.dirname(path)])
    } catch (e) {
      useApp.getState().toast({ level: 'error', title: t("Couldn't delete"), detail: errorText(e) })
    }
  }

  const onContext = (e: React.MouseEvent, row: Row | null) => {
    e.preventDefault()
    e.stopPropagation()
    if (!root) return
    const ex = useExplorer.getState()
    const target = row?.entry.path ?? root
    if (row) ex.select(row.entry.path)
    const parent = parentFor(row)
    const rel = P.displayPath(target, root)
    useApp.getState().showContextMenu(e, [
      { label: t('New file…'), icon: <FilePlus size={14} />, run: () => void ex.startEdit({ mode: 'new-file', parent, initial: '' }) },
      { label: t('New folder…'), icon: <FolderPlus size={14} />, run: () => void ex.startEdit({ mode: 'new-folder', parent, initial: '' }) },
      { separator: true },
      ...(row
        ? [
            { label: t('Rename…'), icon: <Pencil size={14} />, shortcut: 'F2', run: () => void ex.startEdit({ mode: 'rename', parent: P.dirname(row.entry.path), target: row.entry.path, initial: row.entry.name }) },
            { label: t('Delete'), icon: <Trash size={14} />, shortcut: 'Delete', danger: true, run: () => void removeEntry(row.entry.path) },
            { separator: true }
          ]
        : []),
      { label: t('Copy path'), icon: <Copy size={14} />, run: () => void navigator.clipboard.writeText(target) },
      { label: t('Copy relative path'), run: () => void navigator.clipboard.writeText(rel || '.') },
      { separator: true },
      { label: t('Reveal in File Explorer'), icon: <FolderOpen size={14} />, run: () => void invoke('app:revealPath', target) },
      { label: t('Open in terminal'), icon: <SquareTerminal size={14} />, run: () => void useTerminals.getState().create({ cwd: row?.entry.kind === 'file' ? P.dirname(target) : target }) },
      { separator: true },
      {
        label: t('Ask Claude about this'),
        icon: <MessageSquarePlus size={14} />,
        run: () => {
          useApp.getState().toggleAgent(true)
          focusComposer.emit({ text: `@${rel || '.'} ` })
        }
      }
    ])
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (useExplorer.getState().editing) return
    const ex = useExplorer.getState()
    const idx = rows.findIndex((r) => ex.selected && P.samePath(r.entry.path, ex.selected))
    const row = rows[idx]
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = rows[Math.max(0, Math.min(rows.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) ex.select(next.entry.path)
    } else if (e.key === 'ArrowRight' && row?.entry.kind === 'dir') {
      e.preventDefault()
      if (!row.expanded) void ex.expand(row.entry.path)
      else if (rows[idx + 1]) ex.select(rows[idx + 1].entry.path)
    } else if (e.key === 'ArrowLeft' && row) {
      e.preventDefault()
      if (row.entry.kind === 'dir' && row.expanded) void ex.toggle(row.entry.path)
      else if (root && !P.samePath(P.dirname(row.entry.path), root)) ex.select(P.dirname(row.entry.path))
    } else if (e.key === 'Enter' && row) {
      e.preventDefault()
      if (row.entry.kind === 'dir') void ex.toggle(row.entry.path)
      else useEditors.getState().openFile(row.entry.path, { preview: false, focus: true })
    } else if (e.key === 'F2' && row) {
      e.preventDefault()
      void ex.startEdit({ mode: 'rename', parent: P.dirname(row.entry.path), target: row.entry.path, initial: row.entry.name })
    } else if (e.key === 'Delete' && row) {
      e.preventDefault()
      void removeEntry(row.entry.path)
    }
  }

  if (!workspace || !root) {
    return (
      <div className="view">
        <div className="view-head">
          <span className="view-title">{t('Explorer')}</span>
        </div>
        <div className="empty-state explorer-empty">
          <strong>{t('No folder opened')}</strong>
          <span>{t('Open a project folder to see its files and follow Claude as it works there.')}</span>
          <button className="btn btn-primary" onClick={() => void openFolder()}>
            <FolderOpen size={15} /> {t('Open folder')}
          </button>
          {recent.length > 0 && (
            <div className="recent-list">
              <div className="recent-title">{t('Recent')}</div>
              {recent.slice(0, 6).map((f) => (
                <button key={f} className="recent-item" onClick={() => void openFolder(f)} data-tip={f}>
                  <FolderIcon name={P.basename(f)} open={false} size={15} />
                  <span className="truncate">{P.basename(f)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  const ex = useExplorer.getState()
  return (
    <div className="view" onContextMenu={(e) => onContext(e, null)}>
      <div className="view-head">
        <span className="view-title">{t('Explorer')}</span>
      </div>
      <div className="section-head explorer-root" onClick={() => setRootOpen(!rootOpen)}>
        <ChevronRight size={14} strokeWidth={2} className={`chev${rootOpen ? ' open' : ''}`} />
        <span className="truncate grow" data-tip={root}>
          {workspace.name}
        </span>
        <span className="section-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn sm" data-tip={t('New file')} onClick={() => void ex.startEdit({ mode: 'new-file', parent: parentFor(rows.find((r) => P.samePath(r.entry.path, selected ?? '')) ?? null), initial: '' })}>
            <FilePlus size={15} strokeWidth={1.7} />
          </button>
          <button className="icon-btn sm" data-tip={t('New folder')} onClick={() => void ex.startEdit({ mode: 'new-folder', parent: parentFor(rows.find((r) => P.samePath(r.entry.path, selected ?? '')) ?? null), initial: '' })}>
            <FolderPlus size={15} strokeWidth={1.7} />
          </button>
          <button className="icon-btn sm" data-tip={t('Refresh')} onClick={() => void ex.refreshAll()}>
            <RefreshCw size={14} strokeWidth={1.7} />
          </button>
          <button className="icon-btn sm" data-tip={t('Collapse all')} onClick={() => ex.collapseAll()}>
            <ListCollapse size={15} strokeWidth={1.7} />
          </button>
        </span>
      </div>
      {rootOpen && (
        <div className="tree" ref={scrollRef} tabIndex={0} onKeyDown={onKeyDown}>
          <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {virt.getVirtualItems().map((vi) => {
              const row = rows[vi.index]
              return (
                <div key={row.entry.path + (row.editing ? ':edit' : '')} className="tree-slot" style={{ transform: `translateY(${vi.start}px)`, height: ROW_H }}>
                  <TreeRow row={row} selected={!!selected && P.samePath(selected, row.entry.path)} activePath={activePath} onContext={onContext} />
                </div>
              )
            })}
          </div>
          {rows.length === 0 && <div className="empty-state">{t('Folder is empty')}</div>}
        </div>
      )}
    </div>
  )
}
