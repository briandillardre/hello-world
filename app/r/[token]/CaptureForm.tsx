'use client'

import { useRef, useState } from 'react'

/**
 * One-tap receipt capture: camera → optional job → done. Posts to
 * /api/r/[token]; the token scopes everything, no session involved.
 */
export function CaptureForm({ token, merchant, amount, last4, zones, suggestedJobId = null, vendorName = null }: {
  token: string
  merchant: string | null
  amount: number
  last4: string | null
  zones: { id: string; name: string }[]
  /** Vendor-handshake hints: the truck was at a vendor zone at swipe time. */
  suggestedJobId?: string | null
  vendorName?: string | null
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [zone, setZone] = useState(suggestedJobId && zones.some((z) => z.id === suggestedJobId) ? suggestedJobId : '')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const file = fileRef.current?.files?.[0]
    if (!file) { setError('Take the photo first.'); return }
    setBusy(true); setError(null)
    try {
      const form = new FormData()
      form.set('photo', file)
      if (zone) form.set('zone', zone)
      const res = await fetch(`/api/r/${token}`, { method: 'POST', body: form })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) throw new Error(j.error || 'Upload failed — try again.')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed — try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-teal/40 bg-navy-900 p-6 text-center">
        <p className="text-4xl mb-2">✅</p>
        <h1 className="font-display font-bold text-lg mb-1">Receipt captured</h1>
        <p className="text-sm text-muted">You&apos;re done — the office takes it from here.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-navy-800 bg-navy-900 p-5 space-y-4">
      <div>
        <h1 className="font-display font-bold text-xl">Snap the receipt</h1>
        <p className="text-sm text-muted mt-1">
          <span className="text-ink font-semibold">${amount.toFixed(2)}</span>
          {merchant && <> at <span className="text-ink font-semibold">{merchant}</span></>}
          {last4 && <span className="text-faint"> · card …{last4}</span>}
        </p>
        {vendorName && (
          <p className="text-[11.5px] text-teal mt-1">📍 Truck seen at {vendorName}{zone ? ' — job pre-filled from its last site' : ''}</p>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          setPreview(f ? URL.createObjectURL(f) : null)
          setError(null)
        }}
      />

      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Receipt" className="w-full rounded-xl border border-navy-700 max-h-80 object-contain bg-navy-950" />
      ) : null}

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="w-full rounded-xl border-2 border-dashed border-navy-600 bg-navy-950 py-5 text-sm font-semibold text-muted hover:border-amber hover:text-ink transition-colors"
      >
        📷 {preview ? 'Retake photo' : 'Open camera'}
      </button>

      {zones.length > 0 && (
        <label className="block">
          <span className="text-[11px] font-mono uppercase tracking-[0.12em] text-faint">Job (optional)</span>
          <select
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            className="mt-1 w-full rounded-lg bg-navy-950 border border-navy-700 px-3 py-2.5 text-sm text-ink"
          >
            <option value="">— pick the job it belongs to —</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </label>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="button"
        disabled={busy || !preview}
        onClick={submit}
        className="w-full rounded-xl bg-amber text-[#1a1100] font-display font-bold py-3 disabled:opacity-40"
      >
        {busy ? 'Uploading…' : 'Send it in'}
      </button>
    </div>
  )
}
