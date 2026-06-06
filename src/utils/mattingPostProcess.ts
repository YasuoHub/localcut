/**
 * Mask post-processing utilities:
 * - Gaussian blur (feathering)
 * - Dilate (expand)
 * - Erode (contract)
 */

export function gaussianBlurMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  if (radius <= 0) return new Uint8ClampedArray(mask)

  const result = new Uint8ClampedArray(mask.length)
  const kernel = build1DGaussianKernel(radius)

  // Horizontal pass
  const tmp = new Uint8ClampedArray(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      let weightSum = 0
      for (let k = -radius; k <= radius; k++) {
        const sx = x + k
        if (sx >= 0 && sx < width) {
          const w = kernel[Math.abs(k)]
          sum += mask[y * width + sx] * w
          weightSum += w
        }
      }
      tmp[y * width + x] = Math.round(sum / weightSum)
    }
  }

  // Vertical pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      let weightSum = 0
      for (let k = -radius; k <= radius; k++) {
        const sy = y + k
        if (sy >= 0 && sy < height) {
          const w = kernel[Math.abs(k)]
          sum += tmp[sy * width + x] * w
          weightSum += w
        }
      }
      result[y * width + x] = Math.round(sum / weightSum)
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
 * Dilate mask (expand white areas)
 * Uses a circular structuring element
 */
export function dilateMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  if (radius <= 0) return new Uint8ClampedArray(mask)

  const result = new Uint8ClampedArray(mask.length)
  const r2 = radius * radius

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxVal = 0
      for (let dy = -radius; dy <= radius; dy++) {
        const sy = y + dy
        if (sy < 0 || sy >= height) continue
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > r2) continue
          const sx = x + dx
          if (sx < 0 || sx >= width) continue
          maxVal = Math.max(maxVal, mask[sy * width + sx])
        }
      }
      result[y * width + x] = maxVal
    }
  }

  return result
}

/**
 * Erode mask (shrink white areas)
 * Uses a circular structuring element
 */
export function erodeMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  if (radius <= 0) return new Uint8ClampedArray(mask)

  const result = new Uint8ClampedArray(mask.length)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minVal = 255
      for (let dy = -radius; dy <= radius; dy++) {
        const sy = y + dy
        if (sy < 0 || sy >= height) continue
        for (let dx = -radius; dx <= radius; dx++) {
          const sx = x + dx
          if (sx < 0 || sx >= width) continue
          minVal = Math.min(minVal, mask[sy * width + sx])
        }
      }
      result[y * width + x] = minVal
    }
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
