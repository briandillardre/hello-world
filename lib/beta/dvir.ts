/**
 * Driver vehicle inspection reports — pure. The items 49 CFR 396.11 names
 * (a commercial truck's post-trip report must cover at least these; the
 * pre-trip in 396.13 reviews the last one), plus trailer items when one is
 * coupled. A defect is minor or out-of-service; any out-of-service defect
 * makes the vehicle UNSAFE until a mechanic certifies the repair, and every
 * defect opens a work order on the machine (lib/actions/beta.ts) so it
 * can't be signed and forgotten.
 *
 * 396.11(a)(2): the report lists the vehicle, the defects and the driver's
 * signature; 396.11(a)(3): before it runs again a carrier certifies the
 * defects are repaired or that repair is unnecessary; the next driver signs
 * that they saw the certification. All three are on the record here.
 */

export const DVIR_ITEMS: { key: string; label: string; trailer?: true }[] = [
  { key: 'service_brakes', label: 'Service brakes (incl. trailer brake connections)' },
  { key: 'parking_brake', label: 'Parking brake' },
  { key: 'steering', label: 'Steering mechanism' },
  { key: 'lights', label: 'Lights and reflectors' },
  { key: 'tires', label: 'Tires' },
  { key: 'horn', label: 'Horn' },
  { key: 'wipers', label: 'Windshield wipers' },
  { key: 'mirrors', label: 'Rear-vision mirrors' },
  { key: 'coupling', label: 'Coupling devices / fifth wheel' },
  { key: 'wheels', label: 'Wheels and rims' },
  { key: 'emergency', label: 'Emergency equipment (extinguisher, triangles)' },
  { key: 'fluids', label: 'Fluid leaks (oil, coolant, fuel, air)' },
  { key: 'body', label: 'Body, doors, load securement' },
  { key: 'trailer_brakes', label: 'Trailer brakes', trailer: true },
  { key: 'trailer_lights', label: 'Trailer lights', trailer: true },
  { key: 'trailer_tires', label: 'Trailer tires and wheels', trailer: true },
  { key: 'trailer_hitch', label: 'Hitch, pin, chains', trailer: true },
]

export type Severity = 'minor' | 'oos'
export interface Defect { item: string; severity: Severity; note: string }
export interface Dvir {
  when: 'pre' | 'post'
  odometer?: number
  trailer?: string
  defects: Defect[]
  driverName: string
  signature: string
  signedAt: string
  /** 396.11(a)(3): a mechanic's certification */
  repair?: { by: string; at: string; outcome: 'repaired' | 'not_needed'; note?: string }
  /** the next driver's review of that certification */
  reviewedBy?: { name: string; at: string }
  workOrderIds?: string[]
}

export function cleanDvir(raw: unknown, now: string): { ok: true; value: Omit<Dvir, 'driverName' | 'signedAt'> & { signedAt: string } } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Nothing to file.' }
  const r = raw as Record<string, unknown>
  const when = r.when === 'post' ? 'post' : r.when === 'pre' ? 'pre' : null
  if (!when) return { ok: false, error: 'Pre-trip or post-trip?' }
  const odo = r.odometer === undefined || r.odometer === null || r.odometer === '' ? undefined : Number(r.odometer)
  if (odo !== undefined && (!Number.isFinite(odo) || odo < 0 || odo > 3_000_000)) return { ok: false, error: 'That odometer reading doesn’t look right.' }
  const trailer = typeof r.trailer === 'string' ? r.trailer.trim().slice(0, 60) || undefined : undefined
  const keys = new Set(DVIR_ITEMS.filter((i) => trailer || !i.trailer).map((i) => i.key))
  const defects: Defect[] = []
  if (Array.isArray(r.defects)) {
    for (const d of r.defects.slice(0, 40)) {
      if (!d || typeof d !== 'object') continue
      const x = d as Record<string, unknown>
      if (typeof x.item !== 'string' || !keys.has(x.item)) continue
      if (defects.some((y) => y.item === x.item)) continue
      const note = typeof x.note === 'string' ? x.note.trim().slice(0, 400) : ''
      defects.push({ item: x.item, severity: x.severity === 'oos' ? 'oos' : 'minor', note })
    }
  }
  const signature = typeof r.signature === 'string' ? r.signature.trim() : ''
  if (!/^[MLml0-9 .,-]{6,12000}$/.test(signature)) return { ok: false, error: 'Sign it with a finger first.' }
  return { ok: true, value: { when, odometer: odo === undefined ? undefined : Math.round(odo), trailer, defects, signature, signedAt: now } }
}

export const itemLabel = (key: string) => DVIR_ITEMS.find((i) => i.key === key)?.label ?? key

/** Safe to drive? No out-of-service defect, or one a mechanic has signed off. */
export function dvirStatus(d: Pick<Dvir, 'defects' | 'repair' | 'reviewedBy'>): { state: 'ok' | 'minor' | 'unsafe' | 'repaired'; words: string } {
  const oos = d.defects.filter((x) => x.severity === 'oos').length
  if (!d.defects.length) return { state: 'ok', words: 'No defects — safe to operate' }
  if (d.repair) return { state: 'repaired', words: d.repair.outcome === 'repaired' ? `Repaired — certified by ${d.repair.by}${d.reviewedBy ? `; reviewed by ${d.reviewedBy.name}` : ' · next driver to review'}` : `Repair not needed — certified by ${d.repair.by}` }
  if (oos) return { state: 'unsafe', words: `${oos} out-of-service ${oos === 1 ? 'defect' : 'defects'} — do not operate until repaired` }
  return { state: 'minor', words: `${d.defects.length} minor ${d.defects.length === 1 ? 'defect' : 'defects'} — safe to operate, repair soon` }
}
