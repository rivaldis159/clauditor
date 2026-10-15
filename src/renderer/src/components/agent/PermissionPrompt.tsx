import { useState } from 'react'
import { Check, ListTodo, MessageCircleQuestion, ShieldAlert, X } from 'lucide-react'
import type { PermissionRequest } from '@shared/types'
import { useT } from '@/lib/i18n'
import * as P from '@/lib/paths'
import { languageForPath } from '@/lib/monaco'
import { useApp } from '@/state/app'
import { useSessions } from '@/state/sessions'
import { CodeBlock, Markdown } from './Markdown'
import { HunkView } from './ToolCard'
import { toolMeta } from './toolInfo'

interface Question {
  question: string
  header?: string
  multiSelect?: boolean
  options?: { label: string; description?: string }[]
}

function QuestionForm({ req }: { req: PermissionRequest }) {
  const t = useT()
  const questions = (Array.isArray(req.input.questions) ? req.input.questions : []) as Question[]
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const s = useSessions.getState()
  const toggle = (q: Question, label: string) => {
    const cur = answers[q.question] ?? []
    const next = q.multiSelect ? (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]) : [label]
    setAnswers({ ...answers, [q.question]: next })
  }
  const ready = questions.every((q) => (answers[q.question]?.length ?? 0) > 0 || (other[q.question] ?? '').trim())
  return (
    <div className="perm-card question">
      <div className="perm-head">
        <MessageCircleQuestion size={16} strokeWidth={1.8} />
        <span className="grow">{t('Claude has a question')}</span>
      </div>
      {questions.map((q) => (
        <div key={q.question} className="question-block">
          {q.header && <div className="question-header">{q.header}</div>}
          <div className="question-text">{q.question}</div>
          <div className="question-options">
            {(q.options ?? []).map((o) => {
              const on = answers[q.question]?.includes(o.label)
              return (
                <button key={o.label} className={`question-option${on ? ' on' : ''}`} onClick={() => toggle(q, o.label)}>
                  <span className={`qo-mark${q.multiSelect ? ' square' : ''}`}>{on && <Check size={11} strokeWidth={3} />}</span>
                  <span className="qo-text">
                    <span className="qo-label">{o.label}</span>
                    {o.description && <span className="qo-desc">{o.description}</span>}
                  </span>
                </button>
              )
            })}
            <input className="input" placeholder={t('Other answer…')} value={other[q.question] ?? ''} onChange={(e) => setOther({ ...other, [q.question]: e.target.value })} />
          </div>
        </div>
      ))}
      <div className="perm-actions">
        <button className="btn btn-ghost" onClick={() => void s.respond(req, { behavior: 'deny', message: t('The user skipped this question.') })}>
          {t('Skip')}
        </button>
        <button
          className="btn btn-primary"
          disabled={!ready}
          onClick={() => {
            const out: Record<string, string> = {}
            for (const q of questions) {
              const picked = [...(answers[q.question] ?? [])]
              const extra = (other[q.question] ?? '').trim()
              if (extra) picked.push(extra)
              out[q.question] = picked.join(', ')
            }
            void s.respond(req, { behavior: 'allow', updatedInput: { ...req.input, answers: out } })
          }}
        >
          {t.n(questions.length, 'Send answer', 'Send answers')}
        </button>
      </div>
    </div>
  )
}

function PlanApproval({ req }: { req: PermissionRequest }) {
  const t = useT()
  const s = useSessions.getState()
  return (
    <div className="perm-card plan">
      <div className="perm-head">
        <ListTodo size={16} strokeWidth={1.8} />
        <span className="grow">{t('Plan ready for review')}</span>
      </div>
      <div className="perm-plan">
        <Markdown text={String(req.input.plan ?? '')} />
      </div>
      <div className="perm-actions wrap">
        <button className="btn btn-ghost" onClick={() => void s.respond(req, { behavior: 'deny', message: t('The user wants to stay in plan mode and refine the plan.') })}>
          {t('Keep planning')}
        </button>
        <button
          className="btn"
          onClick={async () => {
            await s.respond(req, { behavior: 'allow' })
            await s.setMode(req.runId, 'default')
          }}
        >
          {t('Approve · ask first')}
        </button>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await s.respond(req, { behavior: 'allow' })
            await s.setMode(req.runId, 'acceptEdits')
          }}
        >
          {t('Approve · accept edits')}
        </button>
      </div>
    </div>
  )
}

