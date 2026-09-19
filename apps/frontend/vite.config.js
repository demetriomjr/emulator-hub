import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const requireFromFrontend = createRequire(import.meta.url)
const packageUiDependencies = new Set([
  'react',
  '@dnd-kit/react',
  '@dnd-kit/dom',
  'antd',
  '@ant-design/icons',
])

const workspacePackageDependencyResolver = {
  name: 'workspace-package-dependency-resolver',
  resolveId(source, importer) {
    const isPackageSource = importer?.includes('apps/packages/') || importer?.includes('apps\\packages\\')
    const dependency = [...packageUiDependencies].find(name => source === name || source.startsWith(`${name}/`))
    return isPackageSource && dependency ? requireFromFrontend.resolve(source) : null
  },
}

export function createFrontendViteConfiguration(environment) {
  const backendUrl = environment.BACKEND_URL ?? 'http://127.0.0.1:3001'

  return {
    base: './',
    plugins: [workspacePackageDependencyResolver, react()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, 'index.html'),
          player: resolve(import.meta.dirname, 'player.html'),
        },
      },
    },
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
