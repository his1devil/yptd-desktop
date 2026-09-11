import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type DesktopBridge } from '../shared/ipc'

const bridge: DesktopBridge = {
  platform: process.platform as 'darwin' | 'win32' | 'linux',
  version: () => ipcRenderer.invoke(IPC.appVersion),
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.windowToggleMaximize),
    close: () => ipcRenderer.send(IPC.windowClose),
    onFullscreen(listener) {
      const handler = (_: unknown, full: boolean): void => listener(full)
      ipcRenderer.on(IPC.windowFullscreen, handler)
      return () => ipcRenderer.removeListener(IPC.windowFullscreen, handler)
    },
  },
}

contextBridge.exposeInMainWorld('desktop', bridge)
