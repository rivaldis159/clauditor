import type { LineChange } from '@shared/lineEdits'

export interface DocChangeEvent {
  path: string
  change: LineChange
  source: 'claude' | 'external'
  /** reveal the change in editors showing this file */
  reveal: boolean
}

type Handler<T> = (payload: T) => void

class Bus<T> {
  private handlers = new Set<Handler<T>>()
  on(h: Handler<T>): () => void {
    this.handlers.add(h)
    return () => this.handlers.delete(h)
  }
  emit(payload: T): void {
    for (const h of this.handlers) h(payload)
  }
}

export const docChanges = new Bus<DocChangeEvent>()
/** Paths that changed on disk (fs watcher or a finished Claude write). */
export const fsTouched = new Bus<string[]>()
export const focusComposer = new Bus<{ text?: string }>()
export const timelineJump = new Bus<{ sessionId: string; eventId: string }>()
