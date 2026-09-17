import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/roms': 'http://127.0.0.1:3000',
    },
  },
})
