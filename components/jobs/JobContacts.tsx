'use client'

/**
 * Who's who on the job: the GC's PM and superintendent, the owner's rep, the
 * engineer, the surveyor, suppliers, inspectors. Tap a number to call, an
 * address to write — the hand-off to the crew carries every contact.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Phone, Mail, Pencil, Trash2, Plus } from 'lucide-react'
import { CONTACT_ROLES, CONTACT_WORDS, type Contact, type ContactRole } from '@/lib/jobs/job'
import { deleteContactAction, saveContactAction } from '@/lib/actions/jobs'

type Draft = { id: string | null; role: ContactRole; companyName: string; name: string; email: string; phone: string; note: string }
const blank: Draft = { id: null, role: 'gc_pm', companyName: '', name: '', email: '', phone: '', note: '' }

export function JobContacts({ zoneId, contacts, canEdit }: { zoneId: string; contacts: Contact[]; canEdit: boolean }) {
  const router = useRouter()
  const [d, setD] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const order = (c: Contact) => CONTACT_ROLES.indexOf(c.role)
  const list = [...contacts].sort((a, b) => order(a) - order(b))

  async function save() {
    if (!d) return
    setBusy(true); setErr(null)
    const r = await saveContactAction(zoneId, d, d.id).catch(() => null)
    setBusy(false)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t save — try again.'); return }
    setD(null); router.refresh()
  }
  async function remove(c: Contact) {
    if (!window.confirm(`Remove ${c.name || c.companyName}?`)) return
    const r = await deleteContactAction(c.id).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t remove it — try again.'); return }
    router.refresh()
  }
  const inp = 'w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink outline-none text-[13px]'

  return (
    <div className="space-y-2 text-[12.5px]">
      {!list.length && !d && <p className="text-faint">No contacts yet — the GC&apos;s project manager and superintendent, the engineer, the surveyor, the suppliers.</p>}
      {list.map((c) => (
        <div key={c.id} className="flex items-start gap-2 rounded-lg border border-navy-800 bg-navy-950/40 px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-ink truncate">{c.name || c.companyName}{c.name && c.companyName ? <span className="text-muted"> · {c.companyName}</span> : null}</p>
            <p className="text-[11.5px] text-faint">{CONTACT_WORDS[c.role]}{c.note ? ` · ${c.note}` : ''}</p>
            <p className="flex items-center gap-3 flex-wrap text-[12px]">
              {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 text-teal"><Phone className="h-3.5 w-3.5" /> {c.phone}</a>}
              {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-teal truncate"><Mail className="h-3.5 w-3.5" /> {c.email}</a>}
            </p>
          </div>
          {canEdit && (
            <div className="flex items-center gap-0.5 flex-none">
              <button type="button" aria-label="Edit" onClick={() => setD({ id: c.id, role: c.role, companyName: c.companyName ?? '', name: c.name ?? '', email: c.email ?? '', phone: c.phone ?? '', note: c.note ?? '' })} className="rounded p-1 text-faint hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" aria-label="Remove" onClick={() => void remove(c)} className="rounded p-1 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </div>
      ))}
      {d && (
        <div className="rounded-lg border border-navy-700 bg-navy-900 p-2.5 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select className={inp} value={d.role} onChange={(e) => setD({ ...d, role: e.target.value as ContactRole })}>
              {CONTACT_ROLES.map((r) => <option key={r} value={r}>{CONTACT_WORDS[r]}</option>)}
            </select>
            <input className={inp} placeholder="Company" value={d.companyName} onChange={(e) => setD({ ...d, companyName: e.target.value })} maxLength={120} />
            <input className={inp} placeholder="Name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={120} />
            <input className={inp} placeholder="Phone" inputMode="tel" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} maxLength={40} />
            <input className={inp} placeholder="Email" inputMode="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} maxLength={200} />
            <input className={inp} placeholder="Note" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} maxLength={300} />
          </div>
          {err && <p className="text-red-300">{err}</p>}
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={() => void save()} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => { setD(null); setErr(null) }} className="rounded-xl border border-navy-700 px-3 py-1.5 text-muted">Cancel</button>
          </div>
        </div>
      )}
      {canEdit && !d && <button type="button" onClick={() => setD({ ...blank })} className="inline-flex items-center gap-1 text-teal"><Plus className="h-3.5 w-3.5" /> Add a contact</button>}
      {err && !d && <p className="text-red-300">{err}</p>}
    </div>
  )
}
