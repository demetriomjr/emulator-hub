import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export function createFrontendViteConfiguration(environment) {
  const backendUrl = environment.BACKEND_URL ?? 'http://127.0.0.1:3001'

  return {
    base: './',
    plugins: [react()],
    server: {
      host: environment.HOST ?? '127.0.0.1',
      port: Number.parseInt(environment.PORT ?? '5173', 10),
      strictPort: true,
      fs: { allow: ['..'] },
      proxy: {
        '/api': backendUrl,
        '/roms': backendUrl,
      },
    },
  }
}

export default defineConfig(({ mode }) => createFrontendViteConfiguration(loadEnv(mode, process.cwd(), '')))
