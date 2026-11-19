'use client'

/**
 * Site survey & as-built (163, Beta). One site at a time:
 *  1. Takeoff versions — freeze the takeoff as a dated, numbered version with
 *     its legend (earthwork + every assumption); compare any two.
 *  2. Drone flights — the surfaces uploaded for the site; their contours ride
 *     the map's timeline (Drone topo & survey layer).
 *  3. Rover shots — paste the data collector's export; check a flight against
 *     them (bias, spread, a verdict against curb / stone / subgrade tolerance).
 *  4. As-built → machine — the takeoff's finished grade re-fit to the curb as
 *     shot, cut to top of stone and subgrade, out as LandXML to Machine files.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Cpu, Map as MapIcon, Mountain } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import type { SurveySite, VersionRow } from '@/lib/db/survey'
import { deleteShotsAction, deleteTakeoffVersionAction, fileShotsAction, readTakeoffDesignAction, runSurveyCheckAction, saveTakeoffVersionAction } from '@/lib/actions/survey'
import { startMachineUploadAction, finishMachineFileAction } from '@/lib/actions/machine'
import { diffLegends, type Legend } from '@/lib/dirt/versions'
import { KIND_WORDS, shotCounts, type ShotKind } from '@/lib/survey/shots'
import { inches, type CheckResults } from '@/lib/survey/check'
import { refitSummary } from '@/lib/survey/refit'
import { defaultGrid, type Grid } from '@/lib/machine/grid'
import { groundBoxFor, boxTooBig } from '@/lib/dirt/ground-box'
import { decodeGround } from '@/lib/dirt/ground-format'
import { BetaPage, Notice, StatePill, box, btn, card, fmtDay, primary } from './ui'

type Site = { id: string; name: string; lat: number | null; lng: number | null; hasData: boolean }
const n0 = (v: number) => Math.round(v).toLocaleString('en-US')
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export function SurveyView({ sites, siteId, data, addon, demo, canWrite, canManage }: {
  sites: Site[]; siteId: string | null; data: SurveySite | null; addon: boolean; demo: boolean; canWrite: boolean; canManage: boolean
}) {
  const router = useRouter()
  const site = sites.find((s) => s.id === siteId) ?? null
  const mapHref = site && site.lat !== null ? `/map?lat=${site.lat.toFixed(6)}&lng=${site.lng!.toFixed(6)}&z=17&layer=survey` : '/map?layer=survey'
  return (
    <BetaPage title="Site survey & as-built" icon={<Mountain className="h-5 w-5 text-violet-300" />} demo={demo}
      blurb="Takeoff versions with their legends, the drone’s topo on the map’s timeline, drone vs rover checks, and stone / subgrade surfaces re-fit to the curb as it was built — as a LandXML file for the machines (dealer check pending).">
      {!addon && !demo && <Notice tone="warn">This rides the dirt takeoff add-on — ask us to turn it on for your company.</Notice>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0"><span className="text-faint text-[12px] block">Site</span>
          <select className={box} value={siteId ?? ''} onChange={(e) => router.push(`/beta/survey?site=${e.target.value}`)}>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.hasData ? '' : ' (nothing yet)'}</option>)}
          </select></label>
        <Link href={mapHref} className={btn}><MapIcon className="h-4 w-4" /> On the map</Link>
      </div>
      {!site && <Notice tone="info">Draw a site first.</Notice>}
      {site && data && (
        <>
          <Versions data={data} canWrite={canWrite} canManage={canManage} />
          <Flights data={data} zoneId={site.id} />
          <Shots data={data} zoneId={site.id} canWrite={canWrite} />
          <Asbuilt data={data} site={site} canWrite={canWrite} />
          <p className="text-faint text-[11.5px]">On the map: Layers → Drone topo & survey (contours and the shots, coloured by the drone’s miss) and Cut / fill (the takeoff version that stood on the day you scrub to).</p>
        </>
      )}
    </BetaPage>
  )
}

async function act<T extends { ok: boolean; error?: string }>(fn: () => Promise<T | null | undefined>, setErr: (e: string | null) => void): Promise<T | null> {
  setErr(null)
  const r = await fn().catch(() => null)
  if (!r?.ok) { setErr((r && 'error' in r && r.error) || 'Couldn’t do that — check your signal and try again.'); return null }
  return r
}

// ── 1. Versions ─────────────────────────────────────────────────────────────

function Versions({ data, canWrite, canManage }: { data: SurveySite; canWrite: boolean; canManage: boolean }) {
  const router = useRouter()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [label, setLabel] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [cmp, setCmp] = useState<[string, string] | null>(null)
  return (
    <section className={`${card} space-y-3`}>
      <h2 className="font-semibold text-ink">1 · Takeoff versions</h2>
      <p className="text-faint text-[12.5px]">Freeze a takeoff when it matters — the bid, after the geotech, after an addendum. Each version keeps its numbers, its legend and its cut/fill picture, dated; the map’s timeline shows the version that stood on the day.</p>
      {err && <Notice tone="bad">{err}</Notice>}
      {!data.takeoffs.length && <Notice tone="info">No dirt takeoff on this site yet — start one from the site page.</Notice>}
      {data.takeoffs.map((t) => {
        const vs = data.versions.filter((v) => v.takeoffId === t.id).sort((a, b) => b.versionNo - a.versionNo)
        return (
          <div key={t.id} className="rounded-lg border border-navy-800 p-2.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0"><Link href={`/dirt/${t.id}`} className="font-semibold text-ink hover:text-amber">{t.name}</Link> <span className="text-faint text-[12px]">· now cut {n0(t.cutCy)} · fill {n0(t.fillCy)} CY · saved {t.computedAt ? when(t.computedAt) : 'not run yet'}</span></span>
              {canWrite && (
                <span className="flex flex-wrap items-center gap-2">
                  <input className={box + ' w-48'} placeholder={`Version ${(vs[0]?.versionNo ?? 0) + 1} — e.g. Bid`} value={label[t.id] ?? ''} maxLength={120} onChange={(e) => setLabel({ ...label, [t.id]: e.target.value })} />
                  <button type="button" className={primary} disabled={busy === t.id || !t.computedAt} onClick={async () => {
                    setBusy(t.id)
                    const r = await act(() => saveTakeoffVersionAction({ takeoffId: t.id, label: label[t.id] }), setErr)
                    setBusy(null)
                    if (r) { setLabel({ ...label, [t.id]: '' }); router.refresh() }
                  }}>{busy === t.id ? 'Freezing…' : 'Freeze as a version'}</button>
                </span>
              )}
            </div>
            {vs.length > 0 && (
              <div className="space-y-1.5">
                {vs.map((v) => (
                  <div key={v.id} className="border-t border-navy-800 pt-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button type="button" className="text-left min-w-0" onClick={() => setOpen(open === v.id ? null : v.id)}>
                        <span className="font-mono text-[12px] text-violet-200">v{v.versionNo}</span> <span className="text-ink">{v.label}</span> <span className="text-faint text-[12px]">· {when(v.createdAt)} · cut {n0(v.legend.earthwork.cutCy)} · fill {n0(v.legend.earthwork.fillCy)} · {v.legend.earthwork.exportCy ? `export ${n0(v.legend.earthwork.exportCy)}` : `import ${n0(v.legend.earthwork.importCy)}`} CY</span>
                      </button>
                      <span className="flex items-center gap-1.5">
                        {vs.some((x) => x.versionNo < v.versionNo) && <button type="button" className={btn} onClick={() => setCmp(cmp && cmp[1] === v.id ? null : [vs.find((x) => x.versionNo < v.versionNo)!.id, v.id])}>Compare</button>}
                        {canManage && canWrite && <ConfirmRemove what={`version ${v.versionNo}`} onConfirm={async () => { if (await act(() => deleteTakeoffVersionAction({ id: v.id }), setErr)) router.refresh() }} />}
                      </span>
                    </div>
                    {open === v.id && <LegendView v={v} />}
                    {cmp && cmp[1] === v.id && <Compare versions={vs} pair={cmp} setPair={setCmp} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

function LegendView({ v }: { v: VersionRow }) {
  const L = v.legend
  const a = L.assumptions
  return (
    <div className="mt-2 grid gap-3 rounded-lg bg-navy-950 p-3 text-[12.5px] sm:grid-cols-2">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint mb-1">Earthwork</p>
        <table className="w-full"><tbody>
          {([['Cut', L.earthwork.cutCy, 'CY'], ['Fill', L.earthwork.fillCy, 'CY'], ['Fill with shrink', L.earthwork.fillAdjCy, 'CY'], ['Balanced on site', L.earthwork.onsiteCy, 'CY'], ['Export', L.earthwork.exportCy, 'CY'], ['Import', L.earthwork.importCy, 'CY'], ['Topsoil strip', L.earthwork.topsoilCy, 'CY'], ['Truck loads', L.earthwork.loads, ''], ['Max cut', L.earthwork.maxCutFt, 'ft'], ['Max fill', L.earthwork.maxFillFt, 'ft'], ['Grading limits', L.earthwork.acres, 'ac']] as [string, number, string][]).map(([k, val, u]) => (
            <tr key={k}><td className="text-faint pr-2">{k}</td><td className="text-right text-ink">{val.toLocaleString('en-US')} {u}</td></tr>
          ))}
        </tbody></table>
      </div>
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint mb-1">Assumptions</p>
        <ul className="space-y-0.5 text-muted">
          <li>Existing ground: <span className="text-ink">{a.existing}</span>{a.datumOffsetFt ? ` · datum offset ${a.datumOffsetFt} ft` : ''}</li>
          <li>Shrink {a.shrinkPct}% · trucks {a.truckCy} CY</li>
          <li>Topsoil: {a.topsoil.join(' · ') || 'none traced'}</li>
          <li>Sections: {a.sections.map((s) => `${s.label} ${s.inches}"`).join(' · ') || 'none'}</li>
          <li>Pads: {a.pads.map((p) => `${p.label} FFE ${p.ffeFt}`).join(' · ') || 'none'}</li>
          {a.demo.length > 0 && <li>Demo: {a.demo.map((d) => `${d.label} ${d.inches}"`).join(' · ')}</li>}
          <li>Plans: {a.sheets.map((s) => `${s.number}${s.rev ? ` Rev ${s.rev}` : ''}`).join(' · ') || 'not recorded (traced by hand)'}</li>
          <li>Traced: {a.counts.contours} contours · {a.counts.spots} spots · {a.counts.areas} areas</li>
        </ul>
        {v.note && <p className="mt-2 text-muted whitespace-pre-wrap">{v.note}</p>}
        {L.warnings.length > 0 && <p className="mt-2 text-amber">{L.warnings.join(' ')}</p>}
      </div>
    </div>
  )
}

function Compare({ versions, pair, setPair }: { versions: VersionRow[]; pair: [string, string]; setPair: (p: [string, string]) => void }) {
  const a = versions.find((v) => v.id === pair[0]), b = versions.find((v) => v.id === pair[1])
  if (!a || !b) return null
  const rows = diffLegends(a.legend as Legend, b.legend as Legend)
  return (
    <div className="mt-2 rounded-lg bg-navy-950 p-3 text-[12.5px] space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-muted">
        Compare <select className={box + ' w-auto'} value={a.id} onChange={(e) => setPair([e.target.value, b.id])}>{versions.filter((v) => v.id !== b.id).map((v) => <option key={v.id} value={v.id}>v{v.versionNo} {v.label}</option>)}</select>
        → <span className="text-ink">v{b.versionNo} {b.label}</span>
      </div>
      {!rows.length ? <p className="text-faint">Nothing changed between these two.</p> : (
        <table className="w-full">
          <thead className="text-faint"><tr><th className="text-left">What</th><th className="text-left">v{a.versionNo}</th><th className="text-left">v{b.versionNo}</th><th className="text-right">Change</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.what} className="border-t border-navy-800"><td className={r.big ? 'text-amber' : 'text-muted'}>{r.what}</td><td className="text-muted">{r.from}</td><td className="text-ink">{r.to}</td><td className="text-right text-ink">{r.delta ?? ''}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  )
}

// ── 2. Flights ──────────────────────────────────────────────────────────────

function Flights({ data, zoneId }: { data: SurveySite; zoneId: string }) {
  return (
    <section className={`${card} space-y-2`}>
      <h2 className="font-semibold text-ink">2 · Drone flights</h2>
      <p className="text-faint text-[12.5px]">The elevation surfaces (DSM GeoTIFF from DroneDeploy, Pix4D, WebODM…) uploaded for this site. Their 1-ft contours draw on the map and follow the timeline — scrub back and the site is as it was flown.</p>
      {!data.flights.length ? <Notice tone="info">No flights yet.</Notice> : (
        <div className="space-y-1">{data.flights.map((f) => <div key={f.id} className="flex items-center justify-between gap-2 border-t border-navy-800 pt-1 first:border-0"><span className="text-ink">{fmtDay(f.flownOn)} <span className="text-muted">· {f.name}</span></span>{!f.ready && <StatePill state="soon">processing</StatePill>}</div>)}</div>
      )}
      <Link href={`/dirt/stockpiles/${zoneId}`} className={btn}>Upload a flight</Link>
    </section>
  )
}

// ── 3. Shots + check ────────────────────────────────────────────────────────

function Shots({ data, zoneId, canWrite }: { data: SurveySite; zoneId: string; canWrite: boolean }) {
  const router = useRouter()
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [takenOn, setTakenOn] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [flightFor, setFlightFor] = useState<Record<string, string>>({})
  const ready = data.flights.filter((f) => f.ready)
  return (
    <section className={`${card} space-y-3`}>
      <h2 className="font-semibold text-ink">3 · Rover shots & the drone check</h2>
      <p className="text-faint text-[12.5px]">Paste the data collector’s export — Point, Northing, Easting, Elevation, Code in SC State Plane feet (or lat / lng). Code the gutter lip LIP, flowline FL, back of curb BOC, control CP. Then check a flight against them: is the drone good enough for the curb, the stone, or only the subgrade?</p>
      {err && <Notice tone="bad">{err}</Notice>}
      {note && <Notice tone="good">{note}</Notice>}
      {canWrite && (
        <div className="space-y-2 rounded-lg border border-navy-800 p-2.5">
          <div className="grid gap-2 sm:grid-cols-3">
            <input className={box} placeholder="Name — e.g. Curb as-built east lot" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            <input type="date" className={box} value={takenOn} onChange={(e) => setTakenOn(e.target.value)} />
          </div>
          <textarea className={box + ' font-mono text-[12px]'} rows={5} placeholder={'101,1092345.12,1543210.55,301.25,LIP\n102,1092355.10,1543210.61,301.31,LIP'} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" className={primary} disabled={busy === 'file' || !text.trim()} onClick={async () => {
            setBusy('file'); setNote(null)
            const r = await act(() => fileShotsAction({ zoneId, name, takenOn, text }), setErr)
            setBusy(null)
            if (r && r.ok) { setText(''); setName(''); setNote(`${r.count} shots filed.${r.problems.length ? ' ' + r.problems.join(' ') : ''}`); router.refresh() }
          }}>{busy === 'file' ? 'Filing…' : 'File the shots'}</button>
        </div>
      )}
      {data.shotSets.map((s) => {
        const counts = shotCounts(s.shots)
        const checks = data.checks.filter((c) => c.shotsId === s.id)
        return (
          <div key={s.id} className="rounded-lg border border-navy-800 p-2.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0"><span className="font-semibold text-ink">{s.name}</span> <span className="text-faint text-[12px]">· {fmtDay(s.takenOn)} · {s.shots.length} shots · {(Object.keys(counts) as ShotKind[]).filter((k) => counts[k]).map((k) => `${counts[k]} ${KIND_WORDS[k].toLowerCase()}`).join(' · ')}</span></span>
              {canWrite && (
                <span className="flex flex-wrap items-center gap-2">
                  <select className={box + ' w-auto'} value={flightFor[s.id] ?? ready[0]?.id ?? ''} onChange={(e) => setFlightFor({ ...flightFor, [s.id]: e.target.value })}>
                    {!ready.length && <option value="">No flight yet</option>}
                    {ready.map((f) => <option key={f.id} value={f.id}>Flight {fmtDay(f.flownOn)}</option>)}
                  </select>
                  <button type="button" className={btn} disabled={!ready.length || busy === s.id} onClick={async () => {
                    setBusy(s.id); setNote(null)
                    const r = await act(() => runSurveyCheckAction({ shotsId: s.id, surfaceId: flightFor[s.id] ?? ready[0].id }), setErr)
                    setBusy(null)
                    if (r) router.refresh()
                  }}>{busy === s.id ? 'Reading the flight…' : 'Check the drone'}</button>
                  <ConfirmRemove what="these shots and their checks" onConfirm={async () => { if (await act(() => deleteShotsAction({ id: s.id }), setErr)) router.refresh() }} />
                </span>
              )}
            </div>
            {checks.map((c) => <CheckView key={c.id} r={c.results} flight={data.flights.find((f) => f.id === c.surfaceId)?.flownOn ?? null} />)}
          </div>
        )
      })}
    </section>
  )
}

function CheckView({ r, flight }: { r: CheckResults; flight: string | null }) {
  const [all, setAll] = useState(false)
  const tone = r.verdict.level === 'curb' || r.verdict.level === 'stone' ? 'good' : r.verdict.level === 'subgrade' ? 'warn' : 'bad'
  const worst = r.shots.filter((s) => s.dz !== null).map((s) => ({ ...s, off: (s.dz as number) - (r.all?.bias ?? 0) })).sort((a, b) => Math.abs(b.off) - Math.abs(a.off))
  return (
    <div className="rounded-lg bg-navy-950 p-2.5 text-[12.5px] space-y-2">
      <p className="text-muted">Against the flight of {flight ? fmtDay(flight) : '—'} · checked {when(r.computedAt)}{r.missing ? ` · ${r.missing} shots outside the flight` : ''}</p>
      <Notice tone={tone}>{r.verdict.words}</Notice>
      {r.all && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px]">
            <thead className="text-faint"><tr><th className="text-left">Shots</th><th>n</th><th>Drone bias</th><th>95% within</th><th>≤ ¼″</th><th>≤ ½″</th><th>≤ 1″</th></tr></thead>
            <tbody>
              {([['All', r.all], ...(Object.entries(r.byKind) as [ShotKind, NonNullable<CheckResults['all']>][]).map(([k, s]) => [KIND_WORDS[k], s])] as [string, NonNullable<CheckResults['all']>][]).map(([k, s]) => (
                <tr key={k} className="border-t border-navy-800 text-center"><td className="text-left text-ink">{k}</td><td>{s.n}</td><td>{s.bias >= 0 ? '+' : '−'}{inches(Math.abs(s.bias))}</td><td>{inches(s.p95)}</td><td>{s.within.quarter}%</td><td>{s.within.half}%</td><td>{s.within.inch}%</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {worst.length > 0 && (
        <details open={all} onToggle={(e) => setAll((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-muted">Biggest misses (after the bias)</summary>
          <div className="mt-1 grid gap-0.5">{worst.slice(0, 15).map((s) => <span key={s.id} className="text-muted">{s.id} {s.code ? `(${s.code})` : ''}: rover {s.z.toFixed(2)} · drone {s.droneZ?.toFixed(2)} · {s.off >= 0 ? '+' : '−'}{inches(Math.abs(s.off))}</span>)}</div>
        </details>
      )}
    </div>
  )
}

// ── 4. As-built → machine ───────────────────────────────────────────────────

function Asbuilt({ data, site, canWrite }: { data: SurveySite; site: Site; canWrite: boolean }) {
  const [takeoffId, setTakeoff] = useState(data.takeoffs[0]?.id ?? '')
  const [shotsId, setShots] = useState(data.shotSets[0]?.id ?? '')
  const [asphaltIn, setAsphalt] = useState('2')
  const [radiusFt, setRadius] = useState('40')
  const [useFl, setUseFl] = useState(true)
  const [grid, setGrid] = useState<Grid>(() => (site.lng !== null ? defaultGrid(site.lng, site.lat!) : 'utm'))
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ summary: string; warnings: string[]; faces: { fg: number; stone: number; sg: number }; filed: boolean | null; xml: string; name: string } | null>(null)
  const worker = useRef<Worker | null>(null)
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; if (stopTimer.current) clearTimeout(stopTimer.current) }, [])
  const [inApp, setInApp] = useState(false)
  useEffect(() => { import('@/lib/native').then((m) => setInApp(m.isNativeApp())).catch(() => {}) }, [])
  const shotSet = useMemo(() => data.shotSets.find((s) => s.id === shotsId) ?? null, [data.shotSets, shotsId])
  const edge = shotSet ? shotSet.shots.filter((s) => s.kind === 'lip' || (useFl && s.kind === 'flowline')).length : 0

  async function build() {
    setErr(null); setDone(null)
    if (!takeoffId || !shotSet) { setErr('Pick the takeoff and the shots.'); return }
    try {
      setBusy('Reading the takeoff…')
      const d = await readTakeoffDesignAction({ takeoffId }).catch(() => null)
      if (!d?.ok) throw new Error(d && !d.ok ? d.error : 'Couldn’t read the takeoff.')
      let ground = null
      if (d.design.existing.source === 'lidar') {
        setBusy('Reading the lidar…')
        const bx = groundBoxFor(d.design.features.flatMap((f) => f.coords))
        if (!bx || boxTooBig(bx)) throw new Error('Trace the takeoff’s grading limits first (under ~3 km).')
        const q = [bx.minLng, bx.minLat, bx.maxLng, bx.maxLat].map((v) => v.toFixed(6)).join(',')
        const r = await fetch(`/api/dirt/ground?takeoff=${encodeURIComponent(takeoffId)}&bbox=${q}`)
        if (!r.ok) throw new Error('The lidar didn’t load — try again.')
        const g = decodeGround(await r.arrayBuffer())
        ground = g && g.header.coverage > 0 ? g.grid : null
      }
      setBusy('Building the surfaces…')
      const out = await new Promise<{ landxml: string; warnings: string[]; residualsFt: number[]; faces: { fg: number; stone: number; sg: number } }>((resolve, reject) => {
        const w = new Worker(new URL('../../lib/dirt/worker.ts', import.meta.url))
        worker.current = w
        const stop = setTimeout(() => { w.terminate(); reject(new Error('That took too long — try on a computer.')) }, 180_000)
        stopTimer.current = stop
        w.onmessage = (e: MessageEvent<{ type: string; error?: string; landxml?: string; warnings?: string[]; residualsFt?: number[]; faces?: { fg: number; stone: number; sg: number } }>) => {
          clearTimeout(stop); w.terminate()
          if (e.data.type === 'asbuilt') resolve(e.data as never)
          else reject(new Error(e.data.error || 'The surfaces couldn’t be built.'))
        }
        w.onerror = () => { clearTimeout(stop); w.terminate(); reject(new Error('The surfaces couldn’t be built.')) }
        w.postMessage({ type: 'ground', ground })
        w.postMessage({ type: 'asbuilt', design: d.design, project: `${d.name} as-built`, grid, radiusFt: Number(radiusFt) || 40, asphaltIn: Number(asphaltIn) || 0,
          kinds: useFl ? ['lip', 'flowline'] : ['lip'], shots: shotSet.shots.map((s) => ({ lng: s.lng, lat: s.lat, zFt: s.z, kind: s.kind })) })
      })
      const FT = 0.3048
      const sum = refitSummary(out.residualsFt.map((r) => ({ x: 0, y: 0, dz: r * FT })))
      const base = `${d.name} as-built ${shotSet.takenOn}`.replace(/[^A-Za-z0-9 ._-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
      let filed: boolean | null = null
      if (canWrite) {
        filed = false
        setBusy('Filing in Machine files…')
        const blob = new Blob([out.landxml], { type: 'application/xml' })
        const st = await startMachineUploadAction({ zoneId: site.id, filename: `${base}.xml`, size: blob.size }).catch(() => null)
        if (st?.ok) {
          const { error } = await createClient().storage.from('machine').uploadToSignedUrl(st.path, st.token, blob, { contentType: 'application/octet-stream' })
          if (!error) {
            const fin = await finishMachineFileAction({ zoneId: site.id, id: st.id, name: `${base}`, filename: `${base}.xml`, kind: 'landxml', takeoffId, grid: grid === 'sc' ? 'NAD83 / South Carolina (ft)' : 'NAD83 / UTM, metres', builtBy: 'HammerTrack as-built re-fit', builtOn: new Date().toLocaleDateString('en-CA'), note: `Re-fit to ${sum.shotsUsed} shots from "${shotSet.name}"; top of stone = FG − ${asphaltIn}" asphalt` }).catch(() => null)
            filed = !!fin?.ok
          }
        }
      }
      setDone({ summary: sum.words, warnings: out.warnings, faces: out.faces, filed, xml: out.landxml, name: `${base}.xml` })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Couldn’t build it.')
    } finally {
      setBusy(null)
    }
  }

  function download() {
    if (!done) return
    const url = URL.createObjectURL(new Blob([done.xml], { type: 'application/xml' }))
    const a = document.createElement('a')
    a.href = url; a.download = done.name
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  return (
    <section className={`${card} space-y-3`}>
      <h2 className="font-semibold text-ink flex items-center gap-2"><Cpu className="h-4 w-4 text-violet-300" /> 4 · As-built → stone and subgrade for the machines</h2>
      <p className="text-faint text-[12.5px]">The takeoff’s finished grade, re-fit so the pavement meets the curb as it was really poured (rover shots on the gutter lip / flowline), faded back to the design in the middle of the lot. Then top of stone (finished grade less the asphalt) and subgrade (less the full section), all in one LandXML 1.2 file for the dealer. It hasn’t been checked in dealer software yet — have the dealer check it before a machine runs on it.</p>
      {!data.takeoffs.length || !data.shotSets.length ? <Notice tone="info">Needs a dirt takeoff with the paving sections traced, and a set of curb shots on this site.</Notice> : (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="min-w-0"><span className="text-faint text-[12px] block">Takeoff (design)</span><select className={box} value={takeoffId} onChange={(e) => setTakeoff(e.target.value)}>{data.takeoffs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="min-w-0"><span className="text-faint text-[12px] block">Curb shots</span><select className={box} value={shotsId} onChange={(e) => setShots(e.target.value)}>{data.shotSets.map((s) => <option key={s.id} value={s.id}>{s.name} · {fmtDay(s.takenOn)}</option>)}</select></label>
          <label className="min-w-0"><span className="text-faint text-[12px] block">Grid</span><select className={box} value={grid} onChange={(e) => setGrid(e.target.value as Grid)}><option value="sc">SC State Plane (ft)</option><option value="utm">UTM (metres)</option></select></label>
          <label><span className="text-faint text-[12px] block">Asphalt thickness (in)</span><input inputMode="decimal" className={box} value={asphaltIn} onChange={(e) => setAsphalt(e.target.value)} /></label>
          <label><span className="text-faint text-[12px] block">Blend back to design over (ft)</span><input inputMode="decimal" className={box} value={radiusFt} onChange={(e) => setRadius(e.target.value)} /></label>
          <label className="flex items-center gap-2 pt-5 text-muted"><input type="checkbox" className="h-4 w-4 accent-amber" checked={useFl} onChange={(e) => setUseFl(e.target.checked)} /> Use flowline shots too</label>
        </div>
      )}
      {shotSet && <p className="text-faint text-[12px]">{edge} pavement-edge shots in this set drive the re-fit; curb tops, control and spots don’t.</p>}
      {err && <Notice tone="bad">{err}</Notice>}
      <button type="button" className={primary} disabled={!!busy || !takeoffId || !shotSet || !edge} onClick={build}>{busy ?? (canWrite ? 'Build and file the as-built surfaces' : 'Build the as-built surfaces')}</button>
      {done && (
        <div className="space-y-2">
          <Notice tone="good">{done.summary} Surfaces: finished grade {n0(done.faces.fg)} triangles, top of stone {n0(done.faces.stone)}, subgrade {n0(done.faces.sg)}.{done.filed ? ' Filed in the site’s Machine files.' : ''}</Notice>
          {done.filed === false && <Notice tone="bad">The surfaces were built but couldn’t be filed in Machine files — check your signal and build again{inApp ? '.' : ', or download them below.'}</Notice>}
          {done.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
          <div className="flex flex-wrap gap-2">
            {/* the app's web view has no download door — the filed copy downloads from Machine files there */}
            {!inApp && <button type="button" className={btn} onClick={download}>Download the LandXML</button>}
            <Link href={`/plans/${site.id}/machine`} className={btn}>{inApp && done.filed ? 'Open it in Machine files' : 'Machine files'}</Link>
          </div>
          {inApp && !done.filed && <p className="text-faint text-[12px]">To download the file itself, open this page on a computer.</p>}
        </div>
      )}
    </section>
  )
}

function ConfirmRemove({ what, onConfirm }: { what: string; onConfirm: () => Promise<void> }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!asking) return <button type="button" className={btn} onClick={() => setAsking(true)}>Remove</button>
  return (
    <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
      Remove {what}?
      <button type="button" className={btn} disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); setAsking(false) }}>{busy ? 'Removing…' : 'Yes, remove'}</button>
      <button type="button" className={btn} disabled={busy} onClick={() => setAsking(false)}>Keep</button>
    </span>
  )
}
