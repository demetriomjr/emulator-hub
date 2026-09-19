import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const composeFile = new URL('../docker-compose.yml', import.meta.url)
const frontendDockerfile = new URL('./frontend.Dockerfile', import.meta.url)

test('production Compose isolates the backend and waits for its healthcheck', async () => {
  const compose = await readFile(composeFile, 'utf8')

  assert.match(compose, /condition: service_healthy/)
  assert.match(compose, /healthcheck:/)
  assert.match(compose, /CADDY_NETWORK/)
  assert.match(compose, /REDIS_NETWORK/)
  assert.match(compose, /external: true/)
  assert.match(compose, /"127\.0\.0\.1:8080:8080"/)
  assert.doesNotMatch(compose, /"0\.0\.0\.0:8080:8080"/)
})

test('production frontend image synchronizes ignored Pokemon sprites before Vite copies public assets', async () => {
  const dockerfile = await readFile(frontendDockerfile, 'utf8')

  assert.match(dockerfile, /RUN npm run sync:pokemon-resources\s*\r?\nRUN npm run build/)
})
