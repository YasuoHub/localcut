import { ref } from 'vue'
import type { CropTemplate, CropTemplateRegion, CropRegion, ImageLayer } from '../types'
import { getActiveLayerDisplayRect } from './useBatchRegions'

const STORAGE_KEY = 'localcut_templates'

function loadFromStorage(): CropTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveToStorage(list: CropTemplate[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch { /* quota exceeded, ignore */ }
}

export function useCropTemplates() {
  const templates = ref<CropTemplate[]>(loadFromStorage())

  function persist() {
    saveToStorage(templates.value)
  }

  function saveTemplate(
    name: string,
    regions: CropRegion[],
    layer: ImageLayer,
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
      return tr
    })

    const tpl: CropTemplate = {
      id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      createdAt: Date.now(),
      baseRect: { ...baseRect },
      regions: templateRegions,
    }
    templates.value.push(tpl)
    persist()
    return tpl
  }

  function applyTemplate(
    templateId: string,
    layer: ImageLayer,
  ): CropRegion[] {
    const tpl = templates.value.find(t => t.id === templateId)
    if (!tpl) return []

    const targetRect = getActiveLayerDisplayRect(layer)

    return tpl.regions.map(tr => {
      const region: CropRegion = {
        id: `tpl_region_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: tr.name,
        shape: tr.shape,
        x: targetRect.x + tr.xRatio * targetRect.width,
        y: targetRect.y + tr.yRatio * targetRect.height,
        width: tr.widthRatio * targetRect.width,
        height: tr.heightRatio * targetRect.height,
      }
      if (tr.pointsRatio && tr.pointsRatio.length >= 3) {
        region.points = tr.pointsRatio.map(p => ({
          x: targetRect.x + p.x * targetRect.width,
          y: targetRect.y + p.y * targetRect.height,
        }))
      }
      return region
    })
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
      persist()
    }
  }

  return { templates, saveTemplate, applyTemplate, deleteTemplate, renameTemplate }
}
