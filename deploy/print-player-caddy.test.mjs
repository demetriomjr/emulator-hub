import assert from 'node:assert/strict'
import test from 'node:test'
import { renderPlayerCaddyInstructions } from './print-player-caddy.mjs'

test('prints six HTTPS origin routes to one frontend upstream and Docker port publications', () => {
  const output = renderPlayerCaddyInstructions({ hostname: 'hub.example.com', ports: '8444,8445,8446,8447,8448,8449' })
  assert.equal((output.match(/reverse_proxy frontend:8080/g) ?? []).length, 6)
  assert.match(output, /hub\.example\.com:8444 \{/)
  assert.match(output, /hub\.example\.com:8449 \{/)
  assert.match(output, /"8444:8444"/)
  assert.match(output, /"8449:8449"/)
  assert.doesNotMatch(output, /demetriomjr/)
})

test('rejects malformed hostnames and port lists rather than printing Caddyfile directives', () => {
  assert.throws(() => renderPlayerCaddyInstructions({ hostname: 'hub.example.com\nabort', ports: '8444,8445,8446,8447,8448,8449' }))
  assert.throws(() => renderPlayerCaddyInstructions({ hostname: 'hub.example.com', ports: '8444,8445,8446,8447,8448,8448' }))
})
