/**
 * The takeoff, off the main thread: the editor posts the design on every
 * change (debounced) and gets back the numbers plus the cut/fill raster as a
 * transferable buffer, so tracing never stutters while a big site runs.
 */
import { runTakeoff, type DirtDesign, type GroundGrid } from './takeoff'
import { heatRaster } from './heat'

let ground: GroundGrid | null = null

type In =
  | { type: 'ground'; ground: GroundGrid | null }
  | { type: 'run'; seq: number; design: DirtDesign }

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)

self.onmessage = (e: MessageEvent<In>) => {
  const m = e.data
  if (m.type === 'ground') { ground = m.ground; return }
  if (m.type !== 'run') return
  try {
    const { results, ctx } = runTakeoff(m.design, ground)
    const heat = heatRaster(ctx, { maxPx: 1000 })
    post({ type: 'done', seq: m.seq, results, heat }, heat ? [heat.rgba.buffer] : [])
  } catch (err) {
    post({ type: 'error', seq: m.seq, error: err instanceof Error ? err.message : String(err) })
  }
}
