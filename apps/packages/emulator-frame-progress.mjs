export function monitorEmulatorFrameProgress({ getFrame, report, schedule = setTimeout, clear = clearTimeout, delay = 1000 } = {}) {
  const initial = readFrame(getFrame)
  let followUpTimer = null
  const timer = schedule(() => {
    const first = readFrame(getFrame)
    if (!Number.isFinite(initial) || !Number.isFinite(first) || first <= initial) {
      report?.({ kind: 'emulator-frame-stall', message: 'Emulator frame count did not advance after startup.' })
      return
    }
    followUpTimer = schedule(() => {
      const second = readFrame(getFrame)
      if (!Number.isFinite(second) || second <= first) {
        report?.({ kind: 'emulator-frame-stall', message: 'Emulator frame count stopped advancing after startup.' })
      }
    }, delay)
  }, delay)
  return () => {
    clear(timer)
    if (followUpTimer !== null) clear(followUpTimer)
  }
}

function readFrame(getFrame) {
  try { return Number(getFrame?.()) } catch { return NaN }
}
