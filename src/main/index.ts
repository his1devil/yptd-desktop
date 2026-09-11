import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, safeStorage, session, shell } from 'electron'
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { IPC, type HttpRequest, type HttpResponse, type StreamBatch } from '../shared/ipc'
import { attachOpenIM, disposeOpenIM } from './openim'
import { setupUpdater } from './updater'

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
  // 开发用：YPTD_DEV_CREDENTIAL='{"userID":…,"nickname":…,"deviceToken":…}' 直接当已登录，
  // 联调不用每次消耗邀请码。打包后不认。
  if (!app.isPackaged && key === 'device-credential' && process.env.YPTD_DEV_CREDENTIAL) return process.env.YPTD_DEV_CREDENTIAL
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

// ---- HTTP --------------------------------------------------------------------
// yptd-server 的三个接口从这里发。渲染进程的 origin 是 localhost（开发）或 file://（打包），
// 服务端没配 CORS 也不该配——这是桌面 app，不是网页。net.fetch 走 Chromium 网络栈，认系统代理。
ipcMain.handle(IPC.httpFetch, async (_e, req: HttpRequest): Promise<HttpResponse> => {
  const res = await net.fetch(req.url, { method: req.method ?? 'GET', headers: req.headers, body: req.body })
  return { status: res.status, ok: res.ok, text: await res.text() }
})

// ---- SSE --------------------------------------------------------------------
// agent 运行的实时流。同样从主进程发出去（CORS），事件按 30ms 攒一批送渲染进程：
// 模型一秒吐几十个 token，逐个 IPC 会把渲染进程的消息循环占满。
const streams = new Map<number, AbortController>()
let nextStream = 1

ipcMain.handle(IPC.streamOpen, (e, url: string, headers: Record<string, string>) => {
  const id = nextStream++
  const ctl = new AbortController()
  streams.set(id, ctl)
  const wc = e.sender
  void pumpStream(id, url, headers, ctl.signal, (batch) => { if (!wc.isDestroyed()) wc.send(IPC.streamEvent, batch) })
    .finally(() => streams.delete(id))
  return id
})
ipcMain.on(IPC.streamClose, (_e, id: number) => {
  streams.get(id)?.abort()
  streams.delete(id)
})

async function pumpStream(id: number, url: string, headers: Record<string, string>, signal: AbortSignal, emit: (b: StreamBatch) => void): Promise<void> {
  let pending: StreamBatch['events'] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    timer = null
    if (pending.length) { emit({ id, events: pending }); pending = [] }
  }
  const queue = (event: string, data: string): void => {
    pending.push({ event, data })
    if (!timer) timer = setTimeout(flush, 30)
  }
  try {
    const res = await net.fetch(url, { headers: { Accept: 'text/event-stream', ...headers }, signal })
    if (!res.ok || !res.body) { flush(); emit({ id, events: [], closed: true, error: `HTTP ${res.status}` }); return }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let event = 'message'
    let data: string[] = []
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        if (line === '') {
          if (data.length) queue(event, data.join('\n'))
          event = 'message'; data = []
        } else if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
        // 以冒号开头的是心跳注释，跳过
      }
    }
    flush()
    emit({ id, events: [], closed: true })
  } catch (err) {
    flush()
    if (!signal.aborted) emit({ id, events: [], closed: true, error: err instanceof Error ? err.message : String(err) })
  }
}

// ---- 文件 --------------------------------------------------------------------
// SDK 建图片/文件消息只认本机路径：选文件走系统对话框，粘贴板里的图片先落成临时文件。
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']
ipcMain.handle(IPC.dialogPickFiles, async (e, kind: 'image' | 'any') => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: kind === 'image' ? [{ name: '图片', extensions: IMAGE_EXT }] : [{ name: '所有文件', extensions: ['*'] }],
  }
  const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return r.canceled ? [] : r.filePaths
})
// 输入框里的缩略图：渲染进程不能读本地文件，这里用 nativeImage 缩到 320 再以 data URL 送过去
ipcMain.handle(IPC.fileThumbnail, (_e, path: string) => {
  try {
    const img = nativeImage.createFromPath(path)
    if (img.isEmpty()) return null
    const { width, height } = img.getSize()
    const scale = Math.min(1, 320 / Math.max(width, height))
    const small = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : img
    return { dataURL: small.toDataURL(), width, height, bytes: statSync(path).size }
  } catch { return null }
})
ipcMain.handle(IPC.fileStash, (_e, name: string, bytes: ArrayBuffer | Uint8Array) => {
  const dir = join(app.getPath('temp'), 'yptd-stash')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${Date.now()}-${name.replace(/[^\w.-]/g, '_') || 'image.png'}`)
  writeFileSync(file, Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)))
  return file
})

// 开发用：YPTD_DEV_CDP=9222 开远程调试口，联调脚本能在页面里跑 JS、截图。打包后不认。
if (!app.isPackaged && process.env.YPTD_DEV_CDP) app.commandLine.appendSwitch('remote-debugging-port', process.env.YPTD_DEV_CDP)

// 设计窗口尺寸 1440×900，最小 1100×700（README §Screens）。
const DESIGN = { width: 1440, height: 900, minWidth: 1100, minHeight: 700 }

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...DESIGN,
    show: false,
    // 无边框 + 自定义标题栏。macOS 保留原生红绿灯，不自绘。
    // 三个灯一共 52px 宽，x=10 让它们在 72px 的红绿灯区（与图标栏同宽）里居中；
    // 标题栏 48px 高，灯 12px，y=18 垂直居中。
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 10, y: 18 },
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
  const win = createWindow()
  setupUpdater(() => (win.isDestroyed() ? null : win.webContents))
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
