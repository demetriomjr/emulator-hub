import assert from 'node:assert/strict'
import test from 'node:test'
import { renderPlayerCaddyInstructions } from './print-player-caddy.mjs'

test('prints nine HTTPS origin routes to one frontend upstream and Docker port publications', () => {
  const output = renderPlayerCaddyInstructions({ hostname: 'hub.example.com', ports: '8444,8445,8446,8447,8448,8449,8450,8451,8452' })
  assert.equal((output.match(/reverse_proxy frontend:8080/g) ?? []).length, 9)
  assert.match(output, /hub\.example\.com:8444 \{/)
  assert.match(output, /hub\.example\.com:8449 \{/)
  assert.match(output, /"8444:8444"/)
  assert.match(output, /"8449:8449"/)
  assert.doesNotMatch(output, /demetriomjr/)
})

test('rejects malformed hostnames and port lists rather than printing Caddyfile directives', () => {
  assert.throws(() => renderPlayerCaddyInstructions({ hostname: 'hub.example.com\nabort', ports: '8444,8445,8446,8447,8448,8449,8450,8451,8452' }))
  assert.throws(() => renderPlayerCaddyInstructions({ hostname: 'hub.example.com', ports: '8444,8445,8446,8447,8448,8449,8450,8451,8451' }))
})

test('prints nine isolated player listeners and Docker publications', () => {
  const output = renderPlayerCaddyInstructions({ hostname: 'hub.example.com', ports: '8444,8445,8446,8447,8448,8449,8450,8451,8452' })
  assert.equal((output.match(/reverse_proxy frontend:8080/g) ?? []).length, 9)
  assert.match(output, /hub\.example\.com:8452 \{/)
  assert.match(output, /"8452:8452"/)
})
