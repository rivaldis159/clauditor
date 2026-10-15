// Text documents backing editor tabs. Kept outside React state: Monaco models are mutable
// objects; the editor store only mirrors dirty/conflict flags for rendering.
import type { TextEncodingName } from '@shared/types'
import { computeLineEdits, type LineChange, type LineEdit } from '@shared/lineEdits'
import { fileUri, languageForPath, monaco } from '@/lib/monaco'
import { invoke } from '@/lib/ipc'
import * as P from '@/lib/paths'

export interface Doc {
  path: string
  model: monaco.editor.ITextModel
  savedVersion: number
  mtimeMs: number
  encoding: TextEncodingName
  eol: 'LF' | 'CRLF'
  conflict: boolean
  diskText: string
  deleted: boolean
  claudeAt: number
  /** created empty because Claude is about to write this new file */
  pendingCreate: boolean
  /** a typing animation is replaying Claude's change into the model */
  animating: boolean
}

export type DocOpen = { ok: true; doc: Doc } | { ok: false; kind: 'binary' | 'image' | 'too-large' | 'missing' | 'error'; size: number; error?: string }

export type { LineChange }

const docs = new Map<string, Doc>()
const pending = new Map<string, Promise<DocOpen>>()
const listeners = new Set<() => void>()
const editListeners = new Set<(doc: Doc) => void>()
const ownWrites = new Map<string, number>()

/** Fires on every content change of any open document (used by auto-save). */
export function onDocEdited(fn: (doc: Doc) => void): () => void {
  editListeners.add(fn)
  return () => editListeners.delete(fn)
}

function notify() {
  for (const l of listeners) l()
}

export function onDocsChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getDoc(path: string): Doc | undefined {
  return docs.get(P.key(path))
}

export function allDocs(): Doc[] {
  return [...docs.values()]
}

export function isDirty(doc: Doc | undefined): boolean {
  return !!doc && !doc.animating && doc.model.getAlternativeVersionId() !== doc.savedVersion
}

export function dirtyPaths(): string[] {
  return allDocs()
    .filter((d) => isDirty(d))
    .map((d) => d.path)
}

export function openDoc(path: string, opts: { allowMissing?: boolean } = {}): Promise<DocOpen> {
  const k = P.key(path)
  const existing = docs.get(k)
  if (existing) return Promise.resolve({ ok: true, doc: existing })
  const inflight = pending.get(k)
  if (inflight) return inflight
  const p = (async (): Promise<DocOpen> => {
    try {
      let c = await invoke('fs:readFile', path)
      const missing = c.kind === 'missing'
      if (missing && opts.allowMissing) c = { ...c, kind: 'text', text: '', encoding: 'utf8', eol: 'LF' }
      if (c.kind !== 'text') return { ok: false, kind: c.kind, size: c.size }
      const uri = fileUri(path)
      let model = monaco.editor.getModel(uri)
      if (model) model.setValue(c.text)
      else model = monaco.editor.createModel(c.text, languageForPath(path), uri)
      model.setEOL(c.eol === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)
      const doc: Doc = {
        path: P.normalize(path),
        model,
        savedVersion: model.getAlternativeVersionId(),
        mtimeMs: c.mtimeMs,
        encoding: c.encoding,
        eol: c.eol,
        conflict: false,
        diskText: c.text,
        deleted: false,
        claudeAt: 0,
        pendingCreate: missing,
        animating: false
      }
      let wasDirty = false
      model.onDidChangeContent(() => {
        const d = isDirty(doc)
        if (d !== wasDirty) {
          wasDirty = d
          notify()
        }
        if (d) for (const l of editListeners) l(doc)
      })
      docs.set(k, doc)
      notify()
      return { ok: true, doc }
    } catch (err) {
      return { ok: false, kind: 'error', size: 0, error: String(err) }
    } finally {
      pending.delete(k)
    }
  })()
  pending.set(k, p)
  return p
}

export function closeDoc(path: string): void {
  const k = P.key(path)
  const d = docs.get(k)
  if (!d) return
  docs.delete(k)
  d.model.dispose()
  notify()
}

export function markSaved(doc: Doc, mtimeMs: number, text: string): void {
  doc.savedVersion = doc.model.getAlternativeVersionId()
  doc.mtimeMs = mtimeMs
  doc.diskText = text
  doc.conflict = false
  doc.deleted = false
  ownWrites.set(P.key(doc.path), Date.now())
  notify()
}

export type SaveResult = 'saved' | 'clean' | 'conflict' | 'error'

export async function saveDoc(path: string, force = false): Promise<SaveResult> {
  const doc = getDoc(path)
  if (!doc) return 'error'
  if (!isDirty(doc) && !force && !doc.deleted) return 'clean'
  const text = doc.model.getValue()
  const res = await invoke('fs:writeFile', doc.path, text, {
    encoding: doc.encoding,
    expectedMtimeMs: force || doc.deleted ? undefined : doc.mtimeMs,
    createDirs: true
  })
  if (res.conflict) {
    doc.conflict = true
    notify()
    return 'conflict'
  }
  if (!res.ok) return 'error'
  markSaved(doc, res.mtimeMs, text)
  return 'saved'
}

