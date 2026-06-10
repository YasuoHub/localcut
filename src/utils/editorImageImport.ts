import type { ImageLayer } from '../types'
import { PERFORMANCE_LIMITS, formatBytes, formatMegapixels, imagePixels } from '../constants/performanceLimits'

export interface EditorImportCheck {
  accepted: File[]
  rejected: string[]
  warnings: string[]
}

export function getEditorLayerPixels(layers: ImageLayer[]) {
  return layers.reduce((sum, layer) => {
    const width = layer.image.naturalWidth || layer.workingCanvas?.width || 0
    const height = layer.image.naturalHeight || layer.workingCanvas?.height || 0
    return sum + imagePixels(width, height)
  }, 0)
}

export function isSupportedEditorImageFile(file: File) {
  return Boolean(file.type.match(/^image\/(png|jpeg|webp)$/)) || /\.(png|jpe?g|webp)$/i.test(file.name)
}

export function validateEditorImageFiles(files: File[], currentLayerCount: number): EditorImportCheck {
  const limits = PERFORMANCE_LIMITS.editor
  const accepted: File[] = []
  const rejected: string[] = []
  const warnings: string[] = []
  const availableSlots = Math.max(0, limits.maxLayers - currentLayerCount)
  const perImportSlots = Math.min(limits.maxFilesPerImport, availableSlots)

  if (availableSlots <= 0) {
    return {
      accepted,
      rejected: [`当前画布最多保留 ${limits.maxLayers} 个图层。请先删除部分图层后再导入。`],
      warnings,
    }
  }

  let totalBytes = 0
  for (const file of files) {
    if (!isSupportedEditorImageFile(file)) {
      rejected.push(`${file.name}: 仅支持 PNG / JPG / WebP`)
      continue
    }
    if (file.size > limits.maxFileBytes) {
      rejected.push(`${file.name}: 超过单张文件 ${formatBytes(limits.maxFileBytes)} 上限`)
      continue
    }
    if (accepted.length >= perImportSlots) {
      rejected.push(`${file.name}: 超过本次可导入 ${perImportSlots} 张上限`)
      continue
    }
    if (totalBytes + file.size > limits.maxImportBytes) {
      rejected.push(`${file.name}: 本次导入文件总量超过 ${formatBytes(limits.maxImportBytes)}`)
      continue
    }
    accepted.push(file)
    totalBytes += file.size
  }

  if (accepted.length > 0 && accepted.length + currentLayerCount > 8) {
    warnings.push(`图层数将达到 ${accepted.length + currentLayerCount} 个；4K 图建议保持在 5-10 层以内。`)
  }

  return { accepted, rejected, warnings }
}

export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`${file.name}: 图片解码失败`))
    }
    img.src = url
  })
}

export function validateImageBeforeLayerAdd(
  img: HTMLImageElement,
  existingLayerPixels: number,
  name = '图片',
) {
  const limits = PERFORMANCE_LIMITS.editor
  const width = img.naturalWidth || img.width
  const height = img.naturalHeight || img.height
  const pixels = imagePixels(width, height)
  if (!width || !height) {
    return { ok: false, message: `${name}: 图片尺寸无效` }
  }
  if (pixels > limits.maxLayerPixels) {
    return {
      ok: false,
      message: `${name}: ${width}x${height} (${formatMegapixels(pixels)}) 超过单图层 ${formatMegapixels(limits.maxLayerPixels)} 上限`,
    }
  }
  if (existingLayerPixels + pixels > limits.maxTotalLayerPixels) {
    return {
      ok: false,
      message: `${name}: 导入后图层总像素将超过 ${formatMegapixels(limits.maxTotalLayerPixels)} 上限`,
    }
  }
  if (pixels > limits.warnLayerPixels || existingLayerPixels + pixels > limits.warnTotalLayerPixels) {
    return {
      ok: true,
      message: `${name}: 大图会增加画布、历史快照和导出内存压力，建议减少图层或拆批处理。`,
    }
  }
  return { ok: true, message: '' }
}

export function buildImportFeedback(rejected: string[], warnings: string[]) {
  const lines: string[] = []
  if (warnings.length > 0) lines.push(...warnings)
  if (rejected.length > 0) {
    lines.push('部分图片未导入：')
    lines.push(...rejected.slice(0, 8))
    if (rejected.length > 8) lines.push(`还有 ${rejected.length - 8} 项未显示。`)
  }
  return lines.join('\n')
}
