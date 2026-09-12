'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Plane, Search, Star, StarOff, Loader2, ChevronRight, X, Repeat } from 'lucide-react'
import { saveAircraftAction, removeAircraftAction } from '@/lib/actions/aircraft'
import { fmtDuration, isPartial } from '@/lib/aircraft-log'
import type { SavedAircraft, SavedAirport } from '@/lib/db/aircraft'
import { AirportBoard } from './AirportBoard'
import { FlightDetail } from './FlightDetail'

/**
 * The flight log screen: search a tail, read its flights, save the ones worth
 * keeping.
 *
 * The one thing this UI must never do is imply it knows more than it does.
 * The archive it reads keeps a rolling window, so the list says out loud
 * where its knowledge stops and what saving the plane would change — an empty
 * list because an aircraft did not fly and an empty list because nobody was
 * writing it down are very different answers.
 */

export interface Ident {
  hex: string
  reg: string | null
  typeCode: string | null
  desc: string | null
  owner: string | null
}

export interface FlightRow {
  id: string
  hex: string
  callsign: string | null
  startedAt: number
  endedAt: number
  durationSec: number
  from: { lat: number; lon: number }
  to: { lat: number; lon: number }
  distanceNm: number
  maxAltFt: number
  maxGsKt: number
  banked: boolean
  hasTrack: boolean
  departed: boolean
  arrived: boolean
  fromLabel: string | null
  toLabel: string | null
  /** Touch-and-goes per field, summarised for the row. */
  pattern?: { field: string; touchAndGoes: number }[]
}

const nf = (n: number) => Math.round(n).toLocaleString()
const dayLabel = (sec: number) =>
  new Date(sec * 1000).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
