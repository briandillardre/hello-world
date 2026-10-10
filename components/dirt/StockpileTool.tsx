'use client'

/**
 * Stockpile volumes (migration 136): draw a pile's toe on the map, pick the
 * drone survey (or old USGS lidar, with the warning), the base rule and the
 * material, and the server measures it. Measurements of the same pile name
 * line up over time. Reuses the takeoff editor's map (TakeoffMap) for the
 * satellite base and the tap-to-trace ring.
 */
import { useCallback, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ArrowLeft, Pencil, Trash2, Upload, X } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { NO_REPLY } from '@/lib/action-reply'
import { MATERIALS, materialDensity, type PileBase } from '@/lib/dirt/stockpile'
import { pileHistory } from '@/lib/dirt/pile-history'
import { deleteStockpileAction, finalizeSurfaceAction, measureStockpileAction, startSurfaceUploadAction } from '@/lib/actions/stockpiles'
import type { StockpileSummary, SurfaceSummary } from '@/lib/db/dirt'

const TakeoffMap = dynamic(() => import('./TakeoffMap'), { ssr: false })

const n0 = (v: number | undefined) => Math.round(Number(v) || 0).toLocaleString()
const n1 = (v: number | undefined) => (Math.round((Number(v) || 0) * 10) / 10).toLocaleString()
const today = () => new Date().toISOString().slice(0, 10)
const AMBER = '#f59e0b'

interface Props {
  zone: { id: string; name: string; ring: [number, number][] | null }
  piles: StockpileSummary[]
  surfaces: SurfaceSummary[]
  canEdit: boolean
}

