/**
 * Magic wand (智选) smart selection utilities.
 * Flood-fill based connected component extraction with contour tracing.
 */

/** RGB color distance (Euclidean). */
function colorDist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/** Tolerance to RGB threshold mapping: 0-100 → 0-441 (max RGB distance ~441). */
function toleranceToThreshold(tolerance: number): number {
  return tolerance * 4.416
}

const MAX_FLOOD_PIXELS = 2_000_000

/** BFS flood fill. Returns mask (1=selected) + bounding box. */
export function floodFill(
  imageData: ImageData,
  seedX: number,
  seedY: number,
  tolerance: number,
): { mask: Uint8Array; minX: number; minY: number; maxX: number; maxY: number } | null {
  const { data, width, height } = imageData
  const threshold = toleranceToThreshold(tolerance)

  const sx = Math.round(seedX)
  const sy = Math.round(seedY)
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null

  const idx = (sy * width + sx) * 4
  const sr = data[idx], sg = data[idx + 1], sb = data[idx + 2]

  const mask = new Uint8Array(width * height)
  const queue: number[] = [sx, sy]
  const dirs = [-1, 0, 1, -1, 1, -1, 0, 1, -1]
  mask[sy * width + sx] = 1
  let minX = sx, minY = sy, maxX = sx, maxY = sy
  let qi = 0, count = 1

  while (qi < queue.length && count < MAX_FLOOD_PIXELS) {
    const cx = queue[qi++]
    const cy = queue[qi++]
    for (let d = 0; d < 8; d++) {
      const nx = cx + dirs[d]
      const ny = cy + dirs[d + 1]
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const mi = ny * width + nx
      if (mask[mi]) continue
      const pi = mi * 4
      if (colorDist(sr, sg, sb, data[pi], data[pi + 1], data[pi + 2]) <= threshold) {
        mask[mi] = 1
        queue.push(nx, ny)
        count++
        if (nx < minX) minX = nx
        if (nx > maxX) maxX = nx
        if (ny < minY) minY = ny
        if (ny > maxY) maxY = ny
      }
    }
  }

  return { mask, minX, minY, maxX, maxY }
}

/**
 * Moore-Neighbor boundary tracing.
 * Returns the outer contour of the selected region as {x,y}[] in image coords.
 */
export function traceContour(
  mask: Uint8Array,
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): { x: number; y: number }[] {
  let startX = -1, startY = -1
  findStart: for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (mask[y * width + x] && (!mask[y * width + (x - 1)] || !mask[(y - 1) * width + x])) {
        startX = x; startY = y
        break findStart
      }
    }
  }
  if (startX < 0) return []

  const dx = [1, 1, 0, -1, -1, -1, 0, 1]
  const dy = [0, 1, 1, 1, 0, -1, -1, -1]

  const contour: { x: number; y: number }[] = []
  let cx = startX, cy = startY, dir = 0
  const maxSteps = (maxX - minX + maxY - minY) * 4 + 1000
  let steps = 0

  do {
    contour.push({ x: cx, y: cy })
    let found = false
    for (let i = 0; i < 8; i++) {
      const nd = (dir + 6 + i) % 8
      const nx = cx + dx[nd]
      const ny = cy + dy[nd]
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[ny * width + nx]) {
        cx = nx; cy = ny; dir = nd
        found = true
        break
      }
    }
    if (!found) break
    steps++
    if (steps > maxSteps) break
  } while (!(cx === startX && cy === startY && contour.length > 2))

  return contour
}

/** Moving average smoothing — reduces pixel-level stair-stepping. */
export function smoothMovingAverage(points: { x: number; y: number }[], radius: number): { x: number; y: number }[] {
  if (points.length < 3 || radius < 1) return points
  const n = points.length
  const result: { x: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, count = 0
    for (let j = -radius; j <= radius; j++) {
      const idx = (i + j + n) % n
      sx += points[idx].x
      sy += points[idx].y
      count++
    }
    result.push({ x: sx / count, y: sy / count })
  }
  return result
}

/** Curvature-based adaptive simplification.
 *  Straight sections (low deviation) → keep only endpoints.
 *  Curved sections → keep vertices at fixed angle intervals.
 *  Sharp corners → always keep.
 */
