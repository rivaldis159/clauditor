// Reacts to filesystem changes and Claude's live activity: keeps editors in sync with disk,
// opens/animates files Claude edits while "follow" is on, and auto-follows Claude desktop
// sessions that work in the open workspace.
//
// Claude Code writes a file *before* its tool call reaches the transcript, so by the time we
// hear about an edit the file on disk (and maybe our editor) already shows the result. To still
// show the change being made, we rewind the document to its pre-edit text (derived from the
// tool call itself) and replay the edit with the typing animation.
import type { FsChangeBatch, LiveSessionInfo, SessionUpdate, TimelineEvent, ToolEvent } from '@shared/types'
import { computeLineEdits } from '@shared/lineEdits'
import { editAlreadyApplied, undoToolEdit } from '@shared/replay'
import { docChanges, fsTouched } from '@/lib/bus'
import { t } from '@/lib/i18n'
import * as P from '@/lib/paths'
import { typeEdits } from '@/lib/typewriter'
import { useActivity } from './activity'
import { useApp } from './app'
import { closeDoc, commitDisk, fetchDisk, getDoc, isDirty, isOwnWrite, openDoc, reloadDoc, stageText, type Doc } from './documents'
import { editorsShowing } from './editorActions'
import { useEditors } from './editors'
import { useExplorer } from './explorer'
import { useGit } from './git'
import { liveAboveWorkspace, liveForWorkspace, onSessionUpdate, sessionTitle, useSessions } from './sessions'

export const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

const queue = new Map<string, Promise<void>>()
const deferred = new Map<string, ReturnType<typeof setTimeout>>()

function toolPath(ev: ToolEvent): string | null {
  const p = ev.result?.file?.path ?? ev.input.file_path ?? ev.input.notebook_path
  return typeof p === 'string' && p ? p : null
}

function absFor(p: string, cwd: string | null): string {
  return cwd && !/^[A-Za-z]:|^\\\\|^\//.test(p) ? P.join(cwd, p) : p
}

/** Run document work for one path at a time. */
function serial(path: string, job: () => Promise<void>): Promise<void> {
  const k = P.key(path)
  const prev = queue.get(k) ?? Promise.resolve()
  const next = prev.then(job, job).finally(() => {
    if (queue.get(k) === next) queue.delete(k)
  })
  queue.set(k, next)
  return next
}

function followingEdits(): boolean {
  const { settings } = useApp.getState()
  return useSessions.getState().follow && settings.claude.followOpensFiles
}

function claudeIsWorking(): boolean {
  const s = useSessions.getState()
  if (!s.activeId) return false
  const live = s.live.find((l) => l.sessionId === s.activeId)
  const runner = Object.values(s.runners).some((r) => r.sessionId === s.activeId && (r.state === 'running' || r.state === 'starting'))
  return live?.status === 'busy' || runner
}

/** Animate (or apply) the document from its current model text to `target`, marking it as Claude's change. */
async function playChange(doc: Doc, path: string, target: { text: string; mtimeMs: number; encoding: Doc['encoding'] }, reveal: boolean): Promise<void> {
  const before = doc.model.getValue()
  const { edits, change } = computeLineEdits(before, target.text, doc.model.getEOL())
  if (!edits.length) {
    commitDisk(doc, target)
    return
  }
  const visible = editorsShowing(path)
  const animate = useApp.getState().settings.claude.animateEdits && visible.length > 0 && change.insertedChars <= 20000
  doc.claudeAt = Date.now()
  if (animate) {
    doc.animating = true
    try {
      await typeEdits(visible[0], doc.model, edits, {
        path,
        onPosition: (pos) => useActivity.getState().setCursor({ path, line: pos.lineNumber, column: pos.column, ts: Date.now() })
      })
    } finally {
      commitDisk(doc, target)
    }
  } else {
    commitDisk(doc, target)
  }
  docChanges.emit({ path, change, source: 'claude', reveal })
}

/** Bring an open document up to date with disk (external change or a Claude edit we could not attribute). */
function syncDoc(path: string): Promise<void> {
  return serial(path, async () => {
    const doc = getDoc(path)
    if (!doc || doc.animating) return
    const r = await reloadDoc(path)
    if (r?.change) docChanges.emit({ path, change: r.change, source: 'external', reveal: false })
  })
}

