import { ref, reactive, watch, type Ref } from 'vue'
import type { CropRegion, ShapeType, TextAnnotation, DragType, CanvasViewState, ImageLayer } from '../types'
import { drawShapePath, addShapeToPath, nextRegionName } from './shapeUtils'
import { magicWandSelect } from './magicWandUtils'

export { drawShapePath }

// --- helpers ---

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)) }

// --- control points ---

const CP_SIZE = 8
const CP_HALF = CP_SIZE / 2

interface ControlPoint { type: DragType; sx: number; sy: number }

function getControlPoints(x: number, y: number, w: number, h: number, view: CanvasViewState): ControlPoint[] {
  const cx = (x + w / 2 - view.offsetX) * view.scale
  const cy = (y + h / 2 - view.offsetY) * view.scale
  const sw = w * view.scale
  const sh = h * view.scale
  return [
    { type: 'resize-nw', sx: cx - sw / 2, sy: cy - sh / 2 },
    { type: 'resize-n',  sx: cx,        sy: cy - sh / 2 },
    { type: 'resize-ne', sx: cx + sw / 2, sy: cy - sh / 2 },
    { type: 'resize-e',  sx: cx + sw / 2, sy: cy },
    { type: 'resize-se', sx: cx + sw / 2, sy: cy + sh / 2 },
    { type: 'resize-s',  sx: cx,        sy: cy + sh / 2 },
    { type: 'resize-sw', sx: cx - sw / 2, sy: cy + sh / 2 },
    { type: 'resize-w',  sx: cx - sw / 2, sy: cy },
  ]
}

// --- composable ---

