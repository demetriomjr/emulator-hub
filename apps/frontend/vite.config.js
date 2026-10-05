import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { frontendEventsMiddleware } from './server/frontend-events-vite.mjs'

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

const playerDocumentIsolation = {
  name: 'player-document-isolation',
  configureServer(server) { server.middlewares.use(addPlayerIsolationHeader) },
  configurePreviewServer(server) { server.middlewares.use(addPlayerIsolationHeader) },
}
const frontendEvents = {
  name: 'frontend-events',
  configureServer(server) { server.middlewares.use(frontendEventsMiddleware()) },
  configurePreviewServer(server) { server.middlewares.use(frontendEventsMiddleware()) },
}

function addPlayerIsolationHeader(request, response, next) {
  if (new URL(request.url ?? '/', 'http://localhost').pathname === '/player.html') {
    response.setHeader('Document-Isolation-Policy', 'isolate-and-require-corp')
  }
  next()
}

export function createFrontendViteConfiguration(environment) {
  const backendUrl = environment.BACKEND_URL ?? 'http://127.0.0.1:3001'

  return {
    base: './',
    plugins: [workspacePackageDependencyResolver, playerDocumentIsolation, frontendEvents, react()],
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
      hmr: environment.E2E_DISABLE_HMR === '1' ? false : { clientPort: Number.parseInt(environment.PORT ?? '5173', 10) },
      fs: { allow: ['..'] },
      proxy: {
        '/api': backendUrl,
        '/roms': backendUrl,
      },
    },
  }
}

export default defineConfig(({ mode }) => createFrontendViteConfiguration(loadEnv(mode, process.cwd(), '')))
