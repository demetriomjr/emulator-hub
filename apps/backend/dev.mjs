import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const execFileAsync = promisify(execFile)
const backendIdentityHeader = 'x-emulator-hub-backend'
const backendIdentityValue = '1'

export async function reclaimOwnBackend({
  host = process.env.HOST ?? '127.0.0.1',
  port = Number.parseInt(process.env.PORT ?? '3000', 10),
  legacyWatcherPids = findWindowsManagedWatcherPids,
  listenerPid = findWindowsListenerPid,
  watcherRootPid = findWindowsWatcherRootPid,
  request = fetch,
  terminateTree = terminateWindowsProcessTree,
  waitForPortRelease = waitForListenerRelease,
} = {}) {
  const staleWatchers = await legacyWatcherPids()
  await Promise.all(staleWatchers.map(pid => terminateTree(pid)))
  if (staleWatchers.length > 0) await waitForPortRelease(port, listenerPid)

  const pid = await listenerPid(port)
  if (pid === null) return { status: 'available', clearedWatchers: staleWatchers.length }

  let response
  try {
    response = await request(`http://${host}:${port}/api/games`, { signal: AbortSignal.timeout(1_000) })
  } catch {
    return { status: 'unidentified-listener', pid }
  }

  if (response.headers.get(backendIdentityHeader) !== backendIdentityValue) {
    return { status: 'foreign-listener', pid }
  }

  await terminateTree(await watcherRootPid(pid))
  await waitForPortRelease(port, listenerPid)
  return { status: 'reclaimed', pid, clearedWatchers: staleWatchers.length }
}

async function findWindowsManagedWatcherPids() {
  if (process.platform !== 'win32') return []
  const script = "$candidates = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match '--watch' -and $_.CommandLine -match 'server\\.mjs' -and $_.CommandLine -match '--emulator-hub-dev-watcher' }; $candidates | ForEach-Object { $_.ProcessId }"
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
  return stdout.split(/\s+/).map(value => Number.parseInt(value, 10)).filter(pid => Number.isSafeInteger(pid) && pid > 0)
}

async function findWindowsListenerPid(port) {
  if (process.platform !== 'win32') return null
  const script = `$listener = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -ne $listener) { $listener.OwningProcess }; exit 0`
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
  const pid = Number.parseInt(stdout.trim(), 10)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

async function findWindowsWatcherRootPid(pid) {
  if (process.platform !== 'win32') return pid
  const script = `$current = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" -ErrorAction SilentlyContinue; if ($null -eq $current) { exit }; $root = $current.ProcessId; while ($current.ParentProcessId) { $parent = Get-CimInstance Win32_Process -Filter \"ProcessId = $($current.ParentProcessId)\" -ErrorAction SilentlyContinue; if ($null -eq $parent) { break }; $current = $parent; if ($current.CommandLine -match \"--watch\" -and $current.CommandLine -match \"server\\.mjs\") { $root = $current.ProcessId } }; $root`
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
  const rootPid = Number.parseInt(stdout.trim(), 10)
  return Number.isSafeInteger(rootPid) && rootPid > 0 ? rootPid : pid
}

async function terminateWindowsProcessTree(pid) {
  if (process.platform === 'win32') {
    await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    return
  }
  process.kill(pid, 'SIGTERM')
}

async function waitForListenerRelease(port, listenerPid) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await listenerPid(port) === null) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Emulator Hub did not release port ${port} after its previous development session was stopped.`)
}

async function startDevelopmentServer() {
  const host = process.env.HOST ?? '127.0.0.1'
  const port = Number.parseInt(process.env.PORT ?? '3000', 10)
  const reclamation = await reclaimOwnBackend({ host, port })
  if (reclamation.status === 'foreign-listener' || reclamation.status === 'unidentified-listener') {
    throw new Error(`Port ${port} is already in use by a process that was not identified as Emulator Hub. It was left untouched.`)
  }

  const watcher = spawn(process.execPath, ['--env-file-if-exists=.env', '--watch', 'server.mjs', '--emulator-hub-dev-watcher'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    stdio: 'inherit',
    windowsHide: true,
  })

  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    watcher.kill('SIGTERM')
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  watcher.once('exit', (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1)
  })
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isMainModule()) {
  startDevelopmentServer().catch(error => {
    console.error(`[Emulator Hub] development server failed: ${error.message}`)
    process.exitCode = 1
  })
}
