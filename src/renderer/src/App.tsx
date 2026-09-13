import { useEffect, useRef, useState } from 'react'
import { Toast } from './components/Toast'
import { UpdateBanner } from './components/UpdateBanner'
import { ContextSidebar } from './shell/ContextSidebar'
import { Inspector } from './shell/Inspector'
import { MainArea } from './shell/MainArea'
import { nextConversation, orderedConversationIds } from './store/order'
import { useSession } from './store/session'
import { useUI } from './store/ui'
import { composerBus } from './views/composerBus'
import { ChannelDialogsMount } from './views/mounts'
import { CommandPalette } from './views/CommandPalette'
import { Recover, SignIn, Splash } from './views/SignIn'
import styles from './App.module.css'

/**
 * 根：按会话阶段决定画什么。
 * 有凭据 → 启动页直到连上；连不上给「重试」，不是逼人重新拿邀请码。
 * 没凭据 → 邀请码表单，登录过程中的状态也显示在表单里。
 */
export function App() {
  const phase = useSession((s) => s.phase)
  const hasCredential = useSession((s) => s.hasCredential)
  // 全屏时红绿灯消失，标题栏左侧那 58px 不必再留空
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => window.desktop.window.onFullscreen(setFullscreen), [])

  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void useSession.getState().boot()
  }, [])

  // 全局快捷键：⌘K 搜索/派活，⌘, 设置，⌥↑↓ 切会话（加 ⇧ 只在有未读的里跳），⌘1–9 前九个会话，
  // ⌘. 右栏，⌘⇧E 标已读，Esc 回到输入框
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 全屏模态（看图）开着时应用级快捷键让位，它自己处理 Esc 和左右键
      if (document.querySelector('[data-modal="true"]')) return
      const ui = useUI.getState()
      const cmd = e.metaKey || e.ctrlKey
      const inField = (e.target as HTMLElement | null)?.tagName === 'INPUT' || (e.target as HTMLElement | null)?.tagName === 'TEXTAREA'
      if (e.altKey && !cmd && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault()
        stepConversation(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey)
        return
      }
      if (e.key === 'Escape' && !inField && !ui.paletteOpen && !ui.dialog && ui.conversationId && ui.section !== 'set' && ui.section !== 'inbox') {
        composerBus.insert('')
        return
      }
      if (!cmd) return
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); ui.setPalette(!ui.paletteOpen) }
      else if (e.key === ',') { e.preventDefault(); ui.setSettingsPage('profile') }
      else if (e.key === '.') { e.preventDefault(); ui.setInspectorOpen(!ui.inspectorOpen) }
      else if (e.key === '\\') { e.preventDefault(); ui.setSidebarOpen(!ui.sidebarOpen) }
      else if (e.shiftKey && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); if (ui.conversationId) void useSession.getState().markRead(ui.conversationId) }
      else if (!e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const id = orderedConversationIds(useSession.getState())[Number(e.key) - 1]
        if (id) { e.preventDefault(); void useSession.getState().open(id) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 一旦到过表单，后面的「连接中 / 失败」都在表单里显示
  const viaForm = useRef(false)
  if (phase.kind === 'signedOut') viaForm.current = true
  if (phase.kind === 'ready') viaForm.current = false

  if (phase.kind === 'booting') return <Splash what="正在启动…" />
  if (phase.kind === 'connecting' && !viaForm.current) return <Splash what={phase.what} />
  if (phase.kind === 'failed' && hasCredential && !viaForm.current) return <Recover why={phase.why} />
  if (phase.kind !== 'ready') return <SignIn />

  return (
    // 冷启动：四块区域按 60ms 错开各浮一次（App.module.css），之后各自的进场接着播
    <div className={styles.window}>
      <div className={styles.body}>
        <ContextSidebar fullscreen={fullscreen} />
        <MainArea />
        <Inspector />
      </div>
      <Toast />
      <UpdateBanner />
      <CommandPalette />
      <ChannelDialogsMount />
    </div>
  )
}

/** ⌥↑ / ⌥↓：按侧栏的顺序（频道、私聊、agent）切到上一个 / 下一个会话；带 ⇧ 只在有未读的里找，循环 */
function stepConversation(dir: 1 | -1, unreadOnly: boolean): void {
  const s = useSession.getState()
  const unread = new Set(s.conversations.filter((c) => c.unread > 0).map((c) => c.id))
  const id = nextConversation(orderedConversationIds(s), useUI.getState().conversationId, dir, unread, unreadOnly)
  if (id) void s.open(id)
}
