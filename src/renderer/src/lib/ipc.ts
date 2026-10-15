import type { EventChannel, EventMap, InvokeChannel, InvokeMap, SendChannel, SendMap } from '@shared/ipc'

const bridge = window.clauditor

export function invoke<K extends InvokeChannel>(channel: K, ...args: Parameters<InvokeMap[K]>): Promise<Awaited<ReturnType<InvokeMap[K]>>> {
  return bridge.invoke(channel, ...args)
}

export function send<K extends SendChannel>(channel: K, ...args: SendMap[K]): void {
  bridge.send(channel, ...args)
}

export function on<K extends EventChannel>(channel: K, listener: (payload: EventMap[K]) => void): () => void {
  return bridge.on(channel, listener)
}

export function pathForFile(file: File): string {
  return bridge.pathForFile(file)
}

/** Strip Electron's "Error invoking remote method …: Error:" prefix for display. */
export function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
