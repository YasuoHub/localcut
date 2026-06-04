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
  const dirs = [-1, 0, 1, -1, 1, -1, 0, 1, -1] // 8-neighbor: (dx,dy) pairs at i,i+1
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
  // find the first boundary pixel (selected pixel with unselected neighbor to its left or top)
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

  // 8-direction clockwise: E, SE, S, SW, W, NW, N, NE
  const dx = [1, 1, 0, -1, -1, -1, 0, 1]
  const dy = [0, 1, 1, 1, 0, -1, -1, -1]

  // backtrack directions (opposite order for finding entry direction)
  function neighbor(x: number, y: number, dir: number): boolean {
    const nx = x + dx[dir]
    const ny = y + dy[dir]
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false
    return mask[ny * width + nx] === 1
  }

  const contour: { x: number; y: number }[] = []
  let cx = startX, cy = startY
  let dir = 0 // start looking east

  const maxSteps = (maxX - minX + maxY - minY) * 4 + 1000
  let steps = 0

  do {
    contour.push({ x: cx, y: cy })
    // search clockwise from (dir + 6) mod 8 for the next boundary pixel
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

/** Ramer-Douglas-Peucker line simplification. */
export function simplifyContour(points: { x: number; y: number }[], epsilon: number): { x: number; y: number }[] {
  if (points.length < 3) return points

  function perpendicularDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay
    if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay)
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    const clamped = Math.max(0, Math.min(1, t))
    return Math.hypot(px - (ax + clamped * dx), py - (ay + clamped * dy))
  }

  function rdp(start: number, end: number): { x: number; y: number }[] {
    if (end - start <= 1) return [points[start]]
    let maxD = 0, maxI = start
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDist(points[i].x, points[i].y, points[start].x, points[start].y, points[end].x, points[end].y)
      if (d > maxD) { maxD = d; maxI = i }
    }
    if (maxD < epsilon) return [points[start]]
    return [...rdp(start, maxI), ...rdp(maxI, end)]
  }

  const result = rdp(0, points.length - 1)
  result.push(points[points.length - 1])
  return result
}

/** Run full magic wand selection: flood fill → contour trace → simplify. */
export function magicWandSelect(
  imageData: ImageData,
  seedX: number,
  seedY: number,
  tolerance: number,
  simplifyEpsilon = 2,
): { points: { x: number; y: number }[]; minX: number; minY: number; width: number; height: number } | null {
  const fill = floodFill(imageData, seedX, seedY, tolerance)
  if (!fill) return null

  const contour = traceContour(fill.mask, imageData.width, imageData.height, fill.minX, fill.minY, fill.maxX, fill.maxY)
  if (contour.length < 3) return null

  const simplified = simplifyContour(contour, simplifyEpsilon)
  if (simplified.length < 3) return null

  return {
    points: simplified,
    minX: fill.minX,
    minY: fill.minY,
    width: fill.maxX - fill.minX + 1,
    height: fill.maxY - fill.minY + 1,
  }
}
