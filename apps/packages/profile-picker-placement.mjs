const MOBILE_BREAKPOINT = 680
const VIEWPORT_GUTTER = 16
const PROFILE_PANEL_WIDTH = 390
const PROFILE_PANEL_PREFERRED_HEIGHT = 408
const PROFILE_PICKER_GAP = 12

export function getProfilePickerPlacement(anchor, viewport) {
  if (!anchor || !viewport || viewport.width <= MOBILE_BREAKPOINT) return null

  const { left, top, bottom } = anchor
  const { width, height } = viewport
  if (![left, top, bottom, width, height].every(Number.isFinite)) return null

  const availableAbove = Math.max(0, top - VIEWPORT_GUTTER)
  const availableBelow = Math.max(0, height - bottom - VIEWPORT_GUTTER)
  const pickerLeft = clamp(left, VIEWPORT_GUTTER, Math.max(VIEWPORT_GUTTER, width - PROFILE_PANEL_WIDTH - VIEWPORT_GUTTER))

  if (availableBelow >= PROFILE_PANEL_PREFERRED_HEIGHT || availableBelow >= availableAbove) {
    return {
      left: pickerLeft,
      top: Math.max(VIEWPORT_GUTTER, bottom + PROFILE_PICKER_GAP),
      maxHeight: availableBelow,
    }
  }

  return {
    left: pickerLeft,
    bottom: Math.max(VIEWPORT_GUTTER, height - top + PROFILE_PICKER_GAP),
    maxHeight: availableAbove,
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}
