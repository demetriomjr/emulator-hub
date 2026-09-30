import { test, expect } from '@playwright/test'
import { openWorkspace, closeWorkspace, addPane, pane } from './helpers.mjs'

test('abrir o Hub registra uma sessão antes de carregar perfis e mantém sua identidade ao mudar blocos', async ({ page }) => {
  const opened = []
  const replies = []
  page.on('response', response => {
    if (response.request().method() !== 'POST' || !new URL(response.url()).pathname.includes('/pokemon-hub/')) return
    replies.push(response.json().then(body => {
      if (response.ok() && typeof body.sessionId === 'string' && body.snapshot) opened.push(body)
    }).catch(() => {}))
  })

  await openWorkspace(page)
  await expect.poll(() => opened.length, { message: 'O backend deve registrar a sessão antes da seleção do primeiro perfil.' }).toBe(1)
  expect(opened[0].sessionId).toBeTruthy()
  expect(opened[0].snapshot.panes).toEqual([null, null, null])

  await addPane(page)
  await addPane(page)
  await expect(page.locator('.pokemon-workspace-pane')).toHaveCount(3)
  await pane(page, 2).getByRole('button', { name: 'Fechar container' }).click()
  await expect(page.locator('.pokemon-workspace-pane')).toHaveCount(2)
  await closeWorkspace(page)
  await Promise.all(replies)
  expect(opened).toHaveLength(1)

  await openWorkspace(page)
  await expect.poll(() => opened.length).toBe(2)
  expect(opened[1].sessionId).not.toBe(opened[0].sessionId)
  await closeWorkspace(page)
})

test('fechar enquanto a abertura aguarda resposta encerra a sessão assim que ela é registrada', async ({ page }) => {
 let release, registered
 const hold=new Promise(resolve=>{release=resolve})
 const backendOpened=new Promise(resolve=>{registered=resolve})
 await page.route('**/api/pokemon-hub/sessions',async route=>{
  const response=await route.fetch()
  registered(await response.json())
  await hold
  await route.fulfill({response})
 })
 try {
  await openWorkspace(page)
  const {sessionId}=await backendOpened
  await page.getByRole('button',{name:'Fechar Pokémon Hub'}).click()
  release()
  await expect.poll(async()=> (await (await fetch(`${process.env.E2E_API_URL}/api/pokemon-hub/sessions`)).json()).sessions.find(session=>session.sessionId===sessionId)?.closedAt,{timeout:5000}).toBeTruthy()
 } finally {release()}
})
