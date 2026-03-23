import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    server: {
      proxy: {
        '/api': { target: 'http://127.0.0.1:17333', changeOrigin: true },
        '/settings': { target: 'http://127.0.0.1:17333', changeOrigin: true },
        '/health': { target: 'http://127.0.0.1:17333', changeOrigin: true },
        '/skills': { target: 'http://127.0.0.1:17333', changeOrigin: true }
      }
    }
  }
})
