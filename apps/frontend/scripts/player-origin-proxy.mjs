import { createServer, request as httpRequest } from 'node:http'

export function createPlayerOriginProxyServer({ targetOrigin }) {
  const target = new URL(targetOrigin)
  if (target.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(target.hostname)) throw new Error('Player origin proxy target must be local HTTP')
  return createServer((incoming, outgoing) => {
    const upstream = httpRequest({
      hostname: '127.0.0.1',
      port: Number(target.port),
      method: incoming.method,
      path: incoming.url,
      headers: { ...incoming.headers, host: target.host },
    }, response => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers)
      response.pipe(outgoing)
    })
    upstream.on('error', error => {
      if (!outgoing.headersSent) outgoing.writeHead(502, { 'Content-Type': 'text/plain' })
      outgoing.end(`Hub dev server unavailable: ${error.message}`)
    })
    incoming.pipe(upstream)
  })
}

export async function startPlayerOriginProxies({ targetOrigin, ports }) {
  const servers = []
  try {
    for (const port of ports) {
      const server = createPlayerOriginProxyServer({ targetOrigin })
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject)
          resolve()
        })
      })
      servers.push(server)
    }
    return servers
  } catch (error) {
    await closePlayerOriginProxies(servers)
    throw error
  }
}

export async function closePlayerOriginProxies(servers) {
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))))
}
