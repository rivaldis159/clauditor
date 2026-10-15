import { useMemo } from 'react'
import { Brain, FilePen, FilePlus, SquareTerminal, Sparkles } from 'lucide-react'
import type { RunnerStreamUpdate, StreamBlock } from '@shared/types'
import { partialFields } from '@/lib/partialJson'
import { useT } from '@/lib/i18n'
import { languageForPath } from '@/lib/monaco'
import * as P from '@/lib/paths'
import { useApp } from '@/state/app'
import { Markdown } from './Markdown'
import { toolMeta } from './toolInfo'

function tail(text: string, lines: number): string {
  const parts = text.split('\n')
  return parts.length > lines ? parts.slice(-lines).join('\n') : text
}

function ToolStream({ b }: { b: StreamBlock }) {
  const t = useT()
  const root = useApp((s) => s.workspace?.root ?? null)
  const { values, open } = useMemo(() => partialFields(b.text), [b.text])
  const name = b.toolName ?? 'tool'
  const meta = toolMeta(name)
  const path = values.file_path ?? values.notebook_path
  if (name === 'Write' && path !== undefined) {
    const content = values.content ?? ''
    const lineCount = content.split('\n').length
    return (
      <div className="stream-tool">
        <div className="stream-tool-head">
          <FilePlus size={14} strokeWidth={1.8} />
          <span>{t('Writing')}</span>
          <span className="tc-target path truncate">{P.displayPath(path, root)}</span>
          <span className="stream-count">{t.n(lineCount, '{n} line', '{n} lines')}</span>
        </div>
        <pre className={`stream-code lang-${languageForPath(path)}`}>
          {tail(content, 26)}
          {open === 'content' && <span className="type-caret" />}
        </pre>
      </div>
    )
  }
  if ((name === 'Edit' || name === 'MultiEdit') && path !== undefined) {
    return (
      <div className="stream-tool">
        <div className="stream-tool-head">
          <FilePen size={14} strokeWidth={1.8} />
          <span>{t('Editing')}</span>
          <span className="tc-target path truncate">{P.displayPath(path, root)}</span>
        </div>
        {values.old_string !== undefined && <pre className="stream-code del">{tail(values.old_string, 10)}</pre>}
        {values.new_string !== undefined && (
          <pre className="stream-code add">
            {tail(values.new_string, 18)}
            {open === 'new_string' && <span className="type-caret" />}
          </pre>
        )}
      </div>
    )
  }
  if ((name === 'Bash' || name === 'PowerShell') && values.command !== undefined) {
    return (
      <div className="stream-tool">
        <div className="stream-tool-head">
          <SquareTerminal size={14} strokeWidth={1.8} />
          <span>{values.description || t('Preparing command')}</span>
        </div>
        <pre className="stream-code">
          <span className="shell-prompt">{name === 'PowerShell' ? 'PS>' : '$'}</span> {values.command}
          {open === 'command' && <span className="type-caret" />}
        </pre>
      </div>
    )
  }
  const Icon = meta.icon
  return (
    <div className="stream-tool">
      <div className="stream-tool-head">
        <Icon size={14} strokeWidth={1.8} />
        <span>{meta.verb}</span>
        <span className="tc-target truncate">{name.startsWith('mcp__') ? name.split('__').slice(1).join(' › ') : name}</span>
        <span className="stream-dots" />
      </div>
    </div>
  )
}

export function StreamView({ stream }: { stream: RunnerStreamUpdate }) {
  const t = useT()
  return (
    <div className="stream">
      {stream.blocks.map((b) =>
        b.type === 'text' ? (
          <div key={b.index} className="tl-text streaming">
            <Markdown text={b.text} />
            <span className="type-caret inline" />
          </div>
        ) : b.type === 'thinking' ? (
          <div key={b.index} className="tl-thinking open streaming">
            <div className="thinking-head">
              <Brain size={13} strokeWidth={1.8} />
              <span>{t('Thinking…')}</span>
            </div>
            <div className="thinking-body">{tail(b.text, 8)}</div>
          </div>
        ) : (
          <ToolStream key={b.index} b={b} />
        )
      )}
      {stream.blocks.length === 0 && (
        <div className="working-line">
          <Sparkles size={13} />
          <span className="shimmer">{t('Claude is composing a response…')}</span>
        </div>
      )}
    </div>
  )
}
