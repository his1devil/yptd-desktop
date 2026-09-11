import { useEffect, useState } from 'react'
import { TitleBar } from './shell/TitleBar'
import { Rail } from './shell/Rail'
import { ContextSidebar } from './shell/ContextSidebar'
import { Inspector } from './shell/Inspector'
import { MainArea } from './shell/MainArea'
import styles from './App.module.css'

export function App() {
  // 全屏时红绿灯消失，标题栏左侧那 58px 不必再留空
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => window.desktop.window.onFullscreen(setFullscreen), [])

  return (
    <div className={styles.window}>
      <TitleBar fullscreen={fullscreen} />
      <div className={styles.body}>
        <Rail />
        <ContextSidebar />
        <MainArea />
        <Inspector />
      </div>
    </div>
  )
}
