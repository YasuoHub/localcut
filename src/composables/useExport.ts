import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import type { CropRegion, TextAnnotation, ImageFormat, ImageLayer } from '../types'
import { drawShapePath } from './shapeUtils'

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
    for (const layer of layers) {
      if (!layer.visible) continue
      const src = (showOriginal || !layer.workingCanvas) ? layer.image : layer.workingCanvas
      // draw the portion of this layer that overlaps the region, accounting for layer position AND scale
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

    // Scale to CSS coordinate space
    ctx.save()
    ctx.scale(dpr, dpr)

    // Composite all layers clipped to region shape
    ctx.save()
    const cssPoints = region.points?.map(p => ({
      x: (p.x - region.x) / region.width * rw,
      y: (p.y - region.y) / region.height * rh,
    }))
    drawShapePath(ctx, region.shape, rw / 2, rh / 2, rw, rh, cssPoints)
    ctx.clip()
    const composite = compositeLayers(layers, region, rw, rh, showOriginal)
    ctx.drawImage(composite, 0, 0)
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
    outputWidth: number | null,
    outputHeight: number | null,
    dpr: number,
    showOriginal: boolean,
    textAnnotations?: TextAnnotation[],
  ): Promise<Blob> {
    const zip = new JSZip()
    for (const region of regions) {
      const canvas = renderRegionToCanvas(layers, region, outputWidth, outputHeight, dpr, showOriginal, textAnnotations)
      const blob = await canvasToBlob(canvas, format, quality)
      const ext = format === 'jpeg' ? 'jpg' : format
      zip.file(`${region.name}.${ext}`, blob)
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

  return { exportRegions, exportSingleRegion, downloadZip }
}
