/**
 * Unsharp Mask (USM) sharpening — Photoshop's classic sharpen algorithm.
 *
 * Process: blur = gaussianBlur(original)
 *          detail = original - blur
 *          sharpened = original + amount * detail   (per channel, RGB only)
 *
 * Uses separable Gaussian for O(2·radius·N) instead of O(radius²·N).
 */

function build1DGaussianKernel(radius: number): Float32Array {
  const sigma = radius / 3
  const kernel = new Float32Array(radius + 1)
  const denom = 2 * sigma * sigma
  for (let i = 0; i <= radius; i++) {
    kernel[i] = Math.exp(-(i * i) / denom)
  }
  return kernel
}

/** Separable Gaussian blur on RGB channels (alpha channel untouched). */
function gaussianBlurRGB(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  if (radius <= 0) return new Uint8ClampedArray(data)

  const size = width * height
  const kernel = build1DGaussianKernel(radius)
  const tmp = new Float32Array(size * 3) // planar: [R..., G..., B...]

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const rowBase = y * width
    for (let x = 0; x < width; x++) {
      let rSum = 0, gSum = 0, bSum = 0
      let wSum = 0
      const xMin = Math.max(0, x - radius)
      const xMax = Math.min(width - 1, x + radius)
      for (let sx = xMin; sx <= xMax; sx++) {
        const w = kernel[Math.abs(sx - x)]
        const idx = (rowBase + sx) * 4
        rSum += data[idx] * w
        gSum += data[idx + 1] * w
        bSum += data[idx + 2] * w
        wSum += w
      }
      const tIdx = y * width + x
      tmp[tIdx] = rSum / wSum
      tmp[size + tIdx] = gSum / wSum
      tmp[size * 2 + tIdx] = bSum / wSum
    }
  }

  // Vertical pass
  const result = new Uint8ClampedArray(data.length)
  for (let y = 0; y < height; y++) {
    const rowBase = y * width
    for (let x = 0; x < width; x++) {
      const idx = (rowBase + x) * 4
      let rSum = 0, gSum = 0, bSum = 0
      let wSum = 0
      const yMin = Math.max(0, y - radius)
      const yMax = Math.min(height - 1, y + radius)
      for (let sy = yMin; sy <= yMax; sy++) {
        const w = kernel[Math.abs(sy - y)]
        const tIdx = sy * width + x
        rSum += tmp[tIdx] * w
        gSum += tmp[size + tIdx] * w
        bSum += tmp[size * 2 + tIdx] * w
        wSum += w
      }
      result[idx] = Math.round(rSum / wSum)
      result[idx + 1] = Math.round(gSum / wSum)
      result[idx + 2] = Math.round(bSum / wSum)
      result[idx + 3] = data[idx + 3] // keep original alpha
    }
  }
  return result
}

const clamp = (v: number) => v < 0 ? 0 : v > 255 ? 255 : v

/**
 * Apply Unsharp Mask sharpening to an ImageData.
 *
 * @param imageData  Source RGBA ImageData
 * @param amount     Sharpening strength, 0 = none, 1.0 = standard, 2.0 = strong. Default 1.0
 * @param radius     Blur radius in pixels. Larger = affects broader edges. Default 2
 * @param threshold  Min brightness difference to apply sharpen (suppresses noise). Default 0
 * @returns          New sharpened ImageData (source is not mutated)
 */
export function unsharpMask(
  imageData: ImageData,
  amount: number = 1.0,
  radius: number = 2,
  threshold: number = 0,
): ImageData {
  if (amount <= 0 || radius <= 0) return new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  )

  const { data, width, height } = imageData
  const blurred = gaussianBlurRGB(data, width, height, Math.max(1, Math.round(radius)))

  const result = new Uint8ClampedArray(data.length)
  const t2 = threshold * threshold

  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - blurred[i]
    const dg = data[i + 1] - blurred[i + 1]
    const db = data[i + 2] - blurred[i + 2]

    // Skip pixels where difference is below threshold (avoids amplifying noise)
    result[i + 3] = data[i + 3] // alpha unchanged
    if (dr * dr + dg * dg + db * db < t2) {
      result[i] = data[i]
      result[i + 1] = data[i + 1]
      result[i + 2] = data[i + 2]
      continue
    }

    result[i] = clamp(data[i] + amount * dr)
    result[i + 1] = clamp(data[i + 1] + amount * dg)
    result[i + 2] = clamp(data[i + 2] + amount * db)
  }

  return new ImageData(result, width, height)
}
