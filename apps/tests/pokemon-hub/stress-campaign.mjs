import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const rounds = Number.parseInt(process.argv[2] ?? '5', 10)
const offset = Number.parseInt(process.argv[3] ?? '0', 10)
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 50) throw new RangeError('Stress campaign rounds must be between 1 and 50')
if (!Number.isInteger(offset) || offset < 0) throw new RangeError('Stress campaign seed offset must be a nonnegative integer')

for (let round = 0; round < rounds; round += 1) {
  const seed = (Math.imul(offset + round + 1, 0x9e3779b9) ^ 0x5eed1234) >>> 0
  console.log(`Pokemon Hub stress round ${round + 1}/${rounds}, seed ${seed}`)
  const child = spawn(process.execPath, [resolve(here, 'run.mjs'), 'stress.spec.mjs', '--grep', '100 drags|30 transferências'], {
    cwd: here, stdio: 'inherit', windowsHide: true, env: { ...process.env, E2E_STRESS_SEED: String(seed) },
  })
  const exitCode = await new Promise(resolveExit => child.once('exit', code => resolveExit(code ?? 1)))
  if (exitCode !== 0) {
    process.exitCode = exitCode
    break
  }
}
