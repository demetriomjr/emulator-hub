export const hoennStarterChoices = Object.freeze([
  { value: 1, label: '1ª — Esquerda · Treecko', species: 252, direction: 'LEFT' },
  { value: 2, label: '2ª — Centro · Torchic', species: 255, direction: null },
  { value: 3, label: '3ª — Direita · Mudkip', species: 258, direction: 'RIGHT' },
])

export const HOENN_DIRECTION_TAP_MS = 8

// Each step describes its input and minimum time before the following step.
export function getShinyHuntStartSequence({ startMode, starterPosition }) {
  if (startMode === 'common') return null
  if (startMode === 'interact-a') return [{ button: 'A', holdMs: 40, intervalMs: 0 }]
  const direction = { 'walk-right': 'RIGHT', 'walk-left': 'LEFT', 'walk-up': 'UP' }[startMode]
  if (direction) return [{ button: direction, holdMs: 1200, intervalMs: 0 }]
  if (startMode !== 'hoenn-starter') throw new Error('Configuração de caça inválida')
  const choice = hoennStarterChoices.find(candidate => candidate.value === starterPosition)
  if (!choice) throw new Error('Escolha a Poké Bola do inicial de Hoenn')
  const confirm = { button: 'A', holdMs: 40, intervalMs: 1000 }
  return [
    { ...confirm },
    ...(choice.direction ? [{ button: choice.direction, localTap: true, intervalMs: 1000 }] : []),
    { ...confirm },
    { ...confirm, intervalMs: 0 },
  ]
}
