import { useEffect, useState } from 'react'
import { Button, Input, Modal } from 'antd'
import { getGames, getProfile, getProfiles, updateProfile } from '../../packages/hub-client.js'

export function ProfileEditor({ games, onCatalog, onSaved, onClose }) {
  const [catalog, setCatalog] = useState(games)
  const [catalogError, setCatalogError] = useState('')
  const [selectedGameId, setSelectedGameId] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [profilesError, setProfilesError] = useState('')
  const [selectedProfileId, setSelectedProfileId] = useState(null)
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [draftName, setDraftName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  useEffect(() => {
    let current = true
    getGames().then(currentGames => {
      if (!current) return
      setCatalog(currentGames)
      onCatalog(currentGames)
    }).catch(error => { if (current) setCatalogError(error.message) })
    return () => { current = false }
  }, [])

  useEffect(() => {
    if (!selectedGameId) return undefined
    let current = true
    setProfilesLoading(true)
    setProfilesError('')
    getProfiles(selectedGameId).then(result => {
      if (current) setProfiles(result)
    }).catch(error => { if (current) setProfilesError(error.message) })
      .finally(() => { if (current) setProfilesLoading(false) })
    return () => { current = false }
  }, [selectedGameId])

  useEffect(() => {
    if (!selectedGameId || !selectedProfileId) return undefined
    let current = true
    setProfileLoading(true)
    setProfileError('')
    getProfile(selectedGameId, selectedProfileId).then(result => {
      if (!current) return
      setProfile(result)
      setDraftName(result.name)
    }).catch(error => { if (current) setProfileError(error.message) })
      .finally(() => { if (current) setProfileLoading(false) })
    return () => { current = false }
  }, [selectedGameId, selectedProfileId])

  const selectedGame = catalog.find(game => game.id === selectedGameId)

  function selectGame(gameId) {
    if (saving || gameId === selectedGameId) return
    setSelectedGameId(gameId)
    setProfiles([])
    setSelectedProfileId(null)
    setProfile(null)
    setProfileError('')
    setDraftName('')
    setSaveMessage('')
  }

  function selectProfile(profileId) {
    if (saving || profileId === selectedProfileId) return
    setSelectedProfileId(profileId)
    setProfile(null)
    setProfileError('')
    setDraftName('')
    setSaveMessage('')
  }

  async function save(event) {
    event.preventDefault()
    if (!profile || saving) return
    setSaving(true)
    setProfileError('')
    setSaveMessage('')
    try {
      const updated = await updateProfile(selectedGameId, profile.id, draftName)
      setProfile(updated)
      setDraftName(updated.name)
      setProfiles(current => current.map(candidate => candidate.id === updated.id ? { ...candidate, ...updated } : candidate))
      onSaved(selectedGameId, updated)
      setSaveMessage('Perfil salvo.')
    } catch (error) {
      setProfileError(error.message)
    } finally {
      setSaving(false)
    }
  }

  return <Modal open centered width="min(1200px, calc(100vw - 32px))" title="Editar perfis" footer={null} onCancel={() => { if (!saving) onClose() }} destroyOnHidden className="global-profile-editor" aria-label="Editar perfis">
    <div className="global-profile-editor-columns">
      <section className="global-profile-editor-column" aria-label="Jogos">
        <h3>Jogos</h3>
        {catalogError && <p role="alert">{catalogError}</p>}
        {catalog.length === 0 && <p>Nenhum jogo disponível.</p>}
        <div className="global-profile-editor-games">
          {catalog.map(game => <button key={game.id} type="button" className={`global-profile-editor-game${selectedGameId === game.id ? ' is-selected' : ''}`} aria-pressed={selectedGameId === game.id} disabled={saving} onClick={() => selectGame(game.id)}>
            <span className="global-profile-editor-cover">{game.coverUrl ? <img src={game.coverUrl} alt="" /> : <span aria-hidden="true">{game.title.slice(0, 1)}</span>}</span>
            <span className="global-profile-editor-game-label"><strong>{game.title}</strong>{game.status !== 'ready' && <small>ROM indisponível</small>}</span>
          </button>)}
        </div>
      </section>
      <section className="global-profile-editor-column" aria-label="Perfis">
        <h3>Perfis{selectedGame ? ` · ${selectedGame.title}` : ''}</h3>
        {!selectedGameId && <p>Selecione um jogo.</p>}
        {profilesLoading && <p role="status">Carregando perfis...</p>}
        {profilesError && <p role="alert">{profilesError}</p>}
        {selectedGameId && !profilesLoading && !profilesError && profiles.length === 0 && <p>Nenhum perfil neste jogo.</p>}
        {profiles.map(candidate => <button key={candidate.id} type="button" className={`global-profile-editor-profile${selectedProfileId === candidate.id ? ' is-selected' : ''}`} aria-pressed={selectedProfileId === candidate.id} disabled={saving} onClick={() => selectProfile(candidate.id)}>{candidate.name}</button>)}
      </section>
      <section className="global-profile-editor-column" aria-label="Dados do perfil">
        <h3>Dados do perfil</h3>
        {!selectedProfileId && <p>Selecione um perfil.</p>}
        {profileLoading && <p role="status">Carregando dados...</p>}
        {profileError && <p role="alert">{profileError}</p>}
        {profile && !profileLoading && <form onSubmit={save}>
          <label htmlFor="global-profile-editor-name">Nome</label>
          <Input id="global-profile-editor-name" value={draftName} onChange={event => { setDraftName(event.target.value); setSaveMessage('') }} maxLength={32} required disabled={saving} autoFocus />
          <Button className="global-profile-editor-save" type="primary" htmlType="submit" loading={saving}>Salvar</Button>
          {saveMessage && <p className="global-profile-editor-saved" role="status">{saveMessage}</p>}
        </form>}
      </section>
    </div>
  </Modal>
}