/** True when an fs event for this path is most likely the echo of our own save. */
export function isOwnWrite(path: string): boolean {
  const t = ownWrites.get(P.key(path))
  return !!t && Date.now() - t < 1500
}

/** Line-level minimal edits turning the model's text into `newText`, plus change info for decorations. */
export function computeEdits(model: monaco.editor.ITextModel, oldText: string, newText: string): { edits: monaco.editor.IIdentifiedSingleEditOperation[]; change: LineChange; raw: LineEdit[] } {
  const { edits, change } = computeLineEdits(oldText, newText, model.getEOL())
  return {
    edits: edits.map((e) => ({ range: new monaco.Range(e.startLine, e.startCol, e.endLine, e.endCol), text: e.text })),
    change,
    raw: edits
  }
}

export interface ReloadResult {
  change: LineChange | null
  conflict: boolean
  deleted: boolean
  oldText: string
  newText: string
}

/** Re-read a document from disk; applies minimal edits so cursor and scroll stay put. */
export async function reloadDoc(path: string, opts: { force?: boolean } = {}): Promise<ReloadResult | null> {
  const doc = getDoc(path)
  if (!doc) return null
  const c = await invoke('fs:readFile', doc.path)
  if (c.kind === 'missing') {
    if (doc.pendingCreate) return null
    if (!doc.deleted) {
      doc.deleted = true
      notify()
    }
    return { change: null, conflict: false, deleted: true, oldText: doc.diskText, newText: '' }
  }
  if (c.kind !== 'text') return null
  const wasDeleted = doc.deleted
  doc.deleted = false
  if (!opts.force && c.text === doc.diskText) {
    doc.mtimeMs = c.mtimeMs
    if (wasDeleted) notify()
    return null
  }
  if (isDirty(doc) && !opts.force) {
    doc.conflict = true
    doc.mtimeMs = doc.mtimeMs || c.mtimeMs
    notify()
    return { change: null, conflict: true, deleted: false, oldText: doc.model.getValue(), newText: c.text }
  }
  const oldText = doc.model.getValue()
  const normalizedNew = c.text
  let change: LineChange | null = null
  if (oldText !== normalizedNew) {
    const { edits, change: ch } = computeEdits(doc.model, oldText, normalizedNew)
    doc.model.pushEditOperations([], edits, () => null)
    if (doc.model.getValue() !== normalizedNew.replace(/\r?\n/g, doc.model.getEOL())) {
      doc.model.pushEditOperations([], [{ range: doc.model.getFullModelRange(), text: normalizedNew }], () => null)
    }
    change = ch
  }
  doc.savedVersion = doc.model.getAlternativeVersionId()
  doc.mtimeMs = c.mtimeMs
  doc.diskText = c.text
  doc.encoding = c.encoding
  doc.conflict = false
  doc.pendingCreate = false
  notify()
  return { change, conflict: false, deleted: false, oldText, newText: normalizedNew }
}

/** Read the current disk state of a file without touching any model. */
export function fetchDisk(path: string) {
  return invoke('fs:readFile', path)
}

/** Record that `doc.model` now mirrors the given disk content (after an animated apply). */
export function commitDisk(doc: Doc, c: { text: string; mtimeMs: number; encoding: TextEncodingName }): void {
  const want = c.text.replace(/\r?\n/g, doc.model.getEOL())
  if (doc.model.getValue() !== want) {
    doc.model.pushEditOperations([], [{ range: doc.model.getFullModelRange(), text: c.text }], () => null)
  }
  doc.savedVersion = doc.model.getAlternativeVersionId()
  doc.mtimeMs = c.mtimeMs
  doc.diskText = c.text
  doc.encoding = c.encoding
  doc.conflict = false
  doc.deleted = false
  doc.pendingCreate = false
  doc.animating = false
  notify()
}

/**
 * Show `text` in the model without treating it as a user edit: used to rewind a document to
 * how it looked before Claude's change, right before replaying that change.
 */
export function stageText(doc: Doc, text: string): void {
  doc.animating = true
  doc.model.applyEdits([{ range: doc.model.getFullModelRange(), text }])
}

/** Keep the user's version: next save overwrites disk. */
export function keepMine(path: string): void {
  const doc = getDoc(path)
  if (!doc) return
  doc.conflict = false
  doc.mtimeMs = 0
  notify()
}

export function renameDoc(oldPath: string, newPath: string): void {
  const k = P.key(oldPath)
  const d = docs.get(k)
  if (!d) return
  docs.delete(k)
  const text = d.model.getValue()
  const dirty = isDirty(d)
  d.model.dispose()
  const model = monaco.editor.createModel(text, languageForPath(newPath), fileUri(newPath))
  const doc: Doc = { ...d, path: P.normalize(newPath), model, savedVersion: dirty ? -1 : model.getAlternativeVersionId() }
  let wasDirty = dirty
  model.onDidChangeContent(() => {
    const now = isDirty(doc)
    if (now !== wasDirty) {
      wasDirty = now
      notify()
    }
  })
  docs.set(P.key(newPath), doc)
  notify()
}
