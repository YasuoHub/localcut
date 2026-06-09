import { computed, ref } from 'vue'

export interface QuickSizePreset {
  id: string
  name: string
  width: number
  height: number
  custom?: boolean
}

interface QuickSizePresetBundle {
  schema: 'localcut-quick-size-presets'
  version: number
  exportedAt: number
  presets: QuickSizePreset[]
}

const STORAGE_KEY = 'localcut_quick_size_presets'
const BUNDLE_VERSION = 1

export const builtinQuickSizePresets: QuickSizePreset[] = [
  { id: 'free', name: '自由裁剪', width: 0, height: 0 },
  { id: 'wechat_cover', name: '公众号首图', width: 900, height: 383 },
  { id: 'wechat_secondary', name: '公众号次图', width: 200, height: 200 },
  { id: 'moments_cover', name: '朋友圈封面', width: 1080, height: 1080 },
  { id: 'desktop_wallpaper', name: '电脑壁纸', width: 1920, height: 1080 },
  { id: 'logo_design', name: 'Logo 设计', width: 500, height: 500 },
  { id: 'square_main', name: '方形主图', width: 800, height: 800 },
  { id: 'vertical_main', name: '竖版主图', width: 800, height: 1200 },
  { id: 'pdd_store', name: '拼多多店铺首页', width: 750, height: 1000 },
  { id: 'photo_1r', name: '标准 1 寸 / 1R', width: 295, height: 413 },
  { id: 'photo_2r', name: '标准 2 寸 / 2R', width: 413, height: 626 },
  { id: 'id_card', name: '二代身份证', width: 358, height: 441 },
]

const customPresets = ref<QuickSizePreset[]>(loadCustomPresets())

function createId() {
  return `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizePreset(value: unknown): QuickSizePreset | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const width = Number(raw.width)
  const height = Number(raw.height)
  if (!name || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null
  return {
    id: typeof raw.id === 'string' && raw.id.startsWith('custom_') ? raw.id : createId(),
    name,
    width: Math.round(width),
    height: Math.round(height),
    custom: true,
  }
}

function loadCustomPresets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizePreset).filter((item): item is QuickSizePreset => Boolean(item))
  } catch (err) {
    console.warn('Failed to load quick size presets', err)
    return []
  }
}

function saveCustomPresets() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customPresets.value))
  } catch (err) {
    console.warn('Failed to save quick size presets', err)
  }
}

function parseBundle(payload: unknown): QuickSizePreset[] {
  if (Array.isArray(payload)) {
    return payload.map(normalizePreset).filter((item): item is QuickSizePreset => Boolean(item))
  }
  if (payload && typeof payload === 'object') {
    const raw = payload as Partial<QuickSizePresetBundle>
    if (Array.isArray(raw.presets)) {
      return raw.presets.map(normalizePreset).filter((item): item is QuickSizePreset => Boolean(item))
    }
  }
  return []
}

export function useQuickSizePresets() {
  const presets = computed(() => [...builtinQuickSizePresets, ...customPresets.value])

  function addCustomPreset(input: { name: string; width: number; height: number }) {
    const preset = normalizePreset({ ...input, id: createId() })
    if (!preset) return null
    customPresets.value.push(preset)
    saveCustomPresets()
    return preset
  }

  function deleteCustomPreset(id: string) {
    const idx = customPresets.value.findIndex(item => item.id === id)
    if (idx === -1) return false
    customPresets.value.splice(idx, 1)
    saveCustomPresets()
    return true
  }

  function exportConfig(): QuickSizePresetBundle {
    return {
      schema: 'localcut-quick-size-presets',
      version: BUNDLE_VERSION,
      exportedAt: Date.now(),
      presets: customPresets.value.map(item => ({ ...item, custom: true })),
    }
  }

  function importConfig(text: string) {
    const incoming = parseBundle(JSON.parse(text))
    const existing = new Set(customPresets.value.map(item => `${item.name}|${item.width}|${item.height}`))
    let imported = 0
    for (const preset of incoming) {
      const key = `${preset.name}|${preset.width}|${preset.height}`
      if (existing.has(key)) continue
      customPresets.value.push({ ...preset, id: createId(), custom: true })
      existing.add(key)
      imported++
    }
    if (imported > 0) saveCustomPresets()
    return imported
  }

  return {
    presets,
    customPresets,
    addCustomPreset,
    deleteCustomPreset,
    exportConfig,
    importConfig,
  }
}
