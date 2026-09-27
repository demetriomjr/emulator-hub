import React from 'react'
import { Button, InputNumber, Select } from 'antd'
import { ArrowDownOutlined, ArrowLeftOutlined, ArrowRightOutlined, ArrowUpOutlined, ClockCircleOutlined, DeleteOutlined, HolderOutlined, RedoOutlined } from '@ant-design/icons'
import { DragDropProvider, useDraggable, useDroppable } from '@dnd-kit/react'
import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom'
import { AVAILABLE_INPUTS, InputType, MAX_ITEMS, addItem, removeItem, reorderItems, updateItem, validateMacro } from './input-macro-simulator.mjs'

const sensors = [PointerSensor.configure({ activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })] })]
const icons = {
  [InputType.UP]: <ArrowUpOutlined />, [InputType.DOWN]: <ArrowDownOutlined />,
  [InputType.LEFT]: <ArrowLeftOutlined />, [InputType.RIGHT]: <ArrowRightOutlined />,
  [InputType.A]: <strong>A</strong>, [InputType.B]: <strong>B</strong>,
  [InputType.L]: <strong>L</strong>, [InputType.R]: <strong>R</strong>,
}

export function ControllerIcon() {
  return <svg viewBox="0 0 24 24" className="control-configuration-icon" aria-hidden="true">
    <path d="M7.1 8.5h9.8c1.5 0 2.8 1 3.2 2.45l1.08 4.15a2.35 2.35 0 0 1-4.08 2.1l-1.55-1.7H8.4l-1.55 1.7a2.35 2.35 0 0 1-4.08-2.1l1.08-4.15A3.3 3.3 0 0 1 7.1 8.5Z" />
    <path d="M7.3 11.15v3.1M5.75 12.7h3.1M16.35 11.8h.01M18.25 13.65h.01" />
  </svg>
}

export default function MacroEditor({ macro, onChange, onSave, onCancel, onStart, onStop, runPhase = 'idle', disabled = false, error = '', warnings = [] }) {
  const change = (id, updates) => onChange(updateItem(macro, id, updates))
  const reorder = (from, to) => { if (from !== to) onChange(reorderItems(macro, from, to)) }
  const busy = disabled || runPhase === 'preparing' || runPhase === 'starting' || runPhase === 'stopping'
  const itemErrors = validateMacro(macro).errors
  return <div className="macro-editor">
    {macro.items.length === 0 && <p className="macro-empty">Adicione um item para criar a macro.</p>}
    <DragDropProvider sensors={sensors} onDragEnd={event => {
      const from = event.operation.source?.data?.index
      const to = event.operation.target?.data?.index
      if (Number.isInteger(from) && Number.isInteger(to)) reorder(from, to)
    }}>
      <ul className="macro-step-list">
        {macro.items.map((item, index) => <MacroItemRow key={item.id} item={item} index={index} count={macro.items.length} disabled={disabled} errors={itemErrors.filter(message => message.startsWith(`Item ${index + 1}:`))}
          onChange={updates => change(item.id, updates)} onRemove={() => onChange(removeItem(macro, item.id))}
          onMove={direction => reorder(index, index + direction)} />)}
      </ul>
    </DragDropProvider>
    <div className="macro-add-items" aria-label="Adicionar item">
      <Button className="macro-add-item" icon={<ControllerIcon />} aria-label="Adicionar botão" title="Adicionar botão" disabled={disabled || macro.items.length >= MAX_ITEMS} onClick={() => onChange(addItem(macro, 'button'))} />
      <Button className="macro-add-item" icon={<ClockCircleOutlined />} aria-label="Adicionar delay" title="Adicionar delay" disabled={disabled || macro.items.length >= MAX_ITEMS} onClick={() => onChange(addItem(macro, 'delay'))} />
      <Button className="macro-add-item" icon={<RedoOutlined />} aria-label="Adicionar repeat" title="Adicionar repeat" disabled={disabled || macro.items.length >= MAX_ITEMS} onClick={() => onChange(addItem(macro, 'repeat'))} />
    </div>
    {warnings.map((warning, index) => <p className="macro-warning" key={index}>{warning}</p>)}
    {error && <p className="macro-error" role="alert">{error}</p>}
    <div className="macro-actions">
      <Button className="macro-save" onClick={onSave} disabled={busy}>Salvar</Button>
      <Button className="macro-cancel" htmlType="button" onClick={onCancel} disabled={disabled}>Cancelar</Button>
      <Button className={`macro-run-toggle${runPhase === 'running' || runPhase === 'stopping' ? ' is-running' : ''}`} type="primary"
        disabled={busy} onClick={runPhase === 'running' ? onStop : onStart}>
        {['preparing', 'starting'].includes(runPhase) ? 'Iniciando…' : runPhase === 'stopping' ? 'Parando…' : runPhase === 'running' ? 'Parar' : 'Iniciar'}
      </Button>
    </div>
  </div>
}

