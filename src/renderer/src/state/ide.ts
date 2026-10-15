// Glue between the IDE bridge (Claude Code's IDE protocol) and the editor UI.
import type { IdeDiagnosticFile, IdeOpenDiffRequest, IdeOpenFileRequest } from '@shared/types'
import { t } from '@/lib/i18n'
import { invoke, on, send } from '@/lib/ipc'
import { monaco } from '@/lib/monaco'
import * as P from '@/lib/paths'
import { useApp } from './app'
import { allDocs, isDirty, openDoc, saveDoc } from './documents'
import { useEditors } from './editors'
import { editorsShowing } from './editorActions'

const resolved = new Set<string>()

export async function resolveIdeDiff(requestId: string, r: { accepted: boolean; content?: string; closed?: boolean }): Promise<void> {
  if (resolved.has(requestId)) return
  resolved.add(requestId)
  await invoke('ide:diffResult', requestId, r)
  useEditors.getState().closeWhere((t) => t.kind === 'ide-diff' && t.requestId === requestId)
}

function openDiff(req: IdeOpenDiffRequest) {
  useEditors.getState().openTab({
    kind: 'ide-diff',
    path: req.filePath,
    requestId: req.requestId,
    newContents: req.newContents,
    tabName: req.tabName,
    title: t("{name} ↔ Claude's proposal", { name: P.basename(req.filePath) })
  })
  useApp.getState().toast({ level: 'info', title: t('Claude proposed a change'), detail: t('{name} — review it, then Accept or Reject', { name: P.basename(req.filePath) }) })
}

async function openFile(req: IdeOpenFileRequest) {
  useEditors.getState().openFile(req.filePath, { preview: !!req.preview })
  if (!req.startText) return
  const r = await openDoc(req.filePath)
  if (!r.ok) return
  const model = r.doc.model
  const start = model.findNextMatch(req.startText, new monaco.Position(1, 1), false, true, null, false)
  if (!start) return
  let end = start.range
  if (req.endText) {
    const e = model.findNextMatch(req.endText, start.range.getEndPosition(), false, true, null, false)
    if (e) end = e.range
  }
  useEditors.getState().openFile(req.filePath, {
    line: start.range.startLineNumber,
    column: start.range.startColumn,
    endLine: end.endLineNumber,
    endColumn: end.endColumn,
    focus: true
  })
}

let editorsTimer: ReturnType<typeof setTimeout> | null = null
function pushEditors() {
  if (editorsTimer) clearTimeout(editorsTimer)
  editorsTimer = setTimeout(() => {
    const st = useEditors.getState()
    const active = st.activePath()
    const seen = new Set<string>()
    const openEditors: { filePath: string; isActive: boolean; isDirty: boolean; languageId: string }[] = []
    for (const g of st.groups) {
      for (const t of g.tabs) {
        if (t.kind !== 'file' || seen.has(P.key(t.path))) continue
        seen.add(P.key(t.path))
        const doc = allDocs().find((d) => P.samePath(d.path, t.path))
        openEditors.push({ filePath: t.path, isActive: P.samePath(active, t.path), isDirty: isDirty(doc), languageId: doc?.model.getLanguageId() ?? 'plaintext' })
      }
    }
    send('ide:editors', { openEditors, dirty: openEditors.filter((e) => e.isDirty).map((e) => e.filePath) })
  }, 200)
}

let diagTimer: ReturnType<typeof setTimeout> | null = null
export function pushDiagnostics() {
  if (diagTimer) clearTimeout(diagTimer)
  diagTimer = setTimeout(() => {
    const files = new Map<string, IdeDiagnosticFile>()
    let errors = 0
    let warnings = 0
    for (const m of monaco.editor.getModelMarkers({})) {
      if (m.resource.scheme !== 'file') continue
      const fsPath = m.resource.fsPath
      let f = files.get(fsPath)
      if (!f) {
        f = { uri: m.resource.toString(), diagnostics: [] }
        files.set(fsPath, f)
      }
      const sev = m.severity === monaco.MarkerSeverity.Error ? 'Error' : m.severity === monaco.MarkerSeverity.Warning ? 'Warning' : m.severity === monaco.MarkerSeverity.Info ? 'Info' : 'Hint'
      if (sev === 'Error') errors++
      else if (sev === 'Warning') warnings++
      f.diagnostics.push({
        message: m.message,
        severity: sev,
        source: m.source,
        code: typeof m.code === 'string' ? m.code : m.code?.value,
        range: { start: { line: m.startLineNumber - 1, character: m.startColumn - 1 }, end: { line: m.endLineNumber - 1, character: m.endColumn - 1 } }
      })
    }
    send('ide:diagnostics', [...files.values()])
    useApp.getState().setProblems({ errors, warnings })
  }, 300)
}

export function pushSelection(ed: monaco.editor.ICodeEditor) {
  const model = ed.getModel()
  const sel = ed.getSelection()
  if (!model || !sel || model.uri.scheme !== 'file') return
  send('ide:selection', {
    filePath: model.uri.fsPath,
    text: model.getValueInRange(sel),
    start: { line: sel.startLineNumber - 1, character: sel.startColumn - 1 },
    end: { line: sel.endLineNumber - 1, character: sel.endColumn - 1 },
    isEmpty: sel.isEmpty()
  })
}

/** Send the current selection to connected Claude Code sessions as an @-mention. */
export async function mentionSelection(): Promise<void> {
  const path = useEditors.getState().activePath()
  if (!path) return
  const ed = editorsShowing(path)[0]
  const sel = ed?.getSelection()
  const n = await invoke('ide:atMention', path, sel && !sel.isEmpty() ? sel.startLineNumber - 1 : undefined, sel && !sel.isEmpty() ? sel.endLineNumber - 1 : undefined)
  useApp.getState().toast(
    n > 0
      ? {
          level: 'success',
          title: t('Sent to Claude'),
          detail: sel && !sel.isEmpty() ? t('{name} lines {start}–{end}', { name: P.basename(path), start: sel.startLineNumber, end: sel.endLineNumber }) : P.basename(path)
        }
      : { level: 'info', title: t('No Claude Code session is connected yet'), detail: t('Open a "Claude Code (CLI)" terminal in Clauditor to connect automatically.') }
  )
}

export function initIdeBridge(): void {
  on('ide:status', (s) => useApp.getState().setIde(s))
  on('ide:openDiff', openDiff)
  on('ide:openFile', (r) => void openFile(r))
  on('ide:closeTab', ({ tabName }) => {
    useEditors.getState().closeWhere((t) => t.kind === 'ide-diff' && t.tabName === tabName)
  })
  on('ide:closeAllDiffs', () => useEditors.getState().closeWhere((t) => t.kind === 'ide-diff'))
  on('ide:saveDocument', async ({ filePath, requestId }) => {
    const r = await saveDoc(filePath)
    send('ide:saved', requestId, r === 'saved' || r === 'clean')
  })
  useEditors.subscribe(pushEditors)
  monaco.editor.onDidChangeMarkers(() => pushDiagnostics())
}
