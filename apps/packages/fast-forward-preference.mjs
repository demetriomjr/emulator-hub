const cookieName = 'emulator_hub_fast_forward_speed'
const validSpeeds = new Set([1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5])

export function readFastForwardSpeed(cookieSource, fallback = 1.5) {
  const raw = new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`).exec(cookieSource ?? '')?.[1]
  const speed = Number(raw)
  return validSpeeds.has(speed) ? speed : fallback
}

export function writeFastForwardSpeed(document, speed) {
  if (!validSpeeds.has(speed)) throw new TypeError('Fast-forward speed is invalid.')
  document.cookie = `${cookieName}=${speed}; Path=/; Max-Age=31536000; SameSite=Lax`
}
