'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { TowerControl, PlaneTakeoff, PlaneLanding, Loader2, Plus, X, Repeat } from 'lucide-react'
import { saveAirportAction, removeAirportAction } from '@/lib/actions/aircraft'
import { fmtDuration } from '@/lib/aircraft-log'
import type { SavedAirport } from '@/lib/db/aircraft'

/**
 * What flew in and out of a field (Brian, Sep 12, sending FlightRadar24's
 * Greenville Downtown departures board — which FR24 locks past 12 hours).
 *
 * The honesty problem here is bigger than anywhere else in the flight log.
 * Nobody publishes this, so we assemble it by watching, which means an empty
 * board can mean two completely different things: nothing flew, or nobody was
 * looking yet. The header always says which, because a board that quietly
 * under-reports is worse than no board.
 */

export interface Movement {
  id: string
  hex: string
  reg: string | null
  typeCode: string | null
  callsign: string | null
  kind: 'departure' | 'arrival'
  otherEnd: string | null
  startedAt: number
  endedAt: number
  durationSec: number
  distanceNm: number
  touchAndGoes: number
}

type Filter = 'all' | 'departure' | 'arrival'

const clock = (sec: number) =>
  new Date(sec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const dayOf = (sec: number) =>
  new Date(sec * 1000).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
const ago = (iso: string | null) => {
  if (!iso) return null
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 2) return 'just now'
  if (mins < 90) return `${mins} min ago`
  const h = Math.round(mins / 60)
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

export function AirportBoard({
  saved: initialSaved, canEdit, onOpenTail, jumpTo = null,
}: {
  saved: SavedAirport[]
  canEdit: boolean
  onOpenTail: (tail: string) => void
  /** The search box resolved to a field (and maybe a destination) — show it
   *  even if nobody is watching it yet. */
  jumpTo?: { ident: string; to?: string } | null
}) {
  const [saved, setSaved] = useState(initialSaved)
  const [active, setActive] = useState<string | null>(initialSaved[0]?.ident ?? null)
  const [adding, setAdding] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [movements, setMovements] = useState<Movement[] | null>(null)
  const [meta, setMeta] = useState<{ name: string; watchingSince: string | null; lastSweptAt: string | null } | null>(null)
  const [days, setDays] = useState(7)
  const [filter, setFilter] = useState<Filter>('all')
  /** Set from a "GMU-CLT" search: show only movements to/from this other end. */
  const [routeTo, setRouteTo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [, start] = useTransition()

  const load = useCallback(async (ident: string, span: number) => {
    setLoading(true); setMovements(null)
    try {
      const r = await fetch(`/api/aircraft/board?ident=${encodeURIComponent(ident)}&days=${span}`)
      const j = await r.json()
      if (!r.ok) { setNote(j?.error ?? 'Could not read that board.'); setMovements([]); return }
      setMovements(j.movements ?? [])
      setMeta({ name: j.field?.name ?? ident, watchingSince: j.watchingSince ?? null, lastSweptAt: j.lastSweptAt ?? null })
    } catch {
      setNote('Could not reach the board.'); setMovements([])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { if (active) void load(active, days) }, [active, days, load])

  // The search box handed us a field — open it, watched or not.
  useEffect(() => {
    if (!jumpTo) return
    setActive(jumpTo.ident)
    setRouteTo(jumpTo.to ?? null)
  }, [jumpTo])

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    const code = adding.trim().toUpperCase()
    if (!/^[A-Z0-9]{3,4}$/.test(code)) { setNote('Type an airfield code, like KGMU.'); return }
    setNote(null)
    start(async () => {
      const r = await saveAirportAction(code)
      if (!r.ok) { setNote(r.error ?? 'Could not add that airfield.'); return }
      setSaved((s) => s.some((x) => x.ident === code) ? s : [...s, { id: code, ident: code, name: null, label: null, lastSweptAt: null }])
      setAdding(''); setActive(code)
    })
  }

  const drop = (ident: string) => {
    start(async () => {
      const r = await removeAirportAction(ident)
      if (!r.ok) { setNote(r.error ?? 'Could not remove that airfield.'); return }
      setSaved((s) => s.filter((x) => x.ident !== ident))
      setActive((a) => (a === ident ? null : a))
    })
  }

  const shown = (movements ?? [])
    .filter((m) => filter === 'all' || m.kind === filter)
    // A route search narrows to the other end, matched on the code we print
    // in the label ("… (CLT)").
    .filter((m) => !routeTo || (m.otherEnd ?? '').toUpperCase().includes(`(${routeTo})`))

  return (
    <section className="space-y-3">
      {canEdit && (
        <form onSubmit={add} className="flex gap-2">
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="Add an airfield — KGMU"
            aria-label="Add an airfield by code"
            autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            className="min-w-0 flex-1 rounded-xl border border-navy-700 bg-navy-950 px-3 py-2 text-base text-ink placeholder:text-faint focus:border-teal focus:outline-none"
          />
          <button type="submit" className="flex flex-none items-center gap-1.5 rounded-xl border border-navy-700 bg-navy-950 px-3 py-2 text-[12.5px] font-semibold text-muted hover:text-ink">
            <Plus className="h-3.5 w-3.5" /> Watch
          </button>
        </form>
      )}

      {note && <p role="status" className="rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-[12.5px] text-amber">{note}</p>}

      {saved.length === 0 ? (
        <div className="rounded-xl border border-navy-800 bg-navy-900 p-4">
          <p className="text-[13px] text-muted">Watch an airfield to see what flies in and out of it.</p>
          <p className="mt-1.5 text-[11.5px] text-faint">
            Nobody publishes this, so we build it by looking — the board starts filling from the
            moment you add the field, and keeps everything from then on.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {saved.map((a) => (
            <span key={a.ident} className={`inline-flex items-center gap-1 rounded-lg border text-[12px] font-semibold ${
              active === a.ident ? 'border-amber/50 bg-amber/15 text-amber' : 'border-navy-800 bg-navy-950 text-muted'
            }`}>
              <button onClick={() => setActive(a.ident)} className="py-1 pl-2.5 pr-1">{a.label || a.ident}</button>
              {canEdit && (
                <button onClick={() => drop(a.ident)} aria-label={`Stop watching ${a.ident}`} className="py-1 pr-1.5 text-faint hover:text-alert">
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {active && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-ink">
              <TowerControl className="h-4 w-4 text-teal" /> {meta?.name ?? active}
            </h2>
            <span className="font-mono text-[11px] text-faint">{active}</span>
            {meta?.lastSweptAt && <span className="text-[11px] text-faint">checked {ago(meta.lastSweptAt)}</span>}
            {routeTo && (
              <button onClick={() => setRouteTo(null)}
                className="inline-flex items-center gap-1 rounded-lg border border-teal/40 bg-teal/10 px-2 py-0.5 text-[11px] font-semibold text-teal">
                only to/from {routeTo} <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {!saved.some((a) => a.ident === active) && (
            <p className="rounded-lg border border-navy-800 bg-navy-950 px-3 py-2 text-[11.5px] text-faint">
              Nobody is watching this field yet, so there is nothing recorded for it beyond
              flights we happened to read for another reason.
              {canEdit && ' Add it above and we start keeping its movements.'}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {(['all', 'departure', 'arrival'] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold ${
                  filter === f ? 'border-teal/50 bg-teal/15 text-teal' : 'border-navy-800 bg-navy-950 text-muted hover:text-ink'
                }`}>
                {f === 'all' ? 'Everything' : f === 'departure' ? 'Departures' : 'Arrivals'}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-navy-800" />
            {[1, 7, 30].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold ${
                  days === d ? 'border-amber/50 bg-amber/15 text-amber' : 'border-navy-800 bg-navy-950 text-muted hover:text-ink'
                }`}>
                {d === 1 ? '24 h' : `${d} days`}
              </button>
            ))}
          </div>

          {loading && (
            <p className="flex items-center gap-2 text-[12.5px] text-faint">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the board…
            </p>
          )}

          {movements && !loading && shown.length === 0 && (
            <p className="rounded-xl border border-navy-800 bg-navy-900 p-4 text-[12.5px] text-faint">
              Nothing recorded here in the last {days === 1 ? '24 hours' : `${days} days`}.
              {meta?.watchingSince && new Date(meta.watchingSince).getTime() > Date.now() - days * 86_400_000
                ? ` This field has only been watched since ${dayOf(new Date(meta.watchingSince).getTime() / 1000)}, so anything before that was never recorded.`
                : ' A quiet field with no ADS-B receiver nearby can also simply go unheard.'}
            </p>
          )}

          {shown.length > 0 && (
            <ul className="space-y-1.5">
              {shown.map((m) => (
                <li key={`${m.id}-${m.kind}`}>
                  <button
                    onClick={() => onOpenTail(m.reg || m.hex)}
                    className="flex w-full items-center gap-3 rounded-xl border border-navy-800 bg-navy-900 px-3 py-2.5 text-left hover:border-navy-700"
                  >
                    <span className="flex-none">
                      {m.kind === 'departure'
                        ? <PlaneTakeoff className="h-4 w-4 text-amber" />
                        : <PlaneLanding className="h-4 w-4 text-teal" />}
                    </span>
                    <span className="w-[66px] flex-none whitespace-nowrap font-mono text-[12px] font-semibold text-ink">
                      {clock(m.kind === 'departure' ? m.startedAt : m.endedAt)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">
                        {m.kind === 'departure' ? 'to ' : 'from '}
                        <span className="font-semibold">{m.otherEnd ?? 'somewhere we could not name'}</span>
                      </span>
                      <span className="flex flex-wrap gap-x-2 text-[11px] text-faint">
                        <span className="font-mono text-muted">{m.reg ?? m.hex.toUpperCase()}</span>
                        {m.typeCode && <span>{m.typeCode}</span>}
                        <span>{fmtDuration(m.durationSec)}</span>
                        <span>{Math.round(m.distanceNm)} nm</span>
                        {m.touchAndGoes > 0 && (
                          <span className="flex items-center gap-0.5 text-teal">
                            <Repeat className="h-3 w-3" />{m.touchAndGoes}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {meta?.watchingSince && (
            <p className="text-[10.5px] text-faint">
              Watching since {dayOf(new Date(meta.watchingSince).getTime() / 1000)}. Nothing before
              that was recorded — nobody publishes airfield history, so this is only what we have
              watched ourselves.
            </p>
          )}
        </>
      )}
    </section>
  )
}
