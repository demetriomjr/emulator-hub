import { getGen3NationalDex } from './pokemon-gen3-species.mjs'

const layouts = new Map([
  ['0fdd36e92b75bed65d09df4635ab0b707b288c2bf1dc4c6e7a4a4f0eebe9d64c', { playerAddress: 0x03004360, enemyAddress: 0x030045c0, gameCode: 'AXVE' }],
  ['02ca41513580a8b780989dee428df747b52a0b1a55bec617886b4059eb1152fb', { playerAddress: 0x03004360, enemyAddress: 0x030045c0, gameCode: 'AXPE' }],
  ['a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af', { playerAddress: 0x020244ec, enemyAddress: 0x02024744, gameCode: 'BPEE' }],
])

const knownEmeraldPatch = 'e12480bad322c9bbb20ebba943ab5d1987001657e0f69d74f5cd94d6ba20a6b3'
const substructureOrders = [
  'GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA',
  'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG',
  'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG',
]

export function findGen3EncounterLayout({ romSha256, patchSha256, core, runtimeId } = {}) {
  if (core !== 'gba' || runtimeId !== 'emulatorjs-4.2.3') return null
  if (patchSha256 && !(romSha256 === 'a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af' && patchSha256 === knownEmeraldPatch)) return null
  return layouts.get(romSha256) ?? null
}

export function gen3StateOffset(address) {
  if (address >= 0x02000000 && address < 0x02040000) return 0x10 + 0x21000 + address - 0x02000000
  if (address >= 0x03000000 && address < 0x03008000) return 0x10 + 0x19000 + address - 0x03000000
  return null
}

function readWord(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function readHalf(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

function stateMatches(bytes, layout) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 0x61010 || !layout) return false
  if ('RASTATE\x01' !== String.fromCharCode(...bytes.subarray(0, 8))) return false
  if (readWord(bytes, 0x10) !== 0x01000007) return false
  return layout.gameCode === String.fromCharCode(...bytes.subarray(0x2c, 0x30))
}

function decodeRecord(bytes, offset) {
  const pid = readWord(bytes, offset)
  const otid = readWord(bytes, offset + 4)
  const encrypted = bytes.subarray(offset + 32, offset + 80)
  if (pid === 0 && otid === 0 && encrypted.every(value => value === 0)) return null
  const order = substructureOrders[pid % 24]
  const plain = new Uint8Array(48)
  const key = pid ^ otid
  const view = new DataView(plain.buffer)
  for (let i = 0; i < 48; i += 4) view.setUint32(i, (readWord(encrypted, i) ^ key) >>> 0, true)
  let checksum = 0
  for (let i = 0; i < 48; i += 2) checksum = (checksum + view.getUint16(i, true)) & 0xffff
  if (checksum !== readHalf(bytes, offset + 28)) return { invalid: true }
  const rawSpecies = view.getUint16(order.indexOf('G') * 12, true)
  const species = getGen3NationalDex(rawSpecies)
  if (species === null) return { invalid: true }
  const shiny = (((otid & 0xffff) ^ (otid >>> 16) ^ (pid & 0xffff) ^ (pid >>> 16)) & 0xffff) < 8
  return { species, shiny, pid, otid }
}

export function inspectGen3Encounter(bytes, layout) {
  if (!stateMatches(bytes, layout)) return { status: 'error', reason: 'state-mismatch' }
  const offset = gen3StateOffset(layout.enemyAddress)
  if (offset === null || offset + 80 > bytes.length) return { status: 'error', reason: 'state-mismatch' }
  const enemy = bytes.subarray(offset, offset + 80)
  if (layout.baselineEnemy?.length === 80 && enemy.every((value, index) => value === layout.baselineEnemy[index])) return { status: 'pending' }
  const record = decodeRecord(bytes, offset)
  if (!record) return { status: 'pending' }
  if (record.invalid) return { status: 'error', reason: 'invalid-enemy-record' }
  return { status: record.shiny ? 'shiny' : 'normal', species: record.species, pid: record.pid, otid: record.otid }
}

export function captureGen3EnemyBaseline(bytes, layout) {
  if (!stateMatches(bytes, layout)) return null
  const offset = gen3StateOffset(layout.enemyAddress)
  return offset === null ? null : bytes.slice(offset, offset + 80)
}
