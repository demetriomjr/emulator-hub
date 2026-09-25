import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { parsePlayerOriginPorts } from '../../packages/player-origin-topology.mjs'
import { closePlayerOriginProxies, startPlayerOriginProxies } from './player-origin-proxy.mjs'

const environment = loadEnv('development', process.cwd(), '')
const hubPort = Number(environment.PORT ?? 5173)
const host = environment.HOST ?? '127.0.0.1'
let servers = []
let ports = []

if (['127.0.0.1', 'localhost'].includes(host) && Number.isInteger(hubPort) && hubPort > 0 && hubPort <= 65529) {
  try {
    const configured = environment.PLAYER_ORIGIN_PORTS || Array.from({ length: 6 }, (_, slot) => hubPort + slot + 1).join(',')
    ports = parsePlayerOriginPorts(new URL(`http://localhost:${hubPort}/`), configured)
    servers = await startPlayerOriginProxies({ targetOrigin: `http://127.0.0.1:${hubPort}`, ports })
    console.info(`[player-origins] Local players on ports ${ports.join(', ')}`)
  } catch (error) {
    ports = []
    console.warn(`[player-origins] Local ports unavailable; using the Hub origin: ${error.message}`)
  }
}

const vite = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VITE_PLAYER_PORTS: ports.join(',') },
})

vite.once('error', async error => {
  console.error(`[player-origins] Could not start Vite: ${error.message}`)
  await closePlayerOriginProxies(servers)
  process.exitCode = 1
})
vite.once('exit', async code => {
  await closePlayerOriginProxies(servers)
  process.exitCode = code ?? 1
})
process.on('SIGINT', () => vite.kill('SIGINT'))
process.on('SIGTERM', () => vite.kill('SIGTERM'))
