import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const frontend = new URL('./', import.meta.url)

test('shows the provided Pokemon Hub image on its catalog card', async () => {
  const source = await readFile(new URL('./src/main.jsx', frontend), 'utf8')

  assert.match(source, /<img className="cover-image" src="\/pokemon-hub-icon\.png" alt="Pokémon Hub" \/>/)
  assert.doesNotMatch(source, /<div className="title"><small>Pokémon Hub<\/small><\/div>/)
  await access(new URL('./public/pokemon-hub-icon.png', frontend))
})
