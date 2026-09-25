export function orderGameProfiles(profiles) {
  return [...profiles].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
}

export function formatGameProfileLabel(profile, profiles) {
  const number = getGameProfileNumber(profile, profiles)
  return number === null ? profile.name : `#${number} ${profile.name}`
}

export function getGameProfileNumber(profile, profiles) {
  const position = orderGameProfiles(profiles).findIndex(candidate => candidate.id === profile.id)
  return position < 0 ? null : position + 1
}
