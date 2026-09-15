import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:65179',
        ws: true,
      },
      '/health': 'http://localhost:65179',
      '/hubs': {
        target: 'http://localhost:65179',
        ws: true,
      },
    },
  },
})
