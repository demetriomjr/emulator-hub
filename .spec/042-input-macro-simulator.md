# Input Macro Simulator Specification

## Overview
A frontend-only input macro simulator package for creating and editing macro sequences. The backend only persists the macro data.

## Package Location
`apps/packages/input-macro-simulator.mjs` (and associated test file)

## Data Model

### MacroStep
```typescript
type InputType =
  | 'up' | 'down' | 'left' | 'right'  // Directions
  | 'a' | 'b' | 'l' | 'r';            // Buttons

type ActionType = 'press' | 'repeat' | 'hold';

interface MacroStep {
  id: string;                    // Unique identifier (UUID)
  input: InputType;              // The input to simulate
  action: ActionType;            // How to execute the input
  duration?: number;             // For 'hold': 0 = infinite, otherwise ms (100-30000). For 'repeat': count (1-100). For 'press': 0 = infinite hold, omitted = short tap.
  delay?: number;                // Delay before next step (ms), default 0
}
```

### Macro
```typescript
interface InputMacro {
  id: string;                    // Unique identifier
  name: string;                  // User-defined name
  steps: MacroStep[];            // Ordered list of steps
  createdAt: number;             // Timestamp
  updatedAt: number;             // Timestamp
}
```

## Available Inputs (Constant)
```typescript
const AVAILABLE_INPUTS: InputType[] = [
  'up', 'down', 'left', 'right',
  'a', 'b', 'l', 'r'
];

const INPUT_LABELS: Record<InputType, string> = {
  up: '↑ Up', down: '↓ Down', left: '← Left', right: '→ Right',
  a: 'A', b: 'B', l: 'L', r: 'R'
};

const ACTION_TYPES: ActionType[] = ['press', 'repeat', 'hold'];

const ACTION_LABELS: Record<ActionType, string> = {
  press: 'Press Once',
  repeat: 'Repeat',
  hold: 'Hold'
};
```

## Package API

### Core Functions

#### `createMacro(name: string): InputMacro`
Creates a new empty macro with the given name.

#### `addStep(macro: InputMacro, step: Omit<MacroStep, 'id'>, index?: number): InputMacro`
Adds a step to the macro at the specified index (or end if not provided). Returns new macro instance.

#### `removeStep(macro: InputMacro, stepId: string): InputMacro`
Removes a step by ID. Returns new macro instance.

#### `updateStep(macro: InputMacro, stepId: string, updates: Partial<Omit<MacroStep, 'id'>>): InputMacro`
Updates a step's properties. Returns new macro instance.

#### `reorderSteps(macro: InputMacro, fromIndex: number, toIndex: number): InputMacro`
Moves a step from one position to another. Returns new macro instance.

#### `validateMacro(macro: InputMacro): { valid: boolean; errors: string[] }`
Validates macro structure and step constraints.

### React Components (Frontend Only)

#### `MacroEditor({ macro, onChange, availableInputs, onSave })`
Main editor component showing the step list with add/remove/reorder controls.

#### `StepEditor({ step, availableInputs, onUpdate, onRemove })`
Inline editor for a single step showing:
- Input selector (dropdown with icons/labels)
- Action type selector (press/repeat/hold)
- Duration input (for hold/repeat)
- Delay input
- Remove button

#### `MacroStepList({ steps, onReorder, onUpdate, onRemove })`
Draggable/sortable list of steps using native HTML5 drag-and-drop.

#### `AddStepButton({ onAdd, availableInputs })`
Button to append a new step with default values.

### Macro Runner (Timeline Builder)

`buildMacroTimeline(macro, options): MacroEvent[]` converts a macro's ordered steps into a flat list of timed input events.

```typescript
interface MacroEvent {
  at: number;        // Milliseconds from the start of the macro run
  input: InputType;  // Logical input, e.g. 'up' or 'a'
  value: 0 | 1;      // Pressed (1) or released (0)
}

interface MacroTimelineOptions {
  pressDurationMs?: number;   // Default 60
  repeatIntervalMs?: number;  // Default 120
}
```

Per action:
- `press`: value 1 at `t`; value 0 at `t + pressDurationMs`
  (or `t + duration` when `duration` is a positive number).
- `press` with `duration: 0`: value 1 at `t`, held forever — released only by
  `emulator-hub:macro-stop` or the next macro run.