export function adaptiveSimplify(
  points: { x: number; y: number }[],
  angleThresholdDeg: number,
  straightTolerance: number,
): { x: number; y: number }[] {
  if (points.length < 4) return points

  const n = points.length
  const angleThreshold = (angleThresholdDeg * Math.PI) / 180

  // compute edge angles and turning angles
  const edges: { dx: number; dy: number; len: number; angle: number }[] = []
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.sqrt(dx * dx + dy * dy)
    edges.push({ dx, dy, len, angle: Math.atan2(dy, dx) })
  }

  // compute turning angle at each vertex (angle change between incoming and outgoing edge)
  const turnAngles: number[] = []
  for (let i = 0; i < n; i++) {
    let da = edges[(i - 1 + n) % n].angle - edges[i].angle
    while (da > Math.PI) da -= 2 * Math.PI
    while (da < -Math.PI) da += 2 * Math.PI
    turnAngles.push(Math.abs(da))
  }

  // classify each vertex: corner, curve, or straight
  const isCorner = turnAngles.map(a => a > angleThreshold)

  // mark vertices to keep
  const keep = new Array(n).fill(false)
  keep[0] = true // always keep first
  for (let i = 1; i < n; i++) {
    keep[i] = isCorner[i] || isCorner[(i - 1 + n) % n] // keep at corners
  }

  // on straight sections between corners, collapse to just start/end
  // on curved sections between corners, keep at regular angular intervals
  let segStart = 0
  const result: { x: number; y: number }[] = [points[0]]

  for (let i = 1; i <= n; i++) {
    const idx = i % n
    if (i === n || isCorner[idx]) {
      // segment from segStart to idx
      if (i > segStart + 1) {
        const isCurved = isSegmentCurved(points, segStart, idx, straightTolerance)
        if (isCurved) {
          // curved: keep vertices at angle intervals
          let cumAngle = 0
          for (let j = segStart + 1; j < i; j++) {
            cumAngle += turnAngles[j % n]
            if (cumAngle >= angleThreshold || j === i - 1) {
              result.push(points[j])
              cumAngle = 0
            }
          }
        }
        // straight: nothing added between endpoints
      }
      if (i < n) {
        result.push(points[idx])
        segStart = idx
      }
    }
  }

  if (result.length < 3) return points
  return result
}

/** Check if a segment of the contour is curved (high cumulative deviation from straight line). */
function isSegmentCurved(
  points: { x: number; y: number }[],
  start: number,
  end: number,
  tolerance: number,
): boolean {
  const a = points[start]
  const b = points[end]
  const dx = b.x - a.x, dy = b.y - a.y
  const segLen = Math.sqrt(dx * dx + dy * dy)
  if (segLen < 1) return false

  let maxDev = 0
  for (let i = start + 1; i < end; i++) {
    const p = points[i]
    // perpendicular distance from point to line ab
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (segLen * segLen)
    const projX = a.x + t * dx
    const projY = a.y + t * dy
    const dev = Math.hypot(p.x - projX, p.y - projY)
    if (dev > maxDev) maxDev = dev
  }
  return maxDev > tolerance
}

/**
 * Detect if a closed contour is a rounded rectangle (or regular rectangle).
 * Uses "longest straight run" analysis: finds the longest consecutive segment
 * where cumulative turning angle stays below 8 degrees. A rounded rectangle has
 * long straight edges (typically >12% of contour each); a circle's "straight"
 * runs are negligible (<3% of contour regardless of point count).
 */
