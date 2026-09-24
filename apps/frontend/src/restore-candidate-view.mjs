const titles = { 'user-state': 'Estado salvo por você', 'cloud-recovery': 'Recuperação automática', 'local-recovery': 'Recuperação local' }
const reasons = { 'user-request': 'Salvo por você', 'periodic-recovery': 'Captura periódica', 'session-close': 'Capturado ao fechar a sessão', 'runtime-break': 'Emulador interrompido', 'possible-recovery': 'Possível fechamento inesperado', 'legacy-unknown': 'Origem manual ou automática desconhecida' }
const origins = { 'this-installation': 'Este dispositivo', 'other-installation': 'Outro dispositivo', unknown: 'Dispositivo desconhecido' }

export function describeRestoreCandidate(candidate) {
  const clock = candidate.captureClock === 'browser' ? 'relógio deste dispositivo' : 'horário do servidor'
  const date = typeof candidate.capturedAt === 'string' && Number.isFinite(Date.parse(candidate.capturedAt))
    ? new Date(candidate.capturedAt).toLocaleString('pt-BR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
    : 'Horário de captura desconhecido'
  const gameTimeLabel = candidate.gameTime?.kind === 'wall-clock' ? 'Hora interna do jogo' : candidate.gameTime?.kind === 'playtime-counter' ? 'Tempo de jogo' : 'Sequência do save'
  return {
    title: candidate.reasonCode === 'legacy-unknown' ? 'Estado antigo' : titles[candidate.kind] ?? 'Estado antigo',
    reason: reasons[candidate.reasonCode] ?? 'Motivo desconhecido',
    origin: origins[candidate.origin] ?? origins.unknown,
    capture: `${date} · ${clock}`,
    saveFreshness: Number.isInteger(candidate.saveRevision) && Number.isInteger(candidate.currentSaveRevision) && candidate.saveRevision < candidate.currentSaveRevision ? 'O save do jogo foi atualizado depois deste estado.' : null,
    gameTime: candidate.gameTime ? `${gameTimeLabel}: ${candidate.gameTime.value}` : null,
  }
}