/** Show the effect of a finished Claude edit tool call in the editor. */
function showToolChange(path: string, ev: ToolEvent): Promise<void> {
  return serial(path, async () => {
    const doc = getDoc(path)
    if (!doc) return
    if (isDirty(doc)) {
      // the user has unsaved work: never overwrite it, let the conflict banner handle it
      await reloadDoc(path)
      return
    }
    const disk = await fetchDisk(path)
    if (disk.kind !== 'text') return
    const reveal = useSessions.getState().follow
    const current = doc.model.getValue()
    const same = current.replace(/\r\n/g, '\n') === disk.text.replace(/\r\n/g, '\n')
    if (same && !doc.animating) {
      // we only saw the result: rewind to the text before this tool call, then replay it
      const before = undoToolEdit(current, ev)
      if (before === null || before.replace(/\r\n/g, '\n') === current.replace(/\r\n/g, '\n')) {
        doc.claudeAt = Date.now()
        commitDisk(doc, disk)
        return
      }
      if (useApp.getState().settings.claude.animateEdits && editorsShowing(path).length) stageText(doc, before)
      else {
        const { change } = computeLineEdits(before, current, doc.model.getEOL())
        commitDisk(doc, disk)
        docChanges.emit({ path, change, source: 'claude', reveal })
        return
      }
    }
    await playChange(doc, path, disk, reveal)
  })
}

export function handleFsBatch(batch: FsChangeBatch): void {
  const ex = useExplorer.getState()
  const dirs = new Set<string>()
  let gitTouched = false
  const working = claudeIsWorking()
  for (const ch of batch.changes) {
    const inGit = ch.path.includes(`${P.SEP}.git${P.SEP}`) || ch.path.endsWith(`${P.SEP}.git`)
    if (inGit) {
      if (/\\(HEAD|index|ORIG_HEAD|FETCH_HEAD|refs)/.test(ch.path)) gitTouched = true
      continue
    }
    gitTouched = true
    dirs.add(P.dirname(ch.path))
    if (!getDoc(ch.path) || isOwnWrite(ch.path)) continue
    if (working) {
      // Claude is probably behind this change; give its tool call a moment to arrive so we can
      // replay the edit instead of jumping straight to the result.
      const k = P.key(ch.path)
      const prev = deferred.get(k)
      if (prev) clearTimeout(prev)
      deferred.set(
        k,
        setTimeout(() => {
          deferred.delete(k)
          void syncDoc(ch.path)
        }, 1500)
      )
    } else void syncDoc(ch.path)
  }
  if (dirs.size) void ex.refresh([...dirs])
  if (gitTouched) useGit.getState().refresh()
  fsTouched.emit(batch.changes.map((c) => c.path))
}

function cancelDeferred(path: string): void {
  const k = P.key(path)
  const t = deferred.get(k)
  if (t) {
    clearTimeout(t)
    deferred.delete(k)
  }
}

function insideWorkspace(p: string): boolean {
  const ws = useApp.getState().workspace
  return !!ws && P.isInside(p, ws.root)
}

async function onEditStarted(abs: string, ev: ToolEvent): Promise<void> {
  const r = await openDoc(abs, { allowMissing: ev.name === 'Write' })
  if (r.ok) {
    const doc = r.doc
    // late arrival: the file already contains this edit → rewind now to avoid flashing the result
    if (!isDirty(doc) && !doc.animating && ev.name !== 'Write' && editAlreadyApplied(doc.model.getValue(), ev)) {
      const before = undoToolEdit(doc.model.getValue(), ev)
      if (before !== null && useApp.getState().settings.claude.animateEdits) stageText(doc, before)
    }
  }
  useEditors.getState().openFile(abs, { preview: true })
  void useExplorer.getState().reveal(abs)
}

function handleToolEvent(ev: ToolEvent, sessionCwd: string | null): void {
  const act = useActivity.getState()
  const path = toolPath(ev)
  if (!path) return
  const abs = absFor(path, sessionCwd)
  if (EDIT_TOOLS.has(ev.name)) {
    const following = followingEdits() && insideWorkspace(abs)
    if (ev.status === 'running') {
      act.setWorking(abs, ev.name)
      if (following) void onEditStarted(abs, ev)
      return
    }
    act.setWorking(abs, null)
    if (ev.status === 'done') {
      act.markTouched(abs)
      cancelDeferred(abs)
      const open = async () => {
        if (following && !getDoc(abs)) await openDoc(abs)
        if (following) useEditors.getState().openFile(abs, { preview: true })
        if (getDoc(abs)) await showToolChange(abs, ev)
      }
      void open().then(() => fsTouched.emit([abs]))
    } else {
      // failed or denied: undo any staging and drop placeholder documents
      const doc = getDoc(abs)
      if (doc?.pendingCreate) {
        useEditors.getState().closeWhere((t) => t.kind === 'file' && P.samePath(t.path, abs))
        closeDoc(abs)
      } else if (doc?.animating) {
        void serial(abs, async () => {
          const disk = await fetchDisk(abs)
          if (disk.kind === 'text') commitDisk(doc, disk)
        })
      }
    }
  } else if (ev.name === 'Read') {
    act.setWorking(abs, ev.status === 'running' ? 'Read' : null)
  }
}

