import { useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CaseSensitive, ChevronRight, Ellipsis, Regex, ReplaceAll, WholeWord, X } from 'lucide-react'
import { FileIcon } from '@/lib/fileIcons'
import * as P from '@/lib/paths'
import { num } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { useApp } from '@/state/app'
import { useSearch } from '@/state/search'
import { useEditors } from '@/state/editors'
import type { SearchFileResult, SearchMatch } from '@shared/types'

type FlatRow = { kind: 'file'; file: SearchFileResult } | { kind: 'match'; file: SearchFileResult; match: SearchMatch }

function Toggle({ on, label, onClick, children }: { on: boolean; label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button className={`input-toggle${on ? ' on' : ''}`} onClick={onClick} data-tip={label} aria-pressed={on}>
      {children}
    </button>
  )
}

export function SearchView({ active }: { active: boolean }) {
  const t = useT()
  const s = useSearch()
  const root = useApp((st) => st.workspace?.root ?? null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (active) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [active])

  const rows = useMemo(() => {
    const out: FlatRow[] = []
    for (const f of s.results) {
      out.push({ kind: 'file', file: f })
      if (!s.collapsed[f.path]) for (const m of f.matches) out.push({ kind: 'match', file: f, match: m })
    }
    return out
  }, [s.results, s.collapsed])

  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => 22, overscan: 16 })
  const total = s.results.reduce((n, f) => n + f.matches.length, 0)
  const resultCount = t.n(total, '{count} result', '{count} results', { count: num(total) })
  const fileCount = t.n(s.results.length, '{count} file', '{count} files', { count: num(s.results.length) })

  return (
    <div className="view">
      <div className="view-head">
        <span className="view-title">{t('Search')}</span>
        <button className="icon-btn sm" data-tip={t('Clear results')} onClick={() => s.set({ query: '', replace: '' })}>
          <X size={15} strokeWidth={1.7} />
        </button>
      </div>
      <div className="search-form">
        <div className="search-row">
          <button className={`search-replace-toggle${s.showReplace ? ' open' : ''}`} onClick={() => s.set({ showReplace: !s.showReplace })} data-tip={t('Toggle replace')}>
            <ChevronRight size={14} strokeWidth={2} />
          </button>
          <div className="search-inputs">
            <div className="input-with-toggles">
              <input
                ref={inputRef}
                className="input"
                placeholder={t('Search')}
                value={s.query}
                spellCheck={false}
                onChange={(e) => s.set({ query: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void s.run()
                }}
              />
              <span className="input-toggles">
                <Toggle on={s.matchCase} label={t('Match case')} onClick={() => s.set({ matchCase: !s.matchCase })}>
                  <CaseSensitive size={16} strokeWidth={1.7} />
                </Toggle>
                <Toggle on={s.wholeWord} label={t('Match whole word')} onClick={() => s.set({ wholeWord: !s.wholeWord })}>
                  <WholeWord size={16} strokeWidth={1.7} />
                </Toggle>
                <Toggle on={s.isRegex} label={t('Use regular expression')} onClick={() => s.set({ isRegex: !s.isRegex })}>
                  <Regex size={15} strokeWidth={1.7} />
                </Toggle>
              </span>
            </div>
            {s.showReplace && (
              <div className="replace-row">
                <input className="input" placeholder={t('Replace')} value={s.replace} spellCheck={false} onChange={(e) => s.set({ replace: e.target.value })} />
                <button className="icon-btn" data-tip={t('Replace all')} disabled={!s.results.length} onClick={() => void s.replaceAll()}>
                  <ReplaceAll size={16} strokeWidth={1.7} />
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="search-filters-toggle">
          <button className="icon-btn sm" data-tip={t('File filters')} onClick={() => s.set({ showFilters: !s.showFilters })}>
            <Ellipsis size={15} />
          </button>
        </div>
        {s.showFilters && (
          <div className="search-filters">
            <label>
              <span>{t('Files to include')}</span>
              <input className="input" placeholder={t('e.g. {patterns}', { patterns: 'src/**, *.ts' })} value={s.include} onChange={(e) => s.set({ include: e.target.value })} />
            </label>
            <label>
              <span>{t('Files to exclude')}</span>
              <input className="input" placeholder={t('e.g. {patterns}', { patterns: 'dist/**, *.min.js' })} value={s.exclude} onChange={(e) => s.set({ exclude: e.target.value })} />
            </label>
          </div>
        )}
      </div>
      <div className="search-summary">
        {!root ? (
          <span className="faint">{t('Open a folder to search.')}</span>
        ) : s.running ? (
          <span className="muted">{total > 0 ? t('Searching… {results}', { results: resultCount }) : t('Searching…')}</span>
        ) : s.done ? (
          s.done.error ? (
            <span className="search-error selectable">{s.done.error}</span>
          ) : total === 0 ? (
            <span className="muted">{t('No results found.')}</span>
          ) : (
            <span className="muted">
              {s.done.limitHit
                ? t('{results} in {files} (limit reached)', { results: resultCount, files: fileCount })
                : t('{results} in {files}', { results: resultCount, files: fileCount })}
            </span>
          )
        ) : null}
      </div>
      <div className="search-results" ref={scrollRef}>
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((vi) => {
            const row = rows[vi.index]
            const style = { transform: `translateY(${vi.start}px)`, height: 22 }
            if (row.kind === 'file') {
              const collapsed = !!s.collapsed[row.file.path]
              return (
                <div key={`f:${row.file.path}`} className="tree-slot" style={style}>
                  <div className="sr-file" onClick={() => s.toggleCollapsed(row.file.path)}>
                    <ChevronRight size={14} strokeWidth={2} className={`sr-chev${collapsed ? '' : ' open'}`} />
                    <FileIcon name={P.basename(row.file.path)} />
                    <span className="sr-name">{P.basename(row.file.path)}</span>
                    <span className="sr-dir truncate">{P.dirHint(row.file.path, root)}</span>
                    <span className="badge">{row.file.matches.length}</span>
                  </div>
                </div>
              )
            }
            const m = row.match
            return (
              <div key={`m:${row.file.path}:${m.line}:${m.column}`} className="tree-slot" style={style}>
                <div
                  className="sr-match"
                  onClick={() =>
                    useEditors.getState().openFile(row.file.path, { line: m.line, column: m.column, endLine: m.line, endColumn: m.column + m.length, preview: true, highlight: true })
                  }
                >
                  <span className="sr-line">{m.line}</span>
                  <span className="sr-preview truncate">
                    {m.preview.slice(0, m.previewOffset)}
                    <mark className={s.showReplace && s.replace ? 'strike' : ''}>{m.preview.slice(m.previewOffset, m.previewOffset + m.length)}</mark>
                    {s.showReplace && s.replace && <mark className="add">{s.replace}</mark>}
                    {m.preview.slice(m.previewOffset + m.length)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
