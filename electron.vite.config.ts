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
    // sandbox 下的 preload 只能 require 白名单里的几个模块，第三方包必须打进 bundle。
    // OpenIM 的渲染桥就是第三方 preload 代码，不能外置。
    plugins: [externalizeDepsPlugin({ exclude: ['@openim/electron-client-sdk'] })],
  },
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [react()],
  },
})
