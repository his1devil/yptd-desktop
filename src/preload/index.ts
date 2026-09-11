import { contextBridge, ipcRenderer } from 'electron'
// OpenIM 官方 SDK 的渲染桥：把 sdk 方法调用转成 IPC 到主进程里的 dylib，事件反向回推。
import '@openim/electron-client-sdk/preload'
import { IPC, type DesktopBridge } from '../shared/ipc'

const bridge: DesktopBridge = {
  platform: process.platform as 'darwin' | 'win32' | 'linux',
  version: () => ipcRenderer.invoke(IPC.appVersion),
  dataDir: () => ipcRenderer.invoke(IPC.appDataDir),
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
  secret: {
    get: (key) => ipcRenderer.invoke(IPC.secretGet, key),
    set: (key, value) => ipcRenderer.invoke(IPC.secretSet, key, value),
    delete: (key) => ipcRenderer.invoke(IPC.secretDelete, key),
  },
}

contextBridge.exposeInMainWorld('desktop', bridge)
