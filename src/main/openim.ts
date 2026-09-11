import { app, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import OpenIMSdkMain from '@openim/electron-client-sdk'

/**
 * OpenIM 的 Go 核心以 dylib 的形式进主进程（官方 SDK 用 koffi 加载）。
 * 渲染进程通过 SDK 自带的 preload/render 桥调用它，事件从这里回推到 webContents。
 *
 * 这是上一版 Go 边车的替代：同一个核心版本（3.8.3-patch.15），少一个进程。
 * 代价是没有进程隔离——核心要是 panic，倒的是主进程。真被咬到再挪进
 * utilityProcess。
 */
export function libraryPath(): string {
  const arch = process.arch === 'arm64' ? 'mac_arm64' : 'mac_x64'
  const file = `libopenimsdk.dylib`
  // 打包后 asar 里的原生库被解到 app.asar.unpacked（见 electron-builder.yml 的 asarUnpack）
  const candidates = [
    join(process.resourcesPath ?? '', 'app.asar.unpacked', 'node_modules', '@openim', 'electron-client-sdk', 'assets', arch, file),
    join(app.getAppPath(), 'node_modules', '@openim', 'electron-client-sdk', 'assets', arch, file),
  ]
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new Error(`找不到 OpenIM 原生库，找过：\n${candidates.join('\n')}`)
  return found
}

let sdk: OpenIMSdkMain | null = null

export function attachOpenIM(webContents: WebContents): void {
  if (sdk) {
    sdk.addWebContent(webContents)
    return
  }
  sdk = new OpenIMSdkMain(libraryPath(), webContents)
}

export function disposeOpenIM(): void {
  sdk?.dispose()
  sdk = null
}
