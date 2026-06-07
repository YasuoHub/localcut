import type { BatchOutputFitMode } from '../types'

export function fitCanvasToSize(
  source: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  mode: BatchOutputFitMode,
  fillColor: string,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')!

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  if (mode === 'stretch') {
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight)
    return canvas
  }

  if (mode === 'original') {
    return source
  }

  const sw = source.width
  const sh = source.height

  if (mode === 'cover') {
    const scale = Math.max(targetWidth / sw, targetHeight / sh)
    const dw = sw * scale
    const dh = sh * scale
    const dx = (targetWidth - dw) / 2
    const dy = (targetHeight - dh) / 2
    ctx.drawImage(source, dx, dy, dw, dh)
    return canvas
  }

  // contain
  ctx.fillStyle = fillColor
  ctx.fillRect(0, 0, targetWidth, targetHeight)
  const scale = Math.min(targetWidth / sw, targetHeight / sh)
  const dw = sw * scale
  const dh = sh * scale
  const dx = (targetWidth - dw) / 2
  const dy = (targetHeight - dh) / 2
  ctx.drawImage(source, dx, dy, dw, dh)
  return canvas
}
