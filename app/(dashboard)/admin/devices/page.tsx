import { notFound } from 'next/navigation'
import { isPlatformOwner } from '@/lib/platform-owner'
import { getMyPermissions } from '@/lib/permissions-server'
import { DeviceInventory, type DeviceRow } from '@/components/admin/DeviceInventory'
import { MODELS, modelFromImei, type DeviceModel } from '@/lib/devices'

export const metadata = { title: 'HammerTrack — Devices' }
export const dynamic = 'force-dynamic'

/**
 * Founder-only, all-clients device inventory (replaces the Google Sheet).
 * Reads every company with the service role, so the gate is everything:
 * platform owner only, never under view-as, 404 for anyone else.
 *
 * Query shape (bounded): registry + worn assets, then ONE embedded
 * newest-fix read per worn asset (limit 1 per asset on the
 * (asset_id, timestamp) index — no scan of asset_locations), the one-row-
 * per-asset telemetry table for truck volts, newest pairing per tag, and
 * one newest-row read per drawer IMEI in unassigned_locations.
 */
export default async function AdminDevicesPage() {
  if (!(await isPlatformOwner())) notFound()
  // notFound() throws — keep it OUTSIDE the try so it is never swallowed.
  let previewing = false
  try {
    const perms = await getMyPermissions() as { viewingAs?: unknown } | null
    previewing = !!perms?.viewingAs
  } catch { previewing = true /* can't tell = refuse */ }
  if (previewing) notFound()

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()

  type Co = { id: string; name: string | null }
  type Reg = { company_id: string; imei: string; model: string | null; label: string | null; iccid: string | null }
  type Ast = { id: string; company_id: string; name: string; type: string; tracker_id: string }

  const [coQ, regQ, astQ] = await Promise.all([
    db.from('companies').select('id, name'),
    db.from('device_onboarding').select('company_id, imei, model, label, iccid'),
    db.from('assets').select('id, company_id, name, type, tracker_id')
      .eq('active', true).is('deleted_at', null).not('tracker_id', 'is', null),
  ])
  const coName = new Map(((coQ.data ?? []) as Co[]).map((c) => [c.id, c.name ?? '(unnamed)']))
  const registry = (regQ.data ?? []) as Reg[]
  const assets = ((astQ.data ?? []) as Ast[]).filter((a) => a.tracker_id && !a.tracker_id.startsWith('phone-'))

  const norm = (t: string) => t.toUpperCase().replace(/^00000000-0000-0000-0000-/, '')
  const regByKey = new Map(registry.map((r) => [norm(r.imei), r]))
  const worn = new Set(assets.map((a) => norm(a.tracker_id)))

  const isTag = (id: string, model?: string | null) =>
    model === 'EYE_BEACON' || /^[0-9A-F]{12}$/.test(norm(id))

  const gpsAssets = assets.filter((a) => !isTag(a.tracker_id, regByKey.get(norm(a.tracker_id))?.model))
  const tagAssets = assets.filter((a) => isTag(a.tracker_id, regByKey.get(norm(a.tracker_id))?.model))

  // Newest fix per GPS asset, chunked.
  type Fix = { timestamp: string; battery: number | null }
  const lastFix = new Map<string, Fix>()
  const volts = new Map<string, number>()
  const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))
  await Promise.all(chunk(gpsAssets.map((a) => a.id), 100).map(async (ids) => {
    const [fixQ, telQ] = await Promise.all([
      db.from('assets').select('id, location:asset_locations(battery, timestamp)').in('id', ids)
        .order('timestamp', { ascending: false, referencedTable: 'asset_locations' })
        .limit(1, { referencedTable: 'asset_locations' }),
      db.from('asset_telemetry_latest').select('asset_id, readings').in('asset_id', ids),
    ])
    type FR = { id: string; location: Fix[] | Fix | null }
    for (const r of (fixQ.data ?? []) as FR[]) {
      const f = Array.isArray(r.location) ? r.location[0] : r.location
      if (f) lastFix.set(r.id, f)
    }
    type TR = { asset_id: string; readings: Record<string, { v?: unknown }> | null }
    for (const r of (telQ.data ?? []) as TR[]) {
      const v = Number(r.readings?.['external.powersource.voltage']?.v)
      if (Number.isFinite(v)) volts.set(r.asset_id, v)
    }
  }))

  // Newest pairing per worn tag.
  const heard = new Map<string, { at: string; by: string | null; byId: string | null }>()
  await Promise.all(chunk(tagAssets.map((a) => a.id), 100).map(async (ids) => {
    const { data } = await db.from('assets')
      .select('id, pairing:pairing_log!member_asset_id(last_seen, carrier_asset_id, carrier:assets!carrier_asset_id(name))')
      .in('id', ids)
      .order('last_seen', { ascending: false, referencedTable: 'pairing_log' })
      .limit(1, { referencedTable: 'pairing_log' })
    type P = { last_seen: string; carrier_asset_id: string; carrier: { name: string } | { name: string }[] | null }
    for (const r of (data ?? []) as { id: string; pairing: P[] | P | null }[]) {
      const p = Array.isArray(r.pairing) ? r.pairing[0] : r.pairing
      if (!p) continue
      const name = (Array.isArray(p.carrier) ? p.carrier[0]?.name : p.carrier?.name) ?? null
      heard.set(r.id, { at: p.last_seen, by: name, byId: p.carrier_asset_id })
    }
  }))

  // Drawer: registry rows nobody wears. GPS boxes: newest buffered ping.
  const drawer = registry.filter((r) => !worn.has(norm(r.imei)))
  const drawerFix = new Map<string, Fix>()
  await Promise.all(drawer.filter((r) => !isTag(r.imei, r.model)).map(async (r) => {
    const { data } = await db.from('unassigned_locations').select('battery, timestamp')
      .eq('company_id', r.company_id).eq('imei', r.imei)
      .order('timestamp', { ascending: false }).limit(1).maybeSingle()
    if (data) drawerFix.set(`${r.company_id}:${r.imei}`, data as Fix)
  }))

  const modelName = (id: string, m: string | null | undefined): string => {
    const model = (m ?? (isTag(id) ? 'EYE_BEACON' : modelFromImei(id)) ?? 'OTHER') as DeviceModel
    return MODELS[model]?.name ?? model
  }
  const kindOf = (id: string, m: string | null | undefined): DeviceRow['kind'] => {
    if (isTag(id, m)) return 'tag'
    const model = m ?? modelFromImei(id)
    return model === 'TAT141' ? 'battery' : 'obd'
  }

  const rows: DeviceRow[] = []
  for (const a of assets) {
    const reg = regByKey.get(norm(a.tracker_id))
    const tag = isTag(a.tracker_id, reg?.model)
    const fix = tag ? null : lastFix.get(a.id)
    const h = tag ? heard.get(a.id) : null
    rows.push({
      key: `a:${a.id}`,
      company: coName.get(a.company_id) ?? '(unknown)',
      tracker: a.tracker_id,
      model: modelName(a.tracker_id, reg?.model),
      kind: kindOf(a.tracker_id, reg?.model),
      iccid: reg?.iccid ?? null,
      assetId: a.id,
      assetName: a.name,
      assetType: a.type,
      label: reg?.label ?? null,
      lastAt: fix?.timestamp ?? h?.at ?? null,
      volts: volts.get(a.id) ?? null,
      battery: fix?.battery ?? null,
      heardBy: h?.by ?? null,
      heardById: h?.byId ?? null,
    })
  }
  for (const r of drawer) {
    const fix = drawerFix.get(`${r.company_id}:${r.imei}`)
    rows.push({
      key: `d:${r.company_id}:${r.imei}`,
      company: coName.get(r.company_id) ?? '(unknown)',
      tracker: r.imei,
      model: modelName(r.imei, r.model),
      kind: kindOf(r.imei, r.model),
      iccid: r.iccid,
      assetId: null, assetName: null, assetType: null,
      label: r.label,
      lastAt: fix?.timestamp ?? null,
      volts: null,
      battery: fix?.battery ?? null,
      heardBy: null, heardById: null,
    })
  }

  return <DeviceInventory rows={rows} now={Date.now()} />
}
