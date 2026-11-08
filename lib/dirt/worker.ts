/**
 * The takeoff, off the main thread: the editor posts the design on every
 * change (debounced) and gets back the numbers plus the cut/fill raster as a
 * transferable buffer, so tracing never stutters while a big site runs.
 */
import { buildContext, runTakeoff, type DirtDesign, type GroundGrid } from './takeoff'
import { heatRaster } from './heat'
import { groundResults, type BoringIn } from '../borings/ground'
import { designFiles } from '../machine/export'
import type { Grid } from '../machine/grid'

let ground: GroundGrid | null = null
let borings: BoringIn[] = []

type In =
  | { type: 'ground'; ground: GroundGrid | null }
  | { type: 'borings'; borings: BoringIn[] }
  | { type: 'run'; seq: number; design: DirtDesign }
  /** The design out to the machines (LandXML + DXF) — sent to its own worker instance by the export panel. */
  | { type: 'export'; design: DirtDesign; project: string; grid: Grid }

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)

self.onmessage = (e: MessageEvent<In>) => {
  const m = e.data
  if (m.type === 'ground') { ground = m.ground; return }
  if (m.type === 'borings') { borings = m.borings; return }
  if (m.type === 'export') {
    try {
      const f = designFiles(buildContext(m.design, ground), m.design, { project: m.project, now: new Date(), grid: m.grid })
      post({ type: 'exported', landxml: f.landxml, dxf: f.dxf, crs: f.crs, warnings: f.warnings, fgFaces: f.fg.faces.length / 3, sgFaces: f.sg.faces.length / 3 })
    } catch (err) {
      post({ type: 'export-error', error: err instanceof Error && err.name === 'ExportError' ? err.message : 'The design couldn’t be exported — check the traces.' })
    }
    return
  }
  if (m.type !== 'run') return
  try {
    // A design too big to run says so instead of pinning a phone's CPU for minutes.
    const { results, ctx } = runTakeoff(m.design, ground, new Date(), { deadline: Date.now() + 120_000 })
    // The site's borings, measured the same way the server's Save does.
    const g = borings.length ? groundResults(ctx, borings) : null
    if (g) results.ground = g
    const heat = heatRaster(ctx, { maxPx: 1000 })
    post({ type: 'done', seq: m.seq, results, heat }, heat ? [heat.rgba.buffer] : [])
  } catch (err) {
    post({ type: 'error', seq: m.seq, error: err instanceof Error ? err.message : String(err) })
  }
}
