import { contextBridge, ipcRenderer, webUtils } from 'electron'
// OpenIM 官方 SDK 的渲染桥：把 sdk 方法调用转成 IPC 到主进程里的 dylib，事件反向回推。
import '@openim/electron-client-sdk/preload'
import { IPC, type DesktopBridge, type StreamBatch, type UpdateStatus } from '../shared/ipc'

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
  http: (req) => ipcRenderer.invoke(IPC.httpFetch, req),
  update: {
    status: () => ipcRenderer.invoke(IPC.updateStatusGet),
    onStatus(listener) {
      const handler = (_: unknown, s: UpdateStatus): void => listener(s)
      ipcRenderer.on(IPC.updateStatus, handler)
      return () => ipcRenderer.removeListener(IPC.updateStatus, handler)
    },
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    install: () => ipcRenderer.send(IPC.updateInstall),
  },
  stream: {
    open: (url, headers) => ipcRenderer.invoke(IPC.streamOpen, url, headers ?? {}),
    close: (id) => ipcRenderer.send(IPC.streamClose, id),
    onBatch(listener) {
      const handler = (_: unknown, batch: StreamBatch): void => listener(batch)
      ipcRenderer.on(IPC.streamEvent, handler)
      return () => ipcRenderer.removeListener(IPC.streamEvent, handler)
    },
  },
  files: {
    pick: (kind) => ipcRenderer.invoke(IPC.dialogPickFiles, kind),
    stash: (name, bytes) => ipcRenderer.invoke(IPC.fileStash, name, bytes),
    pathFor: (file) => webUtils.getPathForFile(file),
    thumbnail: (path) => ipcRenderer.invoke(IPC.fileThumbnail, path),
  },
  clipboard: {
    readText: () => ipcRenderer.invoke(IPC.clipboardReadText),
  },
}

contextBridge.exposeInMainWorld('desktop', bridge)
