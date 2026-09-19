import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const composeFile = new URL('../docker-compose.yml', import.meta.url)

test('production Compose isolates the backend and waits for its healthcheck', async () => {
  const compose = await readFile(composeFile, 'utf8')

  assert.match(compose, /condition: service_healthy/)
  assert.match(compose, /healthcheck:/)
  assert.match(compose, /CADDY_NETWORK/)
  assert.match(compose, /external: true/)
  assert.match(compose, /"127\.0\.0\.1:8080:8080"/)
  assert.doesNotMatch(compose, /"0\.0\.0\.0:8080:8080"/)
})
