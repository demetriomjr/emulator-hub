export function createEmulatorAudioMute(initialMuted = false) {
  let muted = initialMuted
  let emulator = null
  let originalSetVolume = null
  let rememberedVolume = 0.5

  function apply() {
    if (!originalSetVolume) return
    if (muted) {
      if (emulator.volume > 0) rememberedVolume = emulator.volume
      originalSetVolume(0)
    } else {
      const volume = emulator.volume > 0 ? emulator.volume : rememberedVolume
      emulator.volume = volume
      originalSetVolume(volume)
    }
  }

  return {
    attach(candidate) {
      if (!candidate || typeof candidate.setVolume !== 'function' || candidate === emulator) return
      emulator = candidate
      originalSetVolume = candidate.setVolume.bind(candidate)
      if (candidate.volume > 0) rememberedVolume = candidate.volume
      candidate.setVolume = volume => {
        if (muted && volume > 0) {
          rememberedVolume = volume
          candidate.volume = volume
          originalSetVolume(0)
        } else {
          originalSetVolume(volume)
        }
      }
      if (muted) apply()
    },
    setMuted(nextMuted) {
      if (typeof nextMuted !== 'boolean' || nextMuted === muted) return
      muted = nextMuted
      apply()
    },
    apply,
  }
}
