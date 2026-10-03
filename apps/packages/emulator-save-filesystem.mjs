// EmulatorJS 4.2.3 mounts battery saves in IDBFS independently of its cache flags.
// Install this adapter before starting the core; each player iframe owns its class.
export function startEmulatorWithMemorySaves({ emulator, GameManager, onError = () => {} }) {
  const button = emulator?.elements?.parent?.querySelector('.ejs_start_button')
  if (emulator?.started || emulator?.gameManager) throw new Error('Memory save storage must be installed before the core starts.')
  if (typeof GameManager?.prototype?.mountFileSystems !== 'function' || typeof emulator?.startButtonClicked !== 'function' || !button) {
    throw new Error('EmulatorJS does not support memory-only save startup.')
  }

  GameManager.prototype.mountFileSystems = async function () {
    try {
      const memory = this.FS?.filesystems?.MEMFS
      if (!memory) throw new Error('EmulatorJS memory save filesystem is unavailable.')
      this.mkdir('/data')
      this.mkdir('/data/saves')
      this.FS.mount(memory, {}, '/data/saves')
    } catch (error) {
      onError(error)
      throw error
    }
  }

  return emulator.startButtonClicked(button)
}