export default function StockpileTool({ zone, piles: initialPiles, surfaces: initialSurfaces, canEdit }: Props) {
  const [piles, setPiles] = useState(initialPiles)
  const [surfaces, setSurfaces] = useState(initialSurfaces)
  const [surfaceId, setSurfaceId] = useState<string>(initialSurfaces[0]?.id ?? '')
  const [drawing, setDrawing] = useState(false)
  const [draft, setDraft] = useState<[number, number][]>([])
  const [toe, setToe] = useState<[number, number][] | null>(null)
  const [name, setName] = useState('')
  const [base, setBase] = useState<PileBase>('tin')
  const [material, setMaterial] = useState('gravel')
  const [density, setDensity] = useState(String(materialDensity('gravel')))
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [frame] = useState(() => ({ key: 1, coords: zone.ring ?? [] }))
  // Upload form
  const [upOpen, setUpOpen] = useState(false)
  const [upName, setUpName] = useState('')
  const [upDate, setUpDate] = useState(today())
  const [upUnits, setUpUnits] = useState('auto')

  const features = useMemo<GeoJSON.FeatureCollection>(() => {
    const out: GeoJSON.Feature[] = []
    // Newest measurement per pile name on the map.
    for (const h of pileHistory(piles)) {
      const p = h.latest
      if (!Array.isArray(p.toe) || p.toe.length < 3) continue
      const props = { id: p.id, kind: 'topsoil', color: AMBER, sel: p.id === selected ? 1 : 0 }
      out.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...p.toe, p.toe[0]]] }, properties: { ...props, g: 'ar' } })
      const c = p.toe.reduce((s, q) => [s[0] + q[0] / p.toe.length, s[1] + q[1] / p.toe.length], [0, 0])
      out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { ...props, g: 'al', lbl: `${p.name} · ${n0(p.results.cy)} CY` } })
    }
    if (toe) {
      out.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...toe, toe[0]]] }, properties: { id: 'toe', kind: 'platform', color: '#22d3ee', sel: 1, g: 'ar' } })
    }
    return { type: 'FeatureCollection', features: out }
  }, [piles, toe, selected])

  const finish = useCallback(() => {
    if (draft.length < 3) return
    setToe(draft); setDrawing(false); setDraft([])
  }, [draft])

  const onMapClick = useCallback((p: [number, number], meta: { closesRing: boolean }) => {
    if (!drawing) return
    if (meta.closesRing) { finish(); return }
    setDraft(d => [...d, p])
  }, [drawing, finish])

  async function upload(f: File) {
    setErr(null); setBusy('Uploading the survey…')
    try {
      const pre = await startSurfaceUploadAction(zone.id, { name: upName, flownOn: upDate, size: f.size, zUnits: upUnits }).catch(() => null)
      if (!pre?.ok || !pre.path || !pre.token || !pre.id) { setErr(pre?.error ?? NO_REPLY); return }
      const { error } = await createClient().storage.from('dirt').uploadToSignedUrl(pre.path, pre.token, f, { contentType: 'image/tiff' })
      if (error) { setErr('Upload didn’t go through — check signal and try again.'); return }
      setBusy('Reading the survey…')
      const r = await finalizeSurfaceAction(pre.id).catch(() => null)
      if (!r?.ok || !r.surface) { setErr(r?.error ?? NO_REPLY); return }
      setSurfaces(s => [r.surface!, ...s].sort((a, b) => b.flownOn.localeCompare(a.flownOn)))
      setSurfaceId(r.surface.id)
      setUpOpen(false); setUpName('')
    } finally {
      setBusy(null)
    }
  }

  async function measure() {
    if (!toe) return
    setErr(null); setBusy(surfaceId ? 'Measuring from the drone survey…' : 'Measuring from USGS lidar…')
    try {
      const r = await measureStockpileAction({
        zoneId: zone.id, name: name || 'Stockpile', toe, surfaceId: surfaceId || null, base, material, densityTCy: Number(density),
      }).catch(() => null)
      if (!r?.ok || !r.pile) { setErr(r?.error ?? NO_REPLY); return }
      setPiles(ps => [r.pile!, ...ps])
      setSelected(r.pile.id)
      setToe(null)
    } finally {
      setBusy(null)
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this measurement?')) return
    const r = await deleteStockpileAction(id).catch(() => null)
    if (r?.ok) setPiles(ps => ps.filter(p => p.id !== id))
    else setErr(r?.error ?? NO_REPLY)
  }

  const history = pileHistory(piles)
  const names = Array.from(new Set(piles.map(p => p.name)))

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-navy-950 pb-[calc(54px+var(--ht-safe-bottom,0px))] text-ink md:pb-[var(--ht-safe-bottom,0px)]" style={{ paddingTop: 'var(--ht-safe-top, 0px)' }}>
      <div className="flex items-center gap-2 border-b border-navy-800 bg-navy-900 px-3 py-2">
        <Link href={`/zones/${zone.id}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-navy-800 hover:text-ink" aria-label="Back to the site">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{zone.name} — stockpiles</div>
          <div className="text-[11px] text-muted">Draw a pile&apos;s toe over the drone survey · volume above the base, in CY, m³ and tons</div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative h-[48dvh] shrink-0 md:h-auto md:flex-1">
          <TakeoffMap
            ring={zone.ring}
            sheets={[]}
            features={features}
            draft={drawing ? { shape: 'area', coords: draft, color: '#22d3ee' } : null}
            heat={null}
            heatVisible={false}
            heatOpacity={0}
            heatOverSheets={false}
            drawing={drawing}
            snapTo={[]}
            onClick={onMapClick}
            onDblClick={finish}
            onPick={id => setSelected(id && id !== 'toe' ? id : null)}
            frame={frame}
          />
          {drawing && (
            <div className="absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border border-navy-700 bg-navy-900/95 px-3 py-2 text-xs shadow-lg">
              <span className="font-semibold">Pile toe</span>
              <span className="text-muted">Tap around the foot of the pile · tap the first point or double-tap to finish</span>
              {draft.length > 0 && <button onClick={() => setDraft(d => d.slice(0, -1))} className="rounded border border-navy-700 px-2 py-0.5">Undo</button>}
              <button onClick={() => { setDrawing(false); setDraft([]) }} className="rounded border border-navy-700 px-2 py-0.5"><X className="inline h-3 w-3" /> Cancel</button>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-navy-800 p-3 md:w-[360px] md:flex-none md:border-l">
          {/* Survey */}
          <section className="space-y-2">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">Surface</h2>
            <select value={surfaceId} onChange={e => setSurfaceId(e.target.value)} className="w-full rounded-lg border border-navy-700 bg-navy-900 px-2 py-2 text-sm">
              {surfaces.map(s => <option key={s.id} value={s.id}>{s.name} · flown {s.flownOn}</option>)}
              <option value="">USGS lidar (old — not today&apos;s pile)</option>
            </select>
            {surfaceId
              ? <p className="text-xs text-muted">{surfaces.find(s => s.id === surfaceId)?.words}{surfaces.find(s => s.id === surfaceId)?.resM ? ` · ${n1((surfaces.find(s => s.id === surfaceId)?.resM ?? 0) * 100)} cm pixels` : ''}</p>
              : <p className="text-xs text-amber">USGS lidar was flown years ago — it shows the ground as it was then, not the pile today. Use it only to check a long-standing pile; upload a current drone survey for a real number.</p>}
            {canEdit && !upOpen && (
              <button onClick={() => setUpOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-navy-700 px-3 py-1.5 text-sm hover:bg-navy-800"><Upload className="h-4 w-4" /> Upload a drone survey (DSM)</button>
            )}
            {upOpen && (
              <div className="space-y-2 rounded-lg border border-navy-800 bg-navy-900 p-3 text-xs">
                <p className="text-muted">The elevation export (DSM / DEM GeoTIFF, one band) from DroneDeploy, Pix4D, WebODM… in UTM or WGS84, up to 50 MB.</p>
                <input value={upName} onChange={e => setUpName(e.target.value)} placeholder="Name (e.g. Weekly flight)" maxLength={120} className="w-full rounded border border-navy-700 bg-navy-950 px-2 py-1.5 text-sm" />
                <label className="flex items-center gap-2">Flown on <input type="date" value={upDate} onChange={e => setUpDate(e.target.value)} className="rounded border border-navy-700 bg-navy-950 px-2 py-1 text-sm" /></label>
                <label className="flex items-center gap-2">Heights in
                  <select value={upUnits} onChange={e => setUpUnits(e.target.value)} className="rounded border border-navy-700 bg-navy-950 px-2 py-1 text-sm">
                    <option value="auto">what the file says</option>
                    <option value="m">metres</option>
                    <option value="ft">feet</option>
                    <option value="usft">US survey feet</option>
                  </select>
                </label>
                <div className="flex gap-2">
                  <label className="cursor-pointer rounded-lg bg-amber px-3 py-1.5 text-sm font-semibold text-navy-950">
                    Pick the .tif
                    <input type="file" accept=".tif,.tiff,image/tiff" className="hidden" disabled={!!busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }} />
                  </label>
                  <button onClick={() => setUpOpen(false)} className="rounded-lg border border-navy-700 px-3 py-1.5 text-sm">Cancel</button>
                </div>
              </div>
            )}
          </section>

          {/* Measure */}
          {canEdit && (
            <section className="space-y-2">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">Measure a pile</h2>
              {!toe ? (
                <button onClick={() => { setDrawing(true); setDraft([]); setErr(null) }} disabled={drawing} className="flex items-center gap-1.5 rounded-lg border border-navy-700 px-3 py-1.5 text-sm hover:bg-navy-800 disabled:opacity-60">
                  <Pencil className="h-4 w-4" /> {drawing ? 'Drawing the toe…' : 'Draw the toe'}
                </button>
              ) : (
                <div className="flex items-center gap-2 text-xs text-muted">Toe drawn ({toe.length} corners) <button onClick={() => { setToe(null); setDrawing(true) }} className="rounded border border-navy-700 px-2 py-0.5 text-ink">Redraw</button></div>
              )}
              <input value={name} onChange={e => setName(e.target.value)} list="pile-names" placeholder="Pile name — reuse one to track it over time" maxLength={120} className="w-full rounded-lg border border-navy-700 bg-navy-900 px-2 py-2 text-sm" />
              <datalist id="pile-names">{names.map(n => <option key={n} value={n} />)}</datalist>
              <div className="flex gap-2 text-xs">
                <button onClick={() => setBase('tin')} className={`flex-1 rounded-lg border px-2 py-1.5 ${base === 'tin' ? 'border-amber text-ink' : 'border-navy-700 text-muted'}`}>Base follows the toe</button>
                <button onClick={() => setBase('lowest')} className={`flex-1 rounded-lg border px-2 py-1.5 ${base === 'lowest' ? 'border-amber text-ink' : 'border-navy-700 text-muted'}`}>Flat at the lowest point</button>
              </div>
              <div className="flex gap-2">
                <select value={material} onChange={e => { setMaterial(e.target.value); setDensity(String(materialDensity(e.target.value))) }} className="min-w-0 flex-1 rounded-lg border border-navy-700 bg-navy-900 px-2 py-2 text-sm">
                  {MATERIALS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs text-muted">
                  <input value={density} onChange={e => setDensity(e.target.value)} inputMode="decimal" className="w-16 rounded-lg border border-navy-700 bg-navy-900 px-2 py-2 text-sm text-ink" aria-label="Density, tons per cubic yard" />
                  t/yd³
                </label>
              </div>
              <button onClick={measure} disabled={!toe || !!busy} className="w-full rounded-lg bg-amber px-3 py-2 text-sm font-semibold text-navy-950 disabled:opacity-50">Measure</button>
            </section>
          )}
          {busy && <p className="text-xs text-muted">{busy}</p>}
          {err && <p className="text-xs text-amber">{err}</p>}

          {/* Results */}
          <section className="space-y-2">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">Stockpiles</h2>
            {!history.length && <p className="text-xs text-muted">No piles measured on this site yet.</p>}
            {history.map(h => (
              <div key={h.name} className="rounded-lg border border-navy-800 bg-navy-900 p-3 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{h.name}</span>
                  {h.changeCy !== null && <span className={h.changeCy >= 0 ? 'text-teal' : 'text-amber'}>{h.changeCy >= 0 ? '+' : '−'}{n0(Math.abs(h.changeCy))} CY since {h.prevOn}</span>}
                </div>
                {h.all.map(p => (
                  <div key={p.id} onClick={() => setSelected(p.id)} className={`mt-2 cursor-pointer rounded border px-2 py-1.5 ${selected === p.id ? 'border-amber' : 'border-navy-800'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink">{p.measuredOn} · <b>{n0(p.results.cy)} CY</b> · {n0(p.results.m3)} m³ · {n0(p.results.tons)} tons</span>
                      {canEdit && <button onClick={e => { e.stopPropagation(); void remove(p.id) }} aria-label="Delete" className="text-faint hover:text-amber"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                    <div className="text-muted">
                      {n0(p.results.areaSf)} SF · {n1(p.results.maxHeightFt)} ft tall · {MATERIALS.find(m => m.id === p.material)?.label ?? p.material} at {p.results.densityTCy} t/yd³ · {p.results.base === 'lowest' ? 'flat base at the lowest point' : 'base follows the toe'}
                    </div>
                    <div className={p.source === 'lidar' ? 'text-amber' : 'text-faint'}>{p.results.source.detail}</div>
                    {p.results.belowCy > 0.5 && <div className="text-muted">{n0(p.results.belowCy)} CY below the base inside the toe (not counted)</div>}
                    {p.results.warnings.map((w, i) => <div key={i} className="text-amber">{w}</div>)}
                  </div>
                ))}
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  )
}
