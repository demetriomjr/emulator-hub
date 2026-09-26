import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parsePlayerOriginPorts } from '../apps/packages/player-origin-topology.mjs'

export function renderPlayerCaddyInstructions({ hostname, ports, upstream = 'frontend:8080' }) {
  if (typeof hostname !== 'string' || hostname.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    throw new Error('Expected a DNS hostname without scheme or port')
  }
  if (!/^[a-z0-9._-]+:[1-9][0-9]{0,4}$/i.test(upstream)) throw new Error('Expected an upstream such as frontend:8080')
  const selectedPorts = parsePlayerOriginPorts(new URL(`https://${hostname}/`), ports)
  if (selectedPorts.length !== 9) throw new Error('Expected nine player ports')
  const caddyfile = selectedPorts.map(port => `${hostname}:${port} {\n    reverse_proxy ${upstream}\n}`).join('\n\n')
  const composePorts = selectedPorts.map(port => `      - "${port}:${port}"`).join('\n')
  return `# Add these site blocks to your Caddyfile:\n${caddyfile}\n\n# Publish these TCP ports in the Caddy service's Docker Compose ports list:\n${composePorts}\n`
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [hostname, ports, upstream] = process.argv.slice(2)
  try {
    process.stdout.write(renderPlayerCaddyInstructions({ hostname, ports, upstream }))
  } catch (error) {
    console.error(`Usage: node deploy/print-player-caddy.mjs HOSTNAME PORT1,PORT2,PORT3,PORT4,PORT5,PORT6,PORT7,PORT8,PORT9 [UPSTREAM]\n${error.message}`)
    process.exitCode = 1
  }
}
