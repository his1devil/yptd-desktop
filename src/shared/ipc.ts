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
  /** 文件：系统选文件对话框；粘贴板里的图片落成临时文件（SDK 只认路径） */
  dialogPickFiles: 'dialog:pickFiles',
  fileStash: 'file:stash',
  /** yptd-server 的 HTTP 走主进程：渲染进程的 origin（localhost / file://）过不了 CORS */
  httpFetch: 'http:fetch',
  /** SSE 也走主进程：开一条流、收事件、关掉 */
  streamOpen: 'stream:open',
  streamClose: 'stream:close',
  streamEvent: 'stream:event',
} as const

/** 一批 SSE 事件。主进程按 ~30ms 攒一批再发，几百个 token 的 delta 不会变成几百次 IPC */
export interface StreamBatch {
  id: number
  events: { event: string; data: string }[]
  /** 流结束了（服务端关了或断了），之后不会再有事件 */
  closed?: boolean
  error?: string
}

export interface HttpRequest { url: string; method?: string; headers?: Record<string, string>; body?: string }
export interface HttpResponse { status: number; ok: boolean; text: string }

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
  http(req: HttpRequest): Promise<HttpResponse>
  stream: {
    /** 打开一条 SSE，返回流 id；事件通过 onBatch 回来 */
    open(url: string, headers?: Record<string, string>): Promise<number>
    close(id: number): void
    onBatch(listener: (batch: StreamBatch) => void): () => void
  }
  files: {
    /** 系统对话框选文件，返回绝对路径；取消返回空数组 */
    pick(kind: 'image' | 'any'): Promise<string[]>
    /** 粘贴板里的图片没有路径；落到临时目录再交给 SDK */
    stash(name: string, bytes: ArrayBuffer): Promise<string>
    /** 拖进来的 File 的真实路径（沙箱渲染进程里没有 File.path） */
    pathFor(file: File): string
  }
}
