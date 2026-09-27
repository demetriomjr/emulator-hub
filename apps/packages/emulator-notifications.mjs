const configPath = '/home/web_user/.config/retroarch/retroarch.cfg'

export function configureEmulatorNotifications(emulator, { warn = console.warn } = {}) {
  // EmulatorJS 4.2.3 emits this after preparing its FS, before RetroArch reads
  // the config in callMain(). This is a frontend setting, not a core option.
  emulator.on('saveDatabaseLoaded', fs => {
    try {
      const config = fs.readFile(configPath, { encoding: 'utf8' })
      const preserved = config.replace(/^[\t ]*notification_show_fast_forward[\t ]*=[^\r\n]*(?:\r?\n|$)/gm, '')
      const separator = preserved.endsWith('\n') || !preserved ? '' : '\n'
      // Write text: loadExternalFiles() passes an unsupported ArrayBuffer to
      // FS.writeFile(), truncating this file and silently restoring defaults.
      fs.writeFile(configPath, `${preserved}${separator}notification_show_fast_forward = false\n`)
    } catch (error) {
      warn('[emulator-notifications] Could not disable the fast-forward notification', error)
    }
  })
}
