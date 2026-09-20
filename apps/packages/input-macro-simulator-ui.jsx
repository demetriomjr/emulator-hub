import React, { useState } from 'react'
import { Button, InputNumber, Select } from 'antd'
import { ArrowDownOutlined, ArrowLeftOutlined, ArrowRightOutlined, ArrowUpOutlined, DeleteOutlined, HolderOutlined, PlusOutlined } from '@ant-design/icons'
import { ACTION_LABELS, ACTION_TYPES, AVAILABLE_INPUTS, InputType, addStep, reorderSteps, removeStep, updateStep } from './input-macro-simulator.mjs'

const INPUT_ICONS = {
  [InputType.UP]: <ArrowUpOutlined />,
  [InputType.DOWN]: <ArrowDownOutlined />,
  [InputType.LEFT]: <ArrowLeftOutlined />,
  [InputType.RIGHT]: <ArrowRightOutlined />,
  [InputType.A]: <strong>A</strong>,
  [InputType.B]: <strong>B</strong>,
  [InputType.L]: <strong>L</strong>,
  [InputType.R]: <strong>R</strong>,
}

export default function MacroEditor({ macro, onChange, onSave, error = '' }) {
  const [dragIndex, setDragIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)

  function appendStep() {
    onChange(addStep(macro, {}))
  }

  function handleReorder(fromIndex, toIndex) {
    let next = macro
    try {
      next = reorderSteps(macro, fromIndex, toIndex)
    } catch {
      return
    }
    onChange(next)
  }

  function handleUpdate(stepId, updates) {
    onChange(updateStep(macro, stepId, updates))
  }

  function handleRemove(stepId) {
    onChange(removeStep(macro, stepId))
  }

  function handleDrop() {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      handleReorder(dragIndex, dragOverIndex)
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }

  return <div className="macro-editor">
    {macro.steps.length === 0
      ? <p className="macro-empty">No steps yet. Add an input to start building your macro.</p>
      : <ul className="macro-step-list">
          {macro.steps.map((step, index) => <MacroStepRow
            key={step.id}
            step={step}
            index={index}
            dragging={dragIndex === index}
            dragOver={dragOverIndex === index}
            onDragStart={event => { setDragIndex(index); setDragOverIndex(index) }}
            onDragEnter={() => setDragOverIndex(index)}
            onDragEnd={handleDrop}
            onDragOver={event => event.preventDefault()}
            onDrop={event => { event.preventDefault(); handleDrop() }}
            onUpdate={handleUpdate}
            onRemove={handleRemove}
          />)}
        </ul>}
    <div className="macro-actions">
      <Button className="macro-add-step" icon={<PlusOutlined />} onClick={appendStep}>Add step</Button>
      <Button className="macro-save" type="primary" onClick={onSave}>Save macro</Button>
    </div>
    {error && <p className="macro-error" role="alert">{error}</p>}
  </div>
}

function MacroStepRow({ step, index, dragging, dragOver, onDragStart, onDragEnter, onDragEnd, onDragOver, onDrop, onUpdate, onRemove }) {
  return <li className={`macro-step${dragging ? ' dragging' : ''}${dragOver ? ' drag-over' : ''}`} draggable onDragStart={onDragStart} onDragEnter={onDragEnter} onDragEnd={onDragEnd} onDragOver={onDragOver} onDrop={onDrop}>
    <span className="macro-step-drag" aria-label="Reorder step"><HolderOutlined /></span>
    <span className="macro-step-index">{index + 1}</span>
    <StepField step={step} onChange={updates => onUpdate(step.id, updates)} />
    <Button className="macro-step-remove" aria-label={`Remove step ${index + 1}`} icon={<DeleteOutlined />} onClick={() => onRemove(step.id)} />
  </li>
}

function StepField({ step, onChange }) {
  const durationPlaceholder = step.action === 'repeat' ? 'Count' : step.action === 'hold' ? '0 = infinite' : ''
  return <div className="macro-step-fields">
    <Select className="macro-input-select" aria-label="Input" value={step.input} onChange={input => onChange({ input })} options={AVAILABLE_INPUTS.map(input => ({ value: input, label: INPUT_ICONS[input] }))} />
    <Select className="macro-action-select" aria-label="Action" value={step.action} onChange={action => {
      const next = { action }
      if (action === 'press' && step.duration !== 0) next.duration = undefined
      if (action === 'hold' && step.duration == null) next.duration = 0
      onChange(next)
    }} options={ACTION_TYPES.map(action => ({ value: action, label: ACTION_LABELS[action] }))} />
    {step.action !== 'press' && <span className="macro-step-duration"><InputNumber aria-label="Duration" min={step.action === 'repeat' ? 1 : 0} max={step.action === 'repeat' ? 100 : 30000} value={step.duration} placeholder={durationPlaceholder} onChange={duration => onChange({ duration })} /></span>}
    <span className="macro-step-delay"><InputNumber aria-label="Delay" min={0} max={10000} value={step.delay ?? 1000} placeholder="Delay (ms)" onChange={delay => onChange({ delay })} /></span>
  </div>
}