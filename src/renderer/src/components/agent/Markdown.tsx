import { memo, useEffect, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { colorize, escapeHtml } from '@/lib/monaco'
import { useT } from '@/lib/i18n'
import { invoke } from '@/lib/ipc'
import * as P from '@/lib/paths'
import { useApp } from '@/state/app'
import { useEditors } from '@/state/editors'

const cache = new Map<string, string>()
const LANG_ALIASES: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', py: 'python', sh: 'shell', bash: 'shell', ps1: 'powershell', pwsh: 'powershell', yml: 'yaml', md: 'markdown', cs: 'csharp', 'c++': 'cpp', rs: 'rust', golang: 'go' }

export function CodeBlock({ code, lang, maxLines }: { code: string; lang: string; maxLines?: number }) {
  const t = useT()
  const language = LANG_ALIASES[lang] ?? (lang || 'plaintext')
  const key = `${language}\u0000${code}`
  const [html, setHtml] = useState<string>(() => cache.get(key) ?? escapeHtml(code))
  const [copied, setCopied] = useState(false)
  const theme = useApp((s) => s.theme)
  useEffect(() => {
    let alive = true
    const cached = cache.get(key)
    if (cached) {
      setHtml(cached)
      return
    }
    void colorize(code, language).then((h) => {
      if (cache.size > 400) cache.clear()
      cache.set(key, h)
      if (alive) setHtml(h)
    })
    return () => {
      alive = false
    }
  }, [key, code, language, theme])
  const lines = code.split('\n').length
  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span className="codeblock-lang">{lang || t('text')}</span>
        <button
          className="icon-btn sm"
          data-tip={t('Copy')}
          onClick={() => {
            void navigator.clipboard.writeText(code)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre className={`codeblock-body${maxLines && lines > maxLines ? ' clipped' : ''}`} style={maxLines ? { maxHeight: maxLines * 19 + 16 } : undefined}>
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  )
}

/** Turn inline `path/to/file.ts:12` references into clickable links when they exist in the workspace. */
function InlineCode({ children }: { children: React.ReactNode }) {
  const text = String(children)
  const root = useApp((s) => s.workspace?.root ?? null)
  const m = /^([\w.\-\\/ ]+\.[A-Za-z0-9]{1,8})(?::(\d+))?$/.exec(text)
  if (!m || !root) return <code className="inline-code">{text}</code>
  const candidate = /^[A-Za-z]:|^\\\\/.test(m[1]) ? m[1] : P.join(root, m[1])
  return (
    <code
      className="inline-code linkish"
      onClick={async () => {
        const st = await invoke('fs:stat', candidate)
        if (st.exists && st.kind === 'file') useEditors.getState().openFile(candidate, { preview: true, line: m[2] ? Number(m[2]) : undefined, highlight: !!m[2] })
      }}
    >
      {text}
    </code>
  )
}

const components: Components = {
  code(props) {
    const { className, children } = props
    const lang = /language-([\w+-]+)/.exec(className ?? '')?.[1]
    const text = String(children ?? '')
    if (lang || text.includes('\n')) return <CodeBlock code={text.replace(/\n$/, '')} lang={lang ?? ''} />
    return <InlineCode>{children}</InlineCode>
  },
  pre({ children }) {
    return <>{children}</>
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault()
          if (href) void invoke('app:openExternal', href)
        }}
      >
        {children}
      </a>
    )
  },
  table({ children }) {
    return (
      <div className="md-table-wrap">
        <table>{children}</table>
      </div>
    )
  }
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md selectable">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
