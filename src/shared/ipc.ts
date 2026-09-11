/**
 * 主进程与渲染进程之间的契约。两边都 import 这个文件，通道名不会写错，
 * 载荷形状也只定义一次。
 */

export const IPC = {
  /** 渲染进程 → 主进程：窗口控制 */
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggleMaximize',
  windowClose: 'window:close',
  /** 主进程 → 渲染进程：窗口进入/退出全屏（红绿灯区在全屏下不需要留白） */
  windowFullscreen: 'window:fullscreen',
  /** 应用信息 */
  appVersion: 'app:version',
  /** 凭据：设备 token 用 safeStorage 加密后落盘（macOS 背后是钥匙串） */
  secretGet: 'secret:get',
  secretSet: 'secret:set',
  secretDelete: 'secret:delete',
  /** 数据目录，给 OpenIM 的 initSDK 用 */
  appDataDir: 'app:dataDir',
} as const

export type Theme = 'light' | 'dark'

/** preload 暴露给渲染进程的桥。渲染进程零 Node 权限，只有这里列出的能力。 */
export interface DesktopBridge {
  /** 渲染进程没有 Node 类型，这里只列它真正会遇到的三个值 */
  platform: 'darwin' | 'win32' | 'linux'
  version(): Promise<string>
  dataDir(): Promise<string>
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    onFullscreen(listener: (full: boolean) => void): () => void
  }
  secret: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
  }
}
