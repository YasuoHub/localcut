import type { ImageFormat } from '../types'

export const MB = 1024 * 1024

export const PERFORMANCE_LIMITS = {
  editor: {
    maxFilesPerImport: 20,
    maxFileBytes: 80 * MB,
    maxImportBytes: 400 * MB,
    maxLayers: 12,
    warnLayerPixels: 32_000_000,
    maxLayerPixels: 50_000_000,
    warnTotalLayerPixels: 80_000_000,
    maxTotalLayerPixels: 120_000_000,
  },
  export: {
    warnBatchItems: 80,
    maxBatchItems: 120,
    aiUpscaleWarnBatchItems: 20,
    aiUpscaleMaxBatchItems: 30,
    warnOutputPixelsPerItem: 32_000_000,
    maxOutputPixelsPerItem: 50_000_000,
    aiUpscaleMaxOutputPixelsPerItem: 24_000_000,
    warnTotalOutputPixels: 250_000_000,
    maxTotalOutputPixels: 500_000_000,
    zipWarningBytes: 250 * MB,
    zipHardLimitBytes: 600 * MB,
  },
  compression: {
    maxFiles: 50,
    maxFileBytes: 80 * MB,
    maxTotalSourceBytes: 600 * MB,
    maxCanvasPixels: 50_000_000,
    zipWarningBytes: 250 * MB,
    zipHardLimitBytes: 600 * MB,
  },
} as const

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

export function formatMegapixels(pixels: number) {
  if (!Number.isFinite(pixels) || pixels <= 0) return '0 MP'
  return `${(pixels / 1_000_000).toFixed(pixels >= 10_000_000 ? 0 : 1)} MP`
}

export function imagePixels(width: number, height: number) {
  return Math.max(0, Math.round(width) * Math.round(height))
}

export function estimateEncodedBytes(pixels: number, format: ImageFormat, quality: number) {
  const q = Math.max(1, Math.min(100, quality)) / 100
  const bytesPerPixel =
    format === 'png'
      ? 2.4
      : format === 'webp'
        ? 0.35 + q * 0.55
        : 0.45 + q * 0.85
  return Math.round(pixels * bytesPerPixel)
}
