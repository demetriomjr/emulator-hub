const REGIONS = new Set(['alola', 'galar', 'hisui', 'paldea'])
const REGIONAL_VARIANTS = new Map([
  ['paldea', new Set(['combat-breed', 'blaze-breed', 'aqua-breed'])],
])

function assertNationalDex(nationalDex) {
  if (!Number.isInteger(nationalDex) || nationalDex < 1) {
    throw new TypeError('National Pokédex number must be a positive integer')
  }
}

function normalizeRegion(region) {
  if (region == null) return null
  if (typeof region !== 'string' || !REGIONS.has(region)) {
    throw new TypeError('Unsupported region')
  }
  return region
}

function normalizeVariant(region, variant) {
  if (variant == null) return null
  if (typeof variant !== 'string' || !REGIONAL_VARIANTS.get(region)?.has(variant)) {
    throw new TypeError('Unsupported regional variant')
  }
  return variant
}

function regionalForm(name) {
  if (typeof name !== 'string') return null
  for (const region of REGIONS) {
    const marker = `-${region}`
    const index = name.lastIndexOf(marker)
    if (index < 1) continue
    const beforeRegion = name.slice(0, index)
    const afterRegion = name.slice(index + marker.length)
    if (afterRegion === '' && !beforeRegion.endsWith('-totem')) return { region, variant: null }
    if (region === 'galar' && afterRegion === '-standard') return { region, variant: null }
    const variant = afterRegion.startsWith('-') ? afterRegion.slice(1) : null
    if (REGIONAL_VARIANTS.get(region)?.has(variant)) return { region, variant }
  }
  return null
}

function filenames(nationalDex, region, variant = null) {
  const stem = region ? `${nationalDex}-${region}${variant ? `-${variant}` : ''}` : String(nationalDex)
  return { normalFile: `${stem}.png`, shinyFile: `${stem}-shiny.png` }
}

export function selectPokemonResources(records) {
  if (!Array.isArray(records)) throw new TypeError('Pokemon records must be an array')

  const selected = []
  const usedFiles = new Set()

  for (const record of records) {
    const form = regionalForm(record?.name)
    if (!record?.isDefault && !form) continue
    const region = form?.region ?? null
    const variant = form?.variant ?? null

    assertNationalDex(record?.speciesId)
    if (!Number.isInteger(record?.sourceId) || record.sourceId < 1) {
      throw new TypeError('Source identifier must be a positive integer')
    }
    if (!record?.images?.normal || !record?.images?.shiny) {
      throw new TypeError(`Eligible Pokémon ${record.name} is missing normal or shiny artwork`)
    }

    const { normalFile, shinyFile } = filenames(record.speciesId, region, variant)
    for (const filename of [normalFile, shinyFile]) {
      if (usedFiles.has(filename)) throw new Error(`Duplicate local resource filename: ${filename}`)
      usedFiles.add(filename)
    }

    selected.push({
      nationalDex: record.speciesId,
      region,
      variant,
      sourceId: record.sourceId,
      normalFile,
      shinyFile,
      images: record.images,
    })
  }

  return selected.sort((left, right) => left.nationalDex - right.nationalDex || (left.region ?? '').localeCompare(right.region ?? '') || (left.variant ?? '').localeCompare(right.variant ?? ''))
}

export function spriteUrl({ nationalDex, region = null, variant = null, shiny = false } = {}) {
  assertNationalDex(nationalDex)
  const normalizedRegion = normalizeRegion(region)
  const normalizedVariant = normalizeVariant(normalizedRegion, variant)
  if (typeof shiny !== 'boolean') throw new TypeError('Shiny flag must be a boolean')
  const { normalFile, shinyFile } = filenames(nationalDex, normalizedRegion, normalizedVariant)
  return `/resources/pokemon/${shiny ? shinyFile : normalFile}`
}
