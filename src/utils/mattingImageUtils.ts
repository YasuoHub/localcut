const WORKING_MAX_DIM = 4096

export function clampDimensions(w: number, h: number, maxDim = WORKING_MAX_DIM) {
  const max = Math.max(w, h)
  if (max <= maxDim) return { w, h, scale: 1 }
  const scale = maxDim / max
  return { w: Math.round(w * scale), h: Math.round(h * scale), scale }
}

/**
 * 下采样 mask：最近邻插值（比取最大值快 ~25x，44.7MP → 11.2MP 约 40ms）。
 * Mask 值来自模型输出，边缘平滑，最近邻足够保留前景轮廓。
 */
export function downscaleMask(
  mask: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(dstW * dstH)
  const scaleX = srcW / dstW
  const scaleY = srcH / dstH

  for (let dy = 0; dy < dstH; dy++) {
    const sy = Math.floor(dy * scaleY)
    const srcRowBase = sy * srcW
    const dstRowBase = dy * dstW
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.floor(dx * scaleX)
      result[dstRowBase + dx] = mask[srcRowBase + sx]
    }
  }
  return result
}

/**
 * 上采样 mask：最近邻插值。
 */
export function upscaleMask(
  mask: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(dstW * dstH)
  const scaleX = srcW / dstW
  const scaleY = srcH / dstH

  for (let dy = 0; dy < dstH; dy++) {
    const sy = Math.floor(dy * scaleY)
    const srcRowBase = sy * srcW
    const dstRowBase = dy * dstW
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.floor(dx * scaleX)
      result[dstRowBase + dx] = mask[srcRowBase + sx]
    }
  }
  return result
}

/**
 * 合成透明结果图：原图 × mask → 透明 PNG。
 * maxDim 控制输出最大尺寸（默认 4096），传 Infinity 可输出全分辨率。
 */
export function compositeResult(
  sourceImage: HTMLImageElement,
  maskData: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
  maxDim = WORKING_MAX_DIM,
): HTMLCanvasElement {
  const { w, h } = clampDimensions(maskWidth, maskHeight, maxDim)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  ctx.drawImage(sourceImage, 0, 0, w, h)

  const imageData = ctx.getImageData(0, 0, w, h)
  const pixels = imageData.data

  if (w === maskWidth && h === maskHeight) {
    for (let i = 0; i < w * h; i++) {
      pixels[i * 4 + 3] = maskData[i]
    }
  } else {
    // Nearest-neighbour downscale inline: avoids separate mask allocation + full pass
    const scaleX = maskWidth / w
    const scaleY = maskHeight / h
    for (let dy = 0; dy < h; dy++) {
      const sy = Math.floor(dy * scaleY)
      const srcRowBase = sy * maskWidth
      const dstRowBase = dy * w
      for (let dx = 0; dx < w; dx++) {
        const sx = Math.floor(dx * scaleX)
        pixels[(dstRowBase + dx) * 4 + 3] = maskData[srcRowBase + sx]
      }
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}
