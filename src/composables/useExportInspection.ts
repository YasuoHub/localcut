import type {
  BatchOutputFitMode,
  CropRegion,
  ExportInspectionCheckKey,
  ExportInspectionIssue,
  ExportInspectionResult,
  ExportInspectionSettings,
  ImageFormat,
  ImageLayer,
} from '../types'
import { buildFilename, sanitizeFilename, validateFilenamePattern } from './useFilenamePattern'

interface InspectExportOptions {
  allRegions: CropRegion[]
  targetRegions: CropRegion[]
  selectedCount: number
  layers: ImageLayer[]
  activeLayer: ImageLayer | null
  format: ImageFormat
  filenamePattern: string
  imageName: string
  regionIndexById: Record<string, number>
  settings: ExportInspectionSettings
  useCustomSize: boolean
  outputWidth: number | null
  outputHeight: number | null
  fitMode?: BatchOutputFitMode
  dpr: number
  upscaleEnabled: boolean
}

function issue(
  checkKey: ExportInspectionCheckKey,
  title: string,
  detail: string,
  severity: 'error' | 'warning' = 'error',
  regionId?: string,
): ExportInspectionIssue {
  return {
    id: `${checkKey}_${regionId ?? 'global'}_${title}`,
    checkKey,
    severity,
    title,
    detail,
    regionId,
  }
}

function layerRect(layer: ImageLayer) {
  return {
    x: layer.x,
    y: layer.y,
    width: layer.image.naturalWidth * layer.scaleX,
    height: layer.image.naturalHeight * layer.scaleY,
  }
}

function intersects(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
}

function contains(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return b.x >= a.x &&
    b.y >= a.y &&
    b.x + b.width <= a.x + a.width &&
    b.y + b.height <= a.y + a.height
}

function sourcePixelRatio(layers: ImageLayer[], region: CropRegion, outputWidth: number, outputHeight: number): number {
  let minRatio = Infinity
  for (const layer of layers) {
    if (!layer.visible) continue
    if (!intersects(region, layerRect(layer))) continue
    const srcW = region.width / layer.scaleX
    const srcH = region.height / layer.scaleY
    const ratio = Math.min(srcW / outputWidth, srcH / outputHeight)
    if (ratio < minRatio) minRatio = ratio
  }
  return minRatio === Infinity ? 1 : minRatio
}

