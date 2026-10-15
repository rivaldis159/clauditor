import { useState } from 'react'
import { Check, ChevronRight, CloudDownload, CloudUpload, Ellipsis, FileText, GitBranch, LoaderCircle, Minus, Plus, RefreshCw, RotateCcw, WandSparkles } from 'lucide-react'
import type { GitFileStatus } from '@shared/types'
import { FileIcon } from '@/lib/fileIcons'
import * as P from '@/lib/paths'
import { tk, useT, type T } from '@/lib/i18n'
import { useApp } from '@/state/app'
import { gitLetter, useGit } from '@/state/git'
import { useEditors } from '@/state/editors'

function openDiff(f: GitFileStatus, staged: boolean, t: T) {
  const name = P.basename(f.path)
  if (f.index === '?' || (f.index === 'A' && staged)) {
    useEditors.getState().openFile(f.path, { preview: true })
    return
  }
  if (f.worktree === 'D' && !staged) {
    useEditors.getState().openTab({
      kind: 'diff',
      key: `git:${P.key(f.path)}:deleted`,
      path: f.path,
      title: t('{name} (deleted)', { name }),
      left: { kind: 'git', ref: 'HEAD', label: 'HEAD' },
      right: { kind: 'text', text: '', label: tk('Deleted') },
      preview: true
    })
    return
  }
  useEditors.getState().openTab({
    kind: 'diff',
    key: `git:${P.key(f.path)}:${staged ? 'staged' : 'work'}`,
    path: f.path,
    title: staged ? t('{name} (staged)', { name }) : t('{name} (working tree)', { name }),
    left: { kind: 'git', ref: staged ? 'HEAD' : ':0', label: staged ? 'HEAD' : 'Index' },
    right: staged ? { kind: 'git', ref: ':0', label: 'Index' } : { kind: 'file', label: tk('Working tree') },
    preview: true
  })
}

function FileRow({ f, staged }: { f: GitFileStatus; staged: boolean }) {
  const t = useT()
  const g = gitLetter(f)
  const root = useApp((s) => s.workspace?.root)
  const git = useGit.getState()
  const dir = P.dirHint(f.path, root)
  return (
    <div className="scm-row" onClick={() => openDiff(f, staged, t)} data-tip={`${P.displayPath(f.path, root)} — ${g.label}`}>
      <FileIcon name={P.basename(f.path)} />
      <span className="scm-name truncate" style={{ textDecoration: g.letter === 'D' ? 'line-through' : undefined }}>
        {P.basename(f.path)}
      </span>
      <span className="scm-dir truncate">{dir}</span>
      <span className="scm-actions" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn sm" data-tip={t('Open file')} onClick={() => useEditors.getState().openFile(f.path, { preview: false })}>
          <FileText size={14} strokeWidth={1.7} />
        </button>
        {!staged && (
          <button className="icon-btn sm" data-tip={t('Discard changes')} onClick={() => void git.discard([f.path])}>
            <RotateCcw size={14} strokeWidth={1.7} />
          </button>
        )}
        {staged ? (
          <button className="icon-btn sm" data-tip={t('Unstage')} onClick={() => void git.unstage([f.path])}>
            <Minus size={15} strokeWidth={1.8} />
          </button>
        ) : (
          <button className="icon-btn sm" data-tip={t('Stage')} onClick={() => void git.stage([f.path])}>
            <Plus size={15} strokeWidth={1.8} />
          </button>
        )}
      </span>
      <span className="scm-letter" style={{ color: g.color }}>
        {g.letter}
      </span>
    </div>
  )
}

function Section({ title, files, staged, actions }: { title: string; files: GitFileStatus[]; staged: boolean; actions: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="scm-section">
      <div className="section-head" onClick={() => setOpen(!open)}>
        <ChevronRight size={14} strokeWidth={2} className={`chev${open ? ' open' : ''}`} />
        <span className="grow truncate">{title}</span>
        <span className="section-actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
        <span className="badge">{files.length}</span>
      </div>
      {open && files.map((f) => <FileRow key={`${staged}:${f.path}`} f={f} staged={staged} />)}
    </div>
  )
}

