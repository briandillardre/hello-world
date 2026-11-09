'use client'

/**
 * The plan room's pdf.js work, on the device: open a set, read each page's
 * title block and fingerprint, and render the pictures the map and the lists
 * use. Nothing here uploads — the caller does, one page at a time (holding a
 * whole set's full-size pictures at once crash-reloads iPad Safari, Aug 7).
 */

import { extractVectors, textFromContent, textFromShx, type PdfPen, type PdfLine } from '@/lib/dirt/pdf-vectors'
import { readTitleBlock, type TitleBlock } from '@/lib/plans/title-block'
import { wordsToViewed, linesToViewed, fingerprintSource, sha256Hex, inkBox, type ViewTransform } from '@/lib/plans/fingerprint'
import { rasterScale } from '@/lib/dirt/plan-geo'
import { scaleBar, labelledDistances, type ScaleCheck } from '@/lib/plans/scale'
import { findGridLabels, fitGrid, type GridFit } from '@/lib/plans/gridfit'
import { autoCrop, type Crop } from '@/lib/plans/crop'
import { planFeatures, type PlanFeatures } from '@/lib/plans/match'

export type PdfjsModule = typeof import('pdfjs-dist')
export type PdfDoc = import('pdfjs-dist').PDFDocumentProxy

/** pdf.js is served from /public with a NATIVE dynamic import — webpack can't
 *  parse its bundles, so it must never see them (same as ZonePlans). */
export async function loadPdfjs(): Promise<PdfjsModule> {
  const pdfjs = await import(/* webpackIgnore: true */ '/pdfjs/pdf.min.mjs' as string) as PdfjsModule
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'
  return pdfjs
}

export interface PageRead {
  page: number
  /** Viewed size at scale 1, points. */
  width: number
  height: number
  thumb: string
  tb: TitleBlock
  signature: string | null
  ink: [number, number, number, number] | null
  /** The page's own scale evidence (stated · bar · labelled distances · grid). */
  checks: ScaleCheck[]
  /** Where its state plane coordinates put it, when it prints enough of them. */
  grid: GridFit | null
  /** The drawing area for the map (the border and title block cropped off). */
  crop: Crop | null
  /** The drawing's corners, for lining the sheet up (lib/plans/match.ts). */
  features: PlanFeatures | null
}

/** A small JPEG of the page for the review grid and the lists. */
async function thumbOf(page: import('pdfjs-dist').PDFPageProxy, longEdge: number): Promise<string> {
  const base = page.getViewport({ scale: 1 })
  const vp = page.getViewport({ scale: Math.min(2, longEdge / Math.max(base.width, base.height)) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
  const url = canvas.toDataURL('image/jpeg', 0.72)
  canvas.width = 0; canvas.height = 0
  return url
}

/** Layer names of the document's optional content (CAD layers), once per doc. */
export async function layerNames(doc: PdfDoc): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  try {
    const oc = await doc.getOptionalContentConfig()
    for (const [id, g] of Array.from(oc as unknown as Iterable<[string, { name?: string }]>)) names.set(id, g?.name ?? id)
  } catch { /* no layers */ }
  return names
}

/** One page's pens and stroked lines in viewed space (y up, points) — the
 *  first pass's input (lib/plans/first-pass.ts). */
export async function readVectors(pdfjs: PdfjsModule, doc: PdfDoc, n: number): Promise<{ pens: PdfPen[]; lines: PdfLine[]; size: { width: number; height: number } }> {
  const page = await doc.getPage(n)
  try {
    const vp = page.getViewport({ scale: 1 })
    const t = Array.from(vp.transform) as ViewTransform
    const [ops, names] = await Promise.all([page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE }), layerNames(doc)])
    const { pens, lines } = extractVectors(ops, pdfjs.OPS as unknown as Record<string, number>, (id) => names.get(id) ?? null)
    return { pens, lines: linesToViewed(lines, t, vp.height), size: { width: vp.width, height: vp.height } }
  } finally {
    page.cleanup()
  }
}

