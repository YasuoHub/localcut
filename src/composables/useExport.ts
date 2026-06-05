import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import type { CropRegion, TextAnnotation, ImageFormat, ImageLayer, ExportNamingOptions, BatchOutputFitMode } from '../types'
import { drawShapePath } from './shapeUtils'
import { buildFilename, sanitizeFilename, ensureUniqueFilename, makeFilenameContext } from './useFilenamePattern'
import { fitCanvasToSize } from './useExportFit'

export function useExport() {
  /** Composite all visible layers into a region-sized canvas. */
  function compositeLayers(
    layers: ImageLayer[],
    region: CropRegion,
    rw: number, rh: number,
    showOriginal: boolean,
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = rw
    canvas.height = rh
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    for (const layer of [...layers].reverse()) {
      if (!layer.visible) continue
      const src = (showOriginal || !layer.workingCanvas) ? layer.image : layer.workingCanvas
      const srcX = (region.x - layer.x) / layer.scaleX
      const srcY = (region.y - layer.y) / layer.scaleY
      const srcW = region.width / layer.scaleX
      const srcH = region.height / layer.scaleY
      ctx.drawImage(src, srcX, srcY, srcW, srcH, 0, 0, rw, rh)
    }
    return canvas
  }

  function renderRegionToCanvas(
    layers: ImageLayer[],
    region: CropRegion,
    outputWidth: number | null,
    outputHeight: number | null,
    dpr: number,
    showOriginal: boolean,
    textAnnotations?: TextAnnotation[],
  ): HTMLCanvasElement {
    const rw = outputWidth ?? region.width
    const rh = outputHeight ?? region.height
    const cw = Math.round(rw * dpr)
    const ch = Math.round(rh * dpr)

    const result = document.createElement('canvas')
    result.width = cw
    result.height = ch
    const ctx = result.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    ctx.save()
    ctx.scale(dpr, dpr)

    // Composite all layers clipped to region shape
    ctx.save()
    const cssPoints = region.points?.map(p => ({
      x: (p.x - region.x) / region.width * rw,
      y: (p.y - region.y) / region.height * rh,
    }))
    drawShapePath(ctx, region.shape, rw / 2, rh / 2, rw, rh, cssPoints, region.borderRadius)
    ctx.clip()
    const composite = compositeLayers(layers, region, cw, ch, showOriginal)
    ctx.drawImage(composite, 0, 0, rw, rh)
    ctx.restore()

    // Draw text annotations
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
        drawShapePath(ctx, region.shape, rw / 2, rh / 2, rw, rh, cssPoints, region.borderRadius)
        ctx.clip()
        ctx.font = `${t.fontWeight} ${fs}px sans-serif`
        ctx.fillStyle = t.fontColor
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.beginPath(); ctx.rect(tx, ty, tw, th); ctx.clip()
        const chars = [...t.text]
        let line = '', ly = ty
        for (const ch of chars) {
          const test = line + ch
          if (ctx.measureText(test).width > maxWidth && line.length > 0) {
            ctx.fillText(line, tx + 2, ly); line = ch; ly += lineHeight
          } else { line = test }
        }
        if (line) ctx.fillText(line, tx + 2, ly)
        ctx.restore()
      }
    }

    ctx.restore()
    return result
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
    layers: ImageLayer[],
    regions: CropRegion[],
    format: ImageFormat,
    quality: number,
    dpr: number,
    showOriginal: boolean,
    textAnnotations?: TextAnnotation[],
    namingOptions?: ExportNamingOptions,
    batchWidth?: number | null,
    batchHeight?: number | null,
    batchFit?: BatchOutputFitMode,
    batchFill?: string,
  ): Promise<Blob> {
    const zip = new JSZip()
    const usedNames = new Set<string>()
    const ext = format === 'jpeg' ? 'jpg' : format

    for (let i = 0; i < regions.length; i++) {
      const region = regions[i]
      let canvas = renderRegionToCanvas(layers, region, batchWidth ?? null, batchHeight ?? null, dpr, showOriginal, textAnnotations)

      // logical output dimensions (CSS pixels, for filename)
      const outW = batchWidth ?? region.width
      const outH = batchHeight ?? region.height

      // Apply batch fit if enabled — use DPR-scaled dimensions to preserve resolution
      if (batchWidth && batchHeight && batchFit && batchFit !== 'original') {
        canvas = fitCanvasToSize(canvas, Math.round(batchWidth * dpr), Math.round(batchHeight * dpr), batchFit, batchFill ?? '#ffffff')
      }

      const blob = await canvasToBlob(canvas, format, quality)

      // Build filename
      let filename: string
      if (namingOptions) {
        const ctx = makeFilenameContext(
          namingOptions.imageName, region.name, i, Math.round(outW), Math.round(outH), ext,
        )
        const raw = buildFilename(namingOptions.pattern, ctx)
        filename = ensureUniqueFilename(sanitizeFilename(raw) + '.' + ext, usedNames)
        usedNames.add(filename)
      } else {
        filename = `${region.name}.${ext}`
      }
      zip.file(filename, blob)
    }
    return zip.generateAsync({ type: 'blob' })
  }

  async function exportSingleRegion(
    layers: ImageLayer[],
    region: CropRegion,
    format: ImageFormat,
    quality: number,
    outputWidth: number | null,
    outputHeight: number | null,
    dpr: number,
    showOriginal: boolean,
    textAnnotations?: TextAnnotation[],
  ) {
    const canvas = renderRegionToCanvas(layers, region, outputWidth, outputHeight, dpr, showOriginal, textAnnotations)
    const blob = await canvasToBlob(canvas, format, quality)
    const ext = format === 'jpeg' ? 'jpg' : format
    saveAs(blob, `${region.name}.${ext}`)
  }

  function downloadZip(blob: Blob, filename = 'output.zip') { saveAs(blob, filename) }

  return { exportRegions, exportSingleRegion, downloadZip, renderRegionToCanvas }
}
