const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface SiteOverlay {
  id: string
  url: string
  /** Ground corners in MapLibre image-source order: [[TL],[TR],[BR],[BL]], each [lng, lat]. */
  coords: [[number, number], [number, number], [number, number], [number, number]]
  zoneId: string
  /** taken_on (YYYY-MM-DD) — drives the map timeline for photos. */
  takenOn: string
  /** 'photo' rides the Site imagery toggle + timeline; 'plan' rides Scaled plans. */
  kind: 'photo' | 'plan'
  /** A satellite picture (source 'satellite') — it yields on the map to a
   *  sharper drone/site photo up to 14 days older (lib/satellite/display.ts). */
  satellite: boolean
  /** Plan-room versions (143): the sheet this picture is a version of, its
   *  issue date and whether it is the current version — the map shows the
   *  current one live and the one current on a scrubbed day in a replay. */
  sheetId?: string
  issuedOn?: string
  current?: boolean
  /** A revision newer than a pinned current one — held back, never drawn. */
  held?: boolean
  /** When the version was filed — breaks a same-day tie on the timeline. */
  createdAt?: string
  /** "C-101 · Grading plan" and "Rev 2 · Addendum 1 · Oct 20, 2026". */
  sheetLabel?: string
  versionLabel?: string
  /** The drawing area to show (page fractions, v down), border + title block off. */
  crop?: { x0: number; y0: number; x1: number; y1: number; on?: boolean } | null
}

type Corner = [number, number]
function validCorners(b: unknown): b is [Corner, Corner, Corner, Corner] {
  return Array.isArray(b) && b.length === 4 && b.every((c) =>
    Array.isArray(c) && c.length === 2 &&
    typeof c[0] === 'number' && c[0] >= -180 && c[0] <= 180 &&
    typeof c[1] === 'number' && c[1] >= -90 && c[1] <= 90)
}

/**
 * Placed site imagery for the live map:
 *   photos — the NEWEST 500 placed shots (053 bounds), so the map timeline can
 *            play the site back: the scrubber shows each zone's newest shot
 *            taken on or before the scrubbed day; Live shows the newest, period.
 *            Newest, not oldest: a site watched by satellite (131) adds a dated
 *            picture every few days, and an oldest-first cap froze the live map
 *            on old pictures once a company passed 500.
 *   plans  — only each zone's map_active sheet (055 radio; one per zone),
 *            fetched on their own so photos can never crowd them out.
 * Photos sort before plans so plans mount later → draw on top when both
 * toggles are on. Photos carry `satellite` so the map can keep a sharper
 * drone/site shot over a satellite picture taken within 14 days of it
 * (lib/satellite/display.ts — the same day included); within one day a
 * satellite picture also sorts BEFORE the other shots. Tolerates pre-055 (no
 * kind column → all rows are photos) and pre-052/053 (table/column missing →
 * empty).
 */