/** Read one page: size, thumbnail, title block, fingerprint, ink box. */
export async function readPage(pdfjs: PdfjsModule, doc: PdfDoc, n: number, names: Map<string, string>): Promise<PageRead> {
  const page = await doc.getPage(n)
  try {
    const vp = page.getViewport({ scale: 1 })
    const size = { width: vp.width, height: vp.height }
    const t = Array.from(vp.transform) as ViewTransform
    const [tc, annots, ops] = await Promise.all([
      page.getTextContent(),
      page.getAnnotations().catch(() => []),
      page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE }),
    ])
    const words = wordsToViewed([
      ...textFromContent(tc.items as { str?: string; transform?: number[]; width?: number; height?: number }[]),
      ...textFromShx(annots as never[]),
    ], t, vp.height)
    const { pens, lines } = extractVectors(ops, pdfjs.OPS as unknown as Record<string, number>, (id) => names.get(id) ?? null)
    const vl = linesToViewed(lines, t, vp.height)
    const src = fingerprintSource(words, vl, pens, size)
    const [signature, thumb] = await Promise.all([src ? sha256Hex(src) : Promise.resolve(null), thumbOf(page, 260)])
    const tb = readTitleBlock(words, size)
    const checks: ScaleCheck[] = []
    if (tb.feetPerInch) checks.push({ key: 'stated', feetPerInch: tb.feetPerInch, detail: `${tb.scaleText ?? ''} in the title block`.trim() })
    const bar = scaleBar(words)
    if (bar) checks.push({ key: 'bar', feetPerInch: bar.feetPerInch, detail: bar.detail })
    const dims = labelledDistances(words, vl)
    if (dims) checks.push({ key: 'dims', feetPerInch: dims.feetPerInch, detail: dims.detail })
    const grid = fitGrid(findGridLabels(words), size)
    if (grid) checks.push({ key: 'grid', feetPerInch: grid.feetPerInch, detail: `${grid.what}, worst ${grid.worstFt} ft` })
    const crop = autoCrop(vl, size)
    let features: PlanFeatures | null = null
    try { features = planFeatures(pens, vl, size, crop) } catch { /* a page we can't read corners off just places by hand */ }
    return { page: n, width: size.width, height: size.height, thumb, tb, signature, ink: inkBox(vl, size), checks, grid, crop, features }
  } finally {
    page.cleanup()
  }
}

/** The page as the map's picture: PNG, long edge 3000 px (never past 6×) —
 *  the scale the plan reader expects (lib/dirt/plan-geo.ts rasterScale). */
export async function renderSheetPng(doc: PdfDoc, n: number): Promise<Blob> {
  const page = await doc.getPage(n)
  try {
    const base = page.getViewport({ scale: 1 })
    const vp = page.getViewport({ scale: rasterScale(base.width, base.height) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    canvas.width = 0; canvas.height = 0
    if (!blob) throw new Error('rasterize failed')
    return blob
  } finally {
    page.cleanup()
  }
}

/** A picture file (a scan or an export) as one "page": its thumbnail and size. */
export async function readImageFile(f: File): Promise<{ thumb: string; width: number; height: number }> {
  const url = URL.createObjectURL(f)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('image'))
      i.src = url
    })
    const k = Math.min(1, 260 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k)); canvas.height = Math.max(1, Math.round(img.naturalHeight * k))
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(img, 0, 0, canvas.width, canvas.height)
    const thumb = canvas.toDataURL('image/jpeg', 0.72)
    canvas.width = 0; canvas.height = 0
    return { thumb, width: img.naturalWidth, height: img.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The legacy picture category (055) a sheet files under, from its title. */
export function categoryFor(title: string | null, number: string | null): string {
  const t = `${title ?? ''} ${number ?? ''}`.toUpperCase()
  if (/EXIST|SURVEY|TOPO/.test(t)) return 'Existing'
  if (/GRAD|DRAIN|STORM/.test(t)) return 'Grading'
  if (/UTIL|SEWER|WATER/.test(t)) return 'Utilities'
  if (/LANDSC|PLANT|TREE/.test(t)) return 'Landscape'
  if (/EROSION|SEDIMENT|ESC/.test(t)) return 'Erosion control'
  if (/SITE|LAYOUT|DIMENS|PAVING/.test(t)) return 'Site plan'
  return 'Other'
}
