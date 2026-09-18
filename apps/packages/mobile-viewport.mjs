export function isNarrowPortraitViewport({ width, height }, maximumWidth = 680) {
  return Number.isFinite(width) && Number.isFinite(height) && width <= maximumWidth && height > width
}
