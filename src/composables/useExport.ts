import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import type { CropGridGroup, CropRegion, TextAnnotation, ImageFormat, ImageLayer, ExportNamingOptions, BatchOutputFitMode } from '../types'
import { drawShapePath } from './shapeUtils'
import { makeExportFilename, makeFilenameContext } from './useFilenamePattern'
import { fitCanvasToSize } from './useExportFit'
import { expandGridGroup } from './useGridGroups'

import { unsharpMask } from '../utils/imageSharpen'

// ---- PNG DPI injection helpers ----

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) c = CRC32_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function injectPngDpi(blob: Blob, dpi: number): Promise<Blob> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer)
      // PNG: 8-byte signature + IHDR chunk (4 len + 4 type + 13 data + 4 crc) = 33 bytes
      const ihdrEnd = 33
      if (bytes.length < ihdrEnd || bytes[0] !== 137 || bytes[1] !== 80) { resolve(blob); return }

      const ppm = Math.round(dpi * 39.3701)
      const physData = new Uint8Array(9)
      const view = new DataView(physData.buffer)
      view.setUint32(0, ppm, false)
      view.setUint32(4, ppm, false)
      physData[8] = 1

      const type = new TextEncoder().encode('pHYs')
      const crcInput = new Uint8Array(4 + 9)
      crcInput.set(type, 0)
      crcInput.set(physData, 4)
      const crcVal = crc32(crcInput)

      const chunk = new Uint8Array(4 + 4 + 9 + 4)
      const cv = new DataView(chunk.buffer)
      cv.setUint32(0, 9, false)
      chunk.set(type, 4)
      chunk.set(physData, 8)
      cv.setUint32(17, crcVal, false)

      const result = new Uint8Array(bytes.length + chunk.length)
      result.set(bytes.subarray(0, ihdrEnd), 0)
      result.set(chunk, ihdrEnd)
      result.set(bytes.subarray(ihdrEnd), ihdrEnd + chunk.length)
      resolve(new Blob([result], { type: 'image/png' }))
    }
    reader.readAsArrayBuffer(blob)
  })
}

// ---- export composable ----

