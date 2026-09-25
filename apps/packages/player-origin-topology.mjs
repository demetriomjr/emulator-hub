export function parsePlayerOriginPorts(location, value) {
  if (!value) return []
  if (location.protocol !== 'https:' && !(location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(location.hostname))) return []
  const ports = value.split(',').map(part => Number(part.trim()))
  const hubPort = Number(location.port || (location.protocol === 'https:' ? 443 : 80))
  if (ports.length !== 6 || ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535 || port === hubPort) || new Set(ports).size !== 6) {
    throw new Error('Player origin ports must be six distinct valid ports, excluding the Hub port')
  }
  return ports
}

export function availablePlayerOriginSlot(sessions, maximum = 6) {
  const occupied = new Set(sessions.map(session => session.playerOriginSlot))
  for (let slot = 0; slot < maximum; slot += 1) if (!occupied.has(slot)) return slot
  return null
}

export function playerOriginForSlot(hubLocation, slot, ports) {
  const url = new URL(hubLocation.href)
  if (!Number.isInteger(slot) || slot < 0 || slot >= ports.length) throw new RangeError('Player origin slot is invalid')
  url.port = String(ports[slot])
  return url.origin
}

export async function canReachPlayerOrigin(origin, { fetcher = fetch, timeoutMs = 2000 } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetcher(`${origin}/player.html`, { method: 'HEAD', mode: 'no-cors', credentials: 'omit', cache: 'no-store', signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export async function findReachablePlayerOriginSlot(sessions, hubLocation, ports, probe = canReachPlayerOrigin) {
  if (availablePlayerOriginSlot(sessions, ports.length) === null) return null
  const occupied = new Set(sessions.map(session => session.playerOriginSlot))
  const slots = ports.map((_, slot) => slot).filter(slot => !occupied.has(slot))
  const reachable = await Promise.all(slots.map(slot => Promise.resolve(probe(playerOriginForSlot(hubLocation, slot, ports))).catch(() => false)))
  return slots.find((_, index) => reachable[index]) ?? null
}

export function frameOrigin(frame, hubOrigin) {
  if (!frame.src) return hubOrigin
  try { return new URL(frame.src, hubOrigin === 'null' ? undefined : hubOrigin).origin }
  catch { return hubOrigin }
}

export function findTrustedPlayerFrame(event, frames, hubOrigin) {
  for (const frame of frames) {
    if (event.source === frame.contentWindow && event.origin === frameOrigin(frame, hubOrigin)) return frame
  }
  return null
}
