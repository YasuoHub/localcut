import type { FilenameContext } from '../types'

export function buildFilename(pattern: string, context: FilenameContext): string {
  return pattern.replace(/\{(\w+)(?::(\d+))?\}/g, (_, key: string, pad: string) => {
    const v = (context as unknown as Record<string, unknown>)[key]
    if (v === undefined || v === null) return `{${key}}`
    const s = String(v)
    if (pad) {
      const n = parseInt(pad, 10)
      if (!isNaN(n) && !isNaN(Number(s))) return String(s).padStart(n, '0')
    }
    return s
  })
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'untitled'
}

export function ensureUniqueFilename(name: string, used: Set<string>): string {
  let candidate = name
  let counter = 2
  while (used.has(candidate)) {
    const dot = name.lastIndexOf('.')
    if (dot === -1) {
      candidate = `${name}_${counter}`
    } else {
      candidate = `${name.slice(0, dot)}_${counter}${name.slice(dot)}`
    }
    counter++
  }
  return candidate
}

export function validateFilenamePattern(pattern: string): { valid: boolean; unknownKeys: string[] } {
  const knownKeys = ['imageName', 'regionName', 'index', 'width', 'height', 'format', 'date']
  const unknownKeys: string[] = []
  const regex = /\{(\w+)(?::\d+)?\}/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(pattern)) !== null) {
    if (!knownKeys.includes(m[1])) unknownKeys.push(m[1])
  }
  return { valid: unknownKeys.length === 0, unknownKeys }
}

export function previewFilenames(
  pattern: string,
  contexts: FilenameContext[],
  ext: string,
): string[] {
  const used = new Set<string>()
  return contexts.map((ctx) => {
    const raw = buildFilename(pattern, ctx)
    const sanitized = sanitizeFilename(raw)
    const name = ensureUniqueFilename(`${sanitized}.${ext}`, used)
    used.add(name)
    return name
  })
}

export function makeFilenameContext(
  imageName: string,
  regionName: string,
  index: number,
  width: number,
  height: number,
  format: string,
): FilenameContext {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return { imageName, regionName, index, width, height, format, date: `${yyyy}${mm}${dd}` }
}
