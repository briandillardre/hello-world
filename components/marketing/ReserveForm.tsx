'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import { createReservationAction } from '@/lib/actions/reserve'

export function ReserveForm() {
  const [company, setCompany] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [machines, setMachines] = useState('')
  const [tools, setTools] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const r = await createReservationAction({
      company, name, phone, email,
      machines: Number(machines) || 0, tools: Number(tools) || 0, website,
    })
    setBusy(false)
    if (r.ok) setDone(true)
    else setErr(r.error ?? 'Something went wrong — call or text Brian directly.')
  }

  if (done) {
    return (
      <div className="rounded-2xl bg-teal/10 border border-teal/40 p-6 text-center space-y-2">
        <div className="mx-auto w-10 h-10 rounded-full bg-teal/20 grid place-items-center"><Check className="h-5 w-5 text-teal" /></div>
        <p className="font-display font-bold text-ink text-[16px]">You&apos;re in line.</p>
        <p className="text-[13px] text-muted leading-relaxed">
          You&apos;ll get a call within a day or two to count your fleet, lock your
          founder pricing, and schedule your install with the next hardware batch.
        </p>
      </div>
    )
  }

  const field = 'w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2.5 text-sm text-ink placeholder:text-faint outline-none focus:border-amber'
  return (
    <form onSubmit={submit} className="space-y-3">
      <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name *" required className={field} />
      <div className="grid grid-cols-2 gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name *" required className={field} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Cell phone *" required type="tel" inputMode="tel" className={field} />
      </div>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" type="email" inputMode="email" className={field} />
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-[11px] font-mono text-faint">Trucks + machines</span>
          <input value={machines} onChange={(e) => setMachines(e.target.value)} placeholder="e.g. 8" inputMode="numeric" className={field} />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-mono text-faint">Tools worth tagging</span>
          <input value={tools} onChange={(e) => setTools(e.target.value)} placeholder="e.g. 15" inputMode="numeric" className={field} />
        </label>
      </div>
      {/* Honeypot — hidden from humans, irresistible to bots */}
      <input value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" placeholder="Website" />
      {err && <p className="text-[12px] text-amber">{err}</p>}
      <button
        type="submit" disabled={busy}
        className="w-full rounded-xl bg-amber text-[#1a1100] font-display font-bold text-[15px] py-3 hover:bg-amber-600 transition-colors disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Hold my spot'}
      </button>
      <p className="text-[11px] text-faint text-center leading-relaxed">
        No payment now. A refundable deposit holds your hardware when your batch
        is scheduled — you can back out any time before it ships.
      </p>
    </form>
  )
}
