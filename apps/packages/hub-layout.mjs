export function groupGamesByLayout(games, layout) {
  const availableGames = Array.isArray(games) ? games : []
  const sections = Array.isArray(layout?.sections) ? layout.sections : []

  return sections.map(section => {
    const order = new Map((Array.isArray(section.gameIds) ? section.gameIds : []).map((id, index) => [id, index]))
    const grouped = availableGames
      .filter(game => game?.system === section.system)
      .sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.title.localeCompare(right.title))
    return { id: section.id, title: section.title, games: grouped }
  }).filter(section => section.games.length > 0)
}
