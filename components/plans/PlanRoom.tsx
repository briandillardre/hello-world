'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { ArrowLeft, FileStack, Plus, MapPin, Pencil, Trash2, RotateCcw, Map as MapIcon, Layers, Drill, Cpu, Plane } from 'lucide-react'
import {
  groupSheets, revLabel, setKindLabel, SET_KINDS, placementWords, type PlanSetKind,
} from '@/lib/plans/room'
import { roughBounds } from '@/lib/plans/north'
import { scaleWords } from '@/lib/plans/scale'
import type { PlanRoomData, PlanSheetRow, PlanSetRow } from '@/lib/db/plans'
import {
  setSheetOnMapAction, notePlacementAction, updatePlanSetAction, deletePlanSetAction, unvoidPlanSheetAction, updatePlanSheetAction,
} from '@/lib/actions/plans'
import { thumbUrl, fallbackToRaw } from '@/lib/img'
import type { Corners } from '@/components/zones/OverlayPlacer'
import { AddPlanSet } from './AddPlanSet'
import { ItemLibrary } from './ItemLibrary'
import type { TakeoffItem } from '@/lib/db/takeoff'

const OverlayPlacer = dynamic(
  () => import('@/components/zones/OverlayPlacer').then((m) => ({ default: m.OverlayPlacer })),
  { ssr: false },
)

