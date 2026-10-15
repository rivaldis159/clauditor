import { useEffect, useMemo, useRef, useState } from 'react'
import fuzzysort from 'fuzzysort'
import { CornerDownLeft, FolderOpen, GitBranch, Hash, Plus, Sparkles, Terminal } from 'lucide-react'
import { allCommands, prettyKeys } from '@/lib/commands'
import { FileIcon } from '@/lib/fileIcons'
import { invoke } from '@/lib/ipc'
import { ago } from '@/lib/format'
import * as P from '@/lib/paths'
import { tk, useT } from '@/lib/i18n'
import { useApp, type PaletteMode } from '@/state/app'
import { useEditors } from '@/state/editors'
import { useGit } from '@/state/git'
import { originLabel, sessionTitle, useSessions } from '@/state/sessions'
import { openFolder } from '@/state/workspace'
import { editorsShowing } from '@/state/editorActions'

interface Item {
  key: string
  label: string
  detail?: string
  hint?: string
  keys?: string[]
  icon?: React.ReactNode
  highlight?: number[]
  run(): void
}

let filesCache: { root: string; files: string[]; at: number } | null = null

function Highlighted({ text, indexes }: { text: string; indexes?: number[] }) {
  if (!indexes?.length) return <>{text}</>
  const set = new Set(indexes)
  const out: React.ReactNode[] = []
  let buf = ''
  let on = false
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i)
    if (hit !== on) {
      if (buf) out.push(on ? <mark key={i}>{buf}</mark> : buf)
      buf = ''
      on = hit
    }
    buf += text[i]
  }
  if (buf) out.push(on ? <mark key="end">{buf}</mark> : buf)
  return <>{out}</>
}

const PLACEHOLDER: Record<PaletteMode, string> = {
  files: tk('Search files — type > for commands, : to go to a line, # for Claude sessions'),
  commands: tk('Type a command name'),
  sessions: tk('Search Claude Code sessions'),
  goto: tk('Type a line number, e.g. :120 or :120:8'),
  branches: tk('Select a branch or type a new branch name'),
  recent: tk('Open recent folder')
}