/** Sessions in a parent folder that we tail quietly until they touch the workspace. */
const watching = new Set<string>()

function touchesWorkspace(events: TimelineEvent[], cwd: string | null): boolean {
  const ws = useApp.getState().workspace
  if (!ws) return false
  for (const ev of events) {
    if (ev.kind !== 'tool') continue
    const p = toolPath(ev)
    if (p && P.isInside(absFor(p, cwd), ws.root)) return true
    const cmd = typeof ev.input.command === 'string' ? ev.input.command : ''
    if (cmd && cmd.toLowerCase().includes(ws.root.toLowerCase())) return true
  }
  return false
}

function canTakeOver(): boolean {
  const s = useSessions.getState()
  const activeLive = s.live.find((l) => l.sessionId === s.activeId)
  const activeRunner = Object.values(s.runners).find((r) => r.sessionId === s.activeId && (r.state === 'running' || r.state === 'starting'))
  return !(activeLive && activeLive.status === 'busy') && !activeRunner
}

let lastAuto: string | null = null

function announce(sessionId: string, name: string | null) {
  if (lastAuto === sessionId) return
  lastAuto = sessionId
  const title = name || sessionTitle(useSessions.getState().data[sessionId]?.meta)
  useApp.getState().toast({ level: 'info', title: t('Following Claude'), detail: t('Session “{title}” is working in this folder.', { title }) })
}

function onUpdate(u: SessionUpdate): void {
  const { activeId } = useSessions.getState()
  if (watching.has(u.sessionId) && u.sessionId !== activeId) {
    if (touchesWorkspace([...u.added, ...u.updated], u.meta.cwd) && canTakeOver()) {
      watching.delete(u.sessionId)
      announce(u.sessionId, u.meta.live?.name ?? null)
      void useSessions
        .getState()
        .activate(u.sessionId, { follow: useApp.getState().settings.claude.followLive })
        .then(() => {
          // replay the event that triggered the takeover
          for (const ev of [...u.updated, ...u.added]) if (ev.kind === 'tool') handleToolEvent(ev, u.meta.cwd)
        })
    }
    return
  }
  if (u.sessionId !== activeId) return
  const cwd = u.meta.cwd
  // a tool that starts and finishes within one batch arrives once, already "done"
  for (const ev of [...u.updated, ...u.added]) if (ev.kind === 'tool') handleToolEvent(ev, cwd)
}

export function autoFollow(list: LiveSessionInfo[]): void {
  const app = useApp.getState()
  const ws = app.workspace
  if (!ws || !app.settings.claude.autoFollowWorkspace) return
  const s = useSessions.getState()
  for (const id of [...watching]) {
    const l = list.find((x) => x.sessionId === id)
    if (!l || l.status !== 'busy') {
      watching.delete(id)
      if (s.activeId !== id) s.close(id)
    }
  }
  const busy = liveForWorkspace(list, ws.root).find((l) => l.status === 'busy')
  if (busy) {
    if (busy.sessionId === s.activeId || !canTakeOver()) return
    void s.activate(busy.sessionId, { follow: app.settings.claude.followLive }).then(() => announce(busy.sessionId, busy.name))
    return
  }
  // a session in a parent folder may be building this project: tail it and follow once it touches the workspace
  for (const l of liveAboveWorkspace(list, ws.root)) {
    if (l.status !== 'busy' || l.sessionId === s.activeId || watching.has(l.sessionId)) continue
    watching.add(l.sessionId)
    void s.open(l.sessionId).then((d) => {
      if (!d || !watching.has(l.sessionId)) return
      if (touchesWorkspace(d.events.slice(-40), d.cwd) && canTakeOver()) {
        watching.delete(l.sessionId)
        announce(l.sessionId, l.name)
        void useSessions.getState().activate(l.sessionId, { follow: app.settings.claude.followLive })
      }
    })
  }
}

export function initFollow(): void {
  onSessionUpdate(onUpdate)
}
