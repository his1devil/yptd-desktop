import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../fonts/fonts.css'
import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/app-shell.css'
import { App } from './App'
import { im } from './im/client'
import { composerBus } from './views/composerBus'
import { useRuns } from './store/runs'
import { timeline, useSession } from './store/session'
import { applyTheme, useUI } from './store/ui'

// 主题在第一帧之前就要落到 <html> 上，否则浅色会闪一下。
applyTheme(useUI.getState().theme)

// 开发用：控制台 / 联调脚本从 window.yptd 够到两个 store
if (import.meta.env.DEV) Object.assign(window, { yptd: { session: useSession, ui: useUI, timeline, im, runs: useRuns, composer: composerBus } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
