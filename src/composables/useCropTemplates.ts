import { ref } from 'vue'
import type {
  CropTemplate,
  CropTemplateBundle,
  CropTemplateCategory,
  CropTemplateExportSettings,
  CropTemplateGridGroup,
  CropTemplateImportIssue,
  CropTemplateImportResult,
  CropTemplateRegion,
  CropGridGroup,
  CropTemplateSaveOptions,
  CropRegion,
  ImageLayer,
  TemplateConflictMode,
} from '../types'
import { getActiveLayerDisplayRect } from './useBatchRegions'

const STORAGE_KEY = 'localcut_templates'
const TEMPLATE_VERSION = 2

const templates = ref<CropTemplate[]>(loadFromStorage())

function createId(prefix = 'tpl') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function loadFromStorage(): CropTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item, index) => normalizeTemplate(item, { suffix: index + 1 }))
      .filter((item): item is CropTemplate => Boolean(item))
  } catch {
    return []
  }
}

function saveToStorage(list: CropTemplate[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch { /* quota exceeded, ignore */ }
}

function normalizeCategory(value: unknown): CropTemplateCategory {
  const allowed: CropTemplateCategory[] = ['general', 'ecommerce-main', 'detail-long', 'store-decoration', 'custom']
  return allowed.includes(value as CropTemplateCategory) ? value as CropTemplateCategory : 'general'
}

function normalizeExportSettings(value: unknown): CropTemplateExportSettings | undefined {
  if (!isObject(value)) return undefined
  const settings: CropTemplateExportSettings = {}

  if (typeof value.batchUseCustomSize === 'boolean') settings.batchUseCustomSize = value.batchUseCustomSize
  if (typeof value.batchOutputWidth === 'number' || value.batchOutputWidth === null) settings.batchOutputWidth = value.batchOutputWidth
  if (typeof value.batchOutputHeight === 'number' || value.batchOutputHeight === null) settings.batchOutputHeight = value.batchOutputHeight
  if (['original', 'cover', 'contain', 'stretch'].includes(String(value.batchFitMode))) {
    settings.batchFitMode = value.batchFitMode as CropTemplateExportSettings['batchFitMode']
  }
  if (typeof value.batchFillColor === 'string') settings.batchFillColor = value.batchFillColor
  if (typeof value.filenamePattern === 'string') settings.filenamePattern = value.filenamePattern
  if (typeof value.singleUseFilenamePattern === 'boolean') settings.singleUseFilenamePattern = value.singleUseFilenamePattern
  if (['png', 'jpeg', 'webp'].includes(String(value.exportFormat))) {
    settings.exportFormat = value.exportFormat as CropTemplateExportSettings['exportFormat']
  }
  if (typeof value.exportQuality === 'number') settings.exportQuality = Math.max(10, Math.min(100, value.exportQuality))

  return Object.keys(settings).length > 0 ? settings : undefined
}

function normalizeRegion(value: unknown): CropTemplateRegion | null {
  if (!isObject(value)) return null
  if (
    typeof value.name !== 'string' ||
    typeof value.shape !== 'string' ||
    typeof value.xRatio !== 'number' ||
    typeof value.yRatio !== 'number' ||
    typeof value.widthRatio !== 'number' ||
    typeof value.heightRatio !== 'number'
  ) {
    return null
  }

  const region: CropTemplateRegion = {
    name: value.name,
    shape: value.shape as CropTemplateRegion['shape'],
    xRatio: value.xRatio,
    yRatio: value.yRatio,
    widthRatio: value.widthRatio,
    heightRatio: value.heightRatio,
  }

  if (Array.isArray(value.pointsRatio) && value.pointsRatio.length >= 3) {
    const points = value.pointsRatio
      .filter(isObject)
      .map(p => ({ x: Number(p.x), y: Number(p.y) }))
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
    if (points.length >= 3) region.pointsRatio = points
  }

  if (typeof value.borderRadiusRatio === 'number') region.borderRadiusRatio = value.borderRadiusRatio

  return region
}

function normalizeGridGroup(value: unknown): CropTemplateGridGroup | null {
  if (!isObject(value)) return null
  if (
    typeof value.name !== 'string' ||
    typeof value.xRatio !== 'number' ||
    typeof value.yRatio !== 'number' ||
    typeof value.widthRatio !== 'number' ||
    typeof value.heightRatio !== 'number' ||
    typeof value.rows !== 'number' ||
    typeof value.cols !== 'number'
  ) {
    return null
  }

  return {
    name: value.name,
    xRatio: value.xRatio,
    yRatio: value.yRatio,
    widthRatio: value.widthRatio,
    heightRatio: value.heightRatio,
    rows: Math.max(1, Math.round(value.rows)),
    cols: Math.max(1, Math.round(value.cols)),
    gapXRatio: typeof value.gapXRatio === 'number' ? value.gapXRatio : 0,
    gapYRatio: typeof value.gapYRatio === 'number' ? value.gapYRatio : 0,
    borderRadiusRatio: typeof value.borderRadiusRatio === 'number' ? value.borderRadiusRatio : 0,
  }
}

function normalizeTemplate(value: unknown, options: { suffix?: number } = {}): CropTemplate | null {
  if (!isObject(value)) return null
  const regions = Array.isArray(value.regions) ? value.regions.map(normalizeRegion).filter((item): item is CropTemplateRegion => Boolean(item)) : []
  const gridGroups = Array.isArray(value.gridGroups) ? value.gridGroups.map(normalizeGridGroup).filter((item): item is CropTemplateGridGroup => Boolean(item)) : []
  if (!regions.length && !gridGroups.length) return null

  const now = Date.now()
  const name = typeof value.name === 'string' && value.name.trim()
    ? value.name.trim()
    : `未命名模板${options.suffix ? ` ${options.suffix}` : ''}`

  const baseRect = isObject(value.baseRect) &&
    typeof value.baseRect.x === 'number' &&
    typeof value.baseRect.y === 'number' &&
    typeof value.baseRect.width === 'number' &&
    typeof value.baseRect.height === 'number'
    ? {
        x: value.baseRect.x,
        y: value.baseRect.y,
        width: value.baseRect.width,
        height: value.baseRect.height,
      }
    : { x: 0, y: 0, width: 1, height: 1 }

  return {
    id: typeof value.id === 'string' ? value.id : createId(),
    name,
    version: typeof value.version === 'number' ? value.version : 1,
    category: normalizeCategory(value.category),
    favorite: typeof value.favorite === 'boolean' ? value.favorite : false,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : now,
    lastUsedAt: typeof value.lastUsedAt === 'number' ? value.lastUsedAt : undefined,
    baseRect,
    regions,
    gridGroups,
    exportSettings: normalizeExportSettings(value.exportSettings),
  }
}

function cloneTemplate(template: CropTemplate): CropTemplate {
  return JSON.parse(JSON.stringify(template))
}

function buildBundle(selected: CropTemplate[]): CropTemplateBundle {
  return {
    schema: selected.length === 1 ? 'localcut-template' : 'localcut-templates',
    version: TEMPLATE_VERSION,
    exportedAt: Date.now(),
    templates: selected.map(cloneTemplate),
  }
}

function parseImportPayload(payload: unknown, issues: CropTemplateImportIssue[]): CropTemplate[] {
  if (Array.isArray(payload)) {
    issues.push({ level: 'warning', message: '检测到旧版模板数组，已按兼容模式导入。' })
    return payload
      .map((item, index) => normalizeTemplate(item, { suffix: index + 1 }))
      .filter((item): item is CropTemplate => Boolean(item))
  }

  if (!isObject(payload)) return []

  const version = typeof payload.version === 'number' ? payload.version : 1
  if (version < TEMPLATE_VERSION) {
    issues.push({ level: 'warning', message: `模板文件版本 ${version} 较旧，已尝试兼容导入。` })
  }
  if (version > TEMPLATE_VERSION) {
    issues.push({ level: 'warning', message: `模板文件版本 ${version} 高于当前支持版本 ${TEMPLATE_VERSION}，部分字段可能被忽略。` })
  }

  if (Array.isArray(payload.templates)) {
    return payload.templates
      .map((item, index) => normalizeTemplate(item, { suffix: index + 1 }))
      .filter((item): item is CropTemplate => Boolean(item))
  }

  const single = normalizeTemplate(payload)
  return single ? [single] : []
}

function makeUniqueName(name: string, existingNames: Set<string>) {
  if (!existingNames.has(name)) return name
  let index = 2
  let next = `${name} 副本`
  while (existingNames.has(next)) {
    next = `${name} 副本 ${index}`
    index++
  }
  return next
}

export function useCropTemplates() {
  function persist() {
    saveToStorage(templates.value)
  }

  function saveTemplate(
    name: string,
    regions: CropRegion[],
    gridGroups: CropGridGroup[],
    layer: ImageLayer,
    options: CropTemplateSaveOptions,
  ): CropTemplate {
    const baseRect = getActiveLayerDisplayRect(layer)
    const templateRegions: CropTemplateRegion[] = regions.map(r => {
      const tr: CropTemplateRegion = {
        name: r.name,
        shape: r.shape,
        xRatio: (r.x - baseRect.x) / baseRect.width,
        yRatio: (r.y - baseRect.y) / baseRect.height,
        widthRatio: r.width / baseRect.width,
        heightRatio: r.height / baseRect.height,
      }
      if (r.points && r.points.length >= 3) {
        tr.pointsRatio = r.points.map(p => ({
          x: (p.x - baseRect.x) / baseRect.width,
          y: (p.y - baseRect.y) / baseRect.height,
        }))
      }
      if (typeof r.borderRadius === 'number') {
        tr.borderRadiusRatio = r.borderRadius / Math.min(r.width, r.height)
      }
      return tr
    })

    const templateGridGroups: CropTemplateGridGroup[] = gridGroups.map(group => ({
      name: group.name,
      xRatio: (group.x - baseRect.x) / baseRect.width,
      yRatio: (group.y - baseRect.y) / baseRect.height,
      widthRatio: group.width / baseRect.width,
      heightRatio: group.height / baseRect.height,
      rows: group.rows,
      cols: group.cols,
      gapXRatio: group.gapX / baseRect.width,
      gapYRatio: group.gapY / baseRect.height,
      borderRadiusRatio: group.borderRadius / Math.min(group.width, group.height),
    }))

    const now = Date.now()
    const tpl: CropTemplate = {
      id: createId(),
      name,
      version: TEMPLATE_VERSION,
      category: options.category,
      favorite: false,
      createdAt: now,
      updatedAt: now,
      baseRect: { ...baseRect },
      regions: templateRegions,
      gridGroups: templateGridGroups,
      exportSettings: options.exportSettings,
    }
    templates.value.push(tpl)
    persist()
    return tpl
  }

  function applyTemplate(templateId: string, layer: ImageLayer): { regions: CropRegion[]; gridGroups: CropGridGroup[] } {
    const tpl = templates.value.find(t => t.id === templateId)
    if (!tpl) return { regions: [], gridGroups: [] }

    tpl.lastUsedAt = Date.now()
    persist()

    const targetRect = getActiveLayerDisplayRect(layer)

    const regions = tpl.regions.map(tr => {
      const width = tr.widthRatio * targetRect.width
      const height = tr.heightRatio * targetRect.height
      const region: CropRegion = {
        id: createId('tpl_region'),
        name: tr.name,
        shape: tr.shape,
        x: targetRect.x + tr.xRatio * targetRect.width,
        y: targetRect.y + tr.yRatio * targetRect.height,
        width,
        height,
      }
      if (tr.pointsRatio && tr.pointsRatio.length >= 3) {
        region.points = tr.pointsRatio.map(p => ({
          x: targetRect.x + p.x * targetRect.width,
          y: targetRect.y + p.y * targetRect.height,
        }))
      }
      if (typeof tr.borderRadiusRatio === 'number') {
        region.borderRadius = tr.borderRadiusRatio * Math.min(width, height)
      }
      return region
    })

    const gridGroups = (tpl.gridGroups ?? []).map(group => ({
      id: createId('tpl_grid_group'),
      name: group.name,
      x: targetRect.x + group.xRatio * targetRect.width,
      y: targetRect.y + group.yRatio * targetRect.height,
      width: group.widthRatio * targetRect.width,
      height: group.heightRatio * targetRect.height,
      rows: group.rows,
      cols: group.cols,
      gapX: group.gapXRatio * targetRect.width,
      gapY: group.gapYRatio * targetRect.height,
      borderRadius: group.borderRadiusRatio * Math.min(group.widthRatio * targetRect.width, group.heightRatio * targetRect.height),
    }))

    return { regions, gridGroups }
  }

  function deleteTemplate(id: string) {
    const idx = templates.value.findIndex(t => t.id === id)
    if (idx !== -1) {
      templates.value.splice(idx, 1)
      persist()
    }
  }

  function renameTemplate(id: string, newName: string) {
    const tpl = templates.value.find(t => t.id === id)
    if (tpl) {
      tpl.name = newName
      tpl.updatedAt = Date.now()
      persist()
    }
  }

  function updateTemplateCategory(id: string, category: CropTemplateCategory) {
    const tpl = templates.value.find(t => t.id === id)
    if (!tpl) return
    tpl.category = category
    tpl.updatedAt = Date.now()
    persist()
  }

  function toggleFavorite(id: string) {
    const tpl = templates.value.find(t => t.id === id)
    if (!tpl) return
    tpl.favorite = !tpl.favorite
    tpl.updatedAt = Date.now()
    persist()
  }

  function duplicateTemplate(id: string) {
    const source = templates.value.find(t => t.id === id)
    if (!source) return null
    const existingNames = new Set(templates.value.map(t => t.name))
    const now = Date.now()
    const copy = cloneTemplate(source)
    copy.id = createId()
    copy.name = makeUniqueName(source.name, existingNames)
    copy.favorite = false
    copy.createdAt = now
    copy.updatedAt = now
    copy.lastUsedAt = undefined
    templates.value.push(copy)
    persist()
    return copy
  }

  function exportTemplates(ids: string[]) {
    const selected = templates.value.filter(t => ids.includes(t.id))
    if (!selected.length) return null
    return buildBundle(selected)
  }

  function importTemplatesFromText(text: string, conflictMode: TemplateConflictMode): CropTemplateImportResult {
    const result: CropTemplateImportResult = {
      imported: 0,
      skipped: 0,
      overwritten: 0,
      renamed: 0,
      issues: [],
    }

    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      result.issues.push({ level: 'error', message: '文件不是有效的 JSON 模板文件。' })
      return result
    }

    const incoming = parseImportPayload(payload, result.issues)
    if (!incoming.length) {
      result.issues.push({ level: 'error', message: '没有找到字段完整的模板，未导入。' })
      return result
    }

    const existingNames = new Set(templates.value.map(t => t.name))
    for (const rawTemplate of incoming) {
      const template = cloneTemplate(rawTemplate)
      const conflictIndex = templates.value.findIndex(t => t.name === template.name)
      template.version = Math.min(template.version || TEMPLATE_VERSION, TEMPLATE_VERSION)
      template.updatedAt = Date.now()

      if (conflictIndex !== -1) {
        if (conflictMode === 'skip') {
          result.skipped++
          continue
        }
        if (conflictMode === 'overwrite') {
          template.id = templates.value[conflictIndex].id
          template.createdAt = templates.value[conflictIndex].createdAt
          templates.value.splice(conflictIndex, 1, template)
          result.overwritten++
          result.imported++
          continue
        }
        template.id = createId()
        template.name = makeUniqueName(template.name, existingNames)
        result.renamed++
      } else {
        template.id = createId()
      }

      existingNames.add(template.name)
      templates.value.push(template)
      result.imported++
    }

    persist()
    return result
  }

  return {
    templates,
    templateVersion: TEMPLATE_VERSION,
    saveTemplate,
    applyTemplate,
    deleteTemplate,
    renameTemplate,
    updateTemplateCategory,
    toggleFavorite,
    duplicateTemplate,
    exportTemplates,
    importTemplatesFromText,
  }
}
