import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import { PERFORMANCE_LIMITS, formatBytes } from '../constants/performanceLimits'

export { formatBytes } from '../constants/performanceLimits'

export type CompressionOutputFormat = 'original' | 'jpeg' | 'webp' | 'png'

export type CompressionJobStatus = 'pending' | 'processing' | 'done' | 'error'

export interface ImageCompressionJob {
  id: string
  file: File
  name: string
  originalSize: number
  status: CompressionJobStatus
  width?: number
  height?: number
  outputFormat?: Exclude<CompressionOutputFormat, 'original'>
  outputName?: string
  outputSize?: number
  resultBlob?: Blob
  error?: string
}

export interface ImageCompressionOptions {
  outputFormat: CompressionOutputFormat
  quality: number
}

const SOURCE_FORMAT_BY_MIME: Record<string, Exclude<CompressionOutputFormat, 'original'> | undefined> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const MIME_BY_FORMAT: Record<Exclude<CompressionOutputFormat, 'original'>, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

const EXT_BY_FORMAT: Record<Exclude<CompressionOutputFormat, 'original'>, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
}

export const IMAGE_COMPRESSION_LIMITS = {
  ...PERFORMANCE_LIMITS.compression,
} as const

let compressionJobCounter = 0

export function createCompressionJob(file: File): ImageCompressionJob {
  return {
    id: `compress_${Date.now()}_${++compressionJobCounter}_${Math.random().toString(36).slice(2, 7)}`,
    file,
    name: file.name,
    originalSize: file.size,
    status: 'pending',
  }
}

export function isCompressibleImage(file: File) {
  return Boolean(SOURCE_FORMAT_BY_MIME[file.type]) || /\.(png|jpe?g|webp)$/i.test(file.name)
}

export function getImageCompressionLimitText() {
  return [
    `最多 ${IMAGE_COMPRESSION_LIMITS.maxFiles} 张`,
    `单张文件 ${formatBytes(IMAGE_COMPRESSION_LIMITS.maxFileBytes)} 内`,
    `单图 ${Math.round(IMAGE_COMPRESSION_LIMITS.maxCanvasPixels / 1_000_000)}MP 内`,
    `本批源文件 ${formatBytes(IMAGE_COMPRESSION_LIMITS.maxTotalSourceBytes)} 内`,
  ].join(' / ')
}

export function formatSavings(originalSize: number, outputSize?: number) {
  if (!outputSize || originalSize <= 0) return '--'
  const ratio = Math.max(-999, Math.min(100, (1 - outputSize / originalSize) * 100))
  return `${ratio >= 0 ? '-' : '+'}${Math.abs(ratio).toFixed(1)}%`
}

function getSourceFormat(file: File): Exclude<CompressionOutputFormat, 'original'> {
  const byMime = SOURCE_FORMAT_BY_MIME[file.type]
  if (byMime) return byMime
  if (/\.webp$/i.test(file.name)) return 'webp'
  if (/\.jpe?g$/i.test(file.name)) return 'jpeg'
  return 'png'
}

function makeOutputName(name: string, format: Exclude<CompressionOutputFormat, 'original'>) {
  const ext = EXT_BY_FORMAT[format]
  const cleanBase = name
    .replace(/\.[^.\\/]+$/, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim() || 'image'
  return `${cleanBase}.${ext}`
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解码失败'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const normalizedQuality = Math.max(0.1, Math.min(1, quality / 100))
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('图片编码失败'))
      },
      mime,
      normalizedQuality,
    )
  })
}

export async function compressImageFile(file: File, options: ImageCompressionOptions) {
  const sourceFormat = getSourceFormat(file)
  const outputFormat = options.outputFormat === 'original' ? sourceFormat : options.outputFormat
  const image = await loadImageFromFile(file)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (width * height > IMAGE_COMPRESSION_LIMITS.maxCanvasPixels) {
    throw new Error(`图片过大（${width}x${height}），为避免内存溢出已跳过`)
  }
  if (!width || !height) throw new Error('图片尺寸无效')

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (outputFormat === 'jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.drawImage(image, 0, 0, width, height)

  let blob: Blob
  try {
    blob = await canvasToBlob(canvas, MIME_BY_FORMAT[outputFormat], options.quality)
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
  if (blob.size >= file.size) {
    return {
      blob: file,
      width,
      height,
      outputFormat: sourceFormat,
      outputName: makeOutputName(file.name, sourceFormat),
    }
  }
  return {
    blob,
    width,
    height,
    outputFormat,
    outputName: makeOutputName(file.name, outputFormat),
  }
}

export async function downloadCompressedImages(jobs: ImageCompressionJob[]) {
  const doneJobs = jobs.filter(job => job.status === 'done' && job.resultBlob && job.outputName)
  if (doneJobs.length === 0) return

  if (doneJobs.length === 1) {
    downloadCompressedImage(doneJobs[0])
    return
  }

  const zip = new JSZip()
  const usedNames = new Set<string>()
  for (const job of doneJobs) {
    let name = job.outputName!
    if (usedNames.has(name)) {
      const dot = name.lastIndexOf('.')
      const base = dot >= 0 ? name.slice(0, dot) : name
      const ext = dot >= 0 ? name.slice(dot) : ''
      let index = 2
      while (usedNames.has(`${base}_${index}${ext}`)) index++
      name = `${base}_${index}${ext}`
    }
    usedNames.add(name)
    zip.file(name, job.resultBlob!)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  saveAs(blob, 'compressed-images.zip')
}

export function downloadCompressedImage(job: ImageCompressionJob) {
  if (job.status !== 'done' || !job.resultBlob || !job.outputName) return
  saveAs(job.resultBlob, job.outputName)
}