function MacroItemRow({ item, index, count, disabled, errors, onChange, onRemove, onMove }) {
  const drag = useDraggable({ id: item.id, data: { index }, disabled })
  const drop = useDroppable({ id: item.id, data: { index } })
  const rowClass = `macro-step${drag.isDragging ? ' dragging' : ''}${drop.isDropTarget ? ' drag-over' : ''}`
  return <li ref={drop.ref} className={rowClass}>
    <button ref={drag.ref} type="button" className="macro-step-drag" aria-label={`Mover item ${index + 1}`} title="Arraste ou use as setas" disabled={disabled}
      onKeyDown={event => {
        if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); onMove(-1) }
        if (event.key === 'ArrowDown' && index < count - 1) { event.preventDefault(); onMove(1) }
      }}><HolderOutlined /></button>
    <span className="macro-step-index">{index + 1}</span>
    <div className={`macro-step-fields macro-step-fields-${item.kind}`}>
      {item.kind === 'button' || item.kind === 'legacy' ? <>
        <label>Botão <Select aria-label={`Botão do item ${index + 1}`} value={item.input} disabled={disabled} onChange={input => onChange({ input })}
          options={AVAILABLE_INPUTS.map(input => ({ value: input, label: icons[input] }))} /></label>
        <label>Evento <Select aria-label={`Evento do item ${index + 1}`} value={item.kind === 'legacy' ? undefined : item.action} placeholder="Escolha" disabled={disabled}
          onChange={action => onChange({ action })} options={[{ value: 'press', label: 'Press' }, { value: 'hold', label: 'Hold' }]} /></label>
        {item.kind === 'legacy' && <span className="macro-error">Valor antigo: {item.legacyDuration ?? 'sem duração'}. Escolha Press ou Hold.</span>}
        {item.kind !== 'legacy' && <label>{item.action === 'press' ? 'Vezes' : 'Segurar (ms)'}
          <InputNumber min={0} max={item.action === 'hold' ? 600000 : undefined} precision={0} value={item.action === 'press' ? item.count : item.holdMs} disabled={disabled}
            title={item.action === 'hold' ? '0 mantém pressionado até terminar ou parar a macro' : '0 repete infinitamente até parar a macro'}
            onChange={value => onChange(item.action === 'press' ? { count: value } : { holdMs: value })} /></label>}
        {!(item.action === 'press' && item.count === 0) && <label>Delay depois (ms) <InputNumber min={0} max={600000} precision={0} value={item.delayAfterMs} disabled={disabled} onChange={delayAfterMs => onChange({ delayAfterMs })} /></label>}
      </> : item.kind === 'delay' ? <label>Delay (ms) <InputNumber min={0} max={600000} precision={0} value={item.durationMs} disabled={disabled} onChange={durationMs => onChange({ durationMs })} /></label>
        : <label>Repeat (vezes; 0 = infinito) <InputNumber min={0} precision={0} value={item.count} disabled={disabled} onChange={value => onChange({ count: value })} /></label>}
    </div>
    <Button className="macro-step-remove" aria-label={`Excluir item ${index + 1}`} icon={<DeleteOutlined />} disabled={disabled} onClick={onRemove} />
    {errors.length > 0 && <span className="macro-item-error" role="alert">{errors[0]}</span>}
  </li>
}