export async function getPlacedSiteOverlays(companyId: string): Promise<SiteOverlay[]> {
  if (isMock) return []
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const base = 'id, url, bounds, geofence_id, taken_on, created_at, source'
    let rows: Record<string, unknown>[] | null = null
    let planRows: Record<string, unknown>[] = []
    {
      const [ph, pl] = await Promise.all([
        supabase
          .from('zone_imagery')
          .select(`${base}, kind`)
          .eq('company_id', companyId)
          .not('bounds', 'is', null)
          .neq('kind', 'plan')
          .order('taken_on', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(500),
        // Every flagged sheet, placed or not: a sheet whose current revision
        // is not placed yet still plays its placed history on the timeline.
        supabase
          .from('zone_imagery')
          .select(`${base}, kind, map_active`)
          .eq('company_id', companyId)
          .eq('kind', 'plan')
          .eq('map_active', true)
          .limit(200),
      ])
      if (!ph.error) {
        rows = ph.data
        planRows = pl.error ? [] : (pl.data ?? [])
      }
    }
    if (!rows) {
      const { data, error } = await supabase
        .from('zone_imagery')
        .select(base)
        .eq('company_id', companyId)
        .not('bounds', 'is', null)
        .order('taken_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) return []
      rows = data
    }
    const satFirst = (r: Record<string, unknown>) => (r.source === 'satellite' ? 0 : 1)
    rows = [...(rows ?? [])].sort((a, b) =>
      String(a.taken_on ?? '').localeCompare(String(b.taken_on ?? '')) ||
      satFirst(a) - satFirst(b) ||
      String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
    // Plan-room sheets (143): the map flag sits on each sheet's CURRENT
    // version; bring every placed version of those sheets so the timeline
    // can show the one that was current on a scrubbed day.
    const pv = await planVersionsFor(supabase, planRows.map((r) => String(r.id)))
    const versioned = pv?.frames ?? null
    // A picture that belongs to ANY plan-room version (a voided sheet's
    // included) is never drawn as an old-style plan.
    rows = pv ? [...rows, ...planRows.filter((r) => !pv.known.has(String(r.id)))] : [...rows, ...planRows]
    const photos: SiteOverlay[] = []
    const plans: SiteOverlay[] = []
    for (const row of rows ?? []) {
      if (!validCorners(row.bounds)) continue
      const item: SiteOverlay = {
        id: String(row.id),
        url: String(row.url),
        coords: row.bounds,
        zoneId: String(row.geofence_id),
        takenOn: String(row.taken_on ?? ''),
        kind: row.kind === 'plan' ? 'plan' : 'photo',
        satellite: row.source === 'satellite',
      }
      if (item.kind === 'plan') {
        if (row.map_active === true) plans.push(item)
      } else {
        photos.push(item)
      }
    }
    return [...photos, ...plans, ...(versioned ?? []).map((o) => { const c = { ...o }; delete c.fromImage; return c })]
  } catch {
    return []
  }
}

type Db = ReturnType<typeof import('../supabase-server')['createClient']>

/** Every placed version of the sheets whose current picture is on the map. */
async function planVersionsFor(db: Db, activeImageIds: string[]): Promise<{ frames: (SiteOverlay & { fromImage?: string })[]; known: Set<string> } | null> {
  if (!activeImageIds.length) return null
  try {
    const { data: hits, error } = await db.from('plan_versions').select('sheet_id, image_id').in('image_id', activeImageIds.slice(0, 200))
    if (error) return null
    const known = new Set((hits ?? []).map((h) => String(h.image_id)))
    if (!hits?.length) return { frames: [], known }
    const sheetIds = Array.from(new Set(hits.map((h) => String(h.sheet_id))))
    const [{ data: sheets }, { data: vers }] = await Promise.all([
      db.from('plan_sheets').select('id, number, title, current_version_id, voided_at').in('id', sheetIds),
      db.from('plan_versions').select('id, sheet_id, set_id, image_id, rev, issued_on, created_at, crop').in('sheet_id', sheetIds).limit(2000),
    ])
    const imgIds = Array.from(new Set((vers ?? []).map((v) => v.image_id).filter((x): x is string => !!x)))
    const setIds = Array.from(new Set((vers ?? []).map((v) => v.set_id).filter((x): x is string => !!x)))
    const [{ data: imgs }, { data: sets }] = await Promise.all([
      imgIds.length ? db.from('zone_imagery').select('id, url, bounds, geofence_id, taken_on').in('id', imgIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      setIds.length ? db.from('plan_sets').select('id, name').in('id', setIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ])
    const { currentOf, revLabel, statusOf } = await import('../plans/room')
    const { versionFromRow } = await import('./plans')
    const img = new Map((imgs ?? []).map((i) => [String(i.id), i]))
    const setName = new Map((sets ?? []).map((x) => [String(x.id), String(x.name ?? '')]))
    const day = (d: string) => {
      const t = Date.parse(`${d}T12:00:00Z`)
      return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    }
    const out: (SiteOverlay & { fromImage?: string })[] = []
    for (const sh of sheets ?? []) {
      if (sh.voided_at) continue
      const vs = (vers ?? []).filter((v) => v.sheet_id === sh.id).map((v) => ({ row: v, v: versionFromRow(v as Record<string, unknown>) }))
      const pin = { pinnedVersionId: (sh.current_version_id as string | null) ?? null }
      const all = vs.map((x) => x.v)
      const cur = currentOf(pin, all)
      for (const { row, v } of vs) {
        const i = v.imageId ? img.get(v.imageId) : undefined
        if (!i || !validCorners(i.bounds)) continue
        const crop = row.crop && typeof row.crop === 'object' ? row.crop as SiteOverlay['crop'] : null
        out.push({
          id: String(i.id), url: String(i.url), coords: i.bounds, zoneId: String(i.geofence_id), takenOn: String(i.taken_on ?? ''),
          kind: 'plan', satellite: false,
          sheetId: String(sh.id), issuedOn: v.issuedOn, current: cur?.id === v.id,
          held: statusOf(v, pin, all).kind === 'held', createdAt: String(row.created_at ?? ''),
          sheetLabel: `${sh.number}${sh.title ? ` · ${sh.title}` : ''}`,
          versionLabel: `${revLabel(v.rev)}${v.setId && setName.get(v.setId) ? ` · ${setName.get(v.setId)}` : ''} · ${day(v.issuedOn)}`,
          crop,
          fromImage: activeImageIds.includes(String(i.id)) ? String(i.id) : undefined,
        })
      }
    }
    return { frames: out, known }
  } catch {
    return null
  }
}