export function useExport() {
  /** Composite all visible layers into a canvas at the given logical-pixel size. */
  function compositeLayers(
    layers: ImageLayer[],
    region: CropRegion,
    lw: number,
    lh: number,
    showOriginal: boolean,
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = lw
    canvas.height = lh
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    for (const layer of [...layers].reverse()) {
      if (!layer.visible) continue
      const src = (showOriginal || !layer.workingCanvas) ? layer.image : layer.workingCanvas
      const srcX = (region.x - layer.x) / layer.scaleX
      const srcY = (region.y - layer.y) / layer.scaleY
      const srcW = region.width / layer.scaleX
      const srcH = region.height / layer.scaleY
      ctx.drawImage(src, srcX, srcY, srcW, srcH, 0, 0, lw, lh)
    }
    return canvas
  }

  /**
   * Compute the minimum source-to-output pixel ratio across visible layers.
   * >1 means source has more pixels than output (downscale), <1 means upscale.
   */
  function computeSourcePixelRatio(
    layers: ImageLayer[],
    region: CropRegion,
    outputWidth?: number | null,
    outputHeight?: number | null,
  ): number {
    const outW = outputWidth ?? region.width
    const outH = outputHeight ?? region.height
    let minRatio = Infinity
    for (const layer of layers) {
      if (!layer.visible) continue
      const srcW = region.width / layer.scaleX
      const srcH = region.height / layer.scaleY
      const ratio = Math.min(srcW / outW, srcH / outH)
      if (ratio < minRatio) minRatio = ratio
    }
    return minRatio === Infinity ? 1 : minRatio
  }

  /**
   * Render a region to a physical-pixel canvas.
   *
   * Pipeline: composite at logical size → optional batch fit → optional AI upscale → optional USM sharpen → text → single DPR scale
   */
  async function renderRegionToCanvas(
    layers: ImageLayer[],
    region: CropRegion,
    outputWidth: number | null,
    outputHeight: number | null,
    dpr: number,
    showOriginal: boolean,
    textAnnotations?: TextAnnotation[],
    batchFit?: BatchOutputFitMode,
    batchFill?: string,
    upscaleFn?: (canvas: HTMLCanvasElement) => Promise<HTMLCanvasElement>,
    sharpenAmount?: number,
  ): Promise<HTMLCanvasElement> {
    const doFit = batchFit && batchFit !== 'original' && outputWidth && outputHeight
    let outLw = outputWidth ?? region.width
    let outLh = outputHeight ?? region.height

    // Composite: use region's natural size when fitting, otherwise output size
    const compW = doFit ? region.width : outLw
    const compH = doFit ? region.height : outLh

    let logicalCanvas: HTMLCanvasElement
    if (doFit) {
      logicalCanvas = compositeLayers(layers, region, compW, compH, showOriginal)
      logicalCanvas = fitCanvasToSize(logicalCanvas, outLw, outLh, batchFit!, batchFill ?? '#ffffff')
    } else {
      logicalCanvas = compositeLayers(layers, region, compW, compH, showOriginal)
    }

    // AI upscale: applied after fit, before sharpen/text/DPR scale
    if (upscaleFn) {
      logicalCanvas = await upscaleFn(logicalCanvas)
      outLw = logicalCanvas.width
      outLh = logicalCanvas.height
    }

    // USM sharpen: applied after upscale, before text/DPR scale
    if (sharpenAmount && sharpenAmount > 0) {
      const ctx = logicalCanvas.getContext('2d')!
      const imgData = ctx.getImageData(0, 0, outLw, outLh)
      const sharpened = unsharpMask(imgData, sharpenAmount / 100, 2, 2)
      logicalCanvas = document.createElement('canvas')
      logicalCanvas.width = outLw
      logicalCanvas.height = outLh
      logicalCanvas.getContext('2d')!.putImageData(sharpened, 0, 0)
    }

    // Smart DPR: cap to avoid meaningless upscale (>2× beyond source pixels)
    // Skip smart DPR when AI upscale is used (AI provides real pixels)
    const srcRatio = computeSourcePixelRatio(layers, region, outputWidth, outputHeight)
    const maxDpr = upscaleFn ? dpr : Math.max(1, Math.round(srcRatio * 2 * 10) / 10)
    const effectiveDpr = Math.min(dpr, maxDpr)

    const pw = Math.round(outLw * effectiveDpr)
    const ph = Math.round(outLh * effectiveDpr)

    // Region-local coordinate mapping for shape paths (used by both clip and text)
    const cssPoints = region.points?.map(p => ({
      x: (p.x - region.x) / region.width * outLw,
      y: (p.y - region.y) / region.height * outLh,
    }))
    const brScale = region.width > 0 ? outLw / region.width : 1
    const exportBorderRadius = region.borderRadius != null ? region.borderRadius * brScale : undefined

    // Always apply shape clipping for non-rectangular shapes
    if (region.shape !== 'rect') {
      const clipped = document.createElement('canvas')
      clipped.width = outLw
      clipped.height = outLh
      const cctx = clipped.getContext('2d')!
      cctx.imageSmoothingEnabled = true
      cctx.imageSmoothingQuality = 'high'
      cctx.save()
      drawShapePath(cctx, region.shape, outLw / 2, outLh / 2, outLw, outLh, cssPoints, exportBorderRadius)
      cctx.clip()
      cctx.drawImage(logicalCanvas, 0, 0)
      cctx.restore()
      logicalCanvas = clipped
    }

    // Draw text annotations on top of the (possibly clipped) canvas
    if (textAnnotations && textAnnotations.length > 0) {
      const withText = document.createElement('canvas')
      withText.width = outLw
      withText.height = outLh
      const tctx = withText.getContext('2d')!
      tctx.imageSmoothingEnabled = true
      tctx.imageSmoothingQuality = 'high'
      tctx.drawImage(logicalCanvas, 0, 0)

      for (const t of textAnnotations) {
        if (t.x + t.width < region.x || t.x > region.x + region.width ||
            t.y + t.height < region.y || t.y > region.y + region.height) continue
        const tx = (t.x - region.x) / region.width * outLw
        const ty = (t.y - region.y) / region.height * outLh
        const tw = t.width / region.width * outLw
        const th = t.height / region.height * outLh
        const fs = t.fontSize / region.height * outLh
        const lineHeight = fs * 1.3
        const maxWidth = tw - 4
        tctx.save()
        drawShapePath(tctx, region.shape, outLw / 2, outLh / 2, outLw, outLh, cssPoints, exportBorderRadius)
        tctx.clip()
        tctx.font = `${t.fontWeight} ${fs}px sans-serif`
        tctx.fillStyle = t.fontColor
        tctx.textAlign = 'left'
        tctx.textBaseline = 'top'
        tctx.beginPath(); tctx.rect(tx, ty, tw, th); tctx.clip()
        const chars = [...t.text]
        let line = '', ly = ty
        for (const ch of chars) {
          const test = line + ch
          if (tctx.measureText(test).width > maxWidth && line.length > 0) {
            tctx.fillText(line, tx + 2, ly); line = ch; ly += lineHeight
          } else { line = test }
        }
        if (line) tctx.fillText(line, tx + 2, ly)
        tctx.restore()
      }
      logicalCanvas = withText
    }

    // Final: one-shot scale to physical pixels
    const result = document.createElement('canvas')
    result.width = pw
    result.height = ph
    const rctx = result.getContext('2d')!
    rctx.imageSmoothingEnabled = true
    rctx.imageSmoothingQuality = 'high'
    rctx.drawImage(logicalCanvas, 0, 0, pw, ph)

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

  function copyLayerToCanvas(layer: ImageLayer, showOriginal: boolean): HTMLCanvasElement {
    const source = (showOriginal || !layer.workingCanvas) ? layer.image : layer.workingCanvas
    const canvas = document.createElement('canvas')
    canvas.width = layer.image.naturalWidth
    canvas.height = layer.image.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    return canvas
  }

  async function renderLayerToCanvas(
    layer: ImageLayer,
    outputWidth: number | null,
    outputHeight: number | null,
    dpr: number,
    showOriginal: boolean,
    batchFit?: BatchOutputFitMode,
    batchFill?: string,
    upscaleFn?: (canvas: HTMLCanvasElement) => Promise<HTMLCanvasElement>,
    sharpenAmount?: number,
  ): Promise<HTMLCanvasElement> {
    let logicalCanvas = copyLayerToCanvas(layer, showOriginal)
    let outLw = outputWidth ?? logicalCanvas.width
    let outLh = outputHeight ?? logicalCanvas.height
    const doFit = batchFit && batchFit !== 'original' && outputWidth && outputHeight

    if (doFit) {
      logicalCanvas = fitCanvasToSize(logicalCanvas, outLw, outLh, batchFit, batchFill ?? '#ffffff')
    } else if (outputWidth && outputHeight && (outputWidth !== logicalCanvas.width || outputHeight !== logicalCanvas.height)) {
      const resized = document.createElement('canvas')
      resized.width = outputWidth
      resized.height = outputHeight
      const rctx = resized.getContext('2d')!
      rctx.imageSmoothingEnabled = true
      rctx.imageSmoothingQuality = 'high'
      rctx.drawImage(logicalCanvas, 0, 0, outputWidth, outputHeight)
      logicalCanvas = resized
    } else {
      outLw = logicalCanvas.width
      outLh = logicalCanvas.height
    }

    if (upscaleFn) {
      logicalCanvas = await upscaleFn(logicalCanvas)
      outLw = logicalCanvas.width
      outLh = logicalCanvas.height
    }

    if (sharpenAmount && sharpenAmount > 0) {
      const ctx = logicalCanvas.getContext('2d')!
      const imgData = ctx.getImageData(0, 0, outLw, outLh)
      const sharpened = unsharpMask(imgData, sharpenAmount / 100, 2, 2)
      logicalCanvas = document.createElement('canvas')
      logicalCanvas.width = outLw
      logicalCanvas.height = outLh
      logicalCanvas.getContext('2d')!.putImageData(sharpened, 0, 0)
    }

    const pw = Math.round(outLw * dpr)
    const ph = Math.round(outLh * dpr)
    const result = document.createElement('canvas')
    result.width = pw
    result.height = ph
    const rctx = result.getContext('2d')!
    rctx.imageSmoothingEnabled = true
    rctx.imageSmoothingQuality = 'high'
    rctx.drawImage(logicalCanvas, 0, 0, pw, ph)
    return result
  }

  async function addRegionsToZip(
    zip: JSZip,
    regions: CropRegion[],
    usedNames: Set<string>,
    layers: ImageLayer[],
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
    upscaleFn?: (canvas: HTMLCanvasElement) => Promise<HTMLCanvasElement>,
    sharpenAmount?: number,
  ) {
    const ext = format === 'jpeg' ? 'jpg' : format
    for (let i = 0; i < regions.length; i++) {
      const region = regions[i]

      const canvas = await renderRegionToCanvas(
        layers, region,
        batchWidth ?? null, batchHeight ?? null,
        dpr, showOriginal, textAnnotations,
        batchWidth && batchHeight ? batchFit : undefined,
        batchFill,
        upscaleFn,
        sharpenAmount,
      )

      const outW = batchWidth ?? region.width
      const outH = batchHeight ?? region.height

      let blob = await canvasToBlob(canvas, format, quality)
      if (format === 'png') blob = await injectPngDpi(blob, 72)
      canvas.width = 0
      canvas.height = 0

      let filename: string
      if (namingOptions) {
        const ctx = makeFilenameContext(
          namingOptions.imageName,
          region.name,
          namingOptions.regionIndexById?.[region.id] ?? i + 1,
          Math.round(outW),
          Math.round(outH),
          ext,
        )
        filename = makeExportFilename(namingOptions.pattern, ctx, ext, usedNames)
      } else {
        const ctx = makeFilenameContext('', region.name, i + 1, Math.round(outW), Math.round(outH), ext)
        filename = makeExportFilename('{regionName}', ctx, ext, usedNames)
      }
      zip.file(filename, blob)
    }
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
    upscaleFn?: (canvas: HTMLCanvasElement) => Promise<HTMLCanvasElement>,
    sharpenAmount?: number,
  ): Promise<Blob> {
    const zip = new JSZip()
    const usedNames = new Set<string>()
    await addRegionsToZip(
      zip, regions, usedNames,
      layers, format, quality, dpr, showOriginal, textAnnotations,
      namingOptions, batchWidth, batchHeight, batchFit, batchFill, upscaleFn, sharpenAmount,
    )
    return zip.generateAsync({ type: 'blob' })
  }

  async function exportGridGroup(
    layers: ImageLayer[],
    group: CropGridGroup,
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
    upscaleFn?: (canvas: HTMLCanvasElement) => Promise<HTMLCanvasElement>,
    sharpenAmount?: number,
  ): Promise<Blob> {
    const cells = expandGridGroup(group)
    return exportRegions(
      layers, cells,
      format, quality, dpr, showOriginal, textAnnotations,
      namingOptions,
      batchWidth, batchHeight, batchFit, batchFill,
      upscaleFn, sharpenAmount,
    )
  }

  async function exportRegionsAndGridGroups(
    layers: ImageLayer[],
    regions: CropRegion[],
    gridGroups: CropGridGroup[],
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
    upscaleFn?: (canvas: HTMLCanvasElement) => Promise<HTMLCanvasElement>,
    sharpenAmount?: number,
  ): Promise<Blob> {
    const zip = new JSZip()
    const usedNames = new Set<string>()
    await addRegionsToZip(
      zip, regions, usedNames,
      layers, format, quality, dpr, showOriginal, textAnnotations,
      namingOptions, batchWidth, batchHeight, batchFit, batchFill, upscaleFn, sharpenAmount,
    )

    const groupZipNames = new Set<string>()
    const outerIndexOffset = regions.length
    for (let i = 0; i < gridGroups.length; i++) {
      const group = gridGroups[i]
      const cells = expandGridGroup(group)
      const cellIndexById = Object.fromEntries(cells.map((cell, index) => [cell.id, index + 1]))
      const groupZip = await exportRegions(
        layers, cells,
        format, quality, dpr, showOriginal, textAnnotations,
        namingOptions ? { ...namingOptions, regionIndexById: cellIndexById } : undefined,
        batchWidth, batchHeight, batchFit, batchFill,
        upscaleFn, sharpenAmount,
      )
      const ctx = makeFilenameContext(
        namingOptions?.imageName ?? '',
        group.name,
        outerIndexOffset + i + 1,
        Math.round(group.width),
        Math.round(group.height),
        'zip',
      )
      const filename = makeExportFilename(namingOptions?.pattern ?? '{regionName}', ctx, 'zip', groupZipNames)
      zip.file(filename, groupZip)
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
    upscaleFn?: (canvas: HTMLCanvasElement) => Promise<HTMLCanvasElement>,
    sharpenAmount?: number,
    namingOptions?: ExportNamingOptions & { index?: number },
  ) {
    const canvas = await renderRegionToCanvas(layers, region, outputWidth, outputHeight, dpr, showOriginal, textAnnotations, undefined, undefined, upscaleFn, sharpenAmount)
    let blob = await canvasToBlob(canvas, format, quality)
    if (format === 'png') blob = await injectPngDpi(blob, 72)
    canvas.width = 0
    canvas.height = 0
    const ext = format === 'jpeg' ? 'jpg' : format
    const index = namingOptions?.index ?? namingOptions?.regionIndexById?.[region.id] ?? 1
    const outW = outputWidth ?? region.width
    const outH = outputHeight ?? region.height
    const ctx = makeFilenameContext(namingOptions?.imageName ?? '', region.name, index, Math.round(outW), Math.round(outH), ext)
    const filename = makeExportFilename(namingOptions?.pattern ?? '{regionName}', ctx, ext)
    saveAs(blob, filename)
  }

  async function exportSingleLayer(
    layer: ImageLayer,
    format: ImageFormat,
    quality: number,
    outputWidth: number | null,
    outputHeight: number | null,
    dpr: number,
    showOriginal: boolean,
    batchFit?: BatchOutputFitMode,
    batchFill?: string,
    upscaleFn?: (canvas: HTMLCanvasElement) => Promise<HTMLCanvasElement>,
    sharpenAmount?: number,
    namingOptions?: ExportNamingOptions & { index?: number },
  ) {
    const canvas = await renderLayerToCanvas(layer, outputWidth, outputHeight, dpr, showOriginal, batchFit, batchFill, upscaleFn, sharpenAmount)
    let blob = await canvasToBlob(canvas, format, quality)
    if (format === 'png') blob = await injectPngDpi(blob, 72)
    canvas.width = 0
    canvas.height = 0
    const ext = format === 'jpeg' ? 'jpg' : format
    const index = namingOptions?.index ?? 1
    const outW = outputWidth ?? layer.image.naturalWidth
    const outH = outputHeight ?? layer.image.naturalHeight
    const ctx = makeFilenameContext(namingOptions?.imageName ?? '', layer.name, index, Math.round(outW), Math.round(outH), ext)
    const filename = makeExportFilename(namingOptions?.pattern ?? '{regionName}', ctx, ext)
    saveAs(blob, filename)
  }

  function downloadZip(blob: Blob, filename = 'output.zip') { saveAs(blob, filename) }

  return { exportRegions, exportGridGroup, exportRegionsAndGridGroups, exportSingleRegion, exportSingleLayer, downloadZip, renderRegionToCanvas, renderLayerToCanvas, computeSourcePixelRatio }
}