export const fmtDay = (d: string) => {
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/**
 * One site's plan room (migration 143): every sheet filed under its number,
 * opening on its CURRENT version — newest issued unless somebody pinned one —
 * with a NEW dot until you have opened a revision someone else uploaded.
 * Sets list underneath, newest first. Sheets go on the live map one by one
 * (grading and utilities side by side); the map always shows the current
 * version, so a revision can never hide behind an old picture.
 */
export function PlanRoom({ zone, data, canEdit, ring, demo, canDelete = false, items = [], canCosts = false, canGround = false }: {
  zone: { id: string; name: string }
  data: PlanRoomData
  canEdit: boolean
  ring: [number, number][] | null
  demo: boolean
  /** Managers and above: delete a set, void sheets. */
  canDelete?: boolean
  items?: TakeoffItem[]
  canCosts?: boolean
  /** The site's borings, machine files and flight progress (not for a prospect). */
  canGround?: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'sheets' | 'sets' | 'items'>('sheets')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [placing, setPlacing] = useState<{ sheet: PlanSheetRow; versionId: string; imageId: string; url: string; bounds: Corners | null; rough: string | null } | null>(null)
  const centre: [number, number] | null = ring && ring.length >= 3
    ? [ring.reduce((t, p) => t + p[0], 0) / ring.length, ring.reduce((t, p) => t + p[1], 0) / ring.length] : null
  const [pending, setPending] = useState<string | null>(null)

  const live = data.sheets.filter((s) => !s.voidedAt)
  const voided = data.sheets.filter((s) => s.voidedAt)
  const groups = useMemo(() => groupSheets(live), [live])
  const newCount = live.filter((s) => s.isNew).length
  const onMapCount = live.filter((s) => {
    const cur = s.versions.find((v) => v.id === s.currentId)
    const img = cur?.imageId ? data.images[cur.imageId] : undefined
    return !!(img?.mapActive && img.bounds)
  }).length

  async function toggleMap(s: PlanSheetRow, on: boolean) {
    setPending(s.id); setError(null)
    const r = await setSheetOnMapAction(s.id, on).catch(() => null)
    setPending(null)
    if (!r?.ok) setError(r && !r.ok ? r.error : 'Couldn’t update the map — try again.')
    router.refresh()
  }

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        <div>
          <Link href="/plans" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-2">
            <ArrowLeft className="h-4 w-4" /> All plan rooms
          </Link>
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><FileStack className="h-5 w-5 text-amber" /> {zone.name}</h1>
              <p className="text-[12.5px] text-faint">
                {live.length} sheet{live.length === 1 ? '' : 's'} · {data.sets.length} set{data.sets.length === 1 ? '' : 's'}
                {onMapCount > 0 && <> · {onMapCount} on the map</>}
                {newCount > 0 && <> · <span className="text-amber font-semibold">{newCount} new to you</span></>}
              </p>
            </div>
            <Link href={`/plans/${zone.id}/takeoff`} className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-2 text-[12.5px] text-muted hover:text-ink">
              <Layers className="h-4 w-4" /> Takeoff
            </Link>
            {canGround && (
              <Link href={`/plans/${zone.id}/ground`} className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-2 text-[12.5px] text-muted hover:text-ink">
                <Drill className="h-4 w-4" /> Ground
              </Link>
            )}
            {canGround && (
              <Link href={`/plans/${zone.id}/machine`} className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-2 text-[12.5px] text-muted hover:text-ink">
                <Cpu className="h-4 w-4" /> Machines
              </Link>
            )}
            {canGround && (
              <Link href={`/plans/${zone.id}/progress`} className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-2 text-[12.5px] text-muted hover:text-ink">
                <Plane className="h-4 w-4" /> Progress
              </Link>
            )}
            <Link href={`/zones/${zone.id}`} className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-2 text-[12.5px] text-muted hover:text-ink">
              <MapIcon className="h-4 w-4" /> Site page
            </Link>
            {canEdit && (
              <button type="button" onClick={() => setAdding(true)} disabled={demo}
                className="inline-flex items-center gap-2 rounded-xl bg-amber text-[#1a1100] font-display font-bold px-4 py-2 disabled:opacity-50 active:scale-95">
                <Plus className="h-4 w-4" /> Add a set
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-1.5">
          {(['sheets', 'sets', 'items'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={'rounded-full px-3 py-1 text-[12px] font-semibold border ' + (tab === t ? 'bg-teal/15 border-teal/40 text-teal' : 'border-navy-700 text-muted')}>
              {t === 'sheets' ? `Sheets (${live.length})` : t === 'sets' ? `Sets (${data.sets.length})` : `Items (${items.length})`}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {tab === 'sheets' && (
          live.length === 0 ? (
            <Empty canEdit={canEdit} onAdd={() => setAdding(true)} demo={demo} />
          ) : (
            <div className="space-y-4">
              {groups.map((g) => (
                <section key={g.name}>
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-1.5">{g.name}</h2>
                  <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
                    {g.sheets.map((s) => (
                      <SheetRow key={s.id} zoneId={zone.id} sheet={s} data={data} canEdit={canEdit} busy={pending === s.id}
                        onMap={(on) => void toggleMap(s, on)}
                        onPlace={(versionId, imageId, url, bounds) => {
                          // An unplaced sheet starts centred on the site, north up, at the size its scale says.
                          const v = s.versions.find((x) => x.id === versionId)
                          const fpi = v?.scaleChecks?.find((c) => c.key === 'grid' || c.key === 'bar' || c.key === 'dims')?.feetPerInch ?? v?.feetPerInch ?? null
                          const rough = !bounds && centre && v?.pageW && v.pageH && fpi ? roughBounds(centre, v.pageW, v.pageH, fpi) : null
                          setPlacing({ sheet: s, versionId, imageId, url, bounds: bounds ?? (rough as Corners | null), rough: rough && fpi ? scaleWords(fpi) : null })
                        }} />
                    ))}
                  </div>
                </section>
              ))}
              {voided.length > 0 && (
                <details className="rounded-xl border border-navy-800 bg-navy-950">
                  <summary className="px-3 py-2 text-[12px] text-faint cursor-pointer">Voided sheets ({voided.length})</summary>
                  <div className="divide-y divide-navy-800">
                    {voided.map((s) => (
                      <div key={s.id} className="flex items-center gap-2 px-3 py-2">
                        <span className="font-mono text-sm text-faint line-through">{s.number}</span>
                        <span className="text-[12px] text-faint flex-1 truncate">{s.title}</span>
                        <span className="text-[10px] font-bold text-red-400 border border-red-500/40 rounded px-1.5">VOID</span>
                        {canEdit && (
                          <button type="button" onClick={async () => {
                            const r = await unvoidPlanSheetAction(s.id).catch(() => null)
                            if (!r?.ok) setError(r && !r.ok ? r.error : 'Couldn’t restore it — try again.')
                            router.refresh()
                          }}
                            className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-ink"><RotateCcw className="h-3 w-3" /> Restore</button>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )
        )}

        {tab === 'items' && <ItemLibrary items={items} canEdit={canDelete} canSeed={canEdit} canCosts={canCosts} />}

        {tab === 'sets' && (
          data.sets.length === 0 ? <Empty canEdit={canEdit} onAdd={() => setAdding(true)} demo={demo} /> : (
            <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
              {data.sets.map((s, i) => <SetRow key={s.id} set={s} newest={i === 0} canEdit={canEdit} canDelete={canDelete} onChanged={() => router.refresh()} />)}
            </div>
          )
        )}
      </div>

      {adding && (
        <AddPlanSet zoneId={zone.id} sheets={data.sheets} ring={ring} canVoid={canDelete}
          onClose={() => setAdding(false)} onDone={() => router.refresh()} />
      )}
      {placing && (
        <OverlayPlacer
          zoneId={zone.id}
          imageId={placing.imageId}
          imageUrl={placing.url}
          ring={ring}
          initialBounds={placing.bounds}
          hint={placing.rough
            ? `${placing.sheet.number} starts at its own scale (${placing.rough}), north up, on the site — slide and turn it until the property corners sit on the satellite view.`
            : `Line ${placing.sheet.number}’s property corners up with the satellite view — the drawn scale carries over.`}
          onClose={() => setPlacing(null)}
          onSaved={async (b) => {
            const p = placing
            setPlacing(null)
            if (b) await notePlacementAction(p.versionId, 'manual').catch(() => null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function Empty({ canEdit, onAdd, demo }: { canEdit: boolean; onAdd: () => void; demo: boolean }) {
  return (
    <div className="rounded-xl border border-navy-800 bg-navy-900 p-5 text-center space-y-2">
      <p className="text-sm text-ink font-semibold">No plans here yet</p>
      <p className="text-[12.5px] text-faint max-w-md mx-auto">
        Add the bid set’s PDF. Every page files under its sheet number, and the next addendum lands on top as a new revision —
        the newest is always the one you open{demo ? '. (Sign in to a real company to upload.)' : '.'}
      </p>
      {canEdit && !demo && (
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-2 rounded-xl bg-amber text-[#1a1100] font-display font-bold px-4 py-2">
          <Plus className="h-4 w-4" /> Add a set
        </button>
      )}
    </div>
  )
}

function SheetRow({ zoneId, sheet, data, canEdit, busy, onMap, onPlace }: {
  zoneId: string
  sheet: PlanSheetRow
  data: PlanRoomData
  canEdit: boolean
  busy: boolean
  onMap: (on: boolean) => void
  onPlace: (versionId: string, imageId: string, url: string, bounds: Corners | null) => void
}) {
  const router = useRouter()
  const cur = sheet.versions.find((v) => v.id === sheet.currentId) ?? null
  const img = cur?.imageId ? data.images[cur.imageId] : undefined
  const placed = !!img?.bounds
  const pinned = !!sheet.pinnedVersionId && sheet.pinnedVersionId === sheet.currentId
  const newer = pinned ? sheet.versions.filter((v) => v.issuedOn > (cur?.issuedOn ?? '')).length : 0
  const check = !!cur?.placement?.check
  const [editing, setEditing] = useState(false)
  const [num, setNum] = useState(sheet.number)
  const [title, setTitle] = useState(sheet.title ?? '')
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setErr(null)
    const r = await updatePlanSheetAction(sheet.id, { number: num, title }).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t save — try again.'); return }
    setEditing(false)
    router.refresh()
  }

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <Link href={`/plans/${zoneId}/${sheet.id}`} className="flex items-center gap-3 flex-1 min-w-0 group">
          <span className="relative flex-none">
            {img
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={thumbUrl(img.url, 160)} onError={(e) => fallbackToRaw(e, img.url)} alt="" loading="lazy" className="h-11 w-16 object-cover rounded border border-navy-700 bg-white" />
              : <span className="h-11 w-16 rounded border border-navy-700 bg-navy-800 grid place-items-center"><Layers className="h-4 w-4 text-faint" /></span>}
            {sheet.isNew && <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber ring-2 ring-navy-900" aria-label="New revision" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-ink group-hover:text-amber">{sheet.number}</span>
              <span className="text-[13px] text-ink truncate">{sheet.title ?? ''}</span>
            </span>
            <span className="flex items-center gap-1.5 flex-wrap text-[11px] text-faint">
              <span className="rounded px-1.5 py-px bg-emerald-500/15 text-emerald-300 font-semibold">Current · {revLabel(cur?.rev)}</span>
              {cur && <span>issued {fmtDay(cur.issuedOn)}</span>}
              {sheet.versions.length > 1 && <span>· {sheet.versions.length} versions</span>}
              {pinned && <span className="text-amber">· pinned{newer ? ` — ${newer} newer held back` : ''}</span>}
              {sheet.isNew && <span className="text-amber font-semibold">· NEW</span>}
              {placed && cur?.placement?.source === 'grid' && <span className="text-teal" title={placementWords(cur.placement, true)}>· placed from its grid</span>}
              {!placed && img?.mapActive && <span className="text-amber">· place it to put it back on the map</span>}
            </span>
          </span>
        </Link>
        {placed && canEdit && (
          <label className="flex items-center gap-1.5 text-[11px] text-muted cursor-pointer" title="Show the current version on the live map">
            <input type="checkbox" className="accent-teal" checked={!!img?.mapActive} disabled={busy} onChange={(e) => onMap(e.target.checked)} />
            Map
          </label>
        )}
        {placed && !canEdit && img?.mapActive && <span className="text-[11px] text-teal">On map</span>}
        {canEdit && cur?.imageId && img && (
          <button type="button" onClick={() => onPlace(cur.id, cur.imageId!, img.url, img.bounds)}
            className={'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold ' +
              (check ? 'border-amber/60 text-amber' : placed ? 'border-teal/40 text-teal' : 'border-navy-700 text-muted hover:text-ink')}>
            <MapPin className="h-3 w-3" /> {check ? 'Check' : placed ? 'Placed' : 'Place'}
          </button>
        )}
        {canEdit && (
          <button type="button" onClick={() => setEditing((x) => !x)} aria-label="Rename sheet" className="rounded-lg p-1.5 text-faint hover:text-ink">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <input value={num} onChange={(e) => setNum(e.target.value.toUpperCase().slice(0, 24))} aria-label="Sheet number"
            className="w-28 rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-sm font-mono text-ink" />
          <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 200))} aria-label="Sheet title" placeholder="Title"
            className="flex-1 min-w-[10rem] rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-sm text-ink" />
          <button type="button" onClick={() => void save()} className="rounded-lg bg-amber text-[#1a1100] font-bold text-xs px-3 py-1.5">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-faint hover:text-ink">Cancel</button>
          {err && <p className="w-full text-[11.5px] text-red-400">{err}</p>}
        </div>
      )}
    </div>
  )
}

function SetRow({ set, newest, canEdit, canDelete, onChanged }: { set: PlanSetRow; newest: boolean; canEdit: boolean; canDelete: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(set.name)
  const [kind, setKind] = useState<PlanSetKind>(set.kind)
  const [day, setDay] = useState(set.issuedOn)
  const [err, setErr] = useState<string | null>(null)
  const pages = set.files.reduce((n, f) => n + (f.pages ?? 0), 0)

  async function save() {
    setErr(null)
    const r = await updatePlanSetAction(set.id, { name, kind, issuedOn: day }).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t save — try again.'); return }
    setEditing(false); onChanged()
  }
  async function remove() {
    if (!window.confirm(`Delete “${set.name}”? Its ${set.versionCount} sheet version${set.versionCount === 1 ? '' : 's'} leave the plan room and its PDFs are deleted. Sheets go back to their previous version.`)) return
    const r = await deletePlanSetAction(set.id).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t delete — try again.'); return }
    onChanged()
  }

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-ink font-semibold truncate">
            {set.name} {newest && <span className="ml-1 text-[10.5px] rounded px-1.5 py-px bg-emerald-500/15 text-emerald-300 align-middle">Newest</span>}
          </p>
          <p className="text-[11.5px] text-faint">
            {setKindLabel(set.kind)} · issued {fmtDay(set.issuedOn)} · {set.versionCount} sheet{set.versionCount === 1 ? '' : 's'}
            {set.files.length > 0 && <> · {set.files.length} PDF{set.files.length === 1 ? '' : 's'}{pages ? `, ${pages} pages` : ''}</>}
          </p>
        </div>
        {canEdit && (
          <>
            <button type="button" onClick={() => setEditing((x) => !x)} aria-label="Edit set" className="rounded-lg p-1.5 text-faint hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
            {canDelete && <button type="button" onClick={() => void remove()} aria-label="Delete set" className="rounded-lg p-1.5 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>}
          </>
        )}
      </div>
      {editing && (
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] items-center">
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} aria-label="Set name"
            className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-sm text-ink" />
          <select value={kind} onChange={(e) => setKind(e.target.value as PlanSetKind)} aria-label="Kind"
            className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-sm text-ink">
            {SET_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Issued"
            className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-sm text-ink" />
          <div className="flex gap-2">
            <button type="button" onClick={() => void save()} className="rounded-lg bg-amber text-[#1a1100] font-bold text-xs px-3 py-1.5">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-faint hover:text-ink">Cancel</button>
          </div>
          {err && <p className="sm:col-span-4 text-[11.5px] text-red-400">{err}</p>}
        </div>
      )}
      {!editing && err && <p className="text-[11.5px] text-red-400">{err}</p>}
    </div>
  )
}