function detectRoundRect(
  points: { x: number; y: number }[],
): { shape: 'roundrect'; cx: number; cy: number; rx: number; ry: number } | null {
  if (points.length < 8) return null

  const n = points.length

  // Compute per-vertex turning angles
  const turnAngles: number[] = []
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const c = points[(i + 2) % n]
    const angle1 = Math.atan2(b.y - a.y, b.x - a.x)
    const angle2 = Math.atan2(c.y - b.y, c.x - b.x)
    let da = angle1 - angle2
    while (da > Math.PI) da -= 2 * Math.PI
    while (da < -Math.PI) da += 2 * Math.PI
    turnAngles.push(Math.abs(da))
  }

  // Sliding window: find longest run with cumulative turning angle < 8 degrees.
  // Double the array to handle runs that wrap around the contour.
  const cumThreshold = 8 * Math.PI / 180
  const extended = [...turnAngles, ...turnAngles]
  let longestRun = 0
  let right = 0
  let cumAngle = 0

  for (let left = 0; left < n; left++) {
    while (right < left + n && cumAngle + extended[right] < cumThreshold) {
      cumAngle += extended[right]
      right++
    }
    longestRun = Math.max(longestRun, right - left)
    if (right > left) {
      cumAngle -= extended[left]
    } else {
      right = left + 1
      cumAngle = 0
    }
  }

  const straightRatio = longestRun / n

  // A circle's longest "straight" run is ~n * threshold/(2π) ≈ 2.2% of contour.
  // A rounded rectangle's straight edge is typically 15-40% of contour.
  // 12% threshold cleanly separates the two.
  if (straightRatio < 0.12) return null

  // Compute bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }

  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const rx = (maxX - minX) / 2
  const ry = (maxY - minY) / 2

  return { shape: 'roundrect', cx, cy, rx: Math.max(rx, 1), ry: Math.max(ry, 1) }
}

/**
 * Detect if a closed contour is approximately a circle/ellipse.
 * Returns { shape, rx, ry } or null if not circular enough.
 */
function detectCircle(
  points: { x: number; y: number }[],
  threshold: number,
): { shape: 'circle'; cx: number; cy: number; rx: number; ry: number } | null {
  if (points.length < 8) return null

  // centroid and bounding box
  let sx = 0, sy = 0
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    sx += p.x; sy += p.y
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const n = points.length
  const cx = sx / n, cy = sy / n

  // compute average distance from centroid
  let avgDist = 0
  const dists: number[] = []
  for (const p of points) {
    const d = Math.hypot(p.x - cx, p.y - cy)
    dists.push(d)
    avgDist += d
  }
  avgDist /= n

  // check variance: if most points are within threshold% of avg distance, it's a circle
  let inliers = 0
  for (const d of dists) {
    if (Math.abs(d - avgDist) / avgDist < threshold) inliers++
  }
  const ratio = inliers / n

  if (ratio < 0.85) return null

  // ellipse: use bounding box radii
  const rx = (maxX - minX) / 2
  const ry = (maxY - minY) / 2

  return { shape: 'circle', cx, cy, rx: Math.max(rx, 1), ry: Math.max(ry, 1) }
}

/** Run full magic wand: flood fill → trace → smooth → shape detect / simplify. */
export function magicWandSelect(
  imageData: ImageData,
  seedX: number,
  seedY: number,
  tolerance: number,
  simplifyEpsilon = 1.5,
): { points: { x: number; y: number }[]; shape?: 'circle' | 'roundrect'; minX: number; minY: number; width: number; height: number } | null {
  const fill = floodFill(imageData, seedX, seedY, tolerance)
  if (!fill) return null

  const contour = traceContour(fill.mask, imageData.width, imageData.height, fill.minX, fill.minY, fill.maxX, fill.maxY)
  if (contour.length < 3) return null

  // moving-average smooth
  const smoothed = smoothMovingAverage(contour, 2)

  // try to detect rounded rectangle first (takes priority over circle)
  const roundRect = detectRoundRect(smoothed)
  if (roundRect) {
    return { points: [], shape: 'roundrect', minX: roundRect.cx - roundRect.rx, minY: roundRect.cy - roundRect.ry, width: roundRect.rx * 2, height: roundRect.ry * 2 }
  }

  // try to detect circle/ellipse
  const circle = detectCircle(smoothed, 0.15)
  if (circle) {
    return { points: [], shape: 'circle', minX: circle.cx - circle.rx, minY: circle.cy - circle.ry, width: circle.rx * 2, height: circle.ry * 2 }
  }

  // not a circle: curvature-based adaptive simplification
  const simplified = adaptiveSimplify(smoothed, 15, 2)
  if (simplified.length < 3) return null

  return {
    points: simplified,
    minX: fill.minX,
    minY: fill.minY,
    width: fill.maxX - fill.minX + 1,
    height: fill.maxY - fill.minY + 1,
  }
}
