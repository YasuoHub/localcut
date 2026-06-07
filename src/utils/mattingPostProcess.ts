/**
 * Mask post-processing utilities:
 * - Gaussian blur (feathering)
 * - Dilate (expand)
 * - Erode (contract)
 *
 * All functions accept an optional precomputed offset cache
 * so Worker-side callers can amortize neighborhood offsets across calls.
 */

// Shared cache for circular structuring-element offsets, keyed by radius.
const circularOffsetsCache = new Map<number, Int16Array>()

export function getCircularOffsets(radius: number): Int16Array {
  let offsets = circularOffsetsCache.get(radius)
  if (!offsets) {
    offsets = buildCircularOffsets(radius)
    circularOffsetsCache.set(radius, offsets)
  }
  return offsets
}

export function buildCircularOffsets(radius: number): Int16Array {
  const r2 = radius * radius
  // Count valid offsets first
  let count = 0
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) count++
    }
  }
  const offsets = new Int16Array(count * 2)
  let idx = 0
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) {
        offsets[idx++] = dx
        offsets[idx++] = dy
      }
    }
  }
  return offsets
}

export function gaussianBlurMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  if (radius <= 0) return new Uint8ClampedArray(mask)

  const result = new Uint8ClampedArray(mask.length)
  const kernel = build1DGaussianKernel(radius)
  const size = width * height

  // Horizontal pass
  const tmp = new Uint8ClampedArray(size)
  for (let y = 0; y < height; y++) {
    const rowBase = y * width
    for (let x = 0; x < width; x++) {
      let sum = 0
      let weightSum = 0
      const xMin = Math.max(0, x - radius)
      const xMax = Math.min(width - 1, x + radius)
      for (let sx = xMin; sx <= xMax; sx++) {
        const w = kernel[Math.abs(sx - x)]
        sum += mask[rowBase + sx] * w
        weightSum += w
      }
      tmp[rowBase + x] = Math.round(sum / weightSum)
    }
  }

  // Vertical pass
  for (let y = 0; y < height; y++) {
    const rowBase = y * width
    for (let x = 0; x < width; x++) {
      let sum = 0
      let weightSum = 0
      const yMin = Math.max(0, y - radius)
      const yMax = Math.min(height - 1, y + radius)
      for (let sy = yMin; sy <= yMax; sy++) {
        const w = kernel[Math.abs(sy - y)]
        sum += tmp[sy * width + x] * w
        weightSum += w
      }
      result[rowBase + x] = Math.round(sum / weightSum)
    }
  }

  return result
}

function build1DGaussianKernel(radius: number): Float32Array {
  const sigma = radius / 3
  const kernel = new Float32Array(radius + 1)
  const denom = 2 * sigma * sigma
  for (let i = 0; i <= radius; i++) {
    kernel[i] = Math.exp(-(i * i) / denom)
  }
  return kernel
}

/**
 * Dilate mask (expand white areas) using circular structuring element.
 * Accepts optional precomputed offset array to amortize across calls.
 */
export function dilateMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  offsets?: Int16Array,
): Uint8ClampedArray {
  if (radius <= 0) return new Uint8ClampedArray(mask)

  const result = new Uint8ClampedArray(mask.length)
  const off = offsets || getCircularOffsets(radius)
  const total = mask.length

  for (let i = 0; i < total; i++) {
    const x = i % width
    const y = (i / width) | 0
    let maxVal = 0
    for (let j = 0; j < off.length; j += 2) {
      const sx = x + off[j]
      const sy = y + off[j + 1]
      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        const val = mask[sy * width + sx]
        if (val > maxVal) maxVal = val
      }
    }
    result[i] = maxVal
  }

  return result
}

/**
 * Erode mask (shrink white areas) using circular structuring element.
 * Accepts optional precomputed offset array to amortize across calls.
 */
export function erodeMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  offsets?: Int16Array,
): Uint8ClampedArray {
  if (radius <= 0) return new Uint8ClampedArray(mask)

  const result = new Uint8ClampedArray(mask.length)
  const off = offsets || getCircularOffsets(radius)
  const total = mask.length

  for (let i = 0; i < total; i++) {
    const x = i % width
    const y = (i / width) | 0
    let minVal = 255
    for (let j = 0; j < off.length; j += 2) {
      const sx = x + off[j]
      const sy = y + off[j + 1]
      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        const val = mask[sy * width + sx]
        if (val < minVal) minVal = val
      }
    }
    result[i] = minVal
  }

  return result
}

/**
 * Apply all edge refinements in the correct order:
 * 1. Expand (dilate)
 * 2. Contract (erode)
 * 3. Feather (gaussian blur)
 */
export function applyEdgeRefinements(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  expand: number,
  contract: number,
  feather: number,
): Uint8ClampedArray {
  let result = mask

  if (expand > 0) {
    result = dilateMask(result, width, height, expand)
  }
  if (contract > 0) {
    result = erodeMask(result, width, height, contract)
  }

  if (feather > 0) {
    result = gaussianBlurMask(result, width, height, feather)
    // Re-threshold after blur to keep mask clean
    for (let i = 0; i < result.length; i++) {
      result[i] = result[i] > 128 ? 255 : (result[i] < 32 ? 0 : result[i])
    }
  }

  return result
}
