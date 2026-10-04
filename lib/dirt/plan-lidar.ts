/**
 * The USGS lidar under a plan sheet, asked in the sheet's own page space —
 * pure. The plan reader checks existing contours against it (the plan's
 * datum, a misread label, a contour nothing else could name).
 */
import { GridSurface } from './surface'
import { tmForward, utmParams } from './tm'
import type { GroundGrid } from './takeoff'
import type { SheetMap } from './plan-geo'

const FT = 0.3048

/** Existing ground in FEET (the lidar's datum, NAVD88) at a page point; NaN off the grid. */
export function lidarAtPage(map: SheetMap, grid: GroundGrid): (x: number, y: number) => number {
  const surf = new GridSurface({ x0: grid.x0, y0: grid.y0, dx: grid.dx, dy: grid.dy, nx: grid.nx, ny: grid.ny, z: grid.z })
  const p = utmParams(grid.zone)
  return (x, y) => {
    const [lng, lat] = map.toLngLat(x, y)
    const [e, n] = tmForward(p, lng, lat)
    const m = surf.zAt(e, n)
    return Number.isFinite(m) ? m / FT : NaN
  }
}
