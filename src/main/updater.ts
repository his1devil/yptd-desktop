import { app, ipcMain, type WebContents } from 'electron'
import { autoUpdater } from 'electron-updater'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { IPC, type UpdateStatus } from '../shared/ipc'

/**
 * 自动更新。electron-updater 读 https://im.zhanghuanyang.com/dl/desktop/latest-mac.yml，
 * 有新版就后台下好，通知渲染进程弹一条"重启安装"；不点也会在下次退出时装上。
 *
 * 启动 8 秒后查一次（别抢登录那几秒的网），之后每 4 小时一次；设置页可以手动查。
 * 开发模式没有包，什么都不做，状态是 dev。
 */
const CHECK_EVERY = 4 * 3600_000

export function setupUpdater(target: () => WebContents | null): void {
  let status: UpdateStatus = app.isPackaged ? { kind: 'idle' } : { kind: 'dev' }
  const send = (s: UpdateStatus): void => {
    status = s
    const wc = target()
    if (wc && !wc.isDestroyed()) wc.send(IPC.updateStatus, s)
  }

  ipcMain.handle(IPC.updateStatusGet, () => status)
  ipcMain.handle(IPC.updateCheck, async () => { await check() })
  ipcMain.on(IPC.updateInstall, () => {
    if (status.kind === 'ready') autoUpdater.quitAndInstall()
  })

  if (!app.isPackaged) return

  // 日志落到 userData/logs/updater.log：装好的 app 没有控制台，出问题只能看这个
  const logDir = join(app.getPath('userData'), 'logs')
  mkdirSync(logDir, { recursive: true })
  const logFile = join(logDir, 'updater.log')
  const log = (level: string, ...args: unknown[]): void => {
    try { appendFileSync(logFile, `${new Date().toISOString()} ${level} ${args.map(String).join(' ')}\n`) } catch { /* 日志写不进去不影响更新 */ }
  }
  autoUpdater.logger = { info: (...a) => log('info', ...a), warn: (...a) => log('warn', ...a), error: (...a) => log('error', ...a), debug: (...a) => log('debug', ...a) }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send({ kind: 'checking' }))
  autoUpdater.on('update-available', (info) => send({ kind: 'available', version: info.version }))
  autoUpdater.on('update-not-available', (info) => send({ kind: 'none', version: info.version, at: Date.now() }))
  autoUpdater.on('download-progress', (p) => send({ kind: 'downloading', version: status.kind === 'available' || status.kind === 'downloading' ? status.version : '', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => send({ kind: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => send({ kind: 'error', message: firstLine(err), at: Date.now() }))

  async function check(): Promise<void> {
    if (!app.isPackaged) return
    if (status.kind === 'checking' || status.kind === 'downloading') return
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      send({ kind: 'error', message: firstLine(err), at: Date.now() })
    }
  }

  setTimeout(() => { void check() }, 8_000)
  setInterval(() => { void check() }, CHECK_EVERY)
}

/** electron-updater 的错误信息带着整段响应头和调用栈；给人看的只要第一行。 */
function firstLine(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.split('\n')[0]?.trim().slice(0, 200) || '未知错误'
}
