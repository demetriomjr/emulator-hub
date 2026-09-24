export function createRestoreRequest({ requestId, kind, gameId, profileId, sessionId, candidateId, candidates }) {
  if (![requestId, kind, gameId, profileId, sessionId].every(value => typeof value === 'string' && value.length > 0)) throw new TypeError('Restore request identity is invalid.')
  if (candidateId !== undefined && (typeof candidateId !== 'string' || candidateId.length === 0)) throw new TypeError('Restore candidate identity is invalid.')
  if (kind === 'candidate-list' && (!Array.isArray(candidates) || candidates.length === 0 || candidates.some(candidate => !candidate || typeof candidate.candidateId !== 'string' || !['user-state', 'cloud-recovery', 'local-recovery'].includes(candidate.kind)))) throw new TypeError('Restore candidates are invalid.')
  const safeCandidates = candidates?.map(({ candidateId, kind, reasonCode, capturedAt, captureClock, origin, saveRevision, currentSaveRevision, gameTime }) => ({ candidateId, kind, reasonCode, capturedAt, captureClock, origin, ...(saveRevision !== undefined ? { saveRevision } : {}), ...(currentSaveRevision !== undefined ? { currentSaveRevision } : {}), ...(gameTime ? { gameTime: { value: gameTime.value, kind: gameTime.kind, adapterId: gameTime.adapterId } } : {}) }))
  return { type: 'emulator-hub:snapshot-restore-request', requestId, kind, gameId, profileId, sessionId, ...(candidateId ? { candidateId } : {}), ...(safeCandidates ? { candidates: safeCandidates } : {}) }
}

export function resolveRestoreRequest(pending, message) {
  if (!(pending instanceof Map) || typeof message?.requestId !== 'string') return null
  const request = pending.get(message.requestId)
  if (!request) return null
  if (request.candidates) {
    if (message.candidateId !== null && (typeof message.candidateId !== 'string' || !request.candidates.some(candidate => candidate.candidateId === message.candidateId))) return null
  } else if (typeof message.restore !== 'boolean') return null
  if (request.sessionId && message.sessionId !== request.sessionId) return null
  if (request.gameId && message.gameId !== request.gameId) return null
  if (request.profileId && message.profileId !== request.profileId) return null
  pending.delete(message.requestId)
  return { ...request, ...(request.candidates ? { candidateId: message.candidateId } : { restore: message.restore }) }
}

export function routeRestoreChoiceResponse(pending, settled, message) {
  if (!(pending instanceof Map) || !(settled instanceof Map) || typeof message?.requestId !== 'string' || typeof message.choiceAttemptId !== 'string' || !message.choiceAttemptId || (message.candidateId !== null && (typeof message.candidateId !== 'string' || !message.candidateId))) return null
  const request = pending.get(message.requestId)
  if (request?.candidates) {
    if (!sameRestoreIdentity(request, message)) return null
    const resolved = resolveRestoreRequest(pending, message)
    if (!resolved) return { status: 'stale', candidates: request.candidates }
    settled.set(message.requestId, { sessionId: message.sessionId, gameId: message.gameId, profileId: message.profileId, appliedCandidateId: message.candidateId })
    return { status: 'settled', request: resolved, appliedCandidateId: message.candidateId }
  }
  const previous = settled.get(message.requestId)
  return previous && sameRestoreIdentity(previous, message) ? { status: 'settled', appliedCandidateId: previous.appliedCandidateId } : null
}

function sameRestoreIdentity(request, message) {
  return request.sessionId === message.sessionId && request.gameId === message.gameId && request.profileId === message.profileId
}

export function restorePromptAfterDeleteTimeout(prompts, pending) {
  const request = prompts[pending.sessionId]
  if (!request || request.requestId !== pending.restoreRequestId || request.deleteRequestId !== pending.requestId || request.candidateId !== pending.candidateId) return prompts
  return {
    ...prompts,
    [pending.sessionId]: {
      ...request,
      deleting: false,
      deleteRequestId: null,
      timedOutDeleteRequestId: pending.requestId,
      deleteError: 'Sem resposta ao tentar excluir. A seleção foi reaberta; confira o estado antes de tentar novamente.',
    },
  }
}

export function canReconcileLateSnapshotDelete(request, message) {
  return Boolean(request && message && !request.deleting && !request.resolving
    && request.requestId === message.restoreRequestId
    && request.timedOutDeleteRequestId === message.requestId
    && request.candidateId === message.candidateId
    && request.candidates?.some(candidate => candidate.candidateId === message.candidateId && candidate.kind === message.kind))
}

export function restorePromptAfterChoiceTimeout(prompts, pending) {
  const request = prompts[pending.sessionId]
  if (!request || request.requestId !== pending.requestId || !request.resolving || request.selectedCandidateId !== pending.candidateId || request.choiceAttemptId !== pending.choiceAttemptId) return prompts
  return { ...prompts, [pending.sessionId]: { ...request, choiceError: 'Aguardando confirmação da escolha. O mesmo estado será solicitado novamente.' } }
}

export function createSnapshotDeleteWatchdog({ onTimeout, schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout, timeoutMs = 8_000 } = {}) {
  if (typeof onTimeout !== 'function' || typeof schedule !== 'function' || typeof cancel !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('Snapshot delete watchdog options are invalid.')
  const pending = new Map()
  return {
    begin(identity) {
      if (!validDeleteIdentity(identity) || pending.has(identity.sessionId)) return false
      const entry = { ...identity, timer: null }
      entry.timer = schedule(() => {
        if (pending.get(identity.sessionId) !== entry) return
        pending.delete(identity.sessionId)
        cancel(entry.timer)
        onTimeout(identity)
      }, timeoutMs)
      pending.set(identity.sessionId, entry)
      return true
    },
    settle(message) {
      if (!validDeleteIdentity(message)) return null
      const entry = pending.get(message.sessionId)
      if (!entry || !sameDeleteIdentity(entry, message)) return null
      pending.delete(message.sessionId)
      cancel(entry.timer)
      return { sessionId: entry.sessionId, requestId: entry.requestId, restoreRequestId: entry.restoreRequestId, candidateId: entry.candidateId, kind: entry.kind }
    },
    cancel(sessionId) {
      const entry = pending.get(sessionId)
      if (!entry) return false
      pending.delete(sessionId)
      cancel(entry.timer)
      return true
    },
    clear() {
      for (const entry of pending.values()) cancel(entry.timer)
      pending.clear()
    },
  }
}

function validDeleteIdentity(value) {
  return value && ['sessionId', 'requestId', 'restoreRequestId', 'candidateId', 'kind'].every(key => typeof value[key] === 'string' && value[key].length > 0)
}

function sameDeleteIdentity(left, right) {
  return ['sessionId', 'requestId', 'restoreRequestId', 'candidateId', 'kind'].every(key => left[key] === right[key])
}