const timeLabel = (sec: number) =>
  new Date(sec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function FlightLog({
  saved: initialSaved, airports, canEdit, archiveDays,
}: {
  saved: SavedAircraft[]
  airports: SavedAirport[]
  canEdit: boolean
  archiveDays: number
}) {
  const [saved, setSaved] = useState(initialSaved)
  const [q, setQ] = useState('')
  const [ident, setIdent] = useState<Ident | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [flights, setFlights] = useState<FlightRow[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [days, setDays] = useState(archiveDays)
  const [openFlight, setOpenFlight] = useState<FlightRow | null>(null)
  const [tab, setTab] = useState<'aircraft' | 'airports'>('aircraft')
  const [busy, setBusy] = useState(false)
  const [loadingFlights, setLoadingFlights] = useState(false)
  const [, startSave] = useTransition()

  const isSaved = !!ident && saved.some((s) => s.hex === ident.hex)

  const loadFlights = useCallback(async (hex: string, span: number) => {
    setLoadingFlights(true)
    setFlights(null)
    try {
      const r = await fetch(`/api/aircraft/flights?hex=${hex}&days=${span}`)
      const j = await r.json()
      if (!r.ok) { setNote(j?.error ?? 'Could not read the flight log.'); setFlights([]); return }
      setFlights(j.flights ?? [])
      setTruncated(!!j.truncated)
    } catch {
      setNote('Could not reach the flight log.')
      setFlights([])
    } finally {
      setLoadingFlights(false)
    }
  }, [])

  const open = useCallback(async (a: Ident, span = archiveDays) => {
    setIdent(a); setNote(null); setDays(span); setOpenFlight(null)
    await loadFlights(a.hex, span)
  }, [archiveDays, loadFlights])

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const term = q.trim()
    if (term.length < 3) { setNote('Type a tail number, like N628TS.'); return }
    setBusy(true); setNote(null); setFlights(null); setIdent(null); setOpenFlight(null)
    try {
      const r = await fetch(`/api/aircraft/search?q=${encodeURIComponent(term)}`)
      const j = await r.json()
      if (!r.ok) { setNote(j?.error ?? 'Search failed.'); return }
      if (!j.aircraft) { setNote(j?.note ?? 'No aircraft found with that tail number.'); return }
      await open(j.aircraft as Ident)
    } catch {
      setNote('Could not reach the aircraft registry.')
    } finally {
      setBusy(false)
    }
  }

  const toggleSave = () => {
    if (!ident) return
    startSave(async () => {
      if (isSaved) {
        const r = await removeAircraftAction(ident.hex)
        if (r.ok) setSaved((s) => s.filter((x) => x.hex !== ident.hex))
        else setNote(r.error ?? 'Could not remove that plane.')
      } else {
        const r = await saveAircraftAction({ hex: ident.hex })
        if (r.ok) {
          setSaved((s) => [{
            id: ident.hex, hex: ident.hex, reg: ident.reg, typeCode: ident.typeCode,
            descr: ident.desc, owner: ident.owner, label: null, notes: null,
            lastSyncedAt: null, lastFlightAt: null, createdAt: new Date().toISOString(),
          }, ...s])
        } else setNote(r.error ?? 'Could not save that plane.')
      }
    })
  }

  // Deep link: /aircraft?tail=N628TS opens straight onto that aircraft.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tail')
    if (!t) return
    setQ(t)
    void (async () => {
      try {
        const r = await fetch(`/api/aircraft/search?q=${encodeURIComponent(t)}`)
        const j = await r.json()
        if (j?.aircraft) { await open(j.aircraft as Ident); return }
        // Arriving from the map popup for an airframe the registry has never
        // heard of (military, a fresh registration) used to land on a page
        // with the tail in the box and no explanation at all (ship-check).
        setNote(j?.note ?? j?.error ?? 'No aircraft found with that tail number.')
      } catch {
        setNote('Could not reach the aircraft registry.')
      }
    })()
  }, [open])

  const title = ident ? (ident.reg || ident.hex.toUpperCase()) : ''

  /** Jumping from an airport board straight into an aircraft's own log. */
  const openTail = useCallback((tail: string) => {
    setTab('aircraft')
    setQ(tail)
    void (async () => {
      setBusy(true)
      try {
        const r = await fetch(`/api/aircraft/search?q=${encodeURIComponent(tail)}`)
        const j = await r.json()
        if (j?.aircraft) await open(j.aircraft as Ident)
        else setNote(j?.note ?? 'No aircraft found with that tail number.')
      } catch { setNote('Could not reach the aircraft registry.') } finally { setBusy(false) }
    })()
  }, [open])

  return (
    <div className="max-w-3xl space-y-4 p-4">
      <div className="flex gap-1.5" role="tablist">
        {([['aircraft', 'By aircraft'], ['airports', 'By airfield']] as const).map(([k, label]) => (
          <button
            key={k} role="tab" aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold ${
              tab === k ? 'border-amber/50 bg-amber/15 text-amber' : 'border-navy-800 bg-navy-950 text-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'airports' && (
        <AirportBoard saved={airports} canEdit={canEdit} onOpenTail={openTail} />
      )}

      {tab === 'aircraft' && (<>
      <form onSubmit={search} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tail number — N628TS"
            aria-label="Search by tail number"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-xl border border-navy-700 bg-navy-950 py-2.5 pl-9 pr-3 text-base text-ink placeholder:text-faint focus:border-teal focus:outline-none"
          />
        </div>
        <button
          type="submit" disabled={busy}
          className="flex-none rounded-xl bg-amber px-4 py-2.5 text-sm font-bold text-[#1a1100] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Look up'}
        </button>
      </form>

      {note && (
        <p role="status" className="rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-[12.5px] text-amber">{note}</p>
      )}

      {/* Saved planes — the watchlist, and the only history that outlives the
          archive window. */}
      {saved.length > 0 && !ident && (
        <section>
          <h2 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">Saved planes</h2>
          <div className="space-y-1.5">
            {saved.map((s) => (
              <button
                key={s.hex}
                onClick={() => open({ hex: s.hex, reg: s.reg, typeCode: s.typeCode, desc: s.descr, owner: s.owner })}
                className="flex w-full items-center gap-3 rounded-xl border border-navy-800 bg-navy-900 px-3 py-2.5 text-left hover:border-navy-700"
              >
                <Plane className="h-4 w-4 flex-none text-amber" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">
                    {s.label || s.reg || s.hex.toUpperCase()}
                  </span>
                  <span className="block truncate text-[11px] text-faint">
                    {[s.descr, s.label && s.reg ? s.reg : null].filter(Boolean).join(' · ') || 'aircraft'}
                    {s.lastFlightAt ? ` · last flew ${dayLabel(new Date(s.lastFlightAt).getTime() / 1000)}` : ''}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 flex-none text-faint" />
              </button>
            ))}
          </div>
        </section>
      )}

      {!ident && saved.length === 0 && (
        <div className="rounded-xl border border-navy-800 bg-navy-900 p-4">
          <p className="text-[13px] text-muted">
            Type a tail number to see where an aircraft has been for the last {archiveDays} days.
          </p>
          <p className="mt-1.5 text-[11.5px] text-faint">
            Save one and we start keeping its flights permanently — the public archive only
            holds {archiveDays} days, so anything older only exists if somebody was writing it down.
          </p>
        </div>
      )}

      {ident && (
        <section className="space-y-3">
          <div className="flex items-start gap-3 rounded-xl border border-navy-800 bg-navy-900 p-3">
            <Plane className="mt-0.5 h-5 w-5 flex-none text-amber" />
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-bold text-ink">{title}</h2>
              <p className="text-[11.5px] text-muted">
                {[ident.desc, ident.typeCode].filter(Boolean).join(' · ') || 'aircraft'}
              </p>
              {ident.owner && <p className="text-[11px] text-faint">{ident.owner}</p>}
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-faint">{ident.hex}</p>
            </div>
            <div className="flex flex-none flex-col items-end gap-1.5">
              <button onClick={() => { setIdent(null); setFlights(null); setOpenFlight(null) }}
                aria-label="Close" className="p-1 text-faint hover:text-ink">
                <X className="h-4 w-4" />
              </button>
              {canEdit && (
                <button
                  onClick={toggleSave}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold ${
                    isSaved ? 'border-teal/40 bg-teal/10 text-teal' : 'border-navy-700 bg-navy-950 text-muted hover:text-ink'
                  }`}
                >
                  {isSaved ? <><Star className="h-3.5 w-3.5" /> Saved</> : <><StarOff className="h-3.5 w-3.5" /> Save</>}
                </button>
              )}
            </div>
          </div>

          {canEdit && !isSaved && (
            <p className="px-1 text-[11px] text-faint">
              Saving this plane starts banking its flights nightly, so its history keeps going
              after the public archive drops it at {archiveDays} days.
            </p>
          )}

          {/* Range. Beyond the archive window only banked flights can answer,
              and the empty state below says so rather than implying it never flew. */}
          <div className="flex items-center gap-1.5">
            {[7, archiveDays, 90, 365].map((d) => (
              <button
                key={d}
                onClick={() => { setDays(d); void loadFlights(ident.hex, d) }}
                className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold ${
                  days === d ? 'border-amber/50 bg-amber/15 text-amber' : 'border-navy-800 bg-navy-950 text-muted hover:text-ink'
                }`}
              >
                {d === 365 ? '1 year' : d === 90 ? '90 days' : `${d} days`}
              </button>
            ))}
          </div>

          {loadingFlights && (
            <p className="flex items-center gap-2 px-1 text-[12.5px] text-faint">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the archive…
            </p>
          )}

          {flights && !loadingFlights && flights.length === 0 && (
            <p className="rounded-xl border border-navy-800 bg-navy-900 p-4 text-[12.5px] text-faint">
              No flights in the last {days} days.
              {days > archiveDays && ' The public archive only reaches back ' + archiveDays +
                ' days — anything older would have to have been banked while the plane was saved.'}
            </p>
          )}

          {truncated && flights && (
            <p className="rounded-lg border border-navy-800 bg-navy-950 px-3 py-2 text-[11.5px] text-faint">
              Showing the most recent days. The archive is a shared community feed and we read it
              a few days at a time — {isSaved ? 'the rest fills in overnight now that this plane is saved.' : 'save this plane and we fill the rest in overnight.'}
            </p>
          )}

          {flights && flights.length > 0 && (
            <ul className="space-y-1.5">
              {flights.map((f) => (
                <li key={f.id}>
                  <button
                    onClick={() => setOpenFlight(openFlight?.id === f.id ? null : f)}
                    aria-expanded={openFlight?.id === f.id}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      openFlight?.id === f.id ? 'border-amber/50 bg-amber/[0.07]' : 'border-navy-800 bg-navy-900 hover:border-navy-700'
                    }`}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] font-semibold text-ink">{dayLabel(f.startedAt)}</span>
                      <span className="font-mono text-[11px] text-muted">
                        {timeLabel(f.startedAt)} → {timeLabel(f.endedAt)}
                      </span>
                      {f.callsign && <span className="ml-auto font-mono text-[10.5px] text-teal">{f.callsign}</span>}
                    </div>
                    {/* Where it actually went, the way anyone reading a flight
                        list expects to see it. */}
                    {/* Wraps rather than truncating: losing the second half
                        of "A → B" loses the whole point of the line. */}
                    {(f.fromLabel || f.toLabel) && (
                      <div className="mt-0.5 text-[12px] leading-snug text-muted">
                        {f.fromLabel ?? 'unknown'} <span className="text-faint">→</span> {f.toLabel ?? 'unknown'}
                      </div>
                    )}
                    {/* The headline of the whole ask: a training flight is
                        one trip, and this is what happened inside it. */}
                    {(f.pattern ?? []).filter((w) => w.touchAndGoes > 0).map((w) => (
                      <div key={w.field} className="mt-0.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-teal">
                        <Repeat className="h-3 w-3 flex-none" />
                        {w.touchAndGoes} touch-and-go{w.touchAndGoes === 1 ? '' : 'es'} at {w.field}
                      </div>
                    ))}
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-faint">
                      <span>{fmtDuration(f.durationSec)}</span>
                      <span>{nf(f.distanceNm)} nm</span>
                      <span>max {nf(f.maxAltFt)} ft</span>
                      <span>{nf(f.maxGsKt)} kt</span>
                      {f.banked && <span className="text-teal">kept</span>}
                    </div>
                    {/* Say what this is rather than letting a fragment of a
                        flight pass for a short one. */}
                    {isPartial(f) ? (
                      <p className="mt-1 text-[10.5px] text-amber">
                        Part of a flight — no receiver heard it take off or land, so this is
                        only the stretch that was covered.
                      </p>
                    ) : (!f.departed || !f.arrived) ? (
                      <p className="mt-1 text-[10.5px] text-faint">
                        {f.departed ? 'Landing' : 'Takeoff'} not covered — the track starts or
                        ends where a receiver picked it up.
                      </p>
                    ) : null}
                  </button>
                  {openFlight?.id === f.id && <FlightDetail flight={f} />}
                </li>
              ))}
            </ul>
          )}

          <p className="px-1 text-[10.5px] text-faint">
            Flight data from the <a href="https://adsb.lol" target="_blank" rel="noopener"
              className="text-muted underline underline-offset-2">adsb.lol</a> receiver network (ODbL).
            Aircraft registry from <a href="https://www.adsbdb.com" target="_blank" rel="noopener"
              className="text-muted underline underline-offset-2">adsbdb</a>. Airfields from{' '}
            <a href="https://ourairports.com" target="_blank" rel="noopener"
              className="text-muted underline underline-offset-2">OurAirports</a> (public domain).
          </p>
        </section>
      )}
      </>)}
    </div>
  )
}
