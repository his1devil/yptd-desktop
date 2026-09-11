import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/tokens.css'
import '../styles/base.css'
import { App } from './App'
import { applyTheme, useUI } from './store/ui'

// 主题在第一帧之前就要落到 <html> 上，否则浅色会闪一下。
applyTheme(useUI.getState().theme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
