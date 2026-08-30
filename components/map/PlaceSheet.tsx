'use client'

import { useState } from 'react'
import { Check, ExternalLink, Pencil, Trash2, X } from 'lucide-react'
import { MapSheet } from './MapSheet'
import { updatePlaceAction, removePlaceAction } from '@/lib/actions/places'
import type { Place, PlaceKind } from '@/lib/types'

/**
 * Pin glyph + colour per place kind — exported so the map layer and this
 * sheet can never disagree about what a fuel stop looks like. Hex colours
 * rather than tailwind classes because MapLibre paint props can't read a
 * classname (same contract as POI_KIND_COLOR in lib/poi.ts).
 */
export const PLACE_KIND_META: Record<PlaceKind, { label: string; emoji: string; color: string }> = {
  supplier: { label: 'Supplier', emoji: '🏗', color: '#60a5fa' },
  fuel:     { label: 'Fuel',     emoji: '⛽', color: '#f472b6' },
  dump:     { label: 'Dump',     emoji: '🗑', color: '#9ca3af' },
  shop:     { label: 'Shop',     emoji: '🔧', color: '#2dd4bf' },
  customer: { label: 'Customer', emoji: '🏠', color: '#34d399' },
  rental:   { label: 'Rental',   emoji: '🚜', color: '#a78bfa' },
  other:    { label: 'Other',    emoji: '📍', color: '#ff9e16' },
}

const KINDS = Object.keys(PLACE_KIND_META) as PlaceKind[]

/**
 * A saved Place (migration 085) in the shared map sheet — bottom sheet on
 * phones, right panel on desktop, exactly like the asset and zone panels.
 * A place is a POINT crews drive to (the supply house, the dump, a
 * customer's driveway), so the sheet leads with Directions. In-app routing
 * is a PREVIEW (no-traffic OSRM line + steps); real voice-guided
 * turn-by-turn stays a Google Maps handoff for now, which is why both
 * buttons live here side by side.
 */