- `repeat` (count `n`): `n` presses, one every `repeatIntervalMs`.
- `hold`: value 1 at `t`, value 0 at `t + duration`.
- `hold` with `duration: 0`: value 1 at `t`, held forever — released only by
  `emulator-hub:macro-stop` or the next macro run.
- `delay`: shifts the start of the following step forward.

The player frame maps each `InputType` to the EmulatorJS core input id
(`up=4, down=5, left=6, right=7, a=8, b=0, l=10, r=11`) and dispatches the
timeline through `gameManager.simulateInput`.

### Execution Contract (Player Frame)

The hub posts to each running player frame:

```typescript
type RunMacroMessage = {
  type: 'emulator-hub:macro-run';
  steps: MacroStep[];
};

type StopMacroMessage = {
  type: 'emulator-hub:macro-stop';
};
```

The player frame builds the timeline and plays it against the running core.
Only one macro executes at a time per frame; a new run cancels the previous
one, and `emulator-hub:macro-stop` cancels the active run and releases all
buttons currently held by it.

### Run Button Placement (Saved Macros Modal)

The macro button lives in the running emulator frame's header
(`.player-header` in `apps/frontend/src/main.jsx`), immediately next to the
global reset button inside `.fast-forward-control`. It opens a modal listing
the hub's saved macros. Each saved macro row shows its name and a play/stop
state button. Playing a macro runs it against the running emulator frame(s);
stop cancels the active run. Below the list sits an
`add macro` button that opens the frontend macro editor to create and save a
new macro. The list is loaded from the backend API.

### Persistence Contract (Backend API)

The saved macros list is managed by the backend. The backend implements:

```typescript
interface MacroStore {
  list(): Promise<InputMacro[]>;
  save(macro: InputMacro): Promise<InputMacro>;
  delete(id: string): Promise<InputMacro>;
}
```

HTTP routes:

- `GET /api/macros` -> `200 { macros: InputMacro[] }`
- `POST /api/macros` -> `200 { macro: InputMacro }` (create or replace by id)
- `DELETE /api/macros/:id` -> `200 { macro: InputMacro }`

Invalid macro bodies return `400`; a missing macro on delete returns `404`.

## UI/UX Requirements

### Visual Design
- Dark green theme consistent with existing hub
- Minimal list view showing only available options
- Each step row: input icon + label, action badge, duration/delay, drag handle, remove button
- Inline editing on click
- Drag handle for reordering (☰ or ⋮⋮)

### Interactions
1. **Add Step**: Click "Add Step" → appends new step with defaults (first input, 'press', no duration)
2. **Edit Step**: Click step row → expands inline editor
3. **Reorder**: Drag drag-handle to reorder
4. **Remove**: Click remove button → immediate removal with undo toast
4. **Save**: Click save → calls backend persistence

### Step Defaults
```typescript
const DEFAULT_STEP: Omit<MacroStep, 'id'> = {
  input: 'a',
  action: 'press',
  delay: 0
};
```

## Constraints & Validation

1. Maximum 100 steps per macro
2. Duration for 'hold': 0 (infinite) or 100ms - 30000ms
3. Duration for 'repeat': 1 - 100 (repetition count)
4. Duration for 'press': 0 (infinite hold) or omitted (default short tap)
5. Delay: 0 - 10000ms
6. Macro name: 1-50 characters, required
7. At least 1 step required for valid macro

## Testing Requirements

- Unit tests for all core functions (immutability, validation)
- Component tests for editor interactions
- Integration test for full create-edit-save flow
- Edge cases: empty macro, max steps, invalid durations

## Implementation Order

1. Create package with types and core functions
2. Add validation logic
3. Build React components (StepEditor, MacroStepList, MacroEditor)
4. Add drag-and-drop reordering
5. Write tests
6. Export from package index
7. Add `buildMacroTimeline` runner and tests
8. Add `input-macro-store.mjs` (JSON file + Redis persistence)
9. Add `/api/macros` routes to `apps/backend/server.mjs` and tests
10. Add `listMacros`/`saveMacro`/`deleteMacro` to `apps/packages/hub-client.js`
11. Handle `emulator-hub:macro-run`/`macro-stop` in `apps/frontend/src/player.js`
12. Add macro button and saved macros modal to `.player-header` in `apps/frontend/src/main.jsx`
