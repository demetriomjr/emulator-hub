import React, { useEffect, useRef } from 'react'
import { spriteUrl } from './pokemon-resource-catalog.mjs'

const statRows = [
  ['hp', 'HP'], ['attack', 'Ataque'], ['defense', 'Defesa'],
  ['specialAttack', 'At. Esp.'], ['specialDefense', 'Def. Esp.'], ['speed', 'Velocidade'],
]

export function PokemonDetailCard({ detail, onClose }) {
  const closeRef = useRef(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  const ready = detail?.availability === 'ready'
  const species = ready ? detail.identity.species : null
  const gender = ready ? detail.identity.gender : null
  const currentHp = ready ? detail.training.partyRuntime?.currentHp : null
  return <div className="pokemon-card-layer">
    <article className="pokemon-detail-card" role="dialog" aria-label={ready ? `Detalhes de ${detail.identity.speciesLabel ?? `Pokémon ${species}`}` : 'Detalhes do Pokémon indisponíveis'} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <button ref={closeRef} className="pokemon-detail-close" type="button" aria-label="Fechar card do Pokémon" onClick={onClose}>×</button>
      {!ready ? <p className="pokemon-detail-unavailable">Os detalhes deste Pokémon estão indisponíveis.</p> : <>
        <div className="pokemon-detail-identity">
          <div className="pokemon-detail-sprite-wrap">
            <img className="pokemon-detail-sprite" src={spriteUrl({ nationalDex: species, shiny: detail.identity.shiny })} alt={`Pokémon número ${species}`} onError={event => { event.currentTarget.hidden = true }} />
            <div className="pokemon-detail-badges">
              {gender === 'male' && <span className="pokemon-detail-gender male" role="img" aria-label="Macho">♂</span>}
              {gender === 'female' && <span className="pokemon-detail-gender female" role="img" aria-label="Fêmea">♀</span>}
              {detail.identity.shiny && <span className="pokemon-detail-shiny" role="img" aria-label="Shiny">✦<small>✧</small></span>}
            </div>
          </div>
          <strong className="pokemon-detail-species">{detail.identity.speciesLabel ?? `Pokémon #${species}`} <small>#{species}</small>{detail.identity.isEgg ? ' · Ovo' : ''}</strong>
          <dl className="pokemon-detail-facts">
            <div><dt>Nível</dt><dd>{value(detail.training.level)}</dd></div>
            <div><dt>Original Trainer ID</dt><dd>{String(detail.origin.trainerId).padStart(5, '0')}</dd></div>
            <div><dt>Original Game</dt><dd>{detail.origin.metGameLabel ?? (detail.origin.metGameId ? `Game #${detail.origin.metGameId}` : 'Desconhecido')}</dd></div>
            <div><dt>Pokébola</dt><dd>{detail.capture.ballLabel ?? (detail.capture.ballId ? `Ball #${detail.capture.ballId}` : 'Desconhecida')}</dd></div>
            <div><dt>Item</dt><dd>{detail.heldItem.itemId === 0 ? 'Sem item' : detail.heldItem.itemLabel ?? `Item #${detail.heldItem.itemId}`}</dd></div>
          </dl>
        </div>
        <div className="pokemon-detail-data">
          <section aria-label="Status e IVs"><h3>Status <small>IV</small></h3><div className="pokemon-detail-stats">
            {statRows.map(([key, label]) => <div className="pokemon-detail-stat" key={key}><span>{label}</span><strong>{key === 'hp' && currentHp != null ? `${currentHp}/${value(detail.training.stats?.hp)}` : value(detail.training.stats?.[key])}</strong><small>IV {value(detail.training.ivs?.[key])}</small></div>)}
          </div></section>
          <section aria-label="Moves"><h3>Moves</h3><ol className="pokemon-detail-moves">{detail.moves.map(move => <li key={move.slot}><span>{move.moveId ? move.label ?? `Move #${move.moveId}` : '—'}</span>{move.moveId ? <small>PP {value(move.pp)}</small> : null}</li>)}</ol></section>
          <section aria-label="Ribbons"><h3>Ribbons</h3>{detail.ribbons.length ? <ul className="pokemon-detail-ribbons">{detail.ribbons.map(ribbon => <li key={ribbon.ribbonId}><img src={`/resources/pokemon-card/ribbons/${ribbon.iconKey}.png`} alt="" aria-hidden="true" onError={event => { event.currentTarget.hidden = true }} /><span>{ribbon.label}</span></li>)}</ul> : <p className="pokemon-detail-no-ribbons">Nenhuma</p>}</section>
        </div>
      </>}
    </article>
  </div>
}

function value(number) { return number ?? '—' }