export function PermissionPrompt({ req }: { req: PermissionRequest }) {
  const t = useT()
  const root = useApp((st) => st.workspace?.root ?? null)
  const [reason, setReason] = useState('')
  const [askReason, setAskReason] = useState(false)
  const s = useSessions.getState()
  if (req.toolName === 'AskUserQuestion') return <QuestionForm req={req} />
  if (req.toolName === 'ExitPlanMode') return <PlanApproval req={req} />
  const meta = toolMeta(req.toolName)
  const i = req.input as Record<string, unknown>
  const fp = typeof i.file_path === 'string' ? i.file_path : null
  const title = req.title ?? `${meta.verb} ${fp ? P.displayPath(fp, root) : req.toolName}`
  return (
    <div className="perm-card">
      <div className="perm-head">
        <ShieldAlert size={16} strokeWidth={1.8} />
        <span className="grow truncate">{title}</span>
        <span className="chip">{req.toolName.startsWith('mcp__') ? req.toolName.split('__').slice(1).join(' › ') : req.toolName}</span>
      </div>
      {req.description && <div className="perm-desc">{req.description}</div>}
      {req.blockedPath && <div className="perm-desc">{t('Path outside the working folder: {path}', { path: req.blockedPath })}</div>}
      <div className="perm-preview">
        {(req.toolName === 'Edit' || req.toolName === 'MultiEdit') && (
          <HunkView
            hunks={[
              {
                oldStart: 1,
                oldLines: 0,
                newStart: 1,
                newLines: 0,
                lines: [...String(i.old_string ?? '').split('\n').map((l) => `-${l}`), ...String(i.new_string ?? '').split('\n').map((l) => `+${l}`)]
              }
            ]}
            maxLines={24}
          />
        )}
        {req.toolName === 'Write' && <CodeBlock code={String(i.content ?? '').slice(0, 8000)} lang={languageForPath(fp ?? '')} maxLines={16} />}
        {(req.toolName === 'Bash' || req.toolName === 'PowerShell') && (
          <div className="shell">
            {typeof i.description === 'string' && <div className="perm-desc">{i.description}</div>}
            <div className="shell-cmd selectable">
              <span className="shell-prompt">{req.toolName === 'PowerShell' ? 'PS>' : '$'}</span>
              <span>{String(i.command ?? '')}</span>
            </div>
          </div>
        )}
        {!['Edit', 'MultiEdit', 'Write', 'Bash', 'PowerShell'].includes(req.toolName) && <pre className="json selectable">{JSON.stringify(req.input, null, 2).slice(0, 4000)}</pre>}
      </div>
      {askReason && (
        <input
          className="input perm-reason"
          autoFocus
          placeholder={t('Tell Claude what to do instead (optional)')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void s.respond(req, { behavior: 'deny', message: reason || t('Denied by the user') })
          }}
        />
      )}
      <div className="perm-actions">
        <button
          className="btn btn-danger"
          onClick={() => {
            if (!askReason) setAskReason(true)
            else void s.respond(req, { behavior: 'deny', message: reason || t('Denied by the user') })
          }}
        >
          <X size={14} strokeWidth={2.2} /> {askReason ? t('Deny') : t('Deny…')}
        </button>
        <span className="grow" />
        {req.suggestions.length > 0 && (
          <button className="btn" data-tip={req.suggestions.map((x) => x.label).join('\n')} onClick={() => void s.respond(req, { behavior: 'allow', remember: true })}>
            {t('Always allow')}
          </button>
        )}
        <button className="btn btn-primary" onClick={() => void s.respond(req, { behavior: 'allow' })}>
          <Check size={14} strokeWidth={2.4} /> {t('Allow')}
        </button>
      </div>
    </div>
  )
}
