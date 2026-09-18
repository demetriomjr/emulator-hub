export function shouldReloadForFrontendRevision(previousRevision, nextRevision) {
  return typeof previousRevision === 'string'
    && previousRevision.length > 0
    && typeof nextRevision === 'string'
    && nextRevision.length > 0
    && previousRevision !== nextRevision
}
