import type { CropGridGroup, CropRegion, ImageLayer } from '../types'

let gridGroupCounter = 0

export function nextGridGroupId(): string {
  return `grid_group_${Date.now()}_${++gridGroupCounter}_${Math.random().toString(36).slice(2, 6)}`
}

export function nextGridCellId(groupId: string, row: number, col: number): string {
  return `${groupId}_cell_${row + 1}_${col + 1}`
}

export function normalizeGridGroup(group: CropGridGroup): CropGridGroup {
  return {
    ...group,
    rows: Math.max(1, Math.round(group.rows || 1)),
    cols: Math.max(1, Math.round(group.cols || 1)),
    width: Math.max(1, group.width),
    height: Math.max(1, group.height),
    gapX: Math.max(0, group.gapX || 0),
    gapY: Math.max(0, group.gapY || 0),
    borderRadius: Math.max(0, group.borderRadius || 0),
  }
}

export function getGridCellSize(group: CropGridGroup) {
  const g = normalizeGridGroup(group)
  const totalGapX = Math.max(0, g.cols - 1) * g.gapX
  const totalGapY = Math.max(0, g.rows - 1) * g.gapY
  return {
    width: Math.max(1, (g.width - totalGapX) / g.cols),
    height: Math.max(1, (g.height - totalGapY) / g.rows),
  }
}

export function expandGridGroup(group: CropGridGroup): CropRegion[] {
  const g = normalizeGridGroup(group)
  const cell = getGridCellSize(g)
  const regions: CropRegion[] = []
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      const index = row * g.cols + col + 1
      const region: CropRegion = {
        id: nextGridCellId(g.id, row, col),
        name: `${g.name}_${String(index).padStart(3, '0')}`,
        x: g.x + col * (cell.width + g.gapX),
        y: g.y + row * (cell.height + g.gapY),
        width: cell.width,
        height: cell.height,
        shape: g.borderRadius > 0 ? 'roundrect' : 'rect',
      }
      if (g.borderRadius > 0) region.borderRadius = Math.min(g.borderRadius, Math.min(cell.width, cell.height) / 2)
      regions.push(region)
    }
  }
  return regions
}

export function createDefaultGridGroup(layer: ImageLayer | null): CropGridGroup {
  const rows = 3
  const cols = 3
  const fallbackSize = 900
  const layerW = layer ? layer.image.naturalWidth * layer.scaleX : fallbackSize
  const layerH = layer ? layer.image.naturalHeight * layer.scaleY : fallbackSize
  const size = Math.max(120, Math.min(layerW, layerH, fallbackSize))
  const x = layer ? layer.x + (layerW - size) / 2 : 0
  const y = layer ? layer.y + (layerH - size) / 2 : 0
  return {
    id: nextGridGroupId(),
    name: `N宫格_${gridGroupCounter}`,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(size),
    height: Math.round(size),
    rows,
    cols,
    gapX: 0,
    gapY: 0,
    borderRadius: 0,
  }
}
