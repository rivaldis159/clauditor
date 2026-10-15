import type { ClauditorBridge } from '../shared/ipc'

declare global {
  interface Window {
    clauditor: ClauditorBridge
  }
}

export {}
