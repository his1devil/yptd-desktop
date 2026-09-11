import { useEffect, useRef, useState } from 'react'
import { Toast } from './components/Toast'
import { UpdateBanner } from './components/UpdateBanner'
import { TitleBar } from './shell/TitleBar'
import { Rail } from './shell/Rail'
import { ContextSidebar } from './shell/ContextSidebar'
import { Inspector } from './shell/Inspector'
import { MainArea } from './shell/MainArea'
import { useSession } from './store/session'
import { useUI } from './store/ui'
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

  // 全局快捷键：⌘K 搜索/派活，⌘, 设置
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); const ui = useUI.getState(); ui.setPalette(!ui.paletteOpen) }
      else if (e.key === ',') { e.preventDefault(); useUI.getState().setSettingsPage('profile') }
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
    <div className={styles.window}>
      <TitleBar fullscreen={fullscreen} />
      <div className={styles.body}>
        <Rail />
        <ContextSidebar />
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
