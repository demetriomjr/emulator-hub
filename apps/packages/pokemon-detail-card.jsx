import React, { useEffect, useRef } from 'react'
import { Button, Tabs } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { getGen3BallIconUrl } from './pokemon-card-ball-icon.mjs'
import { getGen3MoveTypeIconUrl } from './pokemon-card-move-type-icon.mjs'
import { spriteUrl } from './pokemon-resource-catalog.mjs'

const statColumns = [
  [['hp', 'HP'], ['speed', 'SPEED']],
  [['attack', 'ATK'], ['specialAttack', 'S.ATK']],
  [['defense', 'DEF'], ['specialDefense', 'S.DEF']],
]

export function PokemonDetailCard({ detail, onClose }) {
  return detail?.availability === 'ready' && detail.identity.isEgg
    ? <PokemonEggDetailCard detail={detail} onClose={onClose} />
    : <PokemonRegularDetailCard detail={detail} onClose={onClose} />
}

function PokemonRegularDetailCard({ detail, onClose }) {
  const closeRef = useRef(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  const ready = detail?.availability === 'ready'
  const species = ready ? detail.identity.species : null
  const gender = ready ? detail.identity.gender : null
  const ballIcon = ready ? getGen3BallIconUrl(detail.capture.ballId) : null
  const generalContent = ready ? <div className="pokemon-detail-data pokemon-detail-general">
    <section className="pokemon-detail-section" aria-label="Status e IVs"><h3>Status</h3><div className="pokemon-detail-stats">
      {statColumns.map((column, index) => <div className="pokemon-detail-stat-column" key={index}>{column.map(([key, label]) => <div className="pokemon-detail-stat" key={key}>
        <span className="pokemon-detail-stat-name">{label}</span>
        <div className="pokemon-detail-stat-metrics"><strong>{value(detail.training.stats?.[key])}</strong><span className="pokemon-detail-stat-iv" aria-label={`IV ${value(detail.training.ivs?.[key])} de 31`}>({value(detail.training.ivs?.[key])}/31)</span></div>
      </div>)}</div>)}
    </div></section>
    <section className="pokemon-detail-section" aria-label="Moves"><h3>Moves</h3><ol className="pokemon-detail-moves">{detail.moves.map(move => {
      const label = move.moveId ? move.label ?? `Move #${move.moveId}` : '—'
      return <li key={move.slot}><span className="pokemon-detail-move-name" title={label}>{label}</span><MoveTypeBadge type={move.moveId ? move.type : null} /></li>
    })}</ol></section>
  </div> : <p className="pokemon-detail-unavailable">Os detalhes deste Pokémon estão indisponíveis.</p>
  const ribbonContent = ready ? <div className="pokemon-detail-data">
    {detail.ribbons.length ? <ul className="pokemon-detail-ribbons" aria-label="Ribbons">{detail.ribbons.map(ribbon => <li key={ribbon.ribbonId}><img src={`/resources/pokemon-card/ribbons/${ribbon.iconKey}.png`} alt="" aria-hidden="true" onError={event => { event.currentTarget.hidden = true }} /><span>{ribbon.label}</span></li>)}</ul> : <p className="pokemon-detail-no-ribbons">Nenhuma ribbon</p>}
  </div> : <p className="pokemon-detail-unavailable">Os detalhes deste Pokémon estão indisponíveis.</p>
  return <div className="pokemon-card-layer" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <article className={`pokemon-detail-card${ready ? '' : ' pokemon-detail-card-unavailable'}`} role="dialog" aria-label={ready ? `Detalhes de ${detail.identity.speciesLabel ?? `Pokémon ${species}`}` : 'Detalhes do Pokémon indisponíveis'} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      {ready &&
        <div className="pokemon-detail-identity">
          <div className="pokemon-detail-heading">
            <span className="pokemon-detail-dex">#{species}</span>
            <strong className="pokemon-detail-species" title={detail.identity.speciesLabel ?? ''}>{detail.identity.speciesLabel ?? `Pokémon ${species}`}{detail.identity.isEgg ? ' · Ovo' : ''}</strong>
            <span className="pokemon-detail-level" aria-label={`Nível ${value(detail.training.level)}`}><span aria-hidden="true">Nv.</span><span>{value(detail.training.level)}</span></span>
          </div>
          <div className="pokemon-detail-sprite-wrap">
            <div className="pokemon-detail-sprite-stage">
              <img className="pokemon-detail-sprite" src={spriteUrl({ nationalDex: species, shiny: detail.identity.shiny })} alt={`Pokémon número ${species}`} onError={event => { event.currentTarget.hidden = true }} />
              <div className="pokemon-detail-sprite-icons">
                <div className="pokemon-detail-sprite-flags">
                  {detail.identity.shiny && <span className="pokemon-detail-shiny" role="img" aria-label="Shiny">✦<small>✧</small></span>}
                  {gender === 'male' && <span className="pokemon-detail-gender male" role="img" aria-label="Macho">♂</span>}
                  {gender === 'female' && <span className="pokemon-detail-gender female" role="img" aria-label="Fêmea">♀</span>}
                </div>
                {ballIcon && <img className="pokemon-detail-ball" src={ballIcon} alt={detail.capture.ballLabel ?? `Pokébola #${detail.capture.ballId}`} onError={event => { event.currentTarget.hidden = true }} />}
              </div>
            </div>
          </div>
          <div className="pokemon-detail-origin-container">
            <dl className="pokemon-detail-origin">
              <div><dt>OT ID</dt><dd>{String(detail.origin.trainerId).padStart(5, '0')}</dd></div>
              <div><dt>OG</dt><dd>{detail.origin.metGameLabel ?? (detail.origin.metGameId ? `Game #${detail.origin.metGameId}` : 'Desconhecido')}</dd></div>
            </dl>
            <div className="pokemon-detail-held-item"><span>Item</span><strong>{detail.heldItem.itemId === 0 ? 'Sem item' : detail.heldItem.itemLabel ?? `Item #${detail.heldItem.itemId}`}</strong></div>
          </div>
        </div>}
      <div className="pokemon-detail-right">
        <Tabs className="pokemon-detail-tabs" defaultActiveKey="general" items={[{ key: 'general', label: 'Geral', children: generalContent }, { key: 'ribbons', label: 'Ribbon', children: ribbonContent }]} tabBarExtraContent={<Button ref={closeRef} className="pokemon-detail-close" type="text" danger icon={<CloseOutlined />} aria-label="Fechar card do Pokémon" onClick={onClose} />} />
      </div>
    </article>
  </div>
}

function PokemonEggDetailCard({ detail, onClose }) {
  const closeRef = useRef(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  const cycles = detail.incubation?.eggCyclesRemaining
  return <div className="pokemon-card-layer" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <article className="pokemon-detail-card pokemon-egg-card" role="dialog" aria-label="Detalhes do PokéOvo" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <div className="pokemon-detail-identity">
        <div className="pokemon-detail-heading pokemon-egg-heading">
          <strong>PokéOvo</strong>
          <Button ref={closeRef} className="pokemon-detail-close" type="text" danger icon={<CloseOutlined />} aria-label="Fechar card do PokéOvo" onClick={onClose} />
        </div>
        <div className="pokemon-detail-sprite-wrap">
          <div className="pokemon-detail-sprite-stage">
            <img className="pokemon-detail-sprite" src="/resources/pokemon/egg.png" alt="PokéOvo" onError={event => { event.currentTarget.hidden = true }} />
          </div>
        </div>
        <div className="pokemon-detail-origin-container">
          <dl className="pokemon-detail-origin">
            <div><dt>OT ID</dt><dd>{String(detail.origin.trainerId).padStart(5, '0')}</dd></div>
            <div><dt>OG</dt><dd>{detail.origin.metGameLabel ?? (detail.origin.metGameId ? `Game #${detail.origin.metGameId}` : 'Desconhecido')}</dd></div>
          </dl>
          <div className="pokemon-detail-held-item"><span>Passos restantes</span><strong title="Estimativa para Pokémon Emerald sem aceleração de eclosão">{Number.isInteger(cycles) ? `≈ ${((cycles + 1) * 255).toLocaleString('pt-BR')}` : 'Indisponível'}</strong></div>
        </div>
      </div>
    </article>
  </div>
}

function value(number) { return number ?? '—' }

function MoveTypeBadge({ type }) {
  if (!type) return null
  const icon = getGen3MoveTypeIconUrl(type)
  const label = type === 'mystery' ? '???' : type?.toUpperCase()
  return <span className="pokemon-detail-move-type">
    {icon && <img src={icon} alt={label} title={label} onError={event => { event.currentTarget.hidden = true; event.currentTarget.nextElementSibling.hidden = false }} />}
    {type && <span hidden={Boolean(icon)}>{label}</span>}
  </span>
}