export function inspectExport(options: InspectExportOptions): ExportInspectionResult {
  const issues: ExportInspectionIssue[] = []
  const ext = options.format === 'jpeg' ? 'jpg' : options.format

  if (options.settings.regionCount && options.allRegions.length === 0) {
    issues.push(issue('regionCount', '没有裁剪区域', '请先创建至少一个裁剪区域后再导出。'))
  }

  if (options.settings.checkedCount && options.selectedCount === 0 && options.allRegions.length > 0) {
    issues.push(issue('checkedCount', '未勾选区域', '当前会导出全部裁剪区域；如只想导出部分区域，请先勾选。', 'warning'))
  }

  if (options.settings.outputSize && options.useCustomSize) {
    const invalidWidth = !options.outputWidth || options.outputWidth <= 0
    const invalidHeight = !options.outputHeight || options.outputHeight <= 0
    if (invalidWidth || invalidHeight) {
      for (const region of options.targetRegions) {
        issues.push(issue('outputSize', '输出尺寸无效', '统一输出尺寸需要大于 0。', 'error', region.id))
      }
    }
  }

  if (options.settings.unknownVariable) {
    const validation = validateFilenamePattern(options.filenamePattern)
    if (!validation.valid) {
      const detail = `命名规则包含未知变量：${validation.unknownKeys.join(', ')}。`
      const affected = options.targetRegions.length > 0 ? options.targetRegions : options.allRegions
      if (affected.length === 0) {
        issues.push(issue('unknownVariable', '未知命名变量', detail))
      } else {
        for (const region of affected) {
          issues.push(issue('unknownVariable', '未知命名变量', detail, 'error', region.id))
        }
      }
    }
  }

  if (options.settings.filenameDuplicate) {
    const filenameMap = new Map<string, CropRegion[]>()
    for (const region of options.targetRegions) {
      const index = options.regionIndexById[region.id] ?? 1
      const outW = options.useCustomSize && options.outputWidth ? options.outputWidth : region.width
      const outH = options.useCustomSize && options.outputHeight ? options.outputHeight : region.height
      const raw = buildFilename(options.filenamePattern, {
        imageName: options.imageName,
        regionName: region.name,
        index,
        width: Math.round(outW),
        height: Math.round(outH),
        format: ext,
        date: '',
      })
      const filename = `${sanitizeFilename(raw)}.${ext}`
      filenameMap.set(filename, [...(filenameMap.get(filename) ?? []), region])
    }

    for (const [filename, regions] of filenameMap) {
      if (regions.length <= 1) continue
      for (const region of regions) {
        issues.push(issue('filenameDuplicate', '文件名重名', `${filename} 会与其它裁剪区域重名。`, 'error', region.id))
      }
    }
  }

  if (options.settings.activeLayerBounds || options.settings.visibleLayerCoverage) {
    const activeRect = options.activeLayer ? layerRect(options.activeLayer) : null
    const visibleLayers = options.layers.filter(layer => layer.visible)
    for (const region of options.targetRegions) {
      if (options.settings.visibleLayerCoverage && (region.width <= 0 || region.height <= 0)) {
        issues.push(issue('visibleLayerCoverage', '空区域', '裁剪区域宽高需要大于 0。', 'error', region.id))
        continue
      }
      if (options.settings.activeLayerBounds && activeRect && !contains(activeRect, region)) {
        issues.push(issue('activeLayerBounds', '超出活动图层', '裁剪区域没有完全落在当前活动图层范围内。', 'error', region.id))
      }
      if (options.settings.visibleLayerCoverage) {
        const coversVisibleLayer = visibleLayers.some(layer => intersects(region, layerRect(layer)))
        if (!coversVisibleLayer) {
          issues.push(issue('visibleLayerCoverage', '未覆盖可见图层', '这个裁剪区域不会导出任何可见图层内容。', 'error', region.id))
        }
      }
    }
  }

  if (options.settings.sourcePixels) {
    for (const region of options.targetRegions) {
      const outW = options.useCustomSize && options.outputWidth ? options.outputWidth : region.width
      const outH = options.useCustomSize && options.outputHeight ? options.outputHeight : region.height
      const ratio = sourcePixelRatio(options.layers, region, outW, outH)
      const effectiveDpr = Math.min(options.dpr, Math.max(1, Math.round(ratio * 2 * 10) / 10))
      if (effectiveDpr < options.dpr) {
        issues.push(issue(
          'sourcePixels',
          '源像素不足',
          `DPR 会从 ${options.dpr}x 限制为 ${effectiveDpr}x，建议降低 DPR${options.upscaleEnabled ? '。' : '或启用超分。'}`,
          'warning',
          region.id,
        ))
      } else if (ratio < 0.5 && !options.upscaleEnabled) {
        issues.push(issue('sourcePixels', '清晰度风险', '源图像素不足，建议启用超分。', 'warning', region.id))
      }
    }
  }

  const regionIssues = issues.filter(item => item.regionId)
  const regionIds = [...new Set(regionIssues.map(item => item.regionId!))]
  const regionSummaries = regionIds
    .map((regionId) => {
      const region = options.allRegions.find(item => item.id === regionId)
      if (!region) return null
      return { region, issues: regionIssues.filter(item => item.regionId === regionId) }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  return {
    issues,
    globalIssues: issues.filter(item => !item.regionId),
    regionSummaries,
    failedRegionCount: regionSummaries.length,
    hasBlockingIssues: issues.some(item => item.severity === 'error'),
  }
}
