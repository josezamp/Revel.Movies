import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const apiTarget = loadEnv(mode, '.', '').VITE_API_PROXY_TARGET || 'http://localhost:65179'
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          ws: true,
        },
        '/health': apiTarget,
        '/hubs': {
          target: apiTarget,
          ws: true,
        },
      },
    },
  }
})
