import { app, BrowserWindow, ipcMain, safeStorage, session, shell } from 'electron'
import { mkdirSync, readFileSync, unlinkSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { attachOpenIM, disposeOpenIM } from './openim'

// ---- 凭据 --------------------------------------------------------------------
// 设备 token 用 safeStorage 加密后落在 userData 下。macOS 上 safeStorage 的密钥在
// 钥匙串里，只有这个签名的 app 能解——效果等同上一版直接写钥匙串，但不会再撞上
// "命令行建的条目 app 读不到" 那种 ACL 问题。
const secretsDir = (): string => {
  const dir = join(app.getPath('userData'), 'secrets')
  mkdirSync(dir, { recursive: true })
  return dir
}
const secretFile = (key: string): string => join(secretsDir(), key.replace(/[^a-zA-Z0-9._-]/g, '_'))

ipcMain.handle(IPC.secretGet, (_e, key: string) => {
  const file = secretFile(key)
  if (!existsSync(file)) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  try { return safeStorage.decryptString(readFileSync(file)) } catch { return null }
})
ipcMain.handle(IPC.secretSet, (_e, key: string, value: string) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('这台机器上没有可用的安全存储')
  writeFileSync(secretFile(key), safeStorage.encryptString(value), { mode: 0o600 })
})
ipcMain.handle(IPC.secretDelete, (_e, key: string) => {
  const file = secretFile(key)
  if (existsSync(file)) unlinkSync(file)
})
ipcMain.handle(IPC.appDataDir, () => {
  const dir = join(app.getPath('userData'), 'openim')
  mkdirSync(dir, { recursive: true })
  return dir
})

// 设计窗口尺寸 1440×900，最小 1100×700（README §Screens）。
const DESIGN = { width: 1440, height: 900, minWidth: 1100, minHeight: 700 }

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...DESIGN,
    show: false,
    // 无边框 + 自定义标题栏。macOS 保留原生红绿灯，不自绘；
    // 位置 (18,18) 让它们落在标题栏 58px 的红绿灯区里，与图标栏同宽。
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#FFFFFF',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // 开发用：YPTD_THEME=dark 起一个深色窗口截图对比 token。不进产品逻辑。
  if (!app.isPackaged && process.env.YPTD_THEME) {
    const theme = process.env.YPTD_THEME
    win.webContents.on('did-finish-load', () => {
      void win.webContents.executeJavaScript(
        `document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`,
      )
    })
  }

  // 全屏时红绿灯消失，渲染层不必再留 58px 的空
  win.on('enter-full-screen', () => win.webContents.send(IPC.windowFullscreen, true))
  win.on('leave-full-screen', () => win.webContents.send(IPC.windowFullscreen, false))

  // 渲染进程里的外链一律交给系统浏览器，不在 app 内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // OpenIM 核心挂到这个窗口：SDK 调用从渲染进程经 preload 到这里，事件从这里回推
  attachOpenIM(win.webContents)

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.on('before-quit', () => disposeOpenIM())

ipcMain.handle(IPC.appVersion, () => app.getVersion())
ipcMain.on(IPC.windowMinimize, (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
ipcMain.on(IPC.windowToggleMaximize, (e) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w) return
  w.isMaximized() ? w.unmaximize() : w.maximize()
})
ipcMain.on(IPC.windowClose, (e) => BrowserWindow.fromWebContents(e.sender)?.close())

void app.whenReady().then(() => {
  // CSP 只在打包后注入：开发时 Vite 和 React Refresh 要注入内联脚本，
  // 一条严格的 script-src 会把渲染层整个拦成白屏。
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
              "font-src 'self' data:; img-src 'self' data: https:; connect-src 'self' https: wss:",
          ],
        },
      })
    })
  }
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
