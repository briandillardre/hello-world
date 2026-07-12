'use client'

import { useState } from 'react'
import { Check, StickyNote } from 'lucide-react'
import { saveZoneNotesAction } from '@/lib/actions/geofences'

/**
 * Open-ended zone notes — gate codes, ground conditions, "GC is picky about
 * the entrance." The AI reads these when answering about the site, so what
 * you type here becomes something you can ask about later.
 */
export function ZoneNotes({ id, initial }: { id: string; initial: string }) {
  const [notes, setNotes] = useState(initial)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = notes.trim() !== initial.trim()

  const save = async () => {
    setSaving(true)
    setError(null)
    const res = await saveZoneNotesAction(id, notes)
    setSaving(false)
    if (!res.ok) { setError(res.error ?? 'Could not save.'); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <section>
      <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2 flex items-center gap-1.5">
        <StickyNote className="h-3.5 w-3.5 text-teal" /> Notes
      </h2>
      <div className="rounded-xl border border-navy-800 bg-navy-900 p-3 space-y-2">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything worth remembering — gate code, ground conditions, contacts, quirks. The AI reads these."
          className="w-full bg-navy-950 border border-navy-700 rounded-lg px-3 py-2 text-[13px] text-ink placeholder:text-faint outline-none focus:border-amber/50 resize-y"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="rounded-lg bg-teal/15 border border-teal/40 text-teal text-[12px] font-semibold px-3 py-1.5 disabled:opacity-40 hover:bg-teal/25 transition-colors"
          >
            {saving ? 'Saving…' : saved ? <span className="flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Saved</span> : 'Save notes'}
          </button>
          {error && <span className="text-[11.5px] text-alert">{error}</span>}
        </div>
      </div>
    </section>
  )
}
