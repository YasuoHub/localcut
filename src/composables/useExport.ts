import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import type { CropRegion, TextAnnotation, ImageFormat } from '../types'
import { drawShapePath } from './shapeUtils'

export function useExport() {
  function renderRegionToCanvas(
    sourceImage: HTMLImageElement | HTMLCanvasElement,
    region: CropRegion,
    outputWidth: number | null,
    outputHeight: number | null,
    dpr: number,
    textAnnotations?: TextAnnotation[],
  ): HTMLCanvasElement {
    const rw = outputWidth ?? region.width
    const rh = outputHeight ?? region.height
    const cw = Math.round(rw * dpr)
    const ch = Math.round(rh * dpr)

    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    // Scale to CSS coordinate space
    ctx.save()
    ctx.scale(dpr, dpr)

    // transform polygon points to CSS output coords
    const cssPoints = region.points?.map(p => ({
      x: (p.x - region.x) / region.width * rw,
      y: (p.y - region.y) / region.height * rh,
    }))

    // Clip image to region shape and draw
    ctx.save()
    drawShapePath(ctx, region.shape, rw / 2, rh / 2, rw, rh, cssPoints)
    ctx.clip()
    ctx.drawImage(sourceImage, region.x, region.y, region.width, region.height, 0, 0, rw, rh)
    ctx.restore()

    // Draw text annotations in CSS coordinates (clip to region shape)
    if (textAnnotations && textAnnotations.length > 0) {
      for (const t of textAnnotations) {
        if (t.x + t.width < region.x || t.x > region.x + region.width ||
            t.y + t.height < region.y || t.y > region.y + region.height) continue
        const tx = (t.x - region.x) / region.width * rw
        const ty = (t.y - region.y) / region.height * rh
        const tw = t.width / region.width * rw
        const th = t.height / region.height * rh
        const fs = t.fontSize / region.height * rh
        const lineHeight = fs * 1.3
        const maxWidth = tw - 4
        ctx.save()
        // clip text to region shape so only overlapping portion is exported
        drawShapePath(ctx, region.shape, rw / 2, rh / 2, rw, rh, cssPoints)
        ctx.clip()
        ctx.font = `${t.fontWeight} ${fs}px sans-serif`
        ctx.fillStyle = t.fontColor
        ctx.textBaseline = 'top'
        ctx.beginPath(); ctx.rect(tx, ty, tw, th); ctx.clip()
        const chars = [...t.text]
        let line = '', ly = ty
        for (const ch of chars) {
          const test = line + ch
          if (ctx.measureText(test).width > maxWidth && line.length > 0) {
            ctx.fillText(line, tx + 2, ly); line = ch; ly += lineHeight
            if (ly + lineHeight > ty + th) break
          } else { line = test }
        }
        if (line && ly + lineHeight <= ty + th + 2) ctx.fillText(line, tx + 2, ly)
        ctx.restore()
      }
    }

    ctx.restore()

    return canvas
  }

  function canvasToBlob(canvas: HTMLCanvasElement, format: ImageFormat, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const mime = `image/${format}`
      canvas.toBlob(
        (blob) => { if (blob) resolve(blob); else reject(new Error('Canvas toBlob failed')) },
        mime, quality / 100,
      )
    })
  }

  async function exportRegions(
    sourceImage: HTMLImageElement | HTMLCanvasElement,
    regions: CropRegion[],
    format: ImageFormat,
    quality: number,
    outputWidth: number | null,
    outputHeight: number | null,
    dpr: number,
    textAnnotations?: TextAnnotation[],
  ): Promise<Blob> {
    const zip = new JSZip()
    for (const region of regions) {
      const canvas = renderRegionToCanvas(sourceImage, region, outputWidth, outputHeight, dpr, textAnnotations)
      const blob = await canvasToBlob(canvas, format, quality)
      const ext = format === 'jpeg' ? 'jpg' : format
      zip.file(`${region.name}.${ext}`, blob)
    }
    return zip.generateAsync({ type: 'blob' })
  }

  async function exportSingleRegion(
    sourceImage: HTMLImageElement | HTMLCanvasElement,
    region: CropRegion,
    format: ImageFormat,
    quality: number,
    outputWidth: number | null,
    outputHeight: number | null,
    dpr: number,
    textAnnotations?: TextAnnotation[],
  ) {
    const canvas = renderRegionToCanvas(sourceImage, region, outputWidth, outputHeight, dpr, textAnnotations)
    const blob = await canvasToBlob(canvas, format, quality)
    const ext = format === 'jpeg' ? 'jpg' : format
    saveAs(blob, `${region.name}.${ext}`)
  }

  function downloadZip(blob: Blob, filename = 'output.zip') { saveAs(blob, filename) }

  return { exportRegions, exportSingleRegion, downloadZip }
}
