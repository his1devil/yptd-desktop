import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { TRAY_ICON_1X, TRAY_ICON_2X } from './trayIcon'

/**
 * 菜单栏上的图标和未读数。
 *
 * 数字跟着图标走（tray.setTitle），不是跟着 Dock：菜单栏那一眼是「有没有事找我」，
 * 窗口关了、Dock 图标看不见的时候它还在。Dock 角标同时也设一个，两处说的是同一个数。
 *
 * 计的是「要你回应的消息」——私聊、agent 会话、以及频道里 @ 到你的，和收件箱
 * 「提及我的」同一套口径。频道里所有人的闲聊也算进去的话，这个数字每天四位数，
 * 看一眼就等于没看。
 */
let tray: Tray | null = null
let showWindow: (() => void) | null = null

export function setupTray(show: () => void): void {
  if (tray) return
  showWindow = show
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_1X, 'base64'))
  icon.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(TRAY_ICON_2X, 'base64') })
  // template 让 macOS 按菜单栏亮暗自动反色，深色模式下不用换图
  icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('yptd')
  // 左键直接开窗口。挂了 context menu 的话左键会变成弹菜单，多一步才能回到聊天。
  tray.on('click', () => showWindow?.())
  tray.on('right-click', () => {
    tray?.popUpContextMenu(Menu.buildFromTemplate([
      { label: '打开 yptd', click: () => showWindow?.() },
      { type: 'separator' },
      { label: '退出', click: () => { app.quit() } },
    ]))
  })
}

/** 未读数变了就更新菜单栏和 Dock。0 就把数字撤掉，只留图标。 */
export function setUnread(n: number): void {
  const count = Math.max(0, Math.floor(n) || 0)
  // 99+ 是为了菜单栏：那一条的宽度是所有 app 分的，一个四位数会把别人挤走。
  //
  // 前面那个空格不是笔误。Electron 没有暴露图标和标题之间的间距，而系统默认给的
  // 太窄：在真机截图上量过，我们是 3.5pt，旁边系统项（✳ 和 15%）是 9pt——数字
  // 贴着图标，看着就是没对齐。补一个空格把它拉到接近系统的间距。
  if (tray) {
    tray.setTitle(count > 0 ? ' ' + (count > 99 ? '99+' : String(count)) : '')
    tray.setToolTip(count > 0 ? `yptd · ${count} 条待处理` : 'yptd')
  }
  if (process.platform === 'darwin') app.dock?.setBadge(count > 0 ? (count > 99 ? '99+' : String(count)) : '')
}

/** 退出前收掉，否则图标会在菜单栏上留到进程真的消失。 */
export function disposeTray(): void {
  tray?.destroy()
  tray = null
}

