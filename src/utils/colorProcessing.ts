import type { ColorProcessAction, ColorProcessRect } from '../types'

export interface ColorProcessOptions {
  sourceColor: string
  targetColor: string
  tolerance: number
  feather: number
  action: ColorProcessAction
  contiguous: boolean
  removeFringe: boolean
  despeckle: boolean
  rect: ColorProcessRect
  seed?: { x: number; y: number } | null
}

export interface ColorProcessMaskResult {
  mask: Uint8ClampedArray
  count: number
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export function normalizeRect(rect: ColorProcessRect, width: number, height: number): ColorProcessRect {
  const x = clamp(Math.floor(rect.x), 0, width)
  const y = clamp(Math.floor(rect.y), 0, height)
  const right = clamp(Math.ceil(rect.x + rect.width), 0, width)
  const bottom = clamp(Math.ceil(rect.y + rect.height), 0, height)
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  }
}

export function hexToRgb(hex: string) {
  const clean = hex.replace('#', '').trim()
  if (!/^[\da-f]{6}$/i.test(clean)) return { r: 255, g: 255, b: 255 }
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

export function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`
}

function colorDistance(data: Uint8ClampedArray, index: number, color: { r: number; g: number; b: number }) {
  const dr = data[index] - color.r
  const dg = data[index + 1] - color.g
  const db = data[index + 2] - color.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function buildBaseMask(imageData: ImageData, options: ColorProcessOptions): Uint8ClampedArray {
  const { width, height, data } = imageData
  const rect = normalizeRect(options.rect, width, height)
  const mask = new Uint8ClampedArray(width * height)
  if (rect.width === 0 || rect.height === 0) return mask

  const source = hexToRgb(options.sourceColor)
  const tolerance = clamp(options.tolerance, 0, 442)

  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const p = y * width + x
      const i = p * 4
      if (data[i + 3] === 0) continue
      if (colorDistance(data, i, source) <= tolerance) mask[p] = 255
    }
  }

  if (!options.contiguous) return mask

  const seed = options.seed && options.seed.x >= rect.x && options.seed.x < rect.x + rect.width && options.seed.y >= rect.y && options.seed.y < rect.y + rect.height
    ? { x: Math.round(options.seed.x), y: Math.round(options.seed.y) }
    : findFirstMaskPixel(mask, width, rect)
  if (!seed) return new Uint8ClampedArray(width * height)

  const seedIndex = seed.y * width + seed.x
  if (!mask[seedIndex]) return new Uint8ClampedArray(width * height)

  const connected = new Uint8ClampedArray(width * height)
  const queue = new Int32Array(rect.width * rect.height)
  let head = 0
  let tail = 0
  queue[tail++] = seedIndex
  connected[seedIndex] = 255

  while (head < tail) {
    const p = queue[head++]
    const x = p % width
    const y = Math.floor(p / width)
    const neighbors = [p - 1, p + 1, p - width, p + width]
    for (const n of neighbors) {
      const nx = n % width
      const ny = Math.floor(n / width)
      if (nx < rect.x || nx >= rect.x + rect.width || ny < rect.y || ny >= rect.y + rect.height) continue
      if ((Math.abs(nx - x) + Math.abs(ny - y)) !== 1) continue
      if (!mask[n] || connected[n]) continue
      connected[n] = 255
      queue[tail++] = n
    }
  }

  return connected
}

function findFirstMaskPixel(mask: Uint8ClampedArray, width: number, rect: ColorProcessRect) {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (mask[y * width + x]) return { x, y }
    }
  }
  return null
}

function despeckleMask(mask: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x
      let count = 0
      for (let yy = -1; yy <= 1; yy++) {
        for (let xx = -1; xx <= 1; xx++) {
          if (xx === 0 && yy === 0) continue
          if (mask[(y + yy) * width + x + xx]) count++
        }
      }
      if (mask[p] && count <= 1) out[p] = 0
      else if (!mask[p] && count >= 7) out[p] = 255
    }
  }
  return out
}

function featherMask(mask: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  const r = Math.round(clamp(radius, 0, 12))
  if (r <= 0) return mask

  const temp = new Uint8ClampedArray(width * height)
  const out = new Uint8ClampedArray(width * height)

  for (let y = 0; y < height; y++) {
    let sum = 0
    for (let x = -r; x <= r; x++) {
      const cx = clamp(x, 0, width - 1)
      sum += mask[y * width + cx]
    }
    for (let x = 0; x < width; x++) {
      temp[y * width + x] = Math.round(sum / (r * 2 + 1))
      const removeX = clamp(x - r, 0, width - 1)
      const addX = clamp(x + r + 1, 0, width - 1)
      sum += mask[y * width + addX] - mask[y * width + removeX]
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) {
      const cy = clamp(y, 0, height - 1)
      sum += temp[cy * width + x]
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = Math.round(sum / (r * 2 + 1))
      const removeY = clamp(y - r, 0, height - 1)
      const addY = clamp(y + r + 1, 0, height - 1)
      sum += temp[addY * width + x] - temp[removeY * width + x]
    }
  }

  return out
}

export function buildColorProcessMask(imageData: ImageData, options: ColorProcessOptions): ColorProcessMaskResult {
  let mask = buildBaseMask(imageData, options)
  if (options.despeckle) mask = despeckleMask(mask, imageData.width, imageData.height)
  mask = featherMask(mask, imageData.width, imageData.height, options.feather)
  let count = 0
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 0) count++
  }
  return { mask, count }
}

export function applyColorProcess(imageData: ImageData, mask: Uint8ClampedArray, options: ColorProcessOptions): ImageData {
  const out = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
  const data = out.data
  const source = hexToRgb(options.sourceColor)
  const target = hexToRgb(options.targetColor)

  for (let p = 0; p < mask.length; p++) {
    const amount = mask[p] / 255
    if (amount <= 0) continue
    const i = p * 4
    if (options.action === 'transparent') {
      data[i + 3] = Math.round(data[i + 3] * (1 - amount))
      if (options.removeFringe && amount > 0.15) {
        data[i] = Math.round(data[i] + (data[i] - source.r) * amount * 0.35)
        data[i + 1] = Math.round(data[i + 1] + (data[i + 1] - source.g) * amount * 0.35)
        data[i + 2] = Math.round(data[i + 2] + (data[i + 2] - source.b) * amount * 0.35)
      }
    } else {
      data[i] = Math.round(data[i] * (1 - amount) + target.r * amount)
      data[i + 1] = Math.round(data[i + 1] * (1 - amount) + target.g * amount)
      data[i + 2] = Math.round(data[i + 2] * (1 - amount) + target.b * amount)
      data[i + 3] = Math.max(data[i + 3], Math.round(255 * amount))
    }
  }

  return out
}
