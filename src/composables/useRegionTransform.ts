import type { CropRegion } from '../types'

// ---- outline sampling ----

/** Sample a shape's outline into polygon vertices. Rect/circle use many samples for fidelity. */
function getShapeOutline(r: CropRegion): { x: number; y: number }[] {
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  const w = r.width
  const h = r.height

  switch (r.shape) {
    case 'custom':
      return (r.points && r.points.length >= 3) ? r.points : rectCorners(r)
    case 'rect':
    case 'roundrect':
      return rectCorners(r)
    case 'circle': {
      const rx = w / 2
      const ry = h / 2
      const pts: { x: number; y: number }[] = []
      const steps = 32
      for (let i = 0; i < steps; i++) {
        const a = (Math.PI * 2 * i) / steps
        pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry })
      }
      return pts
    }
    case 'triangle':
      return [
        { x: cx, y: r.y },
        { x: r.x + w, y: r.y + h },
        { x: r.x, y: r.y + h },
      ]
    case 'diamond':
      return [
        { x: cx, y: r.y },
        { x: r.x + w, y: cy },
        { x: cx, y: r.y + h },
        { x: r.x, y: cy },
      ]
    case 'star': {
      // matches starPathNoBegin in shapeUtils.ts
      const outerR = Math.min(w, h) / 2
      const innerR = Math.min(w, h) / 4.5
      const pts: { x: number; y: number }[] = []
      const spikes = 5
      const rot = -Math.PI / 2
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR
        const a = rot + (Math.PI * i) / spikes
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
      }
      return pts
    }
    case 'heart': {
      // matches heartPathNoBegin in shapeUtils.ts — sample 4 cubic beziers
      const top = r.y
      const bottom = r.y + h
      const left = r.x
      const right = r.x + w
      const samples = 8 // per bezier segment

      function bezier(t: number, p0x: number, p0y: number, p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number) {
        const u = 1 - t, u2 = u * u, u3 = u2 * u, t2 = t * t, t3 = t2 * t
        return {
          x: u3 * p0x + 3 * u2 * t * p1x + 3 * u * t2 * p2x + t3 * p3x,
          y: u3 * p0y + 3 * u2 * t * p1y + 3 * u * t2 * p2y + t3 * p3y,
        }
      }

      const pts: { x: number; y: number }[] = []
      // Curve 1: (cx, bottom) → left side → (cx - w*0.2, top)
      for (let i = 0; i <= samples; i++) {
        pts.push(bezier(i / samples,
          cx, bottom,
          left, cy + h * 0.3,
          left, top + h * 0.05,
          cx - w * 0.2, top,
        ))
      }
      // Curve 2: (cx - w*0.2, top) → center dip → (cx, top + h*0.3)
      for (let i = 0; i <= samples; i++) {
        pts.push(bezier(i / samples,
          cx - w * 0.2, top,
          cx - w * 0.05, top + h * 0.02,
          cx, top + h * 0.02,
          cx, top + h * 0.3,
        ))
      }
      // Curve 3: (cx, top + h*0.3) → right lobe → (cx + w*0.2, top)
      for (let i = 0; i <= samples; i++) {
        pts.push(bezier(i / samples,
          cx, top + h * 0.3,
          cx, top + h * 0.02,
          cx + w * 0.05, top + h * 0.02,
          cx + w * 0.2, top,
        ))
      }
      // Curve 4: (cx + w*0.2, top) → right side → (cx, bottom)
      for (let i = 0; i <= samples; i++) {
        pts.push(bezier(i / samples,
          cx + w * 0.2, top,
          right, top + h * 0.05,
          right, cy + h * 0.3,
          cx, bottom,
        ))
      }
      return pts
    }
    default:
      return rectCorners(r)
  }
}

function rectCorners(r: CropRegion): { x: number; y: number }[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ]
}

function regionCenter(r: CropRegion): { cx: number; cy: number } {
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }
}

// ---- core transform ----

function recomputeBbox(pts: { x: number; y: number }[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}

function applyTransform(region: CropRegion, newPoints: { x: number; y: number }[]) {
  const bb = recomputeBbox(newPoints)
  region.x = bb.x
  region.y = bb.y
  region.width = bb.width
  region.height = bb.height
  region.shape = 'custom'
  region.points = newPoints
}

// ---- public API ----

/** Flip region horizontally around its own center. */
export function flipRegionHorizontal(region: CropRegion, _pivot?: { cx: number; cy: number }): void {
  const { cx } = regionCenter(region)
  const pts = getShapeOutline(region)
  const flipped = pts.map(p => ({ x: 2 * cx - p.x, y: p.y }))
  applyTransform(region, flipped)
}

/** Flip region vertically around its own center. */
export function flipRegionVertical(region: CropRegion, _pivot?: { cx: number; cy: number }): void {
  const { cy } = regionCenter(region)
  const pts = getShapeOutline(region)
  const flipped = pts.map(p => ({ x: p.x, y: 2 * cy - p.y }))
  applyTransform(region, flipped)
}

/** Rotate region 90° counter-clockwise around its own center. */
export function rotateRegionLeft90(region: CropRegion): void {
  const { cx, cy } = regionCenter(region)
  const pts = getShapeOutline(region)
  const rotated = pts.map(p => ({
    x: cx - (p.y - cy),
    y: cy + (p.x - cx),
  }))
  applyTransform(region, rotated)
}

/** Rotate region 90° clockwise around its own center. */
export function rotateRegionRight90(region: CropRegion): void {
  const { cx, cy } = regionCenter(region)
  const pts = getShapeOutline(region)
  const rotated = pts.map(p => ({
    x: cx + (p.y - cy),
    y: cy - (p.x - cx),
  }))
  applyTransform(region, rotated)
}

/** Rotate region by arbitrary degrees around its own center. */
export function rotateRegion(region: CropRegion, degrees: number): void {
  const clamped = Math.max(-360, Math.min(360, degrees))
  if (clamped === 0) return
  const { cx, cy } = regionCenter(region)
  const rad = (clamped * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const pts = getShapeOutline(region)
  const rotated = pts.map(p => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }))
  applyTransform(region, rotated)
}
