'use client'

/**
 * A site's ground (Plans & Takeoff phase 4): its borings and test pits — add
 * one by hand (a pit takes the phone's location), paste the geotech report's
 * table (lat/lng or SC State Plane N/E), a photo per pit — a north-up plot,
 * and what the saved dirt takeoff makes of them (rock, PWR, unexplored,
 * undercut).
 */
import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Drill, Plus, ClipboardPaste, MapPin, Camera, Trash2, Pencil, Mountain, AlertTriangle, X, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import type { BoringRow } from '@/lib/db/borings'
import { groundWords, type GroundResults } from '@/lib/borings/ground'
import { saveBoringAction, importBoringsAction, deleteBoringAction, startPitPhotoAction, finishPitPhotoAction } from '@/lib/actions/borings'

interface Props {
  zone: { id: string; name: string; ring: [number, number][] | null; personal: boolean }
  borings: BoringRow[]
  takeoff: { id: string; name: string; ground: GroundResults; boundarySf: number; stale: boolean; computedAt: string | null } | null
  dirtAddon: boolean
  canEdit: boolean
  canDelete: boolean
  demo: boolean
}

type Draft = Record<'name' | 'lat' | 'lng' | 'groundFt' | 'depthFt' | 'topsoilIn' | 'fillFt' | 'pwrFt' | 'refusalFt' | 'waterFt' | 'water24hFt' | 'unsuitableFt' | 'note', string> & { id: string | null; kind: 'boring' | 'pit' }

const blank = (kind: 'boring' | 'pit', n: number): Draft => ({
  id: null, kind, name: `${kind === 'pit' ? 'TP' : 'B'}-${n}`, lat: '', lng: '', groundFt: '', depthFt: '', topsoilIn: '', fillFt: '',
  pwrFt: '', refusalFt: '', waterFt: '', water24hFt: '', unsuitableFt: '', note: '',
})
const s = (v: number | null) => (v === null || v === undefined ? '' : String(v))
const draftOf = (b: BoringRow): Draft => ({
  id: b.id, kind: b.kind, name: b.name, lat: String(b.lat), lng: String(b.lng), groundFt: s(b.groundFt), depthFt: String(b.depthFt),
  topsoilIn: s(b.topsoilIn), fillFt: s(b.fillFt), pwrFt: s(b.pwrFt), refusalFt: s(b.refusalFt), waterFt: s(b.waterFt),
  water24hFt: s(b.water24hFt), unsuitableFt: s(b.unsuitableFt), note: b.note ?? '',
})
const num = (t: string): number | null => (t.trim() === '' ? null : Number(t.trim()))
const n0 = (v: number) => Math.round(v).toLocaleString('en-US')
const ft = (v: number | null) => (v === null ? '—' : `${v}′`)

/** What a boring found, in one word, for the plot and the list. */
function verdict(b: BoringRow): { tone: 'rock' | 'pwr' | 'clean'; words: string } {
  if (b.refusalFt !== null) return { tone: 'rock', words: `refusal ${b.refusalFt}′` }
  if (b.pwrFt !== null) return { tone: 'pwr', words: `PWR ${b.pwrFt}′, no refusal to ${b.depthFt}′` }
  return { tone: 'clean', words: `no rock to ${b.depthFt}′` }
}
const TONE = { rock: 'fill-red-400', pwr: 'fill-amber', clean: 'fill-teal-300' }
const TONE_TEXT = { rock: 'text-red-300', pwr: 'text-amber', clean: 'text-teal-300' }

