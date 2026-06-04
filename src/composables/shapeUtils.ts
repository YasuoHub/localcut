import type { ShapeType } from '../types'

let regionCounter = 0
export function nextRegionName(): string {
  return `region_${++regionCounter}`
}

export function drawShapePath(
  ctx: CanvasRenderingContext2D,
  shape: ShapeType,
  cx: number, cy: number, w: number, h: number,
  points?: { x: number; y: number }[],
) {
  ctx.beginPath()
  addShapeToPath(ctx, shape, cx, cy, w, h, points)
}

/** Add shape to existing path without calling beginPath(). */
export function addShapeToPath(
  ctx: CanvasRenderingContext2D,
  shape: ShapeType,
  cx: number, cy: number, w: number, h: number,
  points?: { x: number; y: number }[],
) {
  if (shape === 'custom' && points && points.length >= 3) {
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y)
    }
    ctx.closePath()
    return
  }
  switch (shape) {
    case 'rect':
      ctx.rect(cx - w / 2, cy - h / 2, w, h)
      ctx.closePath()
      break
    case 'circle':
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2)
      ctx.closePath()
      break
    case 'triangle':
      ctx.moveTo(cx, cy - h / 2)
      ctx.lineTo(cx + w / 2, cy + h / 2)
      ctx.lineTo(cx - w / 2, cy + h / 2)
      ctx.closePath()
      break
    case 'diamond':
      ctx.moveTo(cx, cy - h / 2)
      ctx.lineTo(cx + w / 2, cy)
      ctx.lineTo(cx, cy + h / 2)
      ctx.lineTo(cx - w / 2, cy)
      ctx.closePath()
      break
    case 'star':
      starPathNoBegin(ctx, cx, cy, Math.min(w, h) / 2, Math.min(w, h) / 4.5)
      break
    case 'heart':
      heartPathNoBegin(ctx, cx, cy, w, h)
      break
  }
}

export function heartPath(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number,
) {
  ctx.beginPath()
  heartPathNoBegin(ctx, cx, cy, w, h)
}

function heartPathNoBegin(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number,
) {
  const top = cy - h / 2
  const bottom = cy + h / 2
  const left = cx - w / 2
  const right = cx + w / 2
  ctx.moveTo(cx, bottom)
  ctx.bezierCurveTo(left, cy + h * 0.3, left, top + h * 0.05, cx - w * 0.2, top)
  ctx.bezierCurveTo(cx - w * 0.05, top + h * 0.02, cx, top + h * 0.02, cx, top + h * 0.3)
  ctx.bezierCurveTo(cx, top + h * 0.02, cx + w * 0.05, top + h * 0.02, cx + w * 0.2, top)
  ctx.bezierCurveTo(right, top + h * 0.05, right, cy + h * 0.3, cx, bottom)
  ctx.closePath()
}

export function starPath(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number, innerR: number,
) {
  ctx.beginPath()
  starPathNoBegin(ctx, cx, cy, outerR, innerR)
}

function starPathNoBegin(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number, innerR: number,
) {
  const spikes = 5
  const rot = -Math.PI / 2
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = rot + (Math.PI * i) / spikes
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}
