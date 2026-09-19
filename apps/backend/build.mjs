import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const backendRoot = dirname(fileURLToPath(import.meta.url))
const appsRoot = dirname(backendRoot)
const runtimeFiles = [
  ...(await listModules(backendRoot, new Set(['data', 'node_modules', 'roms', 'test', 'graphify-out']))),
  ...(await listModules(join(appsRoot, 'packages'), new Set(['node_modules']))),
]

for (const file of runtimeFiles) await execFileAsync(process.execPath, ['--check', file])
console.log(`Validated ${runtimeFiles.length} backend runtime modules.`)

async function listModules(directory, excluded) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!excluded.has(entry.name)) files.push(...await listModules(join(directory, entry.name), excluded))
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      files.push(join(directory, entry.name))
    }
  }
  return files
}
