/**
 * Which grid a design goes out on (lib/machine/export.ts) — kept apart so a
 * page can offer the choice without loading the exporter.
 */
import { plausibleSC, toStatePlane } from '../plans/stateplane'

export type Grid = 'sc' | 'utm'

/** SC State Plane by default inside a rough South Carolina box, else UTM — the export screen names the grid and lets it be changed (a box can't tell Charlotte or Augusta from South Carolina). */
export function defaultGrid(lng: number, lat: number): Grid {
  const [e, n] = toStatePlane(lng, lat)
  return plausibleSC(e, n) && lat > 32 && lat < 35.25 && lng > -83.4 && lng < -78.5 ? 'sc' : 'utm'
}
