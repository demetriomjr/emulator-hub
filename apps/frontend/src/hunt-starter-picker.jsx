import { useLayoutEffect, useRef } from 'react'
import { hoennStarterChoices } from '../../packages/shiny-hunt-start-sequence.mjs'

export function HuntStarterPicker({ selectedPosition, onSelect, onClose }) {
  const dialogRef = useRef(null)
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    return () => dialog.close()
  }, [])

  function closePicker() {
    dialogRef.current.close()
    onClose()
  }

  return <dialog className="hunt-starter-picker" ref={dialogRef} aria-labelledby="hunt-starter-title" onCancel={event => { event.preventDefault(); closePicker() }}>
    <div className="profile-header">
      <h2 id="hunt-starter-title">Escolha seu inicial</h2>
      <button className="dialog-close" type="button" aria-label="Fechar escolha do inicial" onClick={closePicker}>×</button>
    </div>
    <div className="hunt-starter-options">
      {hoennStarterChoices.map(choice => <button
        className="hunt-starter-option"
        type="button"
        key={choice.value}
        aria-pressed={choice.value === selectedPosition}
        autoFocus={choice.value === (selectedPosition ?? 1)}
        onClick={() => { dialogRef.current.close(); onSelect(choice.value) }}
      >{choice.name}</button>)}
    </div>
  </dialog>
}