export function Palette() {
  const t = useT()
  const palette = useApp((s) => s.palette)
  const workspace = useApp((s) => s.workspace)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const groups = useSessions((s) => s.groups)
  const live = useSessions((s) => s.live)
  const branches = useGit((s) => s.branches)
  const recent = useApp((s) => s.persisted.recentFolders)

  const open = palette.open
  useEffect(() => {
    if (!open) return
    setQuery(palette.mode === 'commands' ? '>' : palette.mode === 'sessions' ? '#' : palette.mode === 'goto' ? ':' : palette.query)
    setIndex(0)
    requestAnimationFrame(() => inputRef.current?.focus())
    if (palette.mode === 'branches') void useGit.getState().loadBranches()
    if (workspace) {
      if (filesCache && filesCache.root === workspace.root && Date.now() - filesCache.at < 20000) setFiles(filesCache.files)
      else
        void invoke('fs:listFiles', workspace.root).then((f) => {
          filesCache = { root: workspace.root, files: f, at: Date.now() }
          setFiles(f)
        })
    }
  }, [open, palette.mode, palette.query, workspace])

  // effective mode from prefix
  const mode: PaletteMode =
    palette.mode === 'branches' || palette.mode === 'recent'
      ? palette.mode
      : query.startsWith('>')
        ? 'commands'
        : query.startsWith(':')
          ? 'goto'
          : query.startsWith('#')
            ? 'sessions'
            : 'files'
  const q = mode === 'commands' || mode === 'goto' || mode === 'sessions' ? query.slice(1).trim() : query.trim()

  const items: Item[] = useMemo(() => {
    const close = () => useApp.getState().closePalette()
    if (mode === 'commands') {
      const cmds = allCommands()
      // match against the translated text, so the query works in the UI language
      const targets = cmds.map((c) => ({ c, s: `${c.category ? `${t(c.category)}: ` : ''}${t(c.title)}` }))
      const res = q ? fuzzysort.go(q, targets, { key: 's', limit: 60, threshold: 0.4 }) : targets.map((x) => ({ obj: x, indexes: [] as number[] }))
      return res.map((r) => {
        const { c, s } = r.obj
        return {
          key: c.id,
          label: s,
          keys: prettyKeys(c.keys),
          highlight: 'indexes' in r ? [...(r.indexes as readonly number[])] : [],
          run: () => {
            close()
            setTimeout(() => void c.run(), 0)
          }
        }
      })
    }
    if (mode === 'goto') {
      const path = useEditors.getState().activePath()
      const m = /^(\d+)(?::(\d+))?$/.exec(q)
      if (!path) return [{ key: 'none', label: t('Open a file first'), run: close }]
      const ed = editorsShowing(path)[0]
      const total = ed?.getModel()?.getLineCount() ?? 0
      return [
        {
          key: 'goto',
          label: m
            ? m[2]
              ? t('Go to line {line}, column {column}', { line: m[1], column: m[2] })
              : t('Go to line {line}', { line: m[1] })
            : t('Type a line number (1–{total})', { total }),
          icon: <Hash size={14} />,
          run: () => {
            if (!m) return
            close()
            useEditors.getState().openFile(path, { line: Number(m[1]), column: m[2] ? Number(m[2]) : 1, focus: true })
          }
        }
      ]
    }
    if (mode === 'sessions') {
      const all = groups.flatMap((g) => g.sessions)
      const liveIds = new Set(live.map((l) => l.sessionId))
      const targets = all.map((m) => ({ m, s: `${sessionTitle(m)} ${m.cwd ? P.basename(m.cwd) : ''}` }))
      const res = q ? fuzzysort.go(q, targets, { key: 's', limit: 50, threshold: 0.15 }).map((r) => r.obj) : targets.slice(0, 50)
      return res.map(({ m }) => ({
        key: m.id,
        label: sessionTitle(m),
        detail: `${m.cwd ? P.basename(m.cwd) : m.projectSlug} · ${originLabel(m.entrypoint)}`,
        hint: liveIds.has(m.id) ? t('running') : ago(m.updatedAt),
        icon: <Sparkles size={14} className={liveIds.has(m.id) ? 'accent' : ''} />,
        run: () => {
          close()
          void useSessions.getState().activate(m.id)
        }
      }))
    }
    if (mode === 'branches') {
      const local = branches.filter((b) => !b.remote)
      const remote = branches.filter((b) => b.remote)
      const targets = [...local, ...remote]
      const res = q ? fuzzysort.go(q, targets, { key: 'name', limit: 50, threshold: 0.1 }).map((r) => r.obj) : targets
      const list: Item[] = res.map((b) => ({
        key: b.name,
        label: b.name,
        detail: b.lastCommit,
        hint: b.current ? t('current') : b.remote ? t('remote') : '',
        icon: <GitBranch size={14} />,
        run: () => {
          close()
          if (!b.current) void useGit.getState().checkout(b.name)
        }
      }))
      if (q && !branches.some((b) => b.name === q)) {
        list.unshift({
          key: '__new',
          label: t('Create new branch: {name}', { name: q }),
          icon: <Plus size={14} />,
          run: () => {
            close()
            void useGit.getState().checkout(q, true)
          }
        })
      }
      return list
    }
    if (mode === 'recent') {
      return recent.map((f) => ({
        key: f,
        label: P.basename(f),
        detail: f,
        icon: <FolderOpen size={14} />,
        run: () => {
          close()
          void openFolder(f)
        }
      }))
    }
    // files
    if (!workspace) {
      return [
        {
          key: 'open',
          label: t('Open folder…'),
          icon: <FolderOpen size={14} />,
          run: () => {
            close()
            void openFolder()
          }
        },
        ...recent.map((f) => ({
          key: f,
          label: P.basename(f),
          detail: f,
          icon: <FolderOpen size={14} />,
          run: () => {
            close()
            void openFolder(f)
          }
        }))
      ]
    }
    const root = workspace.root
    const rels = files.map((f) => P.relative(root, f))
    const openTabs = useEditors
      .getState()
      .groups.flatMap((g) => g.tabs)
      .filter((tab) => tab.kind === 'file')
      .map((tab) => ('path' in tab ? P.relative(root, tab.path) : ''))
      .filter(Boolean)
    if (!q) {
      const seen = new Set<string>()
      const list = [...openTabs, ...rels].filter((r) => (seen.has(r) ? false : (seen.add(r), true))).slice(0, 60)
      return list.map((rel) => ({
        key: rel,
        label: P.basename(rel),
        detail: P.dirname(rel) === rel ? '' : P.dirname(rel),
        hint: openTabs.includes(rel) ? t('open') : undefined,
        icon: <FileIcon name={P.basename(rel)} />,
        run: () => {
          close()
          useEditors.getState().openFile(P.join(root, rel), { preview: false, focus: true })
        }
      }))
    }
    // allow "file.ts:42"
    const lineMatch = /^(.*?):(\d+)$/.exec(q)
    const needle = lineMatch ? lineMatch[1] : q
    const res = fuzzysort.go(needle, rels, { limit: 60, threshold: 0.15 })
    return res.map((r) => {
      const rel = r.target
      const base = P.basename(rel)
      const baseStart = rel.length - base.length
      const idx = [...r.indexes]
      return {
        key: rel,
        label: base,
        detail: P.dirname(rel) === rel ? '' : P.dirname(rel),
        icon: <FileIcon name={base} />,
        highlight: idx.filter((i) => i >= baseStart).map((i) => i - baseStart),
        run: () => {
          close()
          useEditors.getState().openFile(P.join(root, rel), { preview: false, focus: true, line: lineMatch ? Number(lineMatch[2]) : undefined })
        }
      }
    })
  }, [mode, q, files, workspace, groups, live, branches, recent, t])

  useEffect(() => {
    setIndex(0)
  }, [query])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-i="${index}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!open) return null
  return (
    <div className="palette-backdrop" onPointerDown={() => useApp.getState().closePalette()}>
      <div className="palette" onPointerDown={(e) => e.stopPropagation()}>
        <div className="palette-input-wrap">
          {mode === 'commands' ? <Terminal size={15} /> : mode === 'sessions' ? <Sparkles size={15} /> : mode === 'branches' ? <GitBranch size={15} /> : null}
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            placeholder={t(PLACEHOLDER[mode])}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                useApp.getState().closePalette()
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(items.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(0, i - 1))
              } else if (e.key === 'PageDown') {
                e.preventDefault()
                setIndex((i) => Math.min(items.length - 1, i + 10))
              } else if (e.key === 'PageUp') {
                e.preventDefault()
                setIndex((i) => Math.max(0, i - 10))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                items[index]?.run()
              }
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {items.map((it, i) => (
            <div key={it.key} data-i={i} className={`palette-item${i === index ? ' active' : ''}`} onPointerEnter={() => setIndex(i)} onClick={() => it.run()}>
              {it.icon && <span className="palette-icon">{it.icon}</span>}
              <span className="palette-label truncate">
                <Highlighted text={it.label} indexes={it.highlight} />
              </span>
              {it.detail && <span className="palette-detail truncate">{it.detail}</span>}
              <span className="grow" />
              {it.hint && <span className="palette-hint">{it.hint}</span>}
              {it.keys && it.keys.length > 0 && (
                <span className="palette-keys">
                  {it.keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </span>
              )}
              {i === index && !it.keys?.length && <CornerDownLeft size={13} className="palette-enter" />}
            </div>
          ))}
          {items.length === 0 && <div className="palette-empty">{t('No matching results')}</div>}
        </div>
      </div>
    </div>
  )
}