export function GroundView({ zone, borings, takeoff, dirtAddon, canEdit, canDelete, demo }: Props) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pasting, setPasting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const nextNo = (kind: 'boring' | 'pit') => {
    const re = kind === 'pit' ? /^tp-?(\d+)$/i : /^b-?(\d+)$/i
    return 1 + borings.reduce((m, b) => { const x = b.name.match(re); return x ? Math.max(m, Number(x[1])) : m }, 0)
  }
  // The takeoff's last run measured other logs than the site has now (added, changed or removed since).
  const stale = !!takeoff && (takeoff.stale
    || borings.length !== takeoff.ground.borings + takeoff.ground.pits + takeoff.ground.far.length
    || borings.some((b) => !takeoff.computedAt || Date.parse(b.updatedAt) > Date.parse(takeoff.computedAt)))
  const stats = useMemo(() => {
    const logs = borings.length
    const top = borings.map((b) => b.topsoilIn).filter((v): v is number => v !== null)
    return {
      logs, pits: borings.filter((b) => b.kind === 'pit').length,
      refusal: borings.filter((b) => b.refusalFt !== null).length,
      water: borings.filter((b) => b.waterFt !== null || b.water24hFt !== null).length,
      deepest: borings.reduce((m, b) => Math.max(m, b.depthFt), 0),
      topsoil: top.length ? { avg: Math.round((10 * top.reduce((a, b) => a + b, 0)) / top.length) / 10, lo: Math.min(...top), hi: Math.max(...top) } : null,
    }
  }, [borings])

  async function save() {
    if (!draft) return
    if (!draft.lat.trim() || !draft.lng.trim()) { setErr('Add the latitude and longitude — or tap Use my location where the pit is.'); return }
    if (!draft.depthFt.trim()) { setErr('Add how deep it went (ft).'); return }
    setBusy('save'); setErr(null)
    const r = await saveBoringAction({
      zoneId: zone.id, id: draft.id, name: draft.name, kind: draft.kind,
      lat: Number(draft.lat), lng: Number(draft.lng), groundFt: num(draft.groundFt), depthFt: Number(draft.depthFt),
      topsoilIn: num(draft.topsoilIn), fillFt: num(draft.fillFt), pwrFt: num(draft.pwrFt), refusalFt: num(draft.refusalFt),
      waterFt: num(draft.waterFt), water24hFt: num(draft.water24hFt), unsuitableFt: num(draft.unsuitableFt), note: draft.note,
    }).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t save — try again.'); return }
    setDraft(null)
    router.refresh()
  }

  async function remove(b: BoringRow) {
    if (!confirm(`Remove ${b.name}? The dirt takeoff stops counting it at its next Save.`)) return
    setBusy(`del:${b.id}`); setErr(null)
    const r = await deleteBoringAction(b.id).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t remove it — try again.'); return }
    router.refresh()
  }

  function here() {
    if (!draft || !navigator.geolocation) { setErr('This phone can’t share its location here.'); return }
    setBusy('gps'); setErr(null)
    navigator.geolocation.getCurrentPosition((pos) => {
      setBusy(null)
      setDraft((d) => (d ? { ...d, lat: pos.coords.latitude.toFixed(7), lng: pos.coords.longitude.toFixed(7) } : d))
      setNote(`Located to about ±${Math.max(1, Math.round(pos.coords.accuracy * 3.28084))} ft.`)
    }, () => { setBusy(null); setErr('Couldn’t get a location — allow location for HammerTrack, or type the latitude and longitude.') }, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 })
  }

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        <div>
          <Link href={`/plans/${zone.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-2"><ArrowLeft className="h-4 w-4" /> Plan room</Link>
          <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><Drill className="h-5 w-5 text-amber" /> Ground · {zone.name}</h1>
          <p className="text-[12.5px] text-faint">The site&apos;s borings and test pits. The dirt takeoff spreads them across the grading limits — rock, PWR and water by elevation, topsoil and fill as depths, the nearest log beyond them — and counts the cut below a boring that stopped short of rock as <em>unexplored</em>, never as common or rock.</p>
        </div>

        {zone.personal && <p className="rounded-xl border border-navy-700 bg-navy-900/60 px-3 py-2 text-[12.5px] text-muted">This is a personal zone — borings live on the company&apos;s sites.</p>}
        {demo && <p className="rounded-xl border border-navy-700 bg-navy-900/60 px-3 py-2 text-[12.5px] text-muted">Demo mode — sign in to log a site&apos;s borings.</p>}

        <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
          {canEdit && (
            <>
              <button onClick={() => { setDraft(blank('boring', nextNo('boring'))); setPasting(false); setNote(null) }} className="inline-flex items-center gap-1.5 rounded-xl bg-amber px-3 py-2 font-semibold text-navy-950"><Plus className="h-4 w-4" /> Boring</button>
              <button onClick={() => { setDraft(blank('pit', nextNo('pit'))); setPasting(false); setNote(null) }} className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-2 text-ink hover:bg-navy-800"><Plus className="h-4 w-4" /> Test pit</button>
              <button onClick={() => { setPasting((p) => !p); setDraft(null) }} className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-2 text-ink hover:bg-navy-800"><ClipboardPaste className="h-4 w-4" /> Paste a table</button>
            </>
          )}
          {takeoff && <Link href={`/dirt/${takeoff.id}`} className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-2 text-muted hover:text-ink"><Mountain className="h-4 w-4" /> Dirt takeoff</Link>}
        </div>

        {err && <p className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-950/30 px-3 py-2 text-[12.5px] text-red-200"><AlertTriangle className="h-4 w-4 mt-0.5 flex-none" /> {err}</p>}

        {pasting && canEdit && <PastePanel zoneId={zone.id} onDone={() => { setPasting(false); router.refresh() }} onCancel={() => setPasting(false)} />}

        {draft && canEdit && (
          <section className="rounded-2xl border border-navy-700 bg-navy-900/60 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">{draft.id ? `Edit ${draft.name}` : draft.kind === 'pit' ? 'New test pit' : 'New boring'}</h2>
              <button onClick={() => setDraft(null)} aria-label="Close" className="p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12.5px]">
              <Field label="Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} text />
              <label className="space-y-1"><span className="block text-faint">Kind</span>
                <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value === 'pit' ? 'pit' : 'boring' })} className="w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink">
                  <option value="boring">Boring</option><option value="pit">Test pit</option>
                </select>
              </label>
              <Field label="Latitude" value={draft.lat} onChange={(v) => setDraft({ ...draft, lat: v })} />
              <Field label="Longitude" value={draft.lng} onChange={(v) => setDraft({ ...draft, lng: v })} />
              <div className="col-span-2 sm:col-span-4 flex items-center gap-2 flex-wrap">
                <button onClick={here} disabled={busy === 'gps'} className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 px-2.5 py-1.5 text-ink hover:bg-navy-800 disabled:opacity-50">
                  {busy === 'gps' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />} Use my location
                </button>
                {note && <span className="text-faint">{note}</span>}
              </div>
              <Field label="Ground elev. (ft)" hint="blank = the takeoff's existing ground" value={draft.groundFt} onChange={(v) => setDraft({ ...draft, groundFt: v })} />
              <Field label="Depth (ft)" hint="how deep it went" value={draft.depthFt} onChange={(v) => setDraft({ ...draft, depthFt: v })} />
              <Field label="Topsoil (in)" value={draft.topsoilIn} onChange={(v) => setDraft({ ...draft, topsoilIn: v })} />
              <Field label="Existing fill to (ft)" hint="blank = none" value={draft.fillFt} onChange={(v) => setDraft({ ...draft, fillFt: v })} />
              <Field label="PWR at (ft)" hint="blank = none" value={draft.pwrFt} onChange={(v) => setDraft({ ...draft, pwrFt: v })} />
              <Field label="Refusal at (ft)" hint="blank = none" value={draft.refusalFt} onChange={(v) => setDraft({ ...draft, refusalFt: v })} />
              <Field label="Water at drilling (ft)" hint="blank = dry" value={draft.waterFt} onChange={(v) => setDraft({ ...draft, waterFt: v })} />
              <Field label="Water at 24 h (ft)" value={draft.water24hFt} onChange={(v) => setDraft({ ...draft, water24hFt: v })} />
              <Field label="Unsuitable to (ft)" hint="blank = none" value={draft.unsuitableFt} onChange={(v) => setDraft({ ...draft, unsuitableFt: v })} />
              <div className="col-span-2 sm:col-span-3"><Field label="Note" value={draft.note} onChange={(v) => setDraft({ ...draft, note: v })} text /></div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDraft(null)} className="rounded-xl border border-navy-700 px-3 py-2 text-[12.5px] text-muted hover:text-ink">Cancel</button>
              <button onClick={save} disabled={busy === 'save'} className="rounded-xl bg-amber px-4 py-2 text-[12.5px] font-semibold text-navy-950 disabled:opacity-50">{busy === 'save' ? 'Saving…' : 'Save'}</button>
            </div>
          </section>
        )}

        {takeoff && (
          <section className="rounded-2xl border border-navy-700 bg-navy-900/60 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">In the cut · {takeoff.name}</h2>
              {stale && <span className="text-[11px] text-amber">Borings or traces changed since — open the takeoff and Save to re-run.</span>}
            </div>
            {takeoff.ground.rock ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Big label="Rock" v={takeoff.ground.rock.rockCy} sub="below refusal" />
                <Big label="PWR" v={takeoff.ground.rock.pwrCy} sub="rippable" />
                <Big label="Unexplored" v={takeoff.ground.rock.unexploredCy} sub="deeper than the borings" />
                <Big label="Undercut" v={takeoff.ground.rock.undercutCy} sub="unsuitable under the work" />
              </div>
            ) : null}
            <ul className="space-y-1 text-[12.5px] text-muted">
              {groundWords(takeoff.ground, takeoff.boundarySf).map((w) => <li key={w}>• {w}</li>)}
            </ul>
          </section>
        )}
        {!takeoff && borings.length > 0 && (
          <p className="text-[12.5px] text-faint">{dirtAddon ? 'Save the site’s dirt takeoff and it measures the rock, PWR, undercut and unexplored ground in its cut from these logs.' : 'With the dirt takeoff add-on, these logs become rock, PWR and undercut yards in the cut.'}</p>
        )}

        {borings.length > 0 && (
          <section className="grid gap-3 md:grid-cols-[1fr_1fr]">
            <div className="rounded-2xl border border-navy-700 bg-navy-900/60 p-3 text-[12.5px] space-y-1">
              <div className="text-ink font-semibold">{stats.logs - stats.pits} boring{stats.logs - stats.pits === 1 ? '' : 's'} · {stats.pits} test pit{stats.pits === 1 ? '' : 's'}</div>
              <div className="text-muted">Refusal in {stats.refusal} of {stats.logs} · water in {stats.water} of {stats.logs} · deepest {stats.deepest}′</div>
              {stats.topsoil && <div className="text-muted">Topsoil {stats.topsoil.avg}″ average ({stats.topsoil.lo}–{stats.topsoil.hi}″)</div>}
              <div className="flex gap-3 pt-1 text-[11px]">
                <span className="text-red-300">● refusal (rock)</span><span className="text-amber">● PWR, no refusal</span><span className="text-teal-300">● no rock found</span>
              </div>
            </div>
            <Plot ring={zone.ring} borings={borings} />
          </section>
        )}

        <section className="space-y-2">
          {!borings.length && !demo && <p className="text-[12.5px] text-faint">No borings yet. Paste the geotech report&apos;s boring table (or a spreadsheet), or log a test pit where you stand.</p>}
          {borings.map((b) => {
            const v = verdict(b)
            return (
              <div key={b.id} className="rounded-xl border border-navy-800 bg-navy-950 p-2.5 text-[12.5px]">
                <div className="flex items-start gap-2">
                  {b.photoUrl && (
                    <a href={b.photoUrl} target="_blank" rel="noreferrer" className="flex-none">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a short signed link, not an optimizable asset */}
                      <img src={b.photoUrl} alt={`${b.name} photo`} className="h-12 w-12 rounded-lg object-cover" />
                    </a>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-ink">{b.name}</span>
                      <span className="rounded-full border border-navy-700 px-1.5 text-[10.5px] uppercase tracking-wide text-faint">{b.kind === 'pit' ? 'Test pit' : 'Boring'}</span>
                      <span className={TONE_TEXT[v.tone]}>{v.words}</span>
                    </div>
                    <div className="text-muted">
                      Depth {b.depthFt}′{b.groundFt !== null ? ` · ground ${b.groundFt}′` : ' · ground from the takeoff'}{b.topsoilIn !== null ? ` · topsoil ${b.topsoilIn}″` : ''}{b.fillFt ? ` · fill to ${b.fillFt}′` : ''}{b.unsuitableFt ? ` · unsuitable to ${b.unsuitableFt}′` : ''}
                      {` · water ${b.waterFt !== null || b.water24hFt !== null ? [b.waterFt !== null ? ft(b.waterFt) : null, b.water24hFt !== null ? `${ft(b.water24hFt)} at 24 h` : null].filter(Boolean).join(', ') : 'dry'}`}
                    </div>
                    {b.note && <div className="text-faint">{b.note}</div>}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 flex-none">
                      {b.kind === 'pit' && <PhotoButton id={b.id} onDone={() => router.refresh()} onError={setErr} />}
                      <button onClick={() => { setDraft(draftOf(b)); setPasting(false); setNote(null) }} aria-label={`Edit ${b.name}`} className="p-2 text-muted hover:text-ink"><Pencil className="h-4 w-4" /></button>
                      {canDelete && <button onClick={() => remove(b)} disabled={busy === `del:${b.id}`} aria-label={`Remove ${b.name}`} className="p-2 text-red-300 hover:text-red-200 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </section>
      </div>
    </div>
  )
}

function Field({ label, hint, value, onChange, text }: { label: string; hint?: string; value: string; onChange: (v: string) => void; text?: boolean }) {
  return (
    <label className="space-y-1 min-w-0">
      <span className="block text-faint truncate">{label}{hint && <span className="text-[10.5px]"> · {hint}</span>}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode={text ? 'text' : 'decimal'} type="text"
        className="w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink" />
    </label>
  )
}

function Big({ label, v, sub }: { label: string; v: number; sub: string }) {
  return (
    <div className="rounded-lg border border-navy-800 bg-navy-950 p-2.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-ink">{n0(v)} <span className="text-xs font-normal text-muted">CY</span></div>
      <div className="text-[11px] text-muted">{sub}</div>
    </div>
  )
}

/** North-up: the site outline and every log, coloured by what it found. */
function Plot({ ring, borings }: { ring: [number, number][] | null; borings: BoringRow[] }) {
  const W = 360, H = 240, PAD = 22
  const pts: [number, number][] = [...(ring ?? []), ...borings.map((b) => [b.lng, b.lat] as [number, number])]
  if (!pts.length) return null
  const lat0 = pts.reduce((a, p) => a + p[1], 0) / pts.length
  const k = Math.cos((lat0 * Math.PI) / 180)
  const xs = pts.map((p) => p[0] * k), ys = pts.map((p) => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const span = Math.max(x1 - x0, y1 - y0, 1e-6)
  const sc = Math.min((W - 2 * PAD) / Math.max(x1 - x0, span * 0.05), (H - 2 * PAD) / Math.max(y1 - y0, span * 0.05))
  const ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2
  const at = (lng: number, lat: number): [number, number] => [ox + (lng * k - x0) * sc, H - (oy + (lat - y0) * sc)]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-2xl border border-navy-700 bg-navy-900/60" role="img" aria-label="Borings plotted north-up over the site outline">
      {ring && ring.length > 2 && <polygon points={ring.map(([lng, lat]) => at(lng, lat).join(',')).join(' ')} className="fill-navy-800/60 stroke-navy-600" strokeWidth={1} />}
      {borings.map((b) => {
        const [x, y] = at(b.lng, b.lat)
        const v = verdict(b)
        return (
          <g key={b.id}>
            {b.kind === 'pit' ? <rect x={x - 4} y={y - 4} width={8} height={8} className={TONE[v.tone]} /> : <circle cx={x} cy={y} r={4.5} className={TONE[v.tone]} />}
            <text x={x + 7} y={y + 3.5} className="fill-ink" fontSize={9}>{b.name}{b.refusalFt !== null ? ` · ${b.refusalFt}′` : ''}</text>
          </g>
        )
      })}
      <g transform={`translate(${W - 16}, 18)`}><path d="M0,-10 L4,4 L0,1 L-4,4 Z" className="fill-ink" /><text x={0} y={14} textAnchor="middle" fontSize={8} className="fill-faint">N</text></g>
    </svg>
  )
}

function PastePanel({ zoneId, onDone, onCancel }: { zoneId: string; onDone: () => void; onCancel: () => void }) {
  const [text, setText] = useState('')
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState<{ added: number; updated: number; skipped: { line: number; why: string }[]; columns: string[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  async function go() {
    setBusy(true); setErr(null); setOut(null)
    const r = await importBoringsAction(zoneId, text, ref).catch(() => null)
    setBusy(false)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t read that — try again.'); return }
    setOut(r)
    if (!r.skipped.length) onDone()
  }
  return (
    <section className="rounded-2xl border border-navy-700 bg-navy-900/60 p-3 space-y-2 text-[12.5px]">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Paste the borings table</h2>
        <button onClick={onCancel} aria-label="Close" className="p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
      </div>
      <p className="text-faint">Copy the geotech report&apos;s boring summary (or a spreadsheet) with a header row: Name, Lat and Lng — or Northing and Easting on SC State Plane — Depth, and any of Ground elev., Topsoil (in), Fill, PWR, Refusal, Water, Water 24 hr, Unsuitable. &ldquo;None&rdquo;, &ldquo;NE&rdquo; and &ldquo;Dry&rdquo; read as not encountered. A name already here is updated.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder={'Boring\tLat\tLng\tDepth\tTopsoil (in)\tRefusal\tWater\nB-1\t34.85261\t-82.39410\t20\t6\t14.5\tNone'}
        className="w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 font-mono text-[11.5px] text-ink" />
      <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Where it came from — e.g. Geotech report, Oct 2026" className="w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink" />
      {err && <p className="text-red-300">{err}</p>}
      {out && (
        <div className="space-y-1">
          <p className="text-ink">{out.added} added · {out.updated} updated{out.columns.length ? ` · read ${out.columns.join(', ')}` : ''}</p>
          {out.skipped.length > 0 && <ul className="text-amber">{out.skipped.slice(0, 20).map((x) => <li key={`${x.line}${x.why}`}>Line {x.line}: {x.why}</li>)}</ul>}
          {out.skipped.length > 0 && <button onClick={onDone} className="text-amber underline">Done</button>}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-xl border border-navy-700 px-3 py-2 text-muted hover:text-ink">Cancel</button>
        <button onClick={go} disabled={busy || !text.trim()} className="rounded-xl bg-amber px-4 py-2 font-semibold text-navy-950 disabled:opacity-50">{busy ? 'Reading…' : 'Read it'}</button>
      </div>
    </section>
  )
}

/** A pit photo: shrunk on the phone (long side 2000 px), then straight to private storage. */
function PhotoButton({ id, onDone, onError }: { id: string; onDone: () => void; onError: (e: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  async function shrink(f: File): Promise<Blob> {
    try {
      const bmp = await createImageBitmap(f)
      const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
      const c = document.createElement('canvas')
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
      c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height)
      const b = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.85))
      return b ?? f
    } catch { return f }
  }
  async function pick(f: File | undefined) {
    if (!f) return
    setBusy(true)
    try {
      const blob = await shrink(f)
      const type = blob.type || 'image/jpeg'
      const st = await startPitPhotoAction({ id, contentType: type, size: blob.size }).catch(() => null)
      if (!st?.ok) { onError(st && !st.ok ? st.error : 'Couldn’t start the upload — try again.'); return }
      const { error } = await createClient().storage.from('plans').uploadToSignedUrl(st.path, st.token, blob, { contentType: type })
      if (error) { onError('The photo didn’t upload — try again.'); return }
      const fin = await finishPitPhotoAction(id).catch(() => null)
      if (!fin?.ok) { onError(fin && !fin.ok ? fin.error : 'Couldn’t file the photo — try again.'); return }
      onDone()
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <button onClick={() => input.current?.click()} disabled={busy} aria-label="Pit photo" className="p-2 text-muted hover:text-ink disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
      </button>
    </>
  )
}
