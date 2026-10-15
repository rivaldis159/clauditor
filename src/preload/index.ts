import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { INVOKE_PREFIXES, type ClauditorBridge } from '@shared/ipc'

const allowed = (channel: string) => INVOKE_PREFIXES.some((p) => channel.startsWith(p))

const bridge: ClauditorBridge = {
  invoke(channel, ...args) {
    if (!allowed(channel)) return Promise.reject(new Error(`Channel not allowed: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  send(channel, ...args) {
    if (!allowed(channel)) return
    ipcRenderer.send(channel, ...args)
  },
  on(channel, listener) {
    if (!allowed(channel)) return () => {}
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
  pathForFile(file) {
    return webUtils.getPathForFile(file)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('clauditor', bridge)