export function PlaceSheet({
  place, canEdit, isMock, onDirections, onChanged, onRemoved, onClose,
}: {
  place: Place
  canEdit: boolean
  isMock: boolean
  /** Start in-app preview routing to this place. */
  onDirections: (p: Place) => void
  /** Optimistic edit echo — the pin + sheet update before the server confirms. */
  onChanged: (p: Place) => void
  onRemoved: (id: string) => void
  onClose: () => void
}) {
  const meta = PLACE_KIND_META[place.kind] ?? PLACE_KIND_META.other

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(place.name)
  const [kind, setKind] = useState<PlaceKind>(place.kind)
  const [notes, setNotes] = useState(place.notes ?? '')
  const [confirmDel, setConfirmDel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Tapping a different pin reuses this mounted sheet — reset the edit form
  // so pin B never inherits pin A's half-typed rename. (State-during-render
  // reset; React's documented "adjust state when props change" pattern.)
  const [forId, setForId] = useState(place.id)
  if (forId !== place.id) {
    setForId(place.id)
    setEditing(false)
    setName(place.name)
    setKind(place.kind)
    setNotes(place.notes ?? '')
    setConfirmDel(false)
    setErr(null)
  }

  const save = async () => {
    const n = name.trim().slice(0, 80)
    if (!n) { setErr('Give the place a name.'); return }
    const trimmedNotes = notes.trim().slice(0, 400) || null
    const next: Place = { ...place, name: n, kind, notes: trimmedNotes }
    // Optimistic: the pin and sheet move now, the server catches up. Demo
    // mode skips the apply — the action is about to refuse, and the UI must
    // not flash an edit that immediately reverts.
    if (!isMock) onChanged(next)
    setBusy(true)
    setErr(null)
    const res = await updatePlaceAction(place.id, { name: n, kind, notes: trimmedNotes })
    setBusy(false)
    if (!res.ok) {
      if (!isMock) onChanged(place) // roll back to what the server still has
      setErr(res.error ?? 'Could not save the change.')
      return
    }
    setEditing(false)
  }

  const remove = async () => {
    setBusy(true)
    setErr(null)
    const res = await removePlaceAction(place.id)
    setBusy(false)
    if (!res.ok) {
      setConfirmDel(false)
      setErr(res.error ?? 'Could not remove it.')
      return
    }
    onRemoved(place.id)
  }

  return (
    <MapSheet
      icon={<span className="text-2xl">{meta.emoji}</span>}
      title={place.name}
      subtitle={
        // The geocoder's line under the name, so "Back gate" still tells you
        // which road it's on. Coords as the fallback for hand-dropped pins.
        <span className="text-muted">
          {place.address ?? `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`}
        </span>
      }
      badge={
        <span
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]"
          style={{ color: meta.color, borderColor: `${meta.color}66`, backgroundColor: `${meta.color}1a` }}
        >
          {meta.label}
        </span>
      }
      onClose={onClose}
    >
      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">Place name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="mt-1 w-full bg-navy-950 border border-navy-700 rounded-lg text-ink text-sm px-3 py-2 outline-none focus:border-amber/60"
            />
          </div>
          <div>
            <label className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">Kind</label>
            {/* Native select — the OS draws the popup, globals.css darkens the
                options and bumps touch inputs to 16px (iOS zoom kill switch). */}
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as PlaceKind)}
              className="mt-1 w-full bg-navy-950 border border-navy-700 rounded-lg text-ink text-sm px-3 py-2 outline-none focus:border-amber/60"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>{PLACE_KIND_META[k].emoji} {PLACE_KIND_META[k].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Gate code, who to ask for, where to park…"
              className="mt-1 w-full bg-navy-950 border border-navy-700 rounded-lg text-ink text-sm px-3 py-2 outline-none focus:border-amber/60 placeholder:text-faint resize-none"
            />
          </div>

          {err && <p className="text-[12px] text-alert leading-snug">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm py-2.5 hover:bg-amber-600 transition-colors disabled:opacity-60"
            >
              {busy
                ? <span className="w-3.5 h-3.5 border-2 border-[#1a1100] border-t-transparent rounded-full animate-spin" />
                : <Check className="h-4 w-4" />}
              Save
            </button>
            <button
              onClick={() => {
                setEditing(false)
                setName(place.name)
                setKind(place.kind)
                setNotes(place.notes ?? '')
                setConfirmDel(false)
                setErr(null)
              }}
              className="rounded-lg bg-navy-800 border border-navy-700 text-faint hover:text-ink px-3 py-2.5"
              aria-label="Cancel editing"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tap-twice remove — same guard the zone panel uses instead of a
              native confirm(). Soft delete server-side (active=false). */}
          {confirmDel ? (
            <button
              onClick={remove}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-alert/15 border border-alert/40 text-alert text-sm font-semibold py-2.5 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" /> Tap again to remove this place
            </button>
          ) : (
            <button
              onClick={() => setConfirmDel(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-navy-700 text-faint hover:text-alert text-sm font-medium py-2.5 transition-colors"
            >
              <Trash2 className="h-4 w-4" /> Remove place
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {place.notes && (
            <p className="rounded-lg bg-navy-800/70 px-3 py-2 text-[12px] text-muted whitespace-pre-line leading-snug">
              📝 {place.notes}
            </p>
          )}

          {/* Directions = in-app preview nav (route line + steps + honest
              no-traffic ETA). The Google Maps handoff STAYS beside it: that's
              where real voice-guided turn-by-turn lives for now. */}
          <button
            onClick={() => onDirections(place)}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm py-2.5 hover:bg-amber-600 transition-colors"
          >
            🧭 Directions
          </button>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`}
            target="_blank" rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-navy-800 border border-navy-700 text-ink text-sm font-medium py-2.5 hover:bg-navy-700 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5 text-faint" /> Open in Google Maps
          </a>

          {err && <p className="text-[12px] text-alert leading-snug">{err}</p>}

          {canEdit && (
            <button
              onClick={() => setEditing(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-navy-700 text-faint hover:text-ink text-sm font-medium py-2.5 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit place
            </button>
          )}
        </div>
      )}
    </MapSheet>
  )
}
