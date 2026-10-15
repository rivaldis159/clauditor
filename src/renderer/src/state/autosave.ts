import { t } from '@/lib/i18n'
import { useApp } from './app'
import { dirtyPaths, isDirty, onDocEdited, saveDoc, type Doc } from './documents'

const timers = new Map<string, ReturnType<typeof setTimeout>>()

async function quietSave(doc: Doc) {
  if (!isDirty(doc) || doc.conflict || doc.deleted) return
  const r = await saveDoc(doc.path)
  if (r === 'conflict') {
    useApp.getState().toast({
      id: `conflict:${doc.path}`,
      level: 'warning',
      title: t('Auto save paused'),
      detail: t('{name} was changed on disk (possibly by Claude). Choose a version in the editor.', { name: doc.path.split('\\').pop() ?? doc.path })
    })
  }
}

export function initAutosave(): void {
  onDocEdited((doc) => {
    const s = useApp.getState().settings.editor
    if (s.autoSave !== 'afterDelay') return
    const prev = timers.get(doc.path)
    if (prev) clearTimeout(prev)
    timers.set(
      doc.path,
      setTimeout(() => {
        timers.delete(doc.path)
        void quietSave(doc)
      }, s.autoSaveDelay)
    )
  })
  window.addEventListener('blur', () => {
    if (useApp.getState().settings.editor.autoSave !== 'onFocusChange') return
    for (const p of dirtyPaths()) void saveDoc(p)
  })
}
