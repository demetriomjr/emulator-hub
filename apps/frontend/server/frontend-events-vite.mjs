import { handleFrontendEventRequest, frontendEventEndpoint } from '../../packages/frontend-events.mjs'
export function frontendEventsMiddleware({ output = console.log } = {}) {
  return (request, response, next) => {
    if (request.url?.split('?')[0] !== frontendEventEndpoint) return next()
    const chunks = []
    let bytes = 0
    let tooLarge = false
    request.on('data', chunk => { bytes += chunk.length; if (bytes > 16384) tooLarge = true; else chunks.push(chunk) })
    request.on('end', () => {
      const result = handleFrontendEventRequest({ method: request.method, contentType: request.headers['content-type'], origin: request.headers.origin, host: request.headers.host, body: Buffer.concat(chunks).toString('utf8'), bodyBytes: tooLarge ? 16385 : bytes })
      if (result.json) output(result.json)
      response.writeHead(result.status, { 'Cache-Control': 'no-store' }); response.end()
    })
    request.on('error', () => { if (!response.headersSent) response.writeHead(400); response.end() })
  }
}
