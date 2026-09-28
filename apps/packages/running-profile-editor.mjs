export async function saveRunningProfileNames(rows, updateProfile) {
  const results = await Promise.allSettled(rows.map(row => updateProfile(row.gameId, row.profileId, row.name)))
  return {
    saved: results.flatMap((result, index) => result.status === 'fulfilled' ? [{ row: rows[index], updated: result.value }] : []),
    failed: results.flatMap((result, index) => result.status === 'rejected' ? [{ row: rows[index], error: result.reason }] : []),
  }
}
