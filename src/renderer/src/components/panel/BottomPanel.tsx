import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, CircleX, Eraser, Info, Maximize2, Minimize2, Plus, Sparkles, SquareTerminal, Trash, TriangleAlert, X } from 'lucide-react'
import type { TerminalProfileId } from '@shared/types'
import { monaco } from '@/lib/monaco'
import { FileIcon } from '@/lib/fileIcons'
import * as P from '@/lib/paths'
import { useT } from '@/lib/i18n'
import { useApp } from '@/state/app'
import { isCreatingTerminal, useTerminals } from '@/state/terminals'
import { useEditors } from '@/state/editors'
import { attachTerminal, clearTerminal, disposeTerminal, fitTerminal, focusTerminal, refreshTerminalOptions } from './terminalHost'

function TerminalView() {
  const t = useT()
  const terminals = useTerminals((s) => s.terminals)
  const activeId = useTerminals((s) => s.activeId)
  const hostRef = useRef<HTMLDivElement>(null)
  const panelVisible = useApp((s) => s.layout.panelVisible)
  const panelHeight = useApp((s) => s.layout.panelHeight)
  const theme = useApp((s) => s.theme)
  const termSettings = useApp((s) => s.settings.terminal)

  useEffect(() => {
    if (!activeId || !hostRef.current) return
    attachTerminal(activeId, hostRef.current)
    for (const el of [...hostRef.current.children]) (el as HTMLElement).style.display = 'none'
    const inst = attachTerminal(activeId, hostRef.current)
    inst.el.style.display = 'block'
    requestAnimationFrame(() => {
      fitTerminal(activeId)
      focusTerminal(activeId)
    })
  }, [activeId])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const id = useTerminals.getState().activeId
      if (id) fitTerminal(id)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (activeId) requestAnimationFrame(() => fitTerminal(activeId))
  }, [panelVisible, panelHeight, activeId])

  useEffect(() => {
    refreshTerminalOptions()
  }, [theme, termSettings])

  useEffect(() => {
    if (panelVisible && terminals.length === 0 && !isCreatingTerminal()) void useTerminals.getState().create()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelVisible])

  return (
    <div className="terminal-view">
      <div className="terminal-host" ref={hostRef} />
      {terminals.length > 1 && (
        <div className="terminal-list">
          {terminals.map((term) => (
            <div key={term.id} className={`terminal-item${term.id === activeId ? ' active' : ''}`} onClick={() => useTerminals.getState().setActive(term.id)}>
              {term.profile === 'claude' ? <Sparkles size={13} className="accent" /> : <SquareTerminal size={13} />}
              <span className="truncate grow">{term.name}</span>
              {term.exitCode !== null && <span className="faint">({term.exitCode})</span>}
              <button
                className="icon-btn sm"
                onClick={(e) => {
                  e.stopPropagation()
                  disposeTerminal(term.id)
                  void useTerminals.getState().kill(term.id)
                }}
                aria-label={t('Close terminal')}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProblemsView() {
  const t = useT()
  const [markers, setMarkers] = useState<monaco.editor.IMarker[]>(() => monaco.editor.getModelMarkers({}))
  const root = useApp((s) => s.workspace?.root ?? null)
  useEffect(() => {
    const d = monaco.editor.onDidChangeMarkers(() => setMarkers(monaco.editor.getModelMarkers({})))
    return () => d.dispose()
  }, [])
  const byFile = useMemo(() => {
    const m = new Map<string, monaco.editor.IMarker[]>()
    for (const mk of markers) {
      if (mk.resource.scheme !== 'file' || mk.severity < monaco.MarkerSeverity.Warning) continue
      const k = mk.resource.fsPath
      m.set(k, [...(m.get(k) ?? []), mk])
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [markers])
  if (!byFile.length) return <div className="empty-state">{t('No problems have been detected in open files.')}</div>
  return (
    <div className="problems">
      {byFile.map(([file, list]) => (
        <div key={file} className="problem-file">
          <div className="problem-file-head">
            <FileIcon name={P.basename(file)} size={14} />
            <span>{P.basename(file)}</span>
            <span className="faint truncate">{P.dirHint(file, root)}</span>
            <span className="badge">{list.length}</span>
          </div>
          {list
            .sort((a, b) => b.severity - a.severity || a.startLineNumber - b.startLineNumber)
            .map((mk, i) => (
              <div
                key={i}
                className="problem"
                onClick={() => useEditors.getState().openFile(file, { line: mk.startLineNumber, column: mk.startColumn, endLine: mk.endLineNumber, endColumn: mk.endColumn, preview: true })}
              >
                {mk.severity === monaco.MarkerSeverity.Error ? <CircleX size={13} className="sev-error" /> : mk.severity === monaco.MarkerSeverity.Warning ? <TriangleAlert size={13} className="sev-warn" /> : <Info size={13} />}
                <span className="problem-msg truncate">{mk.message}</span>
                <span className="faint problem-src">{mk.source ? `${mk.source}${mk.code ? `(${typeof mk.code === 'string' ? mk.code : mk.code.value})` : ''}` : ''}</span>
                <span className="faint">
                  [{mk.startLineNumber}, {mk.startColumn}]
                </span>
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}

export function BottomPanel() {
  const t = useT()
  const tab = useApp((s) => s.panelTab)
  const problems = useApp((s) => s.problems)
  const profiles = useTerminals((s) => s.profiles)
  const activeId = useTerminals((s) => s.activeId)
  const [maximized, setMaximized] = useState(false)
  const a = useApp.getState()

  const newMenu = (e: React.MouseEvent) =>
    a.showContextMenu(
      e,
      profiles
        .filter((p) => p.available)
        .map((p) => ({ label: p.label, icon: p.id === 'claude' ? <Sparkles size={14} /> : <SquareTerminal size={14} />, run: () => void useTerminals.getState().create({ profile: p.id as TerminalProfileId, name: p.id === 'claude' ? 'Claude Code' : undefined }) }))
    )

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-tabs">
          <button className={`panel-tab${tab === 'terminal' ? ' active' : ''}`} onClick={() => a.setPanelTab('terminal')}>
            {t('Terminal')}
          </button>
          <button className={`panel-tab${tab === 'problems' ? ' active' : ''}`} onClick={() => a.setPanelTab('problems')}>
            {t('Problems')}
            {problems.errors + problems.warnings > 0 && <span className="badge">{problems.errors + problems.warnings}</span>}
          </button>
        </div>
        <span className="grow" />
        {tab === 'terminal' && (
          <>
            <button className="icon-btn sm" data-tip={t('New terminal')} data-tip-keys="Ctrl+Shift+`" onClick={() => void useTerminals.getState().create()}>
              <Plus size={15} strokeWidth={1.8} />
            </button>
            <button className="icon-btn sm" data-tip={t('Select terminal profile')} onClick={newMenu}>
              <ChevronDown size={14} strokeWidth={1.8} />
            </button>
            <button className="icon-btn sm" data-tip={t('Claude Code terminal (connected to Clauditor)')} onClick={() => void useTerminals.getState().create({ profile: 'claude', name: 'Claude Code' })}>
              <Sparkles size={14} strokeWidth={1.8} />
            </button>
            <button className="icon-btn sm" data-tip={t('Clear')} disabled={!activeId} onClick={() => activeId && clearTerminal(activeId)}>
              <Eraser size={14} strokeWidth={1.8} />
            </button>
            <button
              className="icon-btn sm"
              data-tip={t('Close terminal')}
              disabled={!activeId}
              onClick={() => {
                if (!activeId) return
                disposeTerminal(activeId)
                void useTerminals.getState().kill(activeId)
              }}
            >
              <Trash size={14} strokeWidth={1.8} />
            </button>
          </>
        )}
        <button
          className="icon-btn sm"
          data-tip={maximized ? t('Restore panel size') : t('Maximize panel')}
          onClick={() => {
            const next = !maximized
            setMaximized(next)
            a.setLayout({ panelHeight: next ? window.innerHeight - 200 : 248 })
          }}
        >
          {maximized ? <Minimize2 size={14} strokeWidth={1.8} /> : <Maximize2 size={14} strokeWidth={1.8} />}
        </button>
        <button className="icon-btn sm" data-tip={t('Close panel')} data-tip-keys="Ctrl+J" onClick={() => a.togglePanel(false)}>
          <X size={15} strokeWidth={1.8} />
        </button>
      </div>
      <div className="panel-body">
        <div style={{ display: tab === 'terminal' ? 'flex' : 'none' }} className="panel-pane">
          <TerminalView />
        </div>
        {tab === 'problems' && (
          <div className="panel-pane">
            <ProblemsView />
          </div>
        )}
      </div>
    </div>
  )
}
