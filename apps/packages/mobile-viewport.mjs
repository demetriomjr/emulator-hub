export function isNarrowPortraitViewport({ width, height }, maximumWidth = 680) {
  return Number.isFinite(width) && Number.isFinite(height) && width <= maximumWidth && height > width
}

export function isMobileLandscapeViewport({ width, height }, maximumWidth = 900, maximumHeight = 500) {
  return Number.isFinite(width) && Number.isFinite(height) && width <= maximumWidth && height <= maximumHeight && width > height
}