export function useCanvasEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  containerRef: Ref<HTMLElement | null>,
  regions: CropRegion[],
  selectedRegionId: Ref<string | null>,
  selectedRegionIds: Ref<Set<string>>,
  activeTool: Ref<'select' | ShapeType | 'brush' | 'eraser' | 'text' | 'magic-wand'>,
  brushSettings: Ref<{ size: number; color: string }>,
  eraserSettings: Ref<{ size: number }>,
  textAnnotations: TextAnnotation[],
  selectedTextId: Ref<string | null>,
  constrainToImage: Ref<boolean>,
  isSingleLayerMode: Ref<boolean>,
  magicWandTolerance: Ref<number>,
  showOriginal: Ref<boolean>,
  layers: Ref<ImageLayer[]>,
  activeLayerId: Ref<string | null>,
  canvasVersion: Ref<number>,
  hGuides: Ref<number[]>,
  vGuides: Ref<number[]>,
  selectedLayerIds: Ref<Set<string>>,
  isHeavyProcessing: Ref<boolean>,
  removeHGuide?: (y: number) => void,
  removeVGuide?: (x: number) => void,
  snapshot?: () => void,
) {
  const view = reactive<CanvasViewState>({
    image: null,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  })

  // helpers
  function getActiveLayer(): ImageLayer | null {
    return layers.value.find(l => l.id === activeLayerId.value) ?? null
  }
  function getWorkingCanvas(): HTMLCanvasElement | null {
    return getActiveLayer()?.workingCanvas ?? null
  }
  function getWorkingCtx(): CanvasRenderingContext2D | null {
    const wc = getWorkingCanvas()
    return wc ? wc.getContext('2d') : null
  }
  function getActiveImage(): HTMLImageElement | null {
    return getActiveLayer()?.image ?? null
  }

  // drawing state
  const isDrawing = ref(false)
  const drawStartX = ref(0)
  const drawStartY = ref(0)
  const drawCurrentX = ref(0)
  const drawCurrentY = ref(0)

  // custom polygon drawing state
  const customPoints = ref<{ x: number; y: number }[]>([])
  const mouseImgPos = ref<{ x: number; y: number }>({ x: 0, y: 0 })

  // vertex dragging
  const isDraggingVertex = ref(false)
  const draggingVertexIndex = ref(-1)
  const draggingVertexRegionId = ref<string | null>(null)

  // drag state
  const isDragging = ref(false)
  const dragType = ref<DragType | null>(null)
  const dragStartBounds = ref<{ x: number; y: number; width: number; height: number } | null>(null)
  const dragStartPoints = ref<{ x: number; y: number }[] | null>(null)
  const dragStartMouse = ref<{ sx: number; sy: number }>({ sx: 0, sy: 0 })
  const draggingText = ref(false) // true if dragging a text annotation
  const dragStartMultiBounds = ref<Map<string, { x: number; y: number; width: number; height: number; points?: { x: number; y: number }[] }> | null>(null)

  // brush/eraser state
  const isBrushing = ref(false)
  const lastBrushPos = ref<{ x: number; y: number } | null>(null)

  // pan state
  const isPanning = ref(false)
  const panStartMouse = ref<{ sx: number; sy: number }>({ sx: 0, sy: 0 })
  const panStartOffset = ref<{ ox: number; oy: number }>({ ox: 0, oy: 0 })
  const spaceHeld = ref(false)

  // marquee selection state
  const isMarquee = ref(false)
  const marqueeStart = ref<{ sx: number; sy: number } | null>(null)
  const marqueeImgStart = ref<{ ix: number; iy: number }>({ ix: 0, iy: 0 })
  const marqueeImgEnd = ref<{ ix: number; iy: number }>({ ix: 0, iy: 0 })

  // layer marquee state (Ctrl+Shift)
  const isLayerMarquee = ref(false)
  const layerMarqueeStart = ref<{ sx: number; sy: number } | null>(null)
  const layerMarqueeImgStart = ref<{ ix: number; iy: number }>({ ix: 0, iy: 0 })
  const layerMarqueeImgEnd = ref<{ ix: number; iy: number }>({ ix: 0, iy: 0 })
  const layerDragStartPositions = ref<Map<string, { x: number; y: number }> | null>(null)

  // clipboard
  const clipboard = ref<{ shape: ShapeType; width: number; height: number; name: string; origX: number; origY: number; points?: { x: number; y: number }[] } | null>(null)
  const pasteCount = ref(0)

  let renderRaf = 0
  let dirty = true

  function markDirty() {
    dirty = true
    if (!renderRaf) renderRaf = requestAnimationFrame(render)
  }

  function screenToImage(sx: number, sy: number) {
    const canvas = canvasRef.value!
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const x = (sx - rect.left) * dpr
    const y = (sy - rect.top) * dpr
    return { ix: x / view.scale + view.offsetX, iy: y / view.scale + view.offsetY }
  }

  function loadImage(img: HTMLImageElement) {
    view.image = img
    view.scale = 1
    view.offsetX = 0
    view.offsetY = 0
    regions.splice(0)
    textAnnotations.splice(0)
    selectedRegionId.value = null
    selectedTextId.value = null
    fitToCanvas()
    markDirty()
  }

  function fitToCanvas() {
    const canvas = canvasRef.value
    const img = getActiveImage()
    if (!canvas || !img) return
    const dpr = window.devicePixelRatio || 1
    const cw = canvas.width || (canvas.clientWidth * dpr)
    const ch = canvas.height || (canvas.clientHeight * dpr)
    if (!cw || !ch) return
    const scaleX = cw / img.naturalWidth
    const scaleY = ch / img.naturalHeight
    view.scale = Math.min(scaleX, scaleY) * 0.85
    view.offsetX = -30
    view.offsetY = -30
    markDirty()
  }

  function getSelectedRegion(): CropRegion | null {
    if (!selectedRegionId.value) return null
    return regions.find(r => r.id === selectedRegionId.value) ?? null
  }

  function getSelectedText(): TextAnnotation | null {
    if (!selectedTextId.value) return null
    return textAnnotations.find(t => t.id === selectedTextId.value) ?? null
  }

  function cleanupEmptyText() {
    const st = getSelectedText()
    if (st && !st.text.trim()) {
      const idx = textAnnotations.findIndex(t => t.id === st.id)
      if (idx !== -1) textAnnotations.splice(idx, 1)
      selectedTextId.value = null
    }
  }

  function selectRegion(id: string | null) {
    cleanupEmptyText()
    selectedRegionId.value = id
    if (id) selectedTextId.value = null
    markDirty()
  }

  function selectText(id: string | null) {
    cleanupEmptyText()
    selectedTextId.value = id
    if (id) selectedRegionId.value = null
    markDirty()
  }

  function clampToImage(x: number, y: number, w: number, h: number) {
    const img = getActiveImage()
    const shouldConstrain = constrainToImage.value && isSingleLayerMode.value
    if (!img || !shouldConstrain) return { x, y, width: w, height: h }
    const iw = img.naturalWidth
    const ih = img.naturalHeight
    let nx = clamp(x, 0, iw - 1)
    let ny = clamp(y, 0, ih - 1)
    let nw = w, nh = h
    if (nx + nw > iw) nw = iw - nx
    if (ny + nh > ih) nh = ih - ny
    if (nw < 5) nw = 5
    if (nh < 5) nh = 5
    return { x: nx, y: ny, width: nw, height: nh }
  }

  // --- custom polygon ---

  function bboxFromPoints(pts: { x: number; y: number }[]) {
    if (pts.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of pts) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }

  function finalizeCustomPolygon() {
    if (customPoints.value.length < 3) return
    const bbox = bboxFromPoints(customPoints.value)
    const region: CropRegion = {
      id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: nextRegionName(),
      ...bbox,
      shape: 'custom',
      points: [...customPoints.value],
    }
    snapshot?.()
    regions.push(region)
    selectRegion(region.id)
    customPoints.value = []
    markDirty()
  }

  function cancelCustomPolygon() {
    customPoints.value = []
    markDirty()
  }

  function hitTestVertex(sx: number, sy: number): { regionId: string; index: number } | null {
    const sel = getSelectedRegion()
    if (!sel || sel.shape !== 'custom' || !sel.points) return null
    const threshold = 8
    for (let i = 0; i < sel.points.length; i++) {
      const vx = (sel.points[i].x - view.offsetX) * view.scale
      const vy = (sel.points[i].y - view.offsetY) * view.scale
      if (Math.abs(sx - vx) <= threshold && Math.abs(sy - vy) <= threshold) {
        return { regionId: sel.id, index: i }
      }
    }
    return null
  }

  function hitTestLineSegment(sx: number, sy: number): { regionId: string; index: number } | null {
    const sel = getSelectedRegion()
    if (!sel || sel.shape !== 'custom' || !sel.points || sel.points.length < 2) return null
    const threshold = 8
    for (let i = 0; i < sel.points.length; i++) {
      const j = (i + 1) % sel.points.length
      const x1 = (sel.points[i].x - view.offsetX) * view.scale
      const y1 = (sel.points[i].y - view.offsetY) * view.scale
      const x2 = (sel.points[j].x - view.offsetX) * view.scale
      const y2 = (sel.points[j].y - view.offsetY) * view.scale
      // distance from point to line segment
      const dx = x2 - x1, dy = y2 - y1
      const len2 = dx * dx + dy * dy
      if (len2 === 0) continue
      let t = ((sx - x1) * dx + (sy - y1) * dy) / len2
      t = Math.max(0, Math.min(1, t))
      const cx = x1 + t * dx, cy = y1 + t * dy
      if (Math.hypot(sx - cx, sy - cy) <= threshold) return { regionId: sel.id, index: i }
    }
    return null
  }

  function deleteVertex(regionId: string, index: number) {
    const r = regions.find(r => r.id === regionId)
    if (!r || !r.points) return
    r.points.splice(index, 1)
    if (r.points.length < 3 && activeTool.value !== 'custom') {
      // auto-delete region
      const idx = regions.findIndex(r => r.id === regionId)
      if (idx !== -1) regions.splice(idx, 1)
      if (selectedRegionId.value === regionId) selectedRegionId.value = null
    } else {
      // update bbox
      const bbox = bboxFromPoints(r.points)
      r.x = bbox.x; r.y = bbox.y; r.width = bbox.width; r.height = bbox.height
    }
    markDirty()
  }

  // --- hit testing ---

  function hitTestControlPoint(sx: number, sy: number): { id: string; type: DragType; isText: boolean } | null {
    // check selected region
    const sel = getSelectedRegion()
    if (sel) {
      const pts = getControlPoints(sel.x, sel.y, sel.width, sel.height, view)
      for (const pt of pts) {
        if (Math.abs(sx - pt.sx) <= CP_HALF + 3 && Math.abs(sy - pt.sy) <= CP_HALF + 3) {
          return { id: sel.id, type: pt.type, isText: false }
        }
      }
    }
    // check selected text
    const selt = getSelectedText()
    if (selt) {
      const pts = getControlPoints(selt.x, selt.y, selt.width, selt.height, view)
      for (const pt of pts) {
        if (Math.abs(sx - pt.sx) <= CP_HALF + 3 && Math.abs(sy - pt.sy) <= CP_HALF + 3) {
          return { id: selt.id, type: pt.type, isText: true }
        }
      }
    }
    return null
  }

  function hitTestRegion(sx: number, sy: number): CropRegion | null {
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = regions[i]
      const cx = (r.x + r.width / 2 - view.offsetX) * view.scale
      const cy = (r.y + r.height / 2 - view.offsetY) * view.scale
      const w = r.width * view.scale
      const h = r.height * view.scale
      if (Math.abs(sx - cx) <= w / 2 && Math.abs(sy - cy) <= h / 2) {
        if (r.shape === 'rect') return r
        if (r.shape === 'roundrect') {
          const canvas = canvasRef.value!
          const ctx = canvas.getContext('2d')!
          ctx.save()
          const radius = r.borderRadius != null ? r.borderRadius * view.scale : Math.min(w, h) * 0.2
          ctx.beginPath()
          ctx.roundRect(cx - w / 2, cy - h / 2, w, h, radius)
          const inside = ctx.isPointInPath(sx, sy)
          ctx.restore()
          if (inside) return r
          continue
        }
        // all other shapes: use canvas isPointInPath
        const canvas = canvasRef.value!
        const ctx = canvas.getContext('2d')!
        ctx.save()
        const sp = screenPoints(r)
        drawShapePath(ctx, r.shape, cx, cy, w, h, sp, r.borderRadius != null ? r.borderRadius * view.scale : undefined)
        const inside = ctx.isPointInPath(sx, sy)
        ctx.restore()
        if (inside) return r
      }
    }
    return null
  }

  function screenPoints(r: CropRegion): { x: number; y: number }[] | undefined {
    if (!r.points) return undefined
    return r.points.map(p => ({
      x: (p.x - view.offsetX) * view.scale,
      y: (p.y - view.offsetY) * view.scale,
    }))
  }

  function hitTestGuide(sx: number, sy: number): { axis: 'h' | 'v'; value: number } | null {
    const threshold = 6
    for (const y of hGuides.value) {
      const gy = (y - view.offsetY) * view.scale
      if (Math.abs(sy - gy) < threshold) return { axis: 'h', value: y }
    }
    for (const x of vGuides.value) {
      const gx = (x - view.offsetX) * view.scale
      if (Math.abs(sx - gx) < threshold) return { axis: 'v', value: x }
    }
    return null
  }

  function hitTestText(sx: number, sy: number): TextAnnotation | null {
    for (let i = textAnnotations.length - 1; i >= 0; i--) {
      const t = textAnnotations[i]
      const cx = (t.x + t.width / 2 - view.offsetX) * view.scale
      const cy = (t.y + t.height / 2 - view.offsetY) * view.scale
      const w = t.width * view.scale
      const h = t.height * view.scale
      if (Math.abs(sx - cx) <= w / 2 && Math.abs(sy - cy) <= h / 2) return t
    }
    return null
  }

  function hitTestLayer(sx: number, sy: number): ImageLayer | null {
    // iterate front-to-back matching rendering order (layers[0] is topmost)
    for (let i = 0; i < layers.value.length; i++) {
      const l = layers.value[i]
      if (!l.visible) continue
      const cx = (l.x + l.image.naturalWidth * l.scaleX / 2 - view.offsetX) * view.scale
      const cy = (l.y + l.image.naturalHeight * l.scaleY / 2 - view.offsetY) * view.scale
      const w = l.image.naturalWidth * l.scaleX * view.scale
      const h = l.image.naturalHeight * l.scaleY * view.scale
      if (Math.abs(sx - cx) <= w / 2 && Math.abs(sy - cy) <= h / 2) return l
    }
    return null
  }

  // layer dragging state
  const isDraggingLayer = ref(false)
  const isResizingLayer = ref(false)
  const layerResizeHandle = ref('')
  const dragStartLayerPos = ref<{ x: number; y: number; sx: number; sy: number; w: number; h: number }>({ x: 0, y: 0, sx: 1, sy: 1, w: 0, h: 0 })
  const pendingCtrlDragLayer = ref<{ x: number; y: number; sx: number; sy: number } | null>(null)

  // --- brush/eraser ---

  function drawBrushStroke(ix: number, iy: number) {
    const ctx = getWorkingCtx()
    const layer = getActiveLayer()
    if (!ctx || !layer) return
    const lx = (ix - layer.x) / layer.scaleX
    const ly = (iy - layer.y) / layer.scaleY
    const brushSize = activeTool.value === 'brush' ? brushSettings.value.size : eraserSettings.value.size
    const sx = brushSize / Math.max(layer.scaleX, layer.scaleY)
    if (activeTool.value === 'brush') {
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = brushSettings.value.color
      ctx.beginPath()
      ctx.arc(lx, ly, sx / 2, 0, Math.PI * 2)
      ctx.fill()
    } else if (activeTool.value === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.beginPath()
      ctx.arc(lx, ly, sx / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
    }
  }

  function drawBrushLine(fromX: number, fromY: number, toX: number, toY: number) {
    const ctx = getWorkingCtx()
    if (!ctx) return
    const dist = Math.hypot(toX - fromX, toY - fromY)
    const size = activeTool.value === 'brush' ? brushSettings.value.size : eraserSettings.value.size
    const step = size * 0.3
    const steps = Math.max(1, Math.ceil(dist / step))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      drawBrushStroke(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t)
    }
  }

  // --- clipboard ---

  function copySelectedRegion() {
    const sel = getSelectedRegion()
    if (!sel) return
    clipboard.value = { shape: sel.shape, width: sel.width, height: sel.height, name: sel.name, origX: sel.x, origY: sel.y, points: sel.points ? sel.points.map(p => ({ ...p })) : undefined }
    pasteCount.value = 0
  }

  function pasteRegion() {
    if (!clipboard.value || !getActiveImage()) return
    const src = clipboard.value
    const offset = 20 + pasteCount.value * 20
    const newX = src.origX + offset
    const newY = src.origY + offset
    const clamped = clampToImage(newX, newY, src.width, src.height)
    // generate unique name with incrementing suffix
    let baseName = `${src.name}_copy`
    let pasteName = baseName
    let counter = 2
    while (regions.some(r => r.name === pasteName)) {
      pasteName = `${baseName}${counter}`
      counter++
    }
    const region: CropRegion = {
      id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: pasteName,
      ...clamped,
      shape: src.shape,
      points: src.points ? src.points.map(p => ({ x: p.x + offset, y: p.y + offset })) : undefined,
    }
    pasteCount.value++
    snapshot?.()
    regions.push(region)
    selectRegion(region.id)
    markDirty()
  }

  // --- event handlers ---

  function handleMouseDown(e: MouseEvent) {
    const canvas = canvasRef.value!
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const sx = (e.clientX - rect.left) * dpr
    const sy = (e.clientY - rect.top) * dpr

    // reset any stale drawing/brushing state on every mousedown
    if (isDrawing.value) isDrawing.value = false
    if (isBrushing.value) { isBrushing.value = false; lastBrushPos.value = null }

    if (e.button === 1 || (e.button === 0 && spaceHeld.value)) {
      isPanning.value = true
      panStartMouse.value = { sx, sy }
      panStartOffset.value = { ox: view.offsetX, oy: view.offsetY }
      return
    }

    // right-click on vertex → delete; Ctrl+right-click on guide → delete guide
    if (e.button === 2) {
      if (e.ctrlKey || e.metaKey) {
        const ghit = hitTestGuide(sx, sy)
        if (ghit) {
          if (ghit.axis === 'h' && removeHGuide) removeHGuide(ghit.value)
          else if (ghit.axis === 'v' && removeVGuide) removeVGuide(ghit.value)
          return
        }
      }
      const vhit = hitTestVertex(sx, sy)
      if (vhit) {
        snapshot?.()
        deleteVertex(vhit.regionId, vhit.index)
      }
      return
    }

    if (e.button !== 0) return

    // Shift+click → pending marquee (activates on drag >3px)
    if (e.shiftKey) {
      // Ctrl+Shift → layer marquee; Shift only → region marquee
      if (e.ctrlKey || e.metaKey) {
        layerMarqueeStart.value = { sx, sy }
        const img = screenToImage(e.clientX, e.clientY)
        layerMarqueeImgStart.value = { ix: img.ix, iy: img.iy }
        layerMarqueeImgEnd.value = { ix: img.ix, iy: img.iy }
        return
      }
      marqueeStart.value = { sx, sy }
      const img = screenToImage(e.clientX, e.clientY)
      marqueeImgStart.value = { ix: img.ix, iy: img.iy }
      marqueeImgEnd.value = { ix: img.ix, iy: img.iy }
      return
    }

    // Ctrl+click in non-select mode:
    //   on layer → activate + drag (pending, activates on move >3px)
    if ((e.ctrlKey || e.metaKey) && activeTool.value !== 'select') {
      const hitL2 = hitTestLayer(sx, sy)
      if (hitL2) {
        activeLayerId.value = hitL2.id
        pendingCtrlDragLayer.value = { x: hitL2.x, y: hitL2.y, sx, sy }
        return
      }
    }

    // in non-select mode, clicking a region/text/control-point takes priority over the tool
    if (activeTool.value !== 'select') {
      const cp = hitTestControlPoint(sx, sy)
      if (cp) {
        // resize / move via control points
        if (cp.isText) {
          selectText(cp.id)
          isDragging.value = true
          draggingText.value = true
        } else {
          selectRegion(cp.id)
          isDragging.value = true
          draggingText.value = false
        }
        dragType.value = cp.type
        const obj = cp.isText
          ? textAnnotations.find(t => t.id === cp.id)
          : regions.find(r => r.id === cp.id)
        if (obj) {
          dragStartBounds.value = { x: obj.x, y: obj.y, width: obj.width, height: obj.height }
          if (!cp.isText) {
            const r = obj as CropRegion
            dragStartPoints.value = r.points ? r.points.map(p => ({ ...p })) : null
          }
        }
        dragStartMouse.value = { sx, sy }
        return
      }
      const hitR2 = hitTestRegion(sx, sy)
      if (hitR2) {
        // clear region multi-set if clicking outside the set
        if (!selectedRegionIds.value.has(hitR2.id)) {
          selectedRegionIds.value = new Set()
        }
        snapshot?.()
        selectRegion(hitR2.id)
        isDragging.value = true
        draggingText.value = false
        dragType.value = 'move'
        dragStartBounds.value = { x: hitR2.x, y: hitR2.y, width: hitR2.width, height: hitR2.height }
        dragStartPoints.value = hitR2.points ? hitR2.points.map(p => ({ ...p })) : null
        dragStartMultiBounds.value = null
        dragStartMouse.value = { sx, sy }
        return
      }
      const hitT2 = hitTestText(sx, sy)
      if (hitT2) {
        selectText(hitT2.id)
        isDragging.value = true
        draggingText.value = true
        dragType.value = 'move'
        dragStartBounds.value = { x: hitT2.x, y: hitT2.y, width: hitT2.width, height: hitT2.height }
        dragStartMouse.value = { sx, sy }
        return
      }
    }

    // in non-select mode, no region/text hit → clear multi-select before tool action
    if (activeTool.value !== 'select') {
      selectedRegionIds.value = new Set()
      selectedLayerIds.value = new Set()
    }

    // brush / eraser
    if (activeTool.value === 'brush' || activeTool.value === 'eraser') {
      snapshot?.()
      isBrushing.value = true
      const img = screenToImage(e.clientX, e.clientY)
      drawBrushStroke(img.ix, img.iy)
      lastBrushPos.value = { x: img.ix, y: img.iy }
      markDirty()
      return
    }

    // magic wand tool
    if (activeTool.value === 'magic-wand') {
      const wc = getWorkingCanvas()
      const layer = getActiveLayer()
      if (!wc || !layer) return
      const img = screenToImage(e.clientX, e.clientY)
      // offset seed to layer-local coords (accounting for position AND scale)
      const sx = Math.round((img.ix - layer.x) / layer.scaleX)
      const sy = Math.round((img.iy - layer.y) / layer.scaleY)
      if (sx < 0 || sy < 0 || sx >= wc.width || sy >= wc.height) return
      const wctx = wc.getContext('2d')!
      const tolerance = magicWandTolerance.value
      // 显示 loading 后再执行重操作
      isHeavyProcessing.value = true
      markDirty()
      requestAnimationFrame(() => {
        const imageData = wctx.getImageData(0, 0, wc.width, wc.height)
        const result = magicWandSelect(imageData, sx, sy, tolerance)
        if (result && ((result.shape === 'circle' || result.shape === 'roundrect') || (result.points && result.points.length >= 3))) {
          snapshot?.()
          const region: CropRegion = {
            id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: nextRegionName(),
            x: result.minX * layer.scaleX + layer.x, y: result.minY * layer.scaleY + layer.y,
            width: result.width * layer.scaleX, height: result.height * layer.scaleY,
            shape: result.shape || 'custom',
            points: result.points?.map(p => ({ x: p.x * layer.scaleX + layer.x, y: p.y * layer.scaleY + layer.y })),
          }
          regions.push(region)
          selectRegion(region.id)
          activeTool.value = 'select'
        }
        isHeavyProcessing.value = false
        markDirty()
      })
      return
    }

    // text tool
    if (activeTool.value === 'text') {
      const img = screenToImage(e.clientX, e.clientY)
      // check if clicking existing text
      const hitT = hitTestText(sx, sy)
      if (hitT) {
        selectText(hitT.id)
        isDragging.value = true
        draggingText.value = true
        dragType.value = 'move'
        dragStartBounds.value = { x: hitT.x, y: hitT.y, width: hitT.width, height: hitT.height }
        dragStartMouse.value = { sx, sy }
        return
      }
      // create new text annotation
      snapshot?.()
      const ta: TextAnnotation = {
        id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        text: '',
        x: img.ix, y: img.iy,
        width: 300, height: 60,
        fontSize: 44, fontColor: '#ffffff', fontWeight: 'bold',
      }
      textAnnotations.push(ta)
      selectText(ta.id)
      markDirty()
      return
    }

    // custom polygon tool
    if (activeTool.value === 'custom') {
      const img = screenToImage(e.clientX, e.clientY)
      // if clicking near first point and have 3+ points, close polygon
      if (customPoints.value.length >= 3) {
        const first = customPoints.value[0]
        const dist = Math.hypot(img.ix - first.x, img.iy - first.y)
        if (dist < 15 / view.scale) {
          finalizeCustomPolygon()
          return
        }
      }
      customPoints.value.push({ x: img.ix, y: img.iy })
      mouseImgPos.value = { x: img.ix, y: img.iy }
      markDirty()
      return
    }

    // check vertex drag
    const vhit2 = hitTestVertex(sx, sy)
    if (vhit2 && activeTool.value === 'select') {
      snapshot?.()
      isDraggingVertex.value = true
      draggingVertexIndex.value = vhit2.index
      draggingVertexRegionId.value = vhit2.regionId
      dragStartMouse.value = { sx, sy }
      const r = regions.find(r => r.id === vhit2.regionId)!
      dragStartBounds.value = r.points ? { x: r.points[vhit2.index].x, y: r.points[vhit2.index].y, width: 0, height: 0 } : null
      return
    }

    // check control point
    const cp = hitTestControlPoint(sx, sy)
    if (cp && activeTool.value === 'select') {
      snapshot?.()
      isDragging.value = true
      draggingText.value = cp.isText
      dragType.value = cp.type
      if (cp.isText) {
        const t = textAnnotations.find(t => t.id === cp.id)!
        dragStartBounds.value = { x: t.x, y: t.y, width: t.width, height: t.height }
      } else {
        const r = regions.find(r => r.id === cp.id)!
        dragStartBounds.value = { x: r.x, y: r.y, width: r.width, height: r.height }
        dragStartPoints.value = r.points ? r.points.map(p => ({ ...p })) : null
      }
      dragStartMouse.value = { sx, sy }
      return
    }

    // check region hit
    const hit = hitTestRegion(sx, sy)
    if (hit && activeTool.value === 'select') {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click → toggle region in multi-set, then start drag
        const newSet = new Set(selectedRegionIds.value)
        if (newSet.has(hit.id)) { newSet.delete(hit.id) } else { newSet.add(hit.id) }
        selectedRegionIds.value = newSet
      } else {
        // Normal click → clear multi-set if clicking outside
        if (!selectedRegionIds.value.has(hit.id)) {
          selectedRegionIds.value = new Set()
        }
      }
      snapshot?.()
      selectRegion(hit.id)
      isDragging.value = true
      draggingText.value = false
      dragType.value = 'move'
      dragStartBounds.value = { x: hit.x, y: hit.y, width: hit.width, height: hit.height }
      dragStartPoints.value = hit.points ? hit.points.map(p => ({ ...p })) : null
      dragStartMultiBounds.value = null
      dragStartMouse.value = { sx, sy }
      return
    }

    // check text hit
    const hitT2 = hitTestText(sx, sy)
    if (hitT2 && activeTool.value === 'select') {
      snapshot?.()
      selectText(hitT2.id)
      isDragging.value = true
      draggingText.value = true
      dragType.value = 'move'
      dragStartBounds.value = { x: hitT2.x, y: hitT2.y, width: hitT2.width, height: hitT2.height }
      dragStartMouse.value = { sx, sy }
      return
    }

    // check layer hit (for repositioning or resizing) — include small margin for handles
    const hitL = hitTestLayer(sx, sy)
    // also check active layer handles even if slightly outside bbox
    const al2 = getActiveLayer()
    let handleHit: string | null = null
    if (al2 && al2.visible && layers.value.length > 0) {
      const hsz = 12
      const lx = (al2.x - view.offsetX) * view.scale
      const ly = (al2.y - view.offsetY) * view.scale
      const lw = al2.image.naturalWidth * al2.scaleX * view.scale
      const lh = al2.image.naturalHeight * al2.scaleY * view.scale
      const lcx = lx + lw / 2, lcy = ly + lh / 2
      if (Math.abs(sx - lx) < hsz && Math.abs(sy - ly) < hsz) handleHit = 'nw'
      else if (Math.abs(sx - (lx + lw)) < hsz && Math.abs(sy - ly) < hsz) handleHit = 'ne'
      else if (Math.abs(sx - lx) < hsz && Math.abs(sy - (ly + lh)) < hsz) handleHit = 'sw'
      else if (Math.abs(sx - (lx + lw)) < hsz && Math.abs(sy - (ly + lh)) < hsz) handleHit = 'se'
      else if (Math.abs(sx - lcx) < hsz && Math.abs(sy - ly) < hsz) handleHit = 'n'
      else if (Math.abs(sx - lcx) < hsz && Math.abs(sy - (ly + lh)) < hsz) handleHit = 's'
      else if (Math.abs(sx - lx) < hsz && Math.abs(sy - lcy) < hsz) handleHit = 'w'
      else if (Math.abs(sx - (lx + lw)) < hsz && Math.abs(sy - lcy) < hsz) handleHit = 'e'
    }
    if (handleHit && (activeTool.value === 'select' || e.ctrlKey) && !hit && !hitT2) {
      snapshot?.()
      isResizingLayer.value = true
      layerResizeHandle.value = handleHit
      activeLayerId.value = al2!.id
      const sp = al2!
      dragStartLayerPos.value = { x: sp.x, y: sp.y, sx: sp.scaleX, sy: sp.scaleY, w: sp.image.naturalWidth, h: sp.image.naturalHeight }
      dragStartMouse.value = { sx, sy }
      return
    }
    if (hitL && activeTool.value === 'select' && !hit && !hitT2) {
      // clear layer multi-set only if clicking outside the set
      if (!selectedLayerIds.value.has(hitL.id)) {
        selectedLayerIds.value = new Set()
      }
      snapshot?.()
      activeLayerId.value = hitL.id
      isDraggingLayer.value = true
      dragStartLayerPos.value = { x: hitL.x, y: hitL.y, sx: 1, sy: 1, w: 0, h: 0 }
      dragStartMouse.value = { sx, sy }
      return
    }

    // click on empty area
    if (activeTool.value === 'select') {
      selectedRegionIds.value = new Set()
      selectedLayerIds.value = new Set()
      selectRegion(null)
      selectText(null)
    } else {
      // shape drawing
      const img = screenToImage(e.clientX, e.clientY)
      isDrawing.value = true
      drawStartX.value = img.ix
      drawStartY.value = img.iy
      drawCurrentX.value = img.ix
      drawCurrentY.value = img.iy
      selectRegion(null)
      selectText(null)
    }

    markDirty()
  }

  function handleMouseMove(e: MouseEvent) {
    const canvas = canvasRef.value!
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const sx = (e.clientX - rect.left) * dpr
    const sy = (e.clientY - rect.top) * dpr

    if (isPanning.value) {
      const dx = (sx - panStartMouse.value.sx) / view.scale
      const dy = (sy - panStartMouse.value.sy) / view.scale
      view.offsetX = panStartOffset.value.ox - dx
      view.offsetY = panStartOffset.value.oy - dy
      markDirty()
      return
    }

    // marquee selection
    if (marqueeStart.value) {
      if (!isMarquee.value) {
        if (Math.abs(sx - marqueeStart.value.sx) > 3 || Math.abs(sy - marqueeStart.value.sy) > 3) {
          isMarquee.value = true
        } else {
          return
        }
      }
      const img = screenToImage(e.clientX, e.clientY)
      marqueeImgEnd.value = { ix: img.ix, iy: img.iy }
      markDirty()
      return
    }

    // layer marquee (Ctrl+Shift)
    if (layerMarqueeStart.value) {
      if (!isLayerMarquee.value) {
        if (Math.abs(sx - layerMarqueeStart.value.sx) > 3 || Math.abs(sy - layerMarqueeStart.value.sy) > 3) {
          isLayerMarquee.value = true
        } else {
          return
        }
      }
      const img = screenToImage(e.clientX, e.clientY)
      layerMarqueeImgEnd.value = { ix: img.ix, iy: img.iy }
      markDirty()
      return
    }

    if (isBrushing.value) {
      const img = screenToImage(e.clientX, e.clientY)
      if (lastBrushPos.value) {
        drawBrushLine(lastBrushPos.value.x, lastBrushPos.value.y, img.ix, img.iy)
      } else {
        drawBrushStroke(img.ix, img.iy)
      }
      lastBrushPos.value = { x: img.ix, y: img.iy }
      markDirty()
      return
    }

    if (isDrawing.value) {
      const img = screenToImage(e.clientX, e.clientY)
      drawCurrentX.value = img.ix
      drawCurrentY.value = img.iy
      markDirty()
      return
    }

    // Ctrl+click → drag: activate when mouse moves past threshold
    if (pendingCtrlDragLayer.value) {
      const p = pendingCtrlDragLayer.value
      if (Math.abs(sx - p.sx) > 3 || Math.abs(sy - p.sy) > 3) {
        snapshot?.()
        isDraggingLayer.value = true
        dragStartLayerPos.value = { x: p.x, y: p.y, sx: 1, sy: 1, w: 0, h: 0 }
        dragStartMouse.value = { sx: p.sx, sy: p.sy }
        pendingCtrlDragLayer.value = null
        // fall through to layer dragging below
      } else {
        return
      }
    }

    // layer dragging
    if (isDraggingLayer.value) {
      const dx = (sx - dragStartMouse.value.sx) / view.scale
      const dy = (sy - dragStartMouse.value.sy) / view.scale
      const layer = getActiveLayer()
      if (!layer) return
      // multi-layer drag
      if (selectedLayerIds.value.size > 0 && selectedLayerIds.value.has(layer.id)) {
        if (!layerDragStartPositions.value) {
          const map = new Map<string, { x: number; y: number }>()
          for (const id of selectedLayerIds.value) {
            const l = layers.value.find(ll => ll.id === id)
            if (l) map.set(id, { x: l.x, y: l.y })
          }
          layerDragStartPositions.value = map
        }
        for (const id of selectedLayerIds.value) {
          const l = layers.value.find(ll => ll.id === id)
          const start = layerDragStartPositions.value.get(id)
          if (l && start) { l.x = start.x + dx; l.y = start.y + dy }
        }
      } else {
        layer.x = dragStartLayerPos.value.x + dx
        layer.y = dragStartLayerPos.value.y + dy
      }
      markDirty()
      return
    }
    if (isResizingLayer.value) {
      const dx = (sx - dragStartMouse.value.sx) / view.scale
      const dy = (sy - dragStartMouse.value.sy) / view.scale
      const layer = getActiveLayer()
      if (layer) {
        const sp = dragStartLayerPos.value
        const h = layerResizeHandle.value
        let nx = sp.x, ny = sp.y, nw = sp.w * sp.sx, nh = sp.h * sp.sy
        if (h.includes('e')) nw = sp.w * sp.sx + dx
        if (h.includes('w')) { nx = sp.x + dx; nw = sp.w * sp.sx - dx }
        if (h.includes('s')) nh = sp.h * sp.sy + dy
        if (h.includes('n')) { ny = sp.y + dy; nh = sp.h * sp.sy - dy }
        if (nw < 10) { if (h.includes('w')) nx = sp.x + sp.w * sp.sx - 10; nw = 10 }
        if (nh < 10) { if (h.includes('n')) ny = sp.y + sp.h * sp.sy - 10; nh = 10 }
        layer.x = nx; layer.y = ny
        layer.scaleX = Math.max(0.1, nw / sp.w)
        layer.scaleY = Math.max(0.1, nh / sp.h)
      }
      markDirty()
      return
    }

    // custom polygon preview
    if (activeTool.value === 'custom' && customPoints.value.length > 0) {
      const img = screenToImage(e.clientX, e.clientY)
      mouseImgPos.value = { x: img.ix, y: img.iy }
      markDirty()
    }

    if (isDraggingVertex.value && draggingVertexRegionId.value) {
      const img = screenToImage(e.clientX, e.clientY)
      const r = regions.find(r => r.id === draggingVertexRegionId.value)
      if (r && r.points && draggingVertexIndex.value >= 0) {
        r.points[draggingVertexIndex.value] = { x: img.ix, y: img.iy }
        const bbox = bboxFromPoints(r.points)
        r.x = bbox.x; r.y = bbox.y; r.width = bbox.width; r.height = bbox.height
      }
      markDirty()
      return
    }

    if (isDragging.value && dragStartBounds.value) {
      canvas.style.cursor = dragType.value === 'move' ? 'grabbing' : getResizeCursor(dragType.value!)
      const dsx = (sx - dragStartMouse.value.sx) / view.scale
      const dsy = (sy - dragStartMouse.value.sy) / view.scale
      const orig = dragStartBounds.value
      let nx = orig.x, ny = orig.y, nw = orig.width, nh = orig.height

      const dt = dragType.value
      if (dt === 'move') {
        nx = orig.x + dsx; ny = orig.y + dsy
      } else if (dt === 'resize-nw') { nx = orig.x + dsx; ny = orig.y + dsy; nw = orig.width - dsx; nh = orig.height - dsy }
      else if (dt === 'resize-ne') { ny = orig.y + dsy; nw = orig.width + dsx; nh = orig.height - dsy }
      else if (dt === 'resize-sw') { nx = orig.x + dsx; nw = orig.width - dsx; nh = orig.height + dsy }
      else if (dt === 'resize-se') { nw = orig.width + dsx; nh = orig.height + dsy }
      else if (dt === 'resize-n') { ny = orig.y + dsy; nh = orig.height - dsy }
      else if (dt === 'resize-s') { nh = orig.height + dsy }
      else if (dt === 'resize-e') { nw = orig.width + dsx }
      else if (dt === 'resize-w') { nx = orig.x + dsx; nw = orig.width - dsx }

      if (nw < 10) { if (dragType.value!.includes('w')) nx = orig.x + orig.width - 10; nw = 10 }
      if (nh < 10) { if (dragType.value!.includes('n')) ny = orig.y + orig.height - 10; nh = 10 }

      const clamped = clampToImage(nx, ny, nw, nh)

      if (draggingText.value) {
        const t = textAnnotations.find(t => t.id === (selectedTextId.value))
        if (t) { t.x = clamped.x; t.y = clamped.y; t.width = clamped.width; t.height = clamped.height }
      } else if (dt === 'move' && selectedRegionIds.value.size > 0 && selectedRegionIds.value.has(selectedRegionId.value!)) {
        // multi-region drag: lazy-init start bounds, then apply delta to all
        if (!dragStartMultiBounds.value) {
          const map = new Map<string, { x: number; y: number; width: number; height: number; points?: { x: number; y: number }[] }>()
          for (const id of selectedRegionIds.value) {
            const rr = regions.find(rr => rr.id === id)
            if (rr) {
              map.set(id, {
                x: rr.x, y: rr.y, width: rr.width, height: rr.height,
                points: rr.points ? rr.points.map(p => ({ ...p })) : undefined,
              })
            }
          }
          dragStartMultiBounds.value = map
        }
        const dx = clamped.x - orig.x
        const dy = clamped.y - orig.y
        for (const id of selectedRegionIds.value) {
          const rr = regions.find(rr => rr.id === id)
          const start = dragStartMultiBounds.value.get(id)
          if (!rr || !start) continue
          rr.x = start.x + dx
          rr.y = start.y + dy
          rr.width = start.width
          rr.height = start.height
          if (rr.points && start.points) {
            for (let i = 0; i < rr.points.length; i++) {
              rr.points[i].x = start.points[i].x + dx
              rr.points[i].y = start.points[i].y + dy
            }
          }
        }
      } else {
        const r = regions.find(r => r.id === selectedRegionId.value)
        if (r) {
          if (r.points && dragStartPoints.value) {
            const dt = dragType.value
            if (dt === 'move') {
              const dx = clamped.x - orig.x
              const dy = clamped.y - orig.y
              for (let i = 0; i < r.points.length; i++) {
                r.points[i].x = dragStartPoints.value[i].x + dx
                r.points[i].y = dragStartPoints.value[i].y + dy
              }
            } else if (dt) {
              // scale points based on resize anchor
              const ow = orig.width || 1, oh = orig.height || 1
              const cw = clamped.width, ch = clamped.height
              let anchorX = orig.x, anchorY = orig.y, sx = cw / ow, sy = ch / oh
              if (dt === 'resize-se') { anchorX = orig.x; anchorY = orig.y }
              else if (dt === 'resize-nw') { anchorX = orig.x + ow; anchorY = orig.y + oh; sx = cw / ow; sy = ch / oh }
              else if (dt === 'resize-ne') { anchorX = orig.x; anchorY = orig.y + oh }
              else if (dt === 'resize-sw') { anchorX = orig.x + ow; anchorY = orig.y }
              else if (dt === 'resize-n') { anchorX = orig.x; anchorY = orig.y + oh; sx = 1 }
              else if (dt === 'resize-s') { anchorX = orig.x; anchorY = orig.y; sx = 1 }
              else if (dt === 'resize-e') { anchorX = orig.x; anchorY = orig.y; sy = 1 }
              else if (dt === 'resize-w') { anchorX = orig.x + ow; anchorY = orig.y; sy = 1 }
              for (let i = 0; i < r.points.length; i++) {
                r.points[i].x = anchorX + (dragStartPoints.value[i].x - anchorX) * sx
                r.points[i].y = anchorY + (dragStartPoints.value[i].y - anchorY) * sy
              }
            }
          }
          r.x = clamped.x; r.y = clamped.y; r.width = clamped.width; r.height = clamped.height
        }
      }

      markDirty()
      return
    }

    updateCursor(sx, sy)
  }

  function handleMouseUp(_e: MouseEvent) {
    if (isPanning.value) { isPanning.value = false; return }

    // marquee finalize
    if (isMarquee.value) {
      isMarquee.value = false
      marqueeStart.value = null
      // select all regions whose center is inside the marquee rect (replace)
      const mx = Math.min(marqueeImgStart.value.ix, marqueeImgEnd.value.ix)
      const my = Math.min(marqueeImgStart.value.iy, marqueeImgEnd.value.iy)
      const mw = Math.abs(marqueeImgEnd.value.ix - marqueeImgStart.value.ix)
      const mh = Math.abs(marqueeImgEnd.value.iy - marqueeImgStart.value.iy)
      const newSet = new Set<string>()
      for (const r of regions) {
        const rcx = r.x + r.width / 2
        const rcy = r.y + r.height / 2
        if (rcx >= mx && rcx <= mx + mw && rcy >= my && rcy <= my + mh) {
          newSet.add(r.id)
        }
      }
      selectedRegionIds.value = newSet
      if (newSet.size > 0) selectedRegionId.value = [...newSet][0]
      markDirty()
      return
    }
    // layer marquee finalize (Ctrl+Shift)
    if (isLayerMarquee.value) {
      isLayerMarquee.value = false
      layerMarqueeStart.value = null
      const mx = Math.min(layerMarqueeImgStart.value.ix, layerMarqueeImgEnd.value.ix)
      const my = Math.min(layerMarqueeImgStart.value.iy, layerMarqueeImgEnd.value.iy)
      const mw = Math.abs(layerMarqueeImgEnd.value.ix - layerMarqueeImgStart.value.ix)
      const mh = Math.abs(layerMarqueeImgEnd.value.iy - layerMarqueeImgStart.value.iy)
      const newSet = new Set<string>()
      for (const l of layers.value) {
        if (!l.visible) continue
        const cx = l.x + l.image.naturalWidth * l.scaleX / 2
        const cy = l.y + l.image.naturalHeight * l.scaleY / 2
        if (cx >= mx && cx <= mx + mw && cy >= my && cy <= my + mh) {
          newSet.add(l.id)
        }
      }
      selectedLayerIds.value = newSet
      markDirty()
      return
    }
    // pending layer marquee that never activated → toggle layer under cursor
    if (layerMarqueeStart.value) {
      layerMarqueeStart.value = null
      const canvas = canvasRef.value!
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const sx = (_e.clientX - rect.left) * dpr
      const sy = (_e.clientY - rect.top) * dpr
      const hitL = hitTestLayer(sx, sy)
      if (hitL) {
        const newSet = new Set(selectedLayerIds.value)
        if (newSet.has(hitL.id)) { newSet.delete(hitL.id) } else { newSet.add(hitL.id) }
        selectedLayerIds.value = newSet
      }
      return
    }
    // pending marquee that never activated → toggle region under cursor
    if (marqueeStart.value) {
      marqueeStart.value = null
      const canvas = canvasRef.value!
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const sx = (_e.clientX - rect.left) * dpr
      const sy = (_e.clientY - rect.top) * dpr
      const hit = hitTestRegion(sx, sy)
      if (hit) {
        const newSet = new Set(selectedRegionIds.value)
        if (newSet.has(hit.id)) { newSet.delete(hit.id) } else { newSet.add(hit.id) }
        selectedRegionIds.value = newSet
        selectRegion(hit.id)
      }
      return
    }

    // clean up pending ctrl+drag (was just a click, no drag)
    if (pendingCtrlDragLayer.value) {
      pendingCtrlDragLayer.value = null
      return
    }

    if (isBrushing.value) {
      isBrushing.value = false
      lastBrushPos.value = null
      return
    }

    if (isDraggingLayer.value) {
      isDraggingLayer.value = false
      layerDragStartPositions.value = null
      markDirty()
      return
    }
    if (isResizingLayer.value) {
      isResizingLayer.value = false
      layerResizeHandle.value = ''
      markDirty()
      return
    }

    if (isDrawing.value) {
      const x1 = Math.min(drawStartX.value, drawCurrentX.value)
      const y1 = Math.min(drawStartY.value, drawCurrentY.value)
      const w = Math.abs(drawCurrentX.value - drawStartX.value)
      const h = Math.abs(drawCurrentY.value - drawStartY.value)
      isDrawing.value = false

      if (w > 2 && h > 2) {
        snapshot?.()
        const clamped = clampToImage(x1, y1, w, h)
        const region: CropRegion = {
          id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: nextRegionName(),
          ...clamped,
          shape: activeTool.value as ShapeType,
        }
        regions.push(region)
        selectRegion(region.id)
      }
      markDirty()
      return
    }

    if (isDraggingVertex.value) {
      isDraggingVertex.value = false
      draggingVertexIndex.value = -1
      draggingVertexRegionId.value = null
      dragStartBounds.value = null
      markDirty()
      return
    }

    if (isDragging.value) {
      isDragging.value = false
      draggingText.value = false
      dragType.value = null
      dragStartBounds.value = null
      dragStartPoints.value = null
      dragStartMultiBounds.value = null
      markDirty()
      return
    }
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault()
    const canvas = canvasRef.value!
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const sx = (e.clientX - rect.left) * dpr
    const sy = (e.clientY - rect.top) * dpr
    const ix = sx / view.scale + view.offsetX
    const iy = sy / view.scale + view.offsetY
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    view.scale = clamp(view.scale * factor, 0.02, 50)
    view.offsetX = ix - sx / view.scale
    view.offsetY = iy - sy / view.scale
    markDirty()
  }

  function handleContextMenu(e: Event) { e.preventDefault() }

  function handleDoubleClick(_e: MouseEvent) {
    if (_e.ctrlKey) return // Ctrl+click already handles layer switch + drag

    if (activeTool.value === 'custom' && customPoints.value.length >= 3) {
      finalizeCustomPolygon()
      return
    }
    const canvas = canvasRef.value!
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const sx = (_e.clientX - rect.left) * dpr
    const sy = (_e.clientY - rect.top) * dpr

    // double-click on a polygon edge to add a vertex (select mode)
    if (activeTool.value === 'select') {
      const seg = hitTestLineSegment(sx, sy)
      if (seg) {
        snapshot?.()
        const r = regions.find(r => r.id === seg.regionId)
        if (r && r.points) {
          const mx = (r.points[seg.index].x + r.points[(seg.index + 1) % r.points.length].x) / 2
          const my = (r.points[seg.index].y + r.points[(seg.index + 1) % r.points.length].y) / 2
          r.points.splice(seg.index + 1, 0, { x: mx, y: my })
          const bbox = bboxFromPoints(r.points)
          r.x = bbox.x; r.y = bbox.y; r.width = bbox.width; r.height = bbox.height
          markDirty()
        }
        return
      }
    }

    // double-click to select region/text when not in select mode
    if (activeTool.value !== 'select') {
      const hit = hitTestRegion(sx, sy)
      if (hit) {
        selectRegion(hit.id)
        activeTool.value = 'select'
        return
      }
      const hitT = hitTestText(sx, sy)
      if (hitT) {
        selectText(hitT.id)
        activeTool.value = 'select'
        return
      }
    }
  }

  function getResizeCursor(type: string): string {
    const map: Record<string, string> = {
      'resize-nw': 'nwse-resize', 'resize-se': 'nwse-resize',
      'resize-ne': 'nesw-resize', 'resize-sw': 'nesw-resize',
      'resize-n': 'ns-resize', 'resize-s': 'ns-resize',
      'resize-e': 'ew-resize', 'resize-w': 'ew-resize',
    }
    return map[type] ?? 'default'
  }

  function updateCursor(sx: number, sy: number) {
    const canvas = canvasRef.value
    if (!canvas) return

    if (spaceHeld.value) {
      canvas.style.cursor = 'grab'
      return
    }

    if (activeTool.value === 'brush' || activeTool.value === 'eraser') {
      const size = activeTool.value === 'brush' ? brushSettings.value.size : eraserSettings.value.size
      const cs = size * view.scale
      // draw cursor circle via CSS custom property or use a crosshair
      canvas.style.cursor = 'crosshair'
      // store cursor size for render
      ;(canvas as any)._cursorSize = cs
      ;(canvas as any)._cursorTool = activeTool.value
      return
    }

    if (activeTool.value === 'text') {
      canvas.style.cursor = 'text'
      return
    }

    if (activeTool.value === 'magic-wand') {
      canvas.style.cursor = 'pointer'
      return
    }

    if (activeTool.value !== 'select') {
      canvas.style.cursor = 'crosshair'
      return
    }

    const cp = hitTestControlPoint(sx, sy)
    if (cp) {
      canvas.style.cursor = getResizeCursor(cp.type)
      return
    }

    // check layer resize handles
    const al = getActiveLayer()
    if (al && al.visible && layers.value.length > 0) {
      const hsz = 10
      const lx = (al.x - view.offsetX) * view.scale
      const ly = (al.y - view.offsetY) * view.scale
      const lw = al.image.naturalWidth * al.scaleX * view.scale
      const lh = al.image.naturalHeight * al.scaleY * view.scale
      const lcx = lx + lw / 2, lcy = ly + lh / 2
      let cursor = ''
      if (Math.abs(sx - lx) < hsz && Math.abs(sy - ly) < hsz) cursor = 'nwse-resize'
      else if (Math.abs(sx - (lx + lw)) < hsz && Math.abs(sy - ly) < hsz) cursor = 'nesw-resize'
      else if (Math.abs(sx - lx) < hsz && Math.abs(sy - (ly + lh)) < hsz) cursor = 'nesw-resize'
      else if (Math.abs(sx - (lx + lw)) < hsz && Math.abs(sy - (ly + lh)) < hsz) cursor = 'nwse-resize'
      else if (Math.abs(sx - lcx) < hsz && Math.abs(sy - ly) < hsz) cursor = 'ns-resize'
      else if (Math.abs(sx - lcx) < hsz && Math.abs(sy - (ly + lh)) < hsz) cursor = 'ns-resize'
      else if (Math.abs(sx - lx) < hsz && Math.abs(sy - lcy) < hsz) cursor = 'ew-resize'
      else if (Math.abs(sx - (lx + lw)) < hsz && Math.abs(sy - lcy) < hsz) cursor = 'ew-resize'
      if (cursor) { canvas.style.cursor = cursor; return }
      // check if hovering over layer body
      if (Math.abs(sx - lcx) < lw / 2 && Math.abs(sy - lcy) < lh / 2) {
        canvas.style.cursor = 'move'; return
      }
    }

    const hit = hitTestRegion(sx, sy) || hitTestText(sx, sy)
    canvas.style.cursor = hit ? 'grab' : 'default'
  }

  // --- rendering ---

  function render() {
    renderRaf = 0
    dirty = false
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const hasImage = layers.value.length > 0

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!hasImage) {
      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#555'
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      return
    }

    // checkerboard
    const cs = 10
    ctx.fillStyle = '#2a2a3a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#353545'
    for (let cy = 0; cy < canvas.height; cy += cs * 2) {
      for (let cx = 0; cx < canvas.width; cx += cs * 2) {
        ctx.fillRect(cx + ((Math.floor(cy / cs) % 2) * cs), cy, cs, cs)
      }
    }

    // draw all visible layers (layers[0] = top of sidebar = top of canvas)
    const visibleLayers = layers.value.filter(l => l.visible).reverse()
    for (const layer of visibleLayers) {
      const img = layer.image
      const natW = img.naturalWidth * layer.scaleX, natH = img.naturalHeight * layer.scaleY
      const ldx = (layer.x - view.offsetX) * view.scale
      const ldy = (layer.y - view.offsetY) * view.scale
      const ldw = natW * view.scale
      const ldh = natH * view.scale

      if (showOriginal.value || !layer.workingCanvas) {
        ctx.drawImage(img, ldx, ldy, ldw, ldh)
      } else {
        ctx.drawImage(layer.workingCanvas, ldx, ldy, ldw, ldh)
      }

      // layer name label at top-left
      ctx.save()
      ctx.font = '11px sans-serif'
      const labelW = ctx.measureText(layer.name).width + 12
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(ldx, ldy, labelW, 20)
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(layer.name, ldx + 6, ldy + 10)
      ctx.restore()

      // secondary outline for multi-selected layers (non-active)
      if (layer.id !== activeLayerId.value && selectedLayerIds.value.has(layer.id)) {
        ctx.save()
        ctx.strokeStyle = '#00e5ff'
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 3])
        ctx.strokeRect(ldx, ldy, ldw, ldh)
        ctx.setLineDash([])
        ctx.restore()
      }
    }

    // active layer outline + handles — drawn after all layers so always visible
    const al = getActiveLayer()
    if (al && al.visible && layers.value.length > 0) {
      const natW = al.image.naturalWidth * al.scaleX, natH = al.image.naturalHeight * al.scaleY
      const ldx = (al.x - view.offsetX) * view.scale
      const ldy = (al.y - view.offsetY) * view.scale
      const ldw = natW * view.scale
      const ldh = natH * view.scale
      ctx.save()
      ctx.strokeStyle = '#4fc3f7'
      ctx.lineWidth = 2.5
      ctx.setLineDash([5, 3])
      ctx.strokeRect(ldx, ldy, ldw, ldh)
      ctx.setLineDash([])
      const hs = 6
      ctx.fillStyle = '#4fc3f7'
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1
      const corners = [
        [ldx, ldy], [ldx + ldw, ldy], [ldx, ldy + ldh], [ldx + ldw, ldy + ldh],
        [ldx + ldw / 2, ldy], [ldx + ldw / 2, ldy + ldh],
        [ldx, ldy + ldh / 2], [ldx + ldw, ldy + ldh / 2],
      ]
      for (const [cx, cy] of corners) {
        ctx.fillRect(cx - hs, cy - hs, hs * 2, hs * 2)
        ctx.strokeRect(cx - hs, cy - hs, hs * 2, hs * 2)
      }
      ctx.restore()
    }

    // --- guide lines ---
    for (const y of hGuides.value) {
      const gy = (y - view.offsetY) * view.scale
      ctx.save()
      ctx.strokeStyle = '#00e5ff'
      ctx.lineWidth = 1
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(0, gy)
      ctx.lineTo(canvas.width, gy)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }
    for (const x of vGuides.value) {
      const gx = (x - view.offsetX) * view.scale
      ctx.save()
      ctx.strokeStyle = '#00e5ff'
      ctx.lineWidth = 1
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(gx, 0)
      ctx.lineTo(gx, canvas.height)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }

    // --- marquee rectangle ---
    if (isMarquee.value) {
      const mx = Math.min(marqueeImgStart.value.ix, marqueeImgEnd.value.ix)
      const my = Math.min(marqueeImgStart.value.iy, marqueeImgEnd.value.iy)
      const mw = Math.abs(marqueeImgEnd.value.ix - marqueeImgStart.value.ix)
      const mh = Math.abs(marqueeImgEnd.value.iy - marqueeImgStart.value.iy)
      const sx = (mx - view.offsetX) * view.scale
      const sy = (my - view.offsetY) * view.scale
      const sw = mw * view.scale
      const sh = mh * view.scale
      ctx.save()
      ctx.fillStyle = 'rgba(79,195,247,0.08)'
      ctx.fillRect(sx, sy, sw, sh)
      ctx.strokeStyle = '#4fc3f7'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.strokeRect(sx, sy, sw, sh)
      ctx.setLineDash([])
      ctx.restore()
    }

    // --- layer marquee rectangle ---
    if (isLayerMarquee.value) {
      const mx = Math.min(layerMarqueeImgStart.value.ix, layerMarqueeImgEnd.value.ix)
      const my = Math.min(layerMarqueeImgStart.value.iy, layerMarqueeImgEnd.value.iy)
      const mw = Math.abs(layerMarqueeImgEnd.value.ix - layerMarqueeImgStart.value.ix)
      const mh = Math.abs(layerMarqueeImgEnd.value.iy - layerMarqueeImgStart.value.iy)
      const sx = (mx - view.offsetX) * view.scale
      const sy = (my - view.offsetY) * view.scale
      const sw = mw * view.scale
      const sh = mh * view.scale
      ctx.save()
      ctx.fillStyle = 'rgba(0,229,255,0.08)'
      ctx.fillRect(sx, sy, sw, sh)
      ctx.strokeStyle = '#00e5ff'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.strokeRect(sx, sy, sw, sh)
      ctx.setLineDash([])
      ctx.restore()
    }

    // dark overlay with region cutouts — covers full canvas
    if (!showOriginal.value) {
    const odx = 0, ody = 0, odw = canvas.width, odh = canvas.height
    ctx.save()
    ctx.beginPath()
    ctx.rect(odx, ody, odw, odh)
    for (const r of regions) {
      const rcx = (r.x + r.width / 2 - view.offsetX) * view.scale
      const rcy = (r.y + r.height / 2 - view.offsetY) * view.scale
      const rw = r.width * view.scale
      const rh = r.height * view.scale
      addShapeToPath(ctx, r.shape, rcx, rcy, rw, rh, screenPoints(r), r.borderRadius != null ? r.borderRadius * view.scale : undefined)
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fill('evenodd')
    ctx.restore()

    // region overlays
    for (const r of regions) {
      const isSelected = r.id === selectedRegionId.value
      const isMultiSelected = !isSelected && selectedRegionIds.value.has(r.id)
      const primary = isSelected || isMultiSelected
      const rcx = (r.x + r.width / 2 - view.offsetX) * view.scale
      const rcy = (r.y + r.height / 2 - view.offsetY) * view.scale
      const rw = r.width * view.scale
      const rh = r.height * view.scale

      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.3)'
      ctx.shadowBlur = 6
      ctx.strokeStyle = isSelected ? '#4fc3f7' : isMultiSelected ? '#6fc8f7' : 'rgba(255,255,255,0.7)'
      ctx.lineWidth = isSelected ? 2.5 : isMultiSelected ? 1.8 : 1.5
      drawShapePath(ctx, r.shape, rcx, rcy, rw, rh, screenPoints(r), r.borderRadius != null ? r.borderRadius * view.scale : undefined)
      ctx.stroke()
      ctx.restore()

      ctx.save()
      ctx.fillStyle = isSelected ? 'rgba(79,195,247,0.12)' : isMultiSelected ? 'rgba(111,200,247,0.08)' : 'rgba(255,255,255,0.06)'
      ctx.shadowColor = 'rgba(0,0,0,0.25)'
      ctx.shadowBlur = primary ? 8 : 4
      drawShapePath(ctx, r.shape, rcx, rcy, rw, rh, screenPoints(r), r.borderRadius != null ? r.borderRadius * view.scale : undefined)
      ctx.fill()
      ctx.restore()

      const lx = rcx - rw / 2
      const ly = rcy - rh / 2 - 6
      ctx.fillStyle = isSelected ? '#4fc3f7' : isMultiSelected ? '#6fc8f7' : '#ddd'
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'left'
      const labelText = `${r.name} (${Math.round(r.width)} × ${Math.round(r.height)})`
      ctx.fillText(labelText, lx, Math.max(ly, 14))

      // only draw control points for primary selected region
      if (isSelected) {
        const pts = getControlPoints(r.x, r.y, r.width, r.height, view)
        for (const pt of pts) {
          ctx.fillStyle = '#4fc3f7'
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 1.5
          ctx.fillRect(pt.sx - CP_HALF, pt.sy - CP_HALF, CP_HALF * 2, CP_HALF * 2)
          ctx.strokeRect(pt.sx - CP_HALF, pt.sy - CP_HALF, CP_HALF * 2, CP_HALF * 2)
        }
      }
    } // end region overlays loop

    // draw text annotations (on top of overlay)
    for (const t of textAnnotations) {
      const tx = (t.x - view.offsetX) * view.scale
      const ty = (t.y - view.offsetY) * view.scale
      const tw = t.width * view.scale
      const th = t.height * view.scale
      const fs = t.fontSize * view.scale
      const lineHeight = fs * 1.3
      const maxWidth = tw - 8 * view.scale

      ctx.save()
      ctx.beginPath()
      ctx.rect(tx, ty, tw, th)
      ctx.clip()
      ctx.font = `${t.fontWeight} ${fs}px sans-serif`
      ctx.fillStyle = t.fontColor
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'

      const chars = [...t.text]
      let line = ''
      let ly = ty + 4 * view.scale
      for (const ch of chars) {
        const testLine = line + ch
        if (ctx.measureText(testLine).width > maxWidth && line.length > 0) {
          ctx.fillText(line, tx + 4 * view.scale, ly)
          line = ch
          ly += lineHeight
        } else {
          line = testLine
        }
      }
      if (line) {
        ctx.fillText(line, tx + 4 * view.scale, ly)
      }
      ctx.restore()

      const isSelected = t.id === selectedTextId.value
      ctx.save()
      ctx.strokeStyle = isSelected ? '#ffcc80' : 'rgba(255,255,255,0.3)'
      ctx.lineWidth = isSelected ? 2 : 1
      ctx.setLineDash(isSelected ? [] : [4, 4])
      ctx.strokeRect(tx, ty, tw, th)
      ctx.setLineDash([])
      ctx.restore()

      if (isSelected) {
        const pts = getControlPoints(t.x, t.y, t.width, t.height, view)
        for (const pt of pts) {
          ctx.fillStyle = '#ffcc80'
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 1.5
          ctx.fillRect(pt.sx - CP_HALF, pt.sy - CP_HALF, CP_HALF * 2, CP_HALF * 2)
          ctx.strokeRect(pt.sx - CP_HALF, pt.sy - CP_HALF, CP_HALF * 2, CP_HALF * 2)
        }
      }
    }
    } // end if (!showOriginal.value)

    // drawing preview
    if (isDrawing.value) {
      const px = Math.min(drawStartX.value, drawCurrentX.value)
      const py = Math.min(drawStartY.value, drawCurrentY.value)
      const pw = Math.abs(drawCurrentX.value - drawStartX.value)
      const ph = Math.abs(drawCurrentY.value - drawStartY.value)
      const pcx = (px + pw / 2 - view.offsetX) * view.scale
      const pcy = (py + ph / 2 - view.offsetY) * view.scale
      const psw = pw * view.scale
      const psh = ph * view.scale
      ctx.save()
      ctx.strokeStyle = '#ff9800'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])
      drawShapePath(ctx, activeTool.value as ShapeType, pcx, pcy, psw, psh)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(255,152,0,0.08)'
      drawShapePath(ctx, activeTool.value as ShapeType, pcx, pcy, psw, psh)
      ctx.fill()
      ctx.restore()
    }

    // custom polygon preview
    if (customPoints.value.length > 0) {
      ctx.save()
      // draw lines between points
      ctx.strokeStyle = '#ff9800'
      ctx.lineWidth = 2
      ctx.setLineDash([])
      if (customPoints.value.length >= 2) {
        ctx.beginPath()
        for (let i = 0; i < customPoints.value.length; i++) {
          const sx = (customPoints.value[i].x - view.offsetX) * view.scale
          const sy = (customPoints.value[i].y - view.offsetY) * view.scale
          if (i === 0) ctx.moveTo(sx, sy)
          else ctx.lineTo(sx, sy)
        }
        ctx.stroke()
      }
      // preview line to cursor
      if (customPoints.value.length >= 1) {
        const last = customPoints.value[customPoints.value.length - 1]
        const lx = (last.x - view.offsetX) * view.scale
        const ly = (last.y - view.offsetY) * view.scale
        const mx = (mouseImgPos.value.x - view.offsetX) * view.scale
        const my = (mouseImgPos.value.y - view.offsetY) * view.scale
        ctx.beginPath()
        ctx.setLineDash([6, 3])
        ctx.moveTo(lx, ly)
        ctx.lineTo(mx, my)
        ctx.stroke()
        ctx.setLineDash([])
      }
      // draw vertex dots
      ctx.fillStyle = '#ff9800'
      for (const pt of customPoints.value) {
        const sx = (pt.x - view.offsetX) * view.scale
        const sy = (pt.y - view.offsetY) * view.scale
        ctx.beginPath()
        ctx.arc(sx, sy, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      // fill polygon if 3+ points
      if (customPoints.value.length >= 3) {
        ctx.beginPath()
        ctx.moveTo(
          (customPoints.value[0].x - view.offsetX) * view.scale,
          (customPoints.value[0].y - view.offsetY) * view.scale,
        )
        for (let i = 1; i < customPoints.value.length; i++) {
          ctx.lineTo(
            (customPoints.value[i].x - view.offsetX) * view.scale,
            (customPoints.value[i].y - view.offsetY) * view.scale,
          )
        }
        ctx.closePath()
        ctx.fillStyle = 'rgba(255,152,0,0.08)'
        ctx.fill()
      }
      ctx.restore()
    }

    // render vertex dots for selected custom region
    const sel = getSelectedRegion()
    if (sel && sel.shape === 'custom' && sel.points) {
      for (let i = 0; i < sel.points.length; i++) {
        const vx = (sel.points[i].x - view.offsetX) * view.scale
        const vy = (sel.points[i].y - view.offsetY) * view.scale
        ctx.fillStyle = '#4fc3f7'
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(vx, vy, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
    }

    // brush/eraser cursor
    const cvsAny = canvas as any
    if (cvsAny._cursorSize && cvsAny._cursorTool) {
    }

    // Not used here — CSS cursor handles it
  }

  function scheduleRender() { markDirty() }

  // --- watchers ---

  watch([selectedRegionId, activeTool], () => {
    if (activeTool.value !== 'text') cleanupEmptyText()
    if (activeTool.value !== 'custom') customPoints.value = []
    markDirty()
  })
  watch([brushSettings, eraserSettings], () => markDirty(), { deep: true })
  watch(showOriginal, () => markDirty())
  watch(constrainToImage, () => markDirty())
  watch(magicWandTolerance, () => markDirty())
  watch(layers, () => markDirty(), { deep: true })
  watch(activeLayerId, () => markDirty())
  watch(canvasVersion, () => markDirty())

  // --- init ---

  function initCanvas() {
    const container = containerRef.value
    const canvas = canvasRef.value
    if (!container || !canvas) return

    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect()
      canvas.width = rect.width * window.devicePixelRatio
      canvas.height = rect.height * window.devicePixelRatio
      canvas.style.width = rect.width + 'px'
      canvas.style.height = rect.height + 'px'
      markDirty()
    })
    ro.observe(container)

    canvas.addEventListener('mousedown', handleMouseDown)
    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseup', handleMouseUp)
    canvas.addEventListener('mouseleave', handleMouseUp)
    canvas.addEventListener('dblclick', handleDoubleClick)
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    canvas.addEventListener('contextmenu', handleContextMenu)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        spaceHeld.value = true
        if (canvasRef.value) canvasRef.value.style.cursor = 'grab'
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld.value = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    markDirty()
  }

  function destroy() { cancelAnimationFrame(renderRaf) }

  return {
    view, isDrawing, loadImage, fitToCanvas,
    selectRegion, selectText, getSelectedRegion, getSelectedText,
    initCanvas, destroy, scheduleRender,
    copySelectedRegion, pasteRegion,
    canCopy: () => !!getSelectedRegion(),
    canPaste: () => !!clipboard.value && !!getActiveImage(),
    getWorkingCanvas,
    cancelCustomPolygon,
    finalizeCustomPolygon,
  }
}
