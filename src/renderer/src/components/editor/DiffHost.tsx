import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Columns2, FileText, Rows2 } from 'lucide-react'
import { languageForPath, monaco } from '@/lib/monaco'
import { invoke } from '@/lib/ipc'
import * as P from '@/lib/paths'
import { useT } from '@/lib/i18n'
import { useApp } from '@/state/app'
import { fetchDisk, openDoc } from '@/state/documents'
import { useEditors, type DiffSide, type Tab } from '@/state/editors'
import { editorOptions } from './CodeEditorHost'

type DiffTab = Extract<Tab, { kind: 'diff' }>

let seq = 0

async function sideText(side: DiffSide, path: string): Promise<string> {
  switch (side.kind) {
    case 'text':
      if (side.label === 'Disk') {
        const c = await fetchDisk(path)
        return c.kind === 'text' ? c.text : ''
      }
      return side.text
    case 'git': {
      const root = useApp.getState().workspace?.root
      if (!root) return ''
      return (await invoke('git:show', root, path, side.ref)) ?? ''
    }
    case 'backup':
      return side.backup ? ((await invoke('sessions:backup', side.sessionId, side.backup)) ?? '') : ''
    case 'file': {
      const c = await fetchDisk(path)
      return c.kind === 'text' ? c.text : ''
    }
  }
}

export function useDiffEditor(container: React.RefObject<HTMLDivElement | null>, sideBySide: boolean, opts?: { originalEditable?: boolean }) {
  const ref = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const [instance, setInstance] = useState<monaco.editor.IStandaloneDiffEditor | null>(null)
  const settings = useApp((s) => s.settings.editor)
  useEffect(() => {
    const base = editorOptions(useApp.getState().settings.editor)
    const diff = monaco.editor.createDiffEditor(container.current!, {
      ...base,
      renderSideBySide: sideBySide,
      useInlineViewWhenSpaceIsLimited: true,
      originalEditable: opts?.originalEditable ?? false,
      renderOverviewRuler: true,
      ignoreTrimWhitespace: false,
      hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 6, revealLineCount: 20 },
      renderMarginRevertIcon: false,
      renderGutterMenu: false,
      diffWordWrap: 'inherit',
      minimap: { enabled: false },
      // room for the +/− signs between the line numbers and the code (inline view)
      lineDecorationsWidth: 20,
      automaticLayout: true,
      theme: 'clauditor'
    })
    ref.current = diff
    setInstance(diff)
    return () => {
      ref.current = null
      setInstance(null)
      diff.dispose()
    }
  }, [container])
  useEffect(() => {
    ref.current?.updateOptions({ renderSideBySide: sideBySide })
  }, [sideBySide])
  useEffect(() => {
    const { minimap: _m, ...rest } = editorOptions(settings)
    ref.current?.updateOptions(rest)
  }, [settings])
  return Object.assign(ref, { instance })
}

export function DiffToolbar({
  left,
  right,
  sideBySide,
  setSideBySide,
  diffRef,
  path,
  children
}: {
  /** side labels: English text marked with tk() is translated here, other text is shown as is */
  left: string
  right: string
  sideBySide: boolean
  setSideBySide(v: boolean): void
  diffRef: React.RefObject<monaco.editor.IStandaloneDiffEditor | null> & { instance?: monaco.editor.IStandaloneDiffEditor | null }
  path: string
  children?: React.ReactNode
}) {
  const t = useT()
  const [stats, setStats] = useState<{ changes: number; added: number; removed: number } | null>(null)
  const instance = diffRef.instance ?? null
  useEffect(() => {
    const d = instance
    if (!d) return
    const update = () => {
      const changes = d.getLineChanges() ?? []
      let added = 0
      let removed = 0
      for (const c of changes) {
        if (c.modifiedEndLineNumber >= c.modifiedStartLineNumber && c.modifiedEndLineNumber > 0) added += c.modifiedEndLineNumber - c.modifiedStartLineNumber + 1
        if (c.originalEndLineNumber >= c.originalStartLineNumber && c.originalEndLineNumber > 0) removed += c.originalEndLineNumber - c.originalStartLineNumber + 1
      }
      setStats({ changes: changes.length, added, removed })
    }
    const sub = d.onDidUpdateDiff(update)
    update()
    return () => sub.dispose()
  }, [instance])
  return (
    <div className="diff-toolbar">
      <span className="diff-side left truncate">{t(left)}</span>
      <span className="diff-arrow">→</span>
      <span className="diff-side right truncate">{t(right)}</span>
      {stats && (
        <span className="diff-stats">
          <span className="plus">+{stats.added}</span>
          <span className="minus">−{stats.removed}</span>
        </span>
      )}
      <span className="grow" />
      {children}
      <button className="icon-btn sm" data-tip={t('Previous change')} onClick={() => diffRef.current?.goToDiff('previous')}>
        <ArrowUp size={15} strokeWidth={1.8} />
      </button>
      <button className="icon-btn sm" data-tip={t('Next change')} onClick={() => diffRef.current?.goToDiff('next')}>
        <ArrowDown size={15} strokeWidth={1.8} />
      </button>
      <button className="icon-btn sm" data-tip={sideBySide ? t('Inline view') : t('Side-by-side view')} onClick={() => setSideBySide(!sideBySide)}>
        {sideBySide ? <Rows2 size={15} strokeWidth={1.7} /> : <Columns2 size={15} strokeWidth={1.7} />}
      </button>
      <button className="icon-btn sm" data-tip={t('Open file')} onClick={() => useEditors.getState().openFile(path, { preview: false })}>
        <FileText size={15} strokeWidth={1.7} />
      </button>
    </div>
  )
}

export function DiffHost({ tab }: { tab: DiffTab }) {
  const t = useT()
  const container = useRef<HTMLDivElement>(null)
  const [sideBySide, setSideBySide] = useState(true)
  const diffRef = useDiffEditor(container, sideBySide)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const diff = diffRef.current
    if (!diff) return
    let disposed = false
    const created: monaco.editor.ITextModel[] = []
    const id = ++seq
    const lang = languageForPath(tab.path)
    void (async () => {
      try {
        const leftText = await sideText(tab.left, tab.path)
        let modified: monaco.editor.ITextModel
        if (tab.right.kind === 'file') {
          const r = await openDoc(tab.path)
          if (!r.ok) throw new Error(t("File couldn't be opened"))
          modified = r.doc.model
        } else {
          modified = monaco.editor.createModel(await sideText(tab.right, tab.path), lang, monaco.Uri.parse(`clauditor-diff:/${id}/right/${P.basename(tab.path)}`))
          created.push(modified)
        }
        const original = monaco.editor.createModel(leftText, lang, monaco.Uri.parse(`clauditor-diff:/${id}/left/${P.basename(tab.path)}`))
        created.push(original)
        if (disposed) return
        diff.setModel({ original, modified })
        diff.getModifiedEditor().updateOptions({ readOnly: tab.right.kind !== 'file' })
      } catch (e) {
        setError(String(e))
      }
    })()
    return () => {
      disposed = true
      // the editor is already disposed when the whole tab unmounts
      if (diffRef.current === diff) diff.setModel(null)
      for (const m of created) m.dispose()
    }
  }, [diffRef, tab.key, tab.left, tab.right, tab.path])

  return (
    <div className="diff-host">
      <DiffToolbar left={tab.left.label} right={tab.right.label} sideBySide={sideBySide} setSideBySide={setSideBySide} diffRef={diffRef} path={tab.path} />
      {error && <div className="editor-banner bad">{error}</div>}
      <div className="monaco-host" ref={container} />
    </div>
  )
}
