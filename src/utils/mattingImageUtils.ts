/**
 * 将原始尺寸图片转为 ImageData（用于发送到 Worker）
 */
export function imageToImageData(image: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, 0, 0)
  return ctx.getImageData(0, 0, image.naturalWidth, image.naturalHeight)
}

/**
 * 合成透明结果图：原图 × mask → 透明 PNG
 */
export function compositeResult(
  sourceImage: HTMLImageElement,
  maskData: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = maskWidth
  canvas.height = maskHeight
  const ctx = canvas.getContext('2d')!

  // 绘制原图
  ctx.drawImage(sourceImage, 0, 0, maskWidth, maskHeight)
  const imageData = ctx.getImageData(0, 0, maskWidth, maskHeight)
  const pixels = imageData.data

  // 将 mask 作为 alpha 通道
  for (let i = 0; i < maskWidth * maskHeight; i++) {
    pixels[i * 4 + 3] = maskData[i]
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}
