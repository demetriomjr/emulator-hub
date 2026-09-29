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
  assert.match(compose, /EMULATOR_HUB_BACKUP_TOKEN/)
  assert.match(compose, /PLAYER_ORIGIN_PORTS: \$\{PLAYER_ORIGIN_PORTS:-\}/)
  assert.match(compose, /external: true/)
  assert.match(compose, /"127\.0\.0\.1:8080:8080"/)
  assert.doesNotMatch(compose, /"0\.0\.0\.0:8080:8080"/)
})

test('production frontend seeds a cache outside the atomically replaced sprite directory', async () => {
  const dockerfile = await readFile(frontendDockerfile, 'utf8')

  assert.match(dockerfile, /COPY apps\/frontend \.\/[\s\S]*cp -a \/app\/apps\/frontend\/public\/resources\/pokemon\/\. \/tmp\/pokemon-seed\//)
  assert.match(dockerfile, /--mount=type=cache,id=emulator-hub-pokemon-sprites,target=\/tmp\/pokemon-cache,sharing=locked/)
  assert.doesNotMatch(dockerfile, /--mount=type=cache[^\n]*target=\/app\/apps\/frontend\/public\/resources\/pokemon/)
  assert.match(dockerfile, /cp -an \/tmp\/pokemon-seed\/\* \/tmp\/pokemon-cache\//)
  assert.doesNotMatch(dockerfile, /cp -an \/tmp\/pokemon-seed\/\. \/tmp\/pokemon-cache\//)
  assert.match(dockerfile, /cp -a \/tmp\/pokemon-cache\/\. \/app\/apps\/frontend\/public\/resources\/pokemon\//)
  assert.match(dockerfile, /npm run build && rm -rf \/tmp\/pokemon-cache\/\* && cp -a \/app\/apps\/frontend\/public\/resources\/pokemon\/\. \/tmp\/pokemon-cache\//)
  assert.match(dockerfile, /ENV VITE_PLAYER_PORTS=\$PLAYER_ORIGIN_PORTS/)
})

test('production backend image copies IPS assets into the backend patch directory', async () => {
  const backendDockerfile = new URL('./backend.Dockerfile', import.meta.url)
  const dockerfile = await readFile(backendDockerfile, 'utf8')

  assert.match(dockerfile, /WORKDIR \/app\/apps\/backend/)
  assert.match(dockerfile, /COPY assets\/ips\/ \.\/patches\//)
  assert.match(dockerfile, /RUN rm -rf \.\/patches[\s\S]*COPY assets\/ips\/ \.\/patches\//)
})
