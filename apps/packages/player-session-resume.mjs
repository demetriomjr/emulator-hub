export async function acquireResumeLeases({ members, createSessionId, acquire, release }) {
  if (!Array.isArray(members) || members.length < 1 || members.length > 6) throw new TypeError('Interrupted player session members are invalid.')
  const acquired = []
  try {
    for (const member of members) {
      const sessionId = createSessionId()
      const lease = await acquire(member, sessionId)
      if (!Number.isInteger(lease?.sessionRevision) || lease.sessionRevision !== member.sessionRevision + 1) {
        acquired.push({ member, sessionId, lease })
        throw new Error('Player session revision changed during resume.')
      }
      acquired.push({ member, sessionId, lease })
    }
    return acquired
  } catch (error) {
    await Promise.allSettled(acquired.map(item => release(item)))
    if (error && typeof error === 'object') error.acquiredCount = acquired.length
    throw error
  }
}

export function assertResumeCheckpointCompatible(checkpoint, launch, saveRevision) {
  if (!checkpoint || !launch || checkpoint.gameId !== launch.id || checkpoint.profileId !== launch.profileId || checkpoint.core !== launch.core || checkpoint.romSha256 !== launch.romSha256 || checkpoint.runtimeId !== launch.runtimeId || checkpoint.patchSha256 !== launch.patchSha256) throw new Error('Interrupted session checkpoint does not match this launch.')
  if (checkpoint.saveRevision !== saveRevision) throw new Error('Interrupted session checkpoint has a different canonical save revision.')
  return true
}
