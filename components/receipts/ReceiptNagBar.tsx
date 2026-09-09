'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The in-app half of the receipt chase (Brian, Sep 9: "annoy the hell out of
 * them until they take a picture"). While the cardholder has charges with no
 * photo, an amber bar rides EVERY screen — on the map it floats under the top
 * bar, elsewhere it sits above the page. "Snap" opens the camera right here
 * (same door as the magic link: /api/r/<token>), "No receipt" closes a charge
 * with a reason the office sees. "Later" only shrinks it to a pill for ten
 * minutes; it never goes away while a receipt is owed.
 */
type Charge = { id: string; merchant: string | null; amount: number; txn_date: string; last4: string | null; token: string | null; nag_level: number; created_at: string }
type Fix = { lat: number; lng: number; acc: number | null }

const SNOOZE_KEY = 'ht_receipt_nag_snooze'
const money = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

export function ReceiptNagBar({ edge }: { edge: boolean }) {
  const [charges, setCharges] = useState<Charge[] | null>(null)
  const [open, setOpen] = useState(false)
  const [snoozeUntil, setSnoozeUntil] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [fix, setFix] = useState<Fix | null>(null)
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/receipts/mine', { cache: 'no-store' })
      if (!r.ok) return
      const j = await r.json() as { charges?: Charge[] }
      setCharges(j.charges ?? [])
    } catch { /* offline — keep what we had */ }
  }, [])

  // Every minute while something is owed, every five otherwise — a poll on
  // every dashboard page for every user is a Vercel call plus an auth round
  // trip, and it almost always comes back empty (sec-check P3).
  const owed = !!charges?.length
  useEffect(() => {
    void load()
    const id = window.setInterval(load, owed ? 60_000 : 300_000)
    const vis = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('ht:receipt-captured', load)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', vis); window.removeEventListener('ht:receipt-captured', load) }
  }, [load, owed])
  useEffect(() => { try { setSnoozeUntil(Number(sessionStorage.getItem(SNOOZE_KEY) ?? 0)) } catch { /* private mode */ } }, [])
  // A fix for the photo pin — asked only once the sheet is open, never on
  // every page paint.
  useEffect(() => {
    if (!open || fix || typeof navigator === 'undefined' || !('geolocation' in navigator)) return
    navigator.geolocation.getCurrentPosition(
      (p) => setFix({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy ?? null }),
      () => { /* no pin */ },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    )
  }, [open, fix])

  if (!charges || charges.length === 0) return null
  const total = charges.reduce((s, c) => s + Number(c.amount), 0)
  const snoozed = Date.now() < snoozeUntil && !open

  const snooze = () => {
    const until = Date.now() + 10 * 60_000
    setSnoozeUntil(until)
    try { sessionStorage.setItem(SNOOZE_KEY, String(until)) } catch { /* private mode */ }
    setOpen(false)
  }

  async function snap(c: Charge, file: File) {
    if (!c.token) { setMsg('This charge has no capture link — snap it from the Receipts page.'); return }
    setBusy(c.id); setMsg(null)
    try {
      const form = new FormData()
      form.set('photo', file)
      if (fix) { form.set('lat', String(fix.lat)); form.set('lng', String(fix.lng)); form.set('fix_src', 'gps'); if (fix.acc != null) form.set('acc', String(Math.round(fix.acc))) }
      const res = await fetch(`/api/r/${c.token}`, { method: 'POST', body: form })
      const j = await res.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!res.ok || !j.ok) throw new Error(j.error || 'Upload failed — try again.')
      setMsg(`Got it — the ${money(c.amount)} receipt is filed.`)
      window.dispatchEvent(new CustomEvent('ht:receipt-captured'))
      await load()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Upload failed — try again.')
    } finally {
      setBusy(null)
    }
  }

  async function noReceipt(c: Charge) {
    const note = window.prompt(`No receipt for ${money(c.amount)}${c.merchant ? ` at ${c.merchant}` : ''}? Say why — the office will see it.`)
    if (note == null) return
    setBusy(c.id); setMsg(null)
    try {
      const res = await fetch('/api/receipts/mine', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: c.id, action: 'no_receipt', note }) })
      const j = await res.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!res.ok || !j.ok) throw new Error(j.error || 'Could not close it.')
      await load()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not close it.')
    } finally {
      setBusy(null)
    }
  }

  // On the map: under the floating top bar, clear of the right-hand control
  // rail (64 px on phones, 76 on desktop), and BELOW the drawers/sheets
  // (z 10+) so an open Layers tray covers it instead of the reverse.
  const wrap = edge
    ? 'fixed left-2 right-[64px] md:left-auto md:right-[76px] md:w-[400px] z-[8] pointer-events-none'
    : 'relative w-full z-[5] shrink-0'
  const wrapStyle = edge ? { top: 'calc(var(--ht-safe-top, 0px) + 62px)' } : undefined

  return (
    <div className={wrap} style={wrapStyle} data-receipt-nag>
      {snoozed ? (
        <div className="flex justify-end pointer-events-auto">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`${charges.length} receipts still need a photo`}
            className={'inline-flex items-center gap-1.5 rounded-full bg-amber text-[#1a1100] font-display font-bold text-[12px] px-3 py-1.5 shadow-panel ' + (edge ? '' : 'mt-2 mr-2')}
          >
            🧾 {charges.length}
          </button>
        </div>
      ) : (
        <div className={'pointer-events-auto bg-amber text-[#1a1100] shadow-panel ' + (edge ? 'rounded-xl' : 'md:rounded-none')}>
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="text-base leading-none">🧾</span>
            <button type="button" onClick={() => setOpen((o) => !o)} className="flex-1 min-w-0 text-left">
              <span className="block font-display font-bold text-[13px] leading-tight truncate">
                {charges.length === 1 ? 'A receipt needs your photo' : `${charges.length} receipts need your photo`} · {money(total)}
              </span>
              <span className="block text-[11px] leading-tight opacity-80 truncate">
                {charges[0].merchant ?? (charges[0].last4 ? `card …${charges[0].last4}` : 'card swipe')} · {ago(charges[0].created_at)}{charges.length > 1 ? ` · +${charges.length - 1} more` : ''}
              </span>
            </button>
            <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-lg bg-[#1a1100] text-amber font-display font-bold text-[12px] px-3 py-1.5 active:scale-95">
              {open ? 'Close' : 'Snap'}
            </button>
            <button type="button" onClick={snooze} aria-label="Hide for ten minutes" className="text-[11px] font-semibold opacity-70 hover:opacity-100 px-1">
              Later
            </button>
          </div>
          {open && (
            <div className="border-t border-[#1a1100]/15 bg-navy-950 text-ink rounded-b-xl max-h-[60vh] overflow-y-auto">
              {msg && <p className="px-3 py-2 text-[12px] text-teal border-b border-navy-800">{msg}</p>}
              <ul className="divide-y divide-navy-800">
                {charges.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold truncate">{money(c.amount)}{c.merchant ? <span className="text-muted font-normal"> at {c.merchant}</span> : null}</p>
                      <p className="text-[11px] text-faint">{c.last4 ? `card …${c.last4} · ` : ''}{ago(c.created_at)}{c.nag_level >= 5 ? ' · the owner can see this one' : ''}</p>
                    </div>
                    <input
                      ref={(el) => { inputs.current[c.id] = el }}
                      type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void snap(c, f); e.target.value = '' }}
                    />
                    <button
                      type="button" disabled={busy === c.id}
                      onClick={() => inputs.current[c.id]?.click()}
                      className="rounded-lg bg-amber text-[#1a1100] font-display font-bold text-[12px] px-3 py-1.5 disabled:opacity-40 active:scale-95"
                    >
                      {busy === c.id ? '…' : '📷 Snap'}
                    </button>
                    <button type="button" disabled={busy === c.id} onClick={() => noReceipt(c)} className="text-[11px] text-faint hover:text-ink px-1">
                      No receipt
                    </button>
                  </li>
                ))}
              </ul>
              <p className="px-3 py-2 text-[11px] text-faint">{fix ? '📍 Your location rides with the photo.' : 'Allow location and the receipt lands on the map beside the charge.'}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
