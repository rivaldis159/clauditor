import { useEffect, useState } from 'react'
import { Markdown } from '@/components/agent/Markdown'
import { getDoc, openDoc } from '@/state/documents'

export function MarkdownPreview({ path }: { path: string }) {
  const [text, setText] = useState('')
  useEffect(() => {
    let disposed = false
    let sub: { dispose(): void } | null = null
    void openDoc(path).then((r) => {
      if (disposed || !r.ok) return
      setText(r.doc.model.getValue())
      sub = r.doc.model.onDidChangeContent(() => setText(getDoc(path)?.model.getValue() ?? ''))
    })
    return () => {
      disposed = true
      sub?.dispose()
    }
  }, [path])
  return (
    <div className="page markdown-page">
      <article className="markdown-article">
        <Markdown text={text} />
      </article>
    </div>
  )
}
