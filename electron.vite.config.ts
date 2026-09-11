import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    // 原生模块（koffi 加载 OpenIM 的 dylib）不能被打进 bundle，留给 Node 自己 require。
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@main': resolve('src/main') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [react()],
  },
})
