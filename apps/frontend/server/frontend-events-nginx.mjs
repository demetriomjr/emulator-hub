import { handleFrontendEventRequest } from '../../packages/frontend-events.mjs'
function receive(request) {
  const result = handleFrontendEventRequest({ method: request.method, contentType: request.headersIn['Content-Type'], origin: request.headersIn.Origin, host: request.headersIn.Host, body: request.requestText, bodyBytes: request.requestBuffer?.length })
  if (result.json) request.variables.frontend_event = result.json
  request.headersOut['Cache-Control'] = 'no-store'
  request.return(result.status)
}
export default { receive }
