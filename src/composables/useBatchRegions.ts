import type { CropRegion, GridOptions, DuplicateOptions, SliceOptions, ImageLayer } from '../types'

let regionCounter = 0

export function nextBatchRegionId(): string {
  return `batch_${Date.now()}_${++regionCounter}_${Math.random().toString(36).slice(2, 6)}`
}

export function generateGridRegions(options: GridOptions): CropRegion[] {
  const regions: CropRegion[] = []
  for (let row = 0; row < options.rows; row++) {
    for (let col = 0; col < options.cols; col++) {
      const x = options.startX + col * (options.cellWidth + options.gapX)
      const y = options.startY + row * (options.cellHeight + options.gapY)
      const index = row * options.cols + col + 1
      regions.push({
        id: nextBatchRegionId(),
        name: `${options.namePrefix}_${String(index).padStart(3, '0')}`,
        x, y,
        width: options.cellWidth,
        height: options.cellHeight,
        shape: 'rect',
      })
    }
  }
  return regions
}

export function duplicateRegionBySpacing(
  region: CropRegion,
  options: DuplicateOptions,
): CropRegion[] {
  const regions: CropRegion[] = []
  for (let i = 1; i <= options.count; i++) {
    let dx = 0, dy = 0
    switch (options.mode) {
      case 'horizontal':
        dx = (region.width + options.gapX) * i
        break
      case 'vertical':
        dy = (region.height + options.gapY) * i
        break
      case 'custom':
        dx = options.deltaX * i
        dy = options.deltaY * i
        break
    }
    const newRegion: CropRegion = {
      id: nextBatchRegionId(),
      name: `${region.name}_${String(i + 1).padStart(2, '0')}`,
      x: region.x + dx,
      y: region.y + dy,
      width: region.width,
      height: region.height,
      shape: region.shape,
    }
    if (region.points && region.points.length >= 3) {
      newRegion.points = region.points.map(p => ({ x: p.x + dx, y: p.y + dy }))
    }
    regions.push(newRegion)
  }
  return regions
}

export function getActiveLayerDisplayRect(layer: ImageLayer): { x: number; y: number; width: number; height: number } {
  return {
    x: layer.x,
    y: layer.y,
    width: layer.image.naturalWidth * layer.scaleX,
    height: layer.image.naturalHeight * layer.scaleY,
  }
}

export function generateSliceRegions(layer: ImageLayer, options: SliceOptions): CropRegion[] {
  const baseRect = getActiveLayerDisplayRect(layer)
  const regions: CropRegion[] = []
  let currentY = baseRect.y + options.startY
  const finalY = options.endY == null ? baseRect.y + baseRect.height : baseRect.y + options.endY
  let index = 1

  while (currentY < finalY) {
    const h = Math.min(options.sliceHeight, finalY - currentY)
    regions.push({
      id: nextBatchRegionId(),
      name: `${options.namePrefix}_${String(index).padStart(3, '0')}`,
      x: baseRect.x,
      y: currentY,
      width: baseRect.width,
      height: h,
      shape: 'rect',
    })
    currentY += options.sliceHeight - options.overlap
    index++
  }
  return regions
}

export function validateSliceOptions(options: SliceOptions, layer: ImageLayer | null): string | null {
  if (!layer) return '请先选择活动图层'
  if (options.sliceHeight <= 0) return '切片高度必须大于 0'
  if (options.overlap < 0) return '重叠值不能为负'
  if (options.overlap >= options.sliceHeight) return '重叠值必须小于切片高度'
  return null
}

/** Generate crop regions from guide line intersections. */
export function generateGuideRegions(
  hGuides: number[],
  vGuides: number[],
  layer: ImageLayer,
  namePrefix = 'guide',
): CropRegion[] {
  const baseRect = getActiveLayerDisplayRect(layer)
  // include layer boundaries
  const ys = [...new Set([baseRect.y, ...hGuides, baseRect.y + baseRect.height])].sort((a, b) => a - b)
  const xs = [...new Set([baseRect.x, ...vGuides, baseRect.x + baseRect.width])].sort((a, b) => a - b)

  const regions: CropRegion[] = []
  for (let row = 0; row < ys.length - 1; row++) {
    for (let col = 0; col < xs.length - 1; col++) {
      const x = xs[col]
      const y = ys[row]
      const w = xs[col + 1] - x
      const h = ys[row + 1] - y
      if (w < 1 || h < 1) continue
      const index = row * (xs.length - 1) + col + 1
      regions.push({
        id: nextBatchRegionId(),
        name: `${namePrefix}_${String(index).padStart(3, '0')}`,
        x, y, width: w, height: h, shape: 'rect',
      })
    }
  }
  return regions
}
