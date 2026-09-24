const remoteKinds = new Set(['user-state', 'cloud-recovery'])

export function snapshotUrlForKind(url, kind) {
  if (typeof url !== 'string' || !remoteKinds.has(kind)) throw new TypeError('Remote snapshot URL or kind is invalid.')
  return kind === 'user-state' ? `${url}${url.includes('?') ? '&' : '?'}kind=user-state` : url
}

export function snapshotMatchesLaunch(snapshot, launch) {
  const metadata = snapshot?.metadata
  return Boolean(metadata && launch
    && metadata.core === launch.core
    && metadata.romSha256 === launch.romSha256
    && metadata.runtimeId === launch.runtimeId
    && metadata.patchSha256 === launch.patchSha256)
}

export function remoteCandidateSummary(snapshot, { currentSaveRevision, installationId } = {}) {
  const metadata = snapshot?.metadata
  const kind = metadata?.kind
  if (!remoteKinds.has(kind) || !Number.isInteger(snapshot.revision) || snapshot.revision < 1) throw new TypeError('Remote restore candidate is invalid.')
  if (typeof metadata.capturedAt !== 'string' || !Number.isFinite(Date.parse(metadata.capturedAt))) throw new TypeError('Remote capture time is invalid.')
  return {
    candidateId: `${kind === 'user-state' ? 'user' : 'remote'}:${snapshot.revision}`,
    kind,
    reasonCode: metadata.reasonCode ?? 'legacy-unknown',
    capturedAt: metadata.capturedAt,
    captureClock: 'server',
    origin: metadata.originInstallationId && installationId ? metadata.originInstallationId === installationId ? 'this-installation' : 'other-installation' : 'unknown',
    saveRevision: metadata.saveRevision,
    currentSaveRevision: Number.isInteger(currentSaveRevision) ? currentSaveRevision : undefined,
  }
}

export function localCandidateSummary(record, { currentSaveRevision } = {}) {
  if (!record || typeof record.candidateId !== 'string' || !record.candidateId) throw new TypeError('Local restore candidate is invalid.')
  return {
    candidateId: record.candidateId,
    kind: 'local-recovery',
    reasonCode: record.reason === 'runtime-break' ? 'runtime-break' : 'possible-recovery',
    capturedAt: typeof record.capturedAt === 'string' && Number.isFinite(Date.parse(record.capturedAt)) ? record.capturedAt : null,
    captureClock: 'browser',
    origin: 'this-installation',
    currentSaveRevision: Number.isInteger(currentSaveRevision) ? currentSaveRevision : undefined,
  }
}

export function sortRestoreCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const leftTime = Date.parse(left.capturedAt ?? '')
    const rightTime = Date.parse(right.capturedAt ?? '')
    if (!Number.isFinite(leftTime)) return Number.isFinite(rightTime) ? 1 : 0
    if (!Number.isFinite(rightTime)) return -1
    return rightTime - leftTime
  })
}

export function getInstallationId(storage) {
  return getInstallationIdentity(storage).id
}

export function getInstallationIdentity(storage) {
  try {
    storage ??= globalThis.localStorage
    if (!storage) return { id: null, comparisonId: null }
    const key = 'emulator_hub_installation_id'
    const previous = storage.getItem(key)
    if (typeof previous === 'string' && /^[a-f0-9-]{36}$/.test(previous)) return { id: previous, comparisonId: previous }
    if (typeof globalThis.crypto?.randomUUID !== 'function') return { id: null, comparisonId: null }
    const created = globalThis.crypto.randomUUID()
    storage.setItem(key, created)
    return { id: created, comparisonId: null }
  } catch { return { id: null, comparisonId: null } }
}
