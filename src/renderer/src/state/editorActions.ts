// Imperative helpers that need live Monaco editor instances.
import { t } from '@/lib/i18n'
import { monaco } from '@/lib/monaco'
import * as P from '@/lib/paths'
import { useApp } from './app'
import { getDoc, keepMine, reloadDoc, saveDoc } from './documents'

const editors = new Map<string, monaco.editor.IStandaloneCodeEditor>()

export function registerEditor(groupId: string, ed: monaco.editor.IStandaloneCodeEditor): () => void {
  editors.set(groupId, ed)
  return () => {
    if (editors.get(groupId) === ed) editors.delete(groupId)
  }
}

export function editorForGroup(groupId: string): monaco.editor.IStandaloneCodeEditor | undefined {
  return editors.get(groupId)
}

export function editorsShowing(path: string): monaco.editor.IStandaloneCodeEditor[] {
  const out: monaco.editor.IStandaloneCodeEditor[] = []
  for (const ed of editors.values()) {
    const m = ed.getModel()
    if (m && P.samePath(m.uri.fsPath, path)) out.push(ed)
  }
  return out
}

export function focusedEditor(): monaco.editor.IStandaloneCodeEditor | undefined {
  for (const ed of editors.values()) if (ed.hasTextFocus()) return ed
  return undefined
}

export async function resolveConflict(path: string): Promise<void> {
  const r = await useApp.getState().ask({
    title: t('{name} changed on disk', { name: P.basename(path) }),
    message: t('This file was changed outside the editor (for example by Claude) while you have unsaved changes.'),
    buttons: [
      { label: t('Cancel'), value: 'cancel', kind: 'ghost' },
      { label: t('Use disk version'), value: 'disk', kind: 'ghost' },
      { label: t('Overwrite with mine'), value: 'mine', kind: 'danger' }
    ]
  })
  if (r.button === 'disk') await reloadDoc(path, { force: true })
  else if (r.button === 'mine') {
    keepMine(path)
    await saveDoc(path, true)
  }
}

export async function saveWithFormat(path: string): Promise<boolean> {
  const doc = getDoc(path)
  if (!doc) return false
  if (useApp.getState().settings.editor.formatOnSave) {
    const ed = editorsShowing(path)[0]
    const action = ed?.getAction('editor.action.formatDocument')
    if (action?.isSupported()) {
      try {
        await action.run()
      } catch {
        /* formatter unavailable */
      }
    }
  }
  const r = await saveDoc(path)
  if (r === 'conflict') {
    await resolveConflict(path)
    return false
  }
  if (r === 'error') {
    useApp.getState().toast({ level: 'error', title: t("Couldn't save {name}", { name: P.basename(path) }) })
    return false
  }
  return true
}
