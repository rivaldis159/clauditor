import { useEffect, useRef, useState } from 'react'
import { Check, Sparkles, X } from 'lucide-react'
import { languageForPath, monaco } from '@/lib/monaco'
import * as P from '@/lib/paths'
import { tk, useT } from '@/lib/i18n'
import { fetchDisk } from '@/state/documents'
import { resolveIdeDiff } from '@/state/ide'
import type { Tab } from '@/state/editors'
import { DiffToolbar, useDiffEditor } from './DiffHost'

type IdeDiffTab = Extract<Tab, { kind: 'ide-diff' }>

/** Claude Code (via the IDE bridge) proposes an edit; the user accepts — optionally after tweaking — or rejects. */
export function IdeDiffHost({ tab }: { tab: IdeDiffTab }) {
  const t = useT()
  const container = useRef<HTMLDivElement>(null)
  const [sideBySide, setSideBySide] = useState(true)
  const diffRef = useDiffEditor(container, sideBySide)
  const modifiedRef = useRef<monaco.editor.ITextModel | null>(null)
  const [isNew, setIsNew] = useState(false)

  useEffect(() => {
    const diff = diffRef.current
    if (!diff) return
    let disposed = false
    const lang = languageForPath(tab.path)
    const original = monaco.editor.createModel('', lang, monaco.Uri.parse(`clauditor-ide:/${tab.requestId}/old/${P.basename(tab.path)}`))
    const modified = monaco.editor.createModel(tab.newContents, lang, monaco.Uri.parse(`clauditor-ide:/${tab.requestId}/new/${P.basename(tab.path)}`))
    modifiedRef.current = modified
    void fetchDisk(tab.path).then((c) => {
      if (disposed) return
      if (c.kind === 'text') original.setValue(c.text)
      else setIsNew(true)
      diff.setModel({ original, modified })
    })
    return () => {
      disposed = true
      if (diffRef.current === diff) diff.setModel(null)
      original.dispose()
      modified.dispose()
      modifiedRef.current = null
    }
  }, [diffRef, tab.requestId, tab.path, tab.newContents])

  const accept = () => void resolveIdeDiff(tab.requestId, { accepted: true, content: modifiedRef.current?.getValue() ?? tab.newContents })
  const reject = () => void resolveIdeDiff(tab.requestId, { accepted: false })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault()
        accept()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="diff-host">
      <div className="ide-proposal">
        <Sparkles size={16} strokeWidth={1.8} />
        <div className="grow">
          <div className="ide-proposal-title">{isNew ? t('Claude Code proposes a new file') : t('Claude Code proposes changes')}</div>
          <div className="ide-proposal-sub truncate">{t('{path} — you can edit the right side before accepting.', { path: tab.path })}</div>
        </div>
        <button className="btn btn-danger" onClick={reject}>
          <X size={15} strokeWidth={2} /> {t('Reject')}
        </button>
        <button className="btn btn-primary" onClick={accept} data-tip={t('Accept')} data-tip-keys="Ctrl+Enter">
          <Check size={15} strokeWidth={2.2} /> {t('Accept')}
        </button>
      </div>
      <DiffToolbar left={isNew ? tk("File doesn't exist yet") : tk('Current')} right={tk("Claude's proposal")} sideBySide={sideBySide} setSideBySide={setSideBySide} diffRef={diffRef} path={tab.path} />
      <div className="monaco-host" ref={container} />
    </div>
  )
}
