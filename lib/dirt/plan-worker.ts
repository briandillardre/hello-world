/**
 * The plan reader, off the main thread: a sheet's pens and words in, the
 * suggested pen roles and the read out. A real sheet is 20k–100k strokes and
 * a read is a second or two of work that must not freeze the editor.
 */
import { readPlan, summarizePens, type PlanRead, type ReadInput, type Role } from './plan-read'
import { sheetMap, type SheetGeo } from './plan-geo'
import { lidarAtPage } from './plan-lidar'
import type { GroundGrid } from './takeoff'

let input: ReadInput | null = null
let roles: Record<number, Role> = {}
/** Lines the estimator set aside ("Not a contour"). */
let exclude: number[][] = []
let lidar: ((x: number, y: number) => number) | undefined

type In =
  | { type: 'load'; seq: number; input: ReadInput; geo: SheetGeo; ground: GroundGrid | null }
  | { type: 'read'; seq: number; roles: Record<number, Role>; exclude?: number[][] }
  | { type: 'ground'; seq: number; geo: SheetGeo; ground: GroundGrid | null }

export type PlanWorkerOut =
  | { type: 'loaded'; seq: number; pens: ReturnType<typeof summarizePens>; roles: Record<number, Role>; read: PlanRead; ms: number }
  | { type: 'read'; seq: number; read: PlanRead; ms: number }
  | { type: 'error'; seq: number; error: string }

const post = (msg: PlanWorkerOut) => (self as unknown as Worker).postMessage(msg)

self.onmessage = (e: MessageEvent<In>) => {
  const m = e.data
  try {
    const t0 = Date.now()
    if (m.type === 'load') {
      input = m.input
      lidar = m.ground ? lidarAtPage(sheetMap(m.geo), m.ground) : undefined
      const pens = summarizePens(input)
      roles = Object.fromEntries(pens.map(p => [p.id, p.suggested]))
      exclude = []
      const read = readPlan(input, { roles, existingFt: lidar })
      post({ type: 'loaded', seq: m.seq, pens, roles, read, ms: Date.now() - t0 })
    } else if (m.type === 'read' && input) {
      roles = m.roles
      exclude = m.exclude ?? []
      post({ type: 'read', seq: m.seq, read: readPlan(input, { roles, existingFt: lidar, exclude }), ms: Date.now() - t0 })
    } else if (m.type === 'ground' && input) {
      lidar = m.ground ? lidarAtPage(sheetMap(m.geo), m.ground) : undefined
      post({ type: 'read', seq: m.seq, read: readPlan(input, { roles, existingFt: lidar, exclude }), ms: Date.now() - t0 })
    }
  } catch (err) {
    post({ type: 'error', seq: m.seq, error: err instanceof Error ? err.message : String(err) })
  }
}
