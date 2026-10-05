import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createHubServer } from '../../backend/server.mjs'
import { createMemoryRedisPersistence } from '../../packages/redis-persistence.mjs'
import { createRedisProfileStore } from '../../packages/profile-store.mjs'
import { startPlayerOriginProxies, closePlayerOriginProxies } from '../../frontend/scripts/player-origin-proxy.mjs'

const require = createRequire(new URL('../pokemon-hub/package.json', import.meta.url))
const { chromium } = require('playwright')
const root = resolve(import.meta.dirname, '../../..')
const baseline = process.argv.includes('--baseline')
const image = process.argv.includes('--image')
const debugSwitch = process.argv.includes('--debug-switch')
const sshKey = 'C:/Users/dm3o/.ssh/hostinger_vps', sshHost = 'deploy@91.108.124.242'
const romPath = resolve(root, process.env.E2E_ROM ?? 'test-data/Pokemon Emerald.gba')
const rom = await readFile(romPath)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const romSha256 = hash(rom)
assert.equal(romSha256, 'a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af')
const runId = `${Date.now()}-${process.pid}`
const containerName = `hub-assets-e2e-${runId}`
const artifacts = join(root, 'test-data/frontend-observability', `hub-${runId}`)
await mkdir(artifacts, { recursive: true })
const fixture = await mkdtemp(join(tmpdir(), 'hub-assets-e2e-'))
const report = { baseline, tests: [], requests: [], runtime: [], events: [] }
const ports = []
let backend, vite, proxies = [], browser, page, frontendOutput = ''
function passed(name, evidence) { report.tests.push({ name, evidence }); console.log('PASS', name) }
try {
  await mkdir(join(fixture, 'roms'))
  await writeFile(join(fixture, 'roms/emerald.gba'), rom)
  execFileSync(process.env.E2E_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'), [join(root, 'test-data/create_emerald_rtc_rng_fixed.py'), romPath, join(fixture, 'expected.gba')])
  const expectedSha256 = hash(await readFile(join(fixture, 'expected.gba')))
  report.expectedRomSha256 = expectedSha256
  const entry = { id: 'e2e-emerald', title: 'Pokémon Emerald Version', core: 'gba', system: 'gba', file: 'emerald.gba', sha256: romSha256,
    pokemonSave: { adapter: 'gen3-gba-v1', layoutProfile: 'pokemon-emerald-gba', title: 'pokemon-emerald', saveKind: 'battery', supported: true } }
  await writeFile(join(fixture, 'catalog.json'), JSON.stringify([entry]))
  const persistence = createMemoryRedisPersistence({ namespace: `assets-e2e:${runId}` })
  const profileStore = createRedisProfileStore({ persistence })
  const profiles = []
  for (let i = 1; i <= 9; i++) profiles.push(await profileStore.create(entry.id, `Asset test ${i}`))
  backend = createHubServer({ persistence, profileStore, catalogPath: join(fixture, 'catalog.json'), romsDirectory: join(fixture, 'roms'),
    backupToken: 'e2e-debug-token',
    patchesDirectory: join(root, 'assets/ips'), savesPath: join(fixture, 'saves'), snapshotsPath: join(fixture, 'snapshots'), backupsPath: join(fixture, 'backups'),
    metadataLoader: async () => null, romDiscovery: { scan: async () => ({ accepted: [] }) } })
  backend.on('request', request => { if (request.url.startsWith('/roms/')) report.requests.push(request.url) })
  await new Promise(resolveListen => backend.listen(0, '127.0.0.1', resolveListen))
  const debugUrl = `http://127.0.0.1:${backend.address().port}/api/debug/environment`
  assert.deepEqual(await (await fetch(debugUrl)).json(), { rngDebugLogging: false })
  const setDebug = async enabled => {
    const response = await fetch(debugUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer e2e-debug-token' }, body: JSON.stringify({ rngDebugLogging: enabled }) })
    assert.equal(response.status, 200)
  }
  if (!debugSwitch) await setDebug(true)
  for (let i = 0; i < (image ? 0 : 10); i++) {
    const server = createServer()
    await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
    ports.push(server.address().port)
    await new Promise(resolveClose => server.close(resolveClose))
  }
  if (image) ports.push(39870, 8444, 8445, 8446, 8447, 8448, 8449, 8450, 8451, 8452)
  const frontend = join(root, 'apps/frontend')
  let tunnel
  if (image) {
    const config = (await readFile(join(root, 'deploy/nginx.conf'), 'utf8')).replace('listen 8080;', 'listen 127.0.0.1:39870;').replaceAll('http://backend:3001', 'http://127.0.0.1:39871')
    await writeFile(join(artifacts, 'nginx.conf'), config)
    execFileSync('scp', ['-q', '-i', sshKey, join(artifacts, 'nginx.conf'), `${sshHost}:/tmp/${containerName}.conf`])
    tunnel = spawn('ssh', ['-i', sshKey, '-o', 'ExitOnForwardFailure=yes', '-N', '-L', '127.0.0.1:39870:127.0.0.1:39870', '-R', `127.0.0.1:39871:127.0.0.1:${backend.address().port}`, sshHost], { windowsHide: true, stdio: 'ignore' })
    backend.once('close', () => tunnel.kill())
    vite = spawn('ssh', ['-i', sshKey, sshHost, `docker run --rm --name ${containerName} --network host -v /tmp/${containerName}.conf:/etc/nginx/conf.d/default.conf:ro emulator-hub-frontend`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } else vite = spawn(process.execPath, [join(frontend, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(ports[0])], {
    cwd: frontend, env: { ...process.env, BACKEND_URL: `http://127.0.0.1:${backend.address().port}`, PORT: String(ports[0]), VITE_PLAYER_PORTS: ports.slice(1).join(','), E2E_DISABLE_HMR: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  for (const pipe of [vite.stdout, vite.stderr]) pipe.on('data', chunk => { frontendOutput += chunk.toString() })
  const origin = `http://127.0.0.1:${ports[0]}`
  let reachable = false
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(origin)).ok) { reachable = true; break } } catch {}
    await new Promise(done => setTimeout(done, 100))
  }
  assert.ok(reachable, frontendOutput)
  proxies = await startPlayerOriginProxies({ targetOrigin: origin, ports: ports.slice(1) })
  browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
  const context = await browser.newContext({ timezoneId: 'America/Sao_Paulo', viewport: { width: 1920, height: 1080 } })
  page = await context.newPage()
  page.on('pageerror', error => { report.tests.push({ pageError: error.message }); console.log('PAGEERROR', error.message) })
  page.on('console', message => { if (message.type() === 'error') console.log('BROWSER', message.text().slice(0, 350)) })
  await page.goto(origin)
  if (!baseline) {
    await until(() => report.requests.length >= 2)
    assert.equal(await page.locator('.player-cell iframe').count(), 0)
    assert.equal(page.workers().length, 1)
    passed('Worker faz prefetch antes de abrir emulador', report.requests.slice())
  }
  await page.getByRole('button', { name: 'Iniciar Pokémon Emerald Version', exact: true }).click()
  await page.getByRole('button', { name: /^#1 Asset test 1$/ }).focus()
  await page.keyboard.press('Enter')
  const frame = await waitForCore(page, 0)
  report.runtime.push(await inspectRuntime(frame))
  passed('Hub real e player.js iniciaram core real', report.runtime[0])
  if (debugSwitch) {
    const closePlayer = async () => {
      await page.getByRole('button', { name: 'Fechar emulador', exact: true }).click()
      await page.locator('.player-cell iframe').waitFor({ state: 'detached', timeout: 30000 })
    }
    const manualReset = async () => {
      await page.getByRole('button', { name: 'Manipulador de odds', exact: true }).click()
      await page.getByRole('button', { name: 'Soft Reset', exact: true }).click()
      await page.waitForTimeout(2500)
    }
    await frame.evaluate(() => { window.__e2eOriginalLoop = window.EJS_emulator.gameManager.Module.postMainLoop })
    await manualReset()
    assert.equal(parseEvents(frontendOutput).length, 0)
    assert.equal(await frame.evaluate(() => window.EJS_emulator.gameManager.Module.postMainLoop === window.__e2eOriginalLoop), true)
    passed('default false: nenhum diagnóstico e nenhum hook RNG no core real')
    await setDebug(true)
    await page.waitForTimeout(5500)
    assert.equal(parseEvents(frontendOutput).length, 0)
    passed('alterar API não muda a página aberta; não há polling')
    await closePlayer()
    await page.reload()
    await page.getByRole('button', { name: 'Iniciar Pokémon Emerald Version', exact: true }).click()
    await page.getByRole('button', { name: /^#1 Asset test 1$/ }).focus(); await page.keyboard.press('Enter')
    await waitForCore(page, 0)
    await manualReset()
    await until(() => parseEvents(frontendOutput).some(e => e.kind === 'rng-reset'))
    passed('true após refresh: logs reais de RNG retornam ao stdout')
    await setDebug(false)
    await closePlayer()
    await page.reload()
    await page.getByRole('button', { name: 'Iniciar Pokémon Emerald Version', exact: true }).click()
    await page.getByRole('button', { name: /^#1 Asset test 1$/ }).focus(); await page.keyboard.press('Enter')
    const disabledFrame = await waitForCore(page, 0)
    await page.waitForTimeout(1000)
    const before = parseEvents(frontendOutput).length
    const startFrame = await disabledFrame.evaluate(() => window.EJS_emulator.gameManager.getFrameNum())
    await manualReset()
    assert.equal(parseEvents(frontendOutput).length, before)
    assert.ok(await disabledFrame.evaluate(() => window.EJS_emulator.gameManager.getFrameNum()) > startFrame)
    passed('false após refresh: logs cessam e jogo continua avançando')
  } else if (baseline) {
    await page.getByRole('button', { name: 'Manipulador de odds', exact: true }).click()
    for (let i = 0; i < 2; i++) { await page.getByRole('button', { name: 'Soft Reset', exact: true }).click(); await page.waitForTimeout(2400) }
    report.events = parseEvents(frontendOutput)
    passed('baseline preservado com Blob URLs do produto', report.events.filter(event => event.kind === 'rng-reset'))
    assert.notEqual(report.runtime[0].romSha256, romSha256, 'Regressão: produto entregou ROM original apesar do IPS registrado')
  } else {
    assert.equal(report.runtime[0].romSha256, expectedSha256)
    assert.equal(report.runtime[0].patch, undefined)
    passed('ROM no FS do runtime igual à referência Python, sem segundo IPS')
    await page.getByRole('button', { name: 'Manipulador de odds', exact: true }).click()
    for (const reset of ['Soft Reset', 'Hard Reset']) {
      let proof = null
      for (let attempt = 0; attempt < 2; attempt++) {
        const previous = parseEvents(frontendOutput).filter(event => event.kind === 'rng-reset').length
        await page.getByRole('button', { name: reset, exact: true }).click()
        await until(() => parseEvents(frontendOutput).filter(event => event.kind === 'rng-reset').length > previous)
        const event = parseEvents(frontendOutput).filter(event => event.kind === 'rng-reset').at(-1)
        assert.equal(event.patchApplied, true)
        assert.equal(event.effectiveRomSha256, expectedSha256)
        const calendar = await frame.evaluate(timestamp => { const d = new Date(timestamp); return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() } }, event.virtualTimestamp)
        const expected = expectedRtcSeed(calendar)
        if (event.seed !== null) assert.equal(event.seed, expected)
        const trajectory = rtcTrajectory(event.samples, expected)
        if (trajectory) { proof = { ...event, expectedRtcSeed: expected, trajectory }; break }
      }
      assert.ok(proof, `RNG não corresponde ao RTC no ${reset}`)
      passed(`${reset}: RNG real corresponde ao RTC e difere do seed zero`, proof)
    }
    await page.getByRole('button', { name: 'Adicionar instância', exact: true }).click()
    for (let i = 2; i <= 9; i++) {
      const choice = page.getByRole('button', { name: new RegExp(`^#${i} Asset test ${i}$`) })
      await choice.focus(); await page.keyboard.press('Enter')
      const next = await waitForCore(page, i - 1)
      const runtime = await inspectRuntime(next)
      report.runtime.push(runtime)
      assert.equal(runtime.romSha256, expectedSha256)
    }
    assert.equal(new Set(report.runtime.map(runtime => runtime.origin)).size, 9)
    assert.equal(report.requests.filter(url => url === '/roms/e2e-emerald').length, 1)
    assert.equal(report.requests.filter(url => url === '/roms/e2e-emerald/patch').length, 1)
    passed('nove cores em nove origens: um download de ROM e IPS', report.requests.slice())
    await page.getByRole('button', { name: /^Configurar caça shiny,/ }).click()
    await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
    await until(() => parseEvents(frontendOutput).filter(event => event.kind === 'rng-reset' && event.huntId).length >= 9, 45000)
    await page.getByRole('button', { name: /^Parar caça shiny,/ }).click()
    const huntEvents = parseEvents(frontendOutput).filter(event => event.kind === 'rng-reset' && event.huntId)
    assert.equal(new Set(huntEvents.map(event => event.sessionId)).size, 9)
    for (const event of huntEvents) { assert.equal(event.patchApplied, true); assert.equal(event.effectiveRomSha256, expectedSha256); assert.ok(event.samples?.length) }
    passed('Shiny Hunt real: RNG dos nove players entregue ao stdout', huntEvents)
    await page.reload()
    await page.getByRole('button', { name: 'Iniciar Pokémon Emerald Version', exact: true }).waitFor()
    await page.waitForTimeout(2000)
    assert.equal(report.requests.length, 2)
    assert.ok(parseEvents(frontendOutput).some(event => event.kind === 'game-asset' && event.assetSource === 'disk'))
    passed('reload reutiliza IndexedDB sem baixar ROM ou IPS')
  }
} catch (error) { report.failure = error.stack; await page?.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {}); throw error }
finally {
  report.events = parseEvents(frontendOutput)
  await writeFile(join(artifacts, 'results.json'), JSON.stringify(report, null, 2))
  await writeFile(join(artifacts, 'frontend.stdout.log'), frontendOutput)
  await browser?.close()
  if (image) execFileSync('ssh', ['-i', sshKey, sshHost, `docker rm -f ${containerName}; rm -f /tmp/${containerName}.conf`], { stdio: 'ignore' })
  vite?.kill('SIGTERM')
  if (vite && vite.exitCode === null) await new Promise(done => { vite.once('exit', done); setTimeout(done, 5000) })
  await closePlayerOriginProxies(proxies)
  if (backend) await new Promise(done => { backend.closeAllConnections(); backend.close(done) })
  assert.ok(fixture.startsWith(join(tmpdir(), 'hub-assets-e2e-')))
  await rm(fixture, { recursive: true, force: true })
  console.log('ARTIFACTS', artifacts)
}
async function waitForCore(page, index) {
  await page.locator('.player-cell iframe').nth(index).waitFor()
  const frame = await (await page.locator('.player-cell iframe').nth(index).elementHandle()).contentFrame()
  await frame.waitForFunction(() => Boolean(window.EJS_emulator?.gameManager && window.EJS_emulator?.started), null, { timeout: 180000 })
  return frame
}
async function inspectRuntime(frame) {
  return frame.evaluate(async () => {
    const emulator = window.EJS_emulator
    const bytes = emulator.gameManager.FS.readFile(emulator.fileName)
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
    return { filename: emulator.fileName, romSha256: sha, patch: emulator.config.gamePatchUrl, origin: location.origin, byteLength: bytes.length, hook: Array.from(bytes.slice(0x400, 0x408)), cave: Array.from(bytes.slice(0x9c0d00, 0x9c0d08)) }
  })
}
function parseEvents(output) { return output.split('\n').flatMap(line => { try { const event = JSON.parse(line); return event.schemaVersion ? [event] : [] } catch { return [] } }) }
async function until(predicate, timeout = 15000) {
  const end = performance.now() + timeout
  while (performance.now() < end) { if (predicate()) return; await new Promise(done => setTimeout(done, 100)) }
  throw new Error('Acceptance condition timed out.')
}
function expectedRtcSeed(calendar) {
  const year = ((calendar.year - 2000) >>> 0) % 100
  const leap = value => value % 4 === 0 && (value % 100 !== 0 || value % 400 === 0)
  let days = calendar.day
  for (let y = 0; y < year; y++) days += leap(y) ? 366 : 365
  days += [31,28,31,30,31,30,31,31,30,31,30,31].slice(0, calendar.month - 1).reduce((sum, value) => sum + value, 0)
  if (calendar.month > 2 && leap(year)) days++
  const bcd = value => Math.floor(value / 10) * 16 + value % 10
  const minutes = days * 1440 + bcd(calendar.hour) * 60 + bcd(calendar.minute)
  return (minutes >>> 16) ^ (minutes & 0xffff)
}
function rtcTrajectory(samples, seed) {
  const positions = new Map(), zeros = new Set()
  let word = seed, zero = 0
  for (let step = 0; step < 1024; step++) {
    positions.set(word, step); zeros.add(zero)
    word = (Math.imul(word, 0x41c64e6d) + 0x6073) >>> 0
    zero = (Math.imul(zero, 0x41c64e6d) + 0x6073) >>> 0
  }
  const tail = samples?.slice(-8)
  if (!tail || tail.length < 4 || tail.some(sample => !positions.has(sample.rngValue) || zeros.has(sample.rngValue))) return null
  const origin = tail[0].frame - positions.get(tail[0].rngValue)
  return tail.every(sample => sample.frame - positions.get(sample.rngValue) === origin) ? { inferredResetFrame: origin, sampleCount: tail.length } : null
}