export function ScmView() {
  const t = useT()
  const workspace = useApp((s) => s.workspace)
  const status = useGit((s) => s.status)
  const message = useGit((s) => s.message)
  const busy = useGit((s) => s.busy)
  const generating = useGit((s) => s.generating)
  const loading = useGit((s) => s.loading)
  const git = useGit.getState()

  if (!workspace) {
    return (
      <div className="view">
        <div className="view-head">
          <span className="view-title">{t('Source control')}</span>
        </div>
        <div className="empty-state">{t('Open a folder to see Git changes.')}</div>
      </div>
    )
  }
  if (status && !status.isRepo) {
    return (
      <div className="view">
        <div className="view-head">
          <span className="view-title">{t('Source control')}</span>
        </div>
        <div className="empty-state">
          <GitBranch size={28} strokeWidth={1.4} />
          <strong>{t("This folder isn't a Git repository yet")}</strong>
          <span>{t('Initialize a repository so changes made by you and Claude can be tracked and undone.')}</span>
          <button className="btn btn-primary" onClick={() => void git.init()}>
            {t('Initialize repository')}
          </button>
        </div>
      </div>
    )
  }

  const staged = status?.files.filter((f) => f.index !== ' ' && f.index !== '?' && !f.conflicted) ?? []
  const changes = status?.files.filter((f) => f.worktree !== ' ' || f.index === '?' || f.conflicted) ?? []
  const canCommit = !!message.trim() && !busy

  return (
    <div className="view">
      <div className="view-head">
        <span className="view-title">{t('Source control')}</span>
        <button className="icon-btn sm" data-tip={t('Refresh')} onClick={() => void git.refreshNow()}>
          <RefreshCw size={14} strokeWidth={1.7} className={loading ? 'spin' : ''} />
        </button>
        <button className="icon-btn sm" data-tip={t('Pull')} onClick={() => void git.sync('pull')}>
          <CloudDownload size={15} strokeWidth={1.7} />
        </button>
        <button className="icon-btn sm" data-tip={t('Push')} onClick={() => void git.sync('push')}>
          <CloudUpload size={15} strokeWidth={1.7} />
        </button>
        <button
          className="icon-btn sm"
          data-tip={t('More actions')}
          onClick={(e) =>
            useApp.getState().showContextMenu(e, [
              { label: t('Fetch'), run: () => void git.sync('fetch') },
              { label: t('Switch branch…'), run: () => useApp.getState().openPalette('branches') },
              { separator: true },
              { label: t('Commit (amend)'), run: () => void git.commit({ amend: true }) },
              { label: t('Stage all'), run: () => void git.stage(changes.map((f) => f.path)) },
              { label: t('Unstage all'), run: () => void git.unstage(staged.map((f) => f.path)) }
            ])
          }
        >
          <Ellipsis size={15} />
        </button>
      </div>
      <div className="scm-commit">
        <div className="scm-message">
          <textarea
            className="input"
            rows={Math.min(8, Math.max(2, message.split('\n').length))}
            placeholder={t('Commit message (Ctrl+Enter to commit on "{branch}")', { branch: status?.branch ?? '…' })}
            value={message}
            spellCheck={false}
            onChange={(e) => git.setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault()
                void git.commit()
              }
            }}
          />
          <button className="scm-wand" data-tip={t('Write a commit message with Claude')} onClick={() => void git.generateMessage()} disabled={generating}>
            {generating ? <LoaderCircle size={15} className="spin" /> : <WandSparkles size={15} strokeWidth={1.7} />}
          </button>
        </div>
        <button className="btn btn-primary scm-commit-btn" disabled={!canCommit} onClick={() => void git.commit()}>
          {busy === 'commit' ? <LoaderCircle size={15} className="spin" /> : <Check size={15} strokeWidth={2} />}
          {t('Commit')}
        </button>
      </div>
      <div className="scm-lists">
        {staged.length > 0 && (
          <Section
            title={t('Staged changes')}
            files={staged}
            staged
            actions={
              <button className="icon-btn sm" data-tip={t('Unstage all')} onClick={() => void git.unstage(staged.map((f) => f.path))}>
                <Minus size={15} strokeWidth={1.8} />
              </button>
            }
          />
        )}
        <Section
          title={t('Changes')}
          files={changes}
          staged={false}
          actions={
            <>
              <button className="icon-btn sm" data-tip={t('Discard all changes')} disabled={!changes.length} onClick={() => void git.discard(changes.map((f) => f.path))}>
                <RotateCcw size={14} strokeWidth={1.7} />
              </button>
              <button className="icon-btn sm" data-tip={t('Stage all')} disabled={!changes.length} onClick={() => void git.stage(changes.map((f) => f.path))}>
                <Plus size={15} strokeWidth={1.8} />
              </button>
            </>
          }
        />
        {status && status.files.length === 0 && <div className="empty-state">{t('No changes. Working tree is clean.')}</div>}
      </div>
    </div>
  )
}
