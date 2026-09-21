const patches = [{
  romSha256: 'a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af',
  file: 'Pokemon Emerald.ips',
  sha256: '9c3795241bc91199cbe14b53cd4934f009119f2bb3ba9d06c1af3931a19a24b6',
}]

export function createGamePatchLookup(entries = patches) {
  const patchesByRomSha256 = new Map(entries.map(({ romSha256, file, sha256 }) => [romSha256, { file, sha256 }]))
  return sha256 => {
    const patch = patchesByRomSha256.get(sha256)
    return patch ? { ...patch } : null
  }
}

export const gamePatchForRom = createGamePatchLookup()
