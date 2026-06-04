import { ref, computed, type Ref } from 'vue'
import type { CropRegion } from '../types'

interface Snapshot {
  regions: CropRegion[]
  selectedRegionId: string | null
}

export function useHistory(
  regions: Ref<CropRegion[]>,
  selectedRegionId: Ref<string | null>,
) {
  const undoStack = ref<Snapshot[]>([])
  const redoStack = ref<Snapshot[]>([])
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  const maxStack = 50

  function deepCloneRegions(list: CropRegion[]): CropRegion[] {
    return list.map(r => ({ ...r }))
  }

  function snapshot() {
    undoStack.value.push({
      regions: deepCloneRegions(regions.value),
      selectedRegionId: selectedRegionId.value,
    })
    if (undoStack.value.length > maxStack) {
      undoStack.value.shift()
    }
    redoStack.value = []
  }

  function applySnapshot(s: Snapshot) {
    regions.value.splice(0, regions.value.length, ...deepCloneRegions(s.regions))
    selectedRegionId.value = s.selectedRegionId
  }

  function undo() {
    if (undoStack.value.length === 0) return
    redoStack.value.push({
      regions: deepCloneRegions(regions.value),
      selectedRegionId: selectedRegionId.value,
    })
    const prev = undoStack.value.pop()!
    applySnapshot(prev)
  }

  function redo() {
    if (redoStack.value.length === 0) return
    undoStack.value.push({
      regions: deepCloneRegions(regions.value),
      selectedRegionId: selectedRegionId.value,
    })
    const next = redoStack.value.pop()!
    applySnapshot(next)
  }

  return { canUndo, canRedo, snapshot, undo, redo }
}
