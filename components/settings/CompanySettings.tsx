'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { updateCompanySettingsAction } from '@/lib/actions/company'
import { normalizeUsPhone } from '@/lib/phone'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Props {
  name: string
  plan: string
  work_start: string
  work_end: string
  work_days: number[]
  alert_phone: string
  alert_email: string
  /** Number SMS consent was recorded for (migration 041); null = never given. */
  sms_consent_phone?: string | null
  sms_consent_at?: string | null
  editable: boolean
}

/** Editable company name + working hours. Work hours drive the after-hours
 *  theft alert, so this is operational, not cosmetic. */
export function CompanySettings({ name, plan, work_start, work_end, work_days, alert_phone, alert_email, sms_consent_phone = null, sms_consent_at = null, editable }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [form, setForm] = useState({ name, work_start, work_end, work_days: [...work_days], alert_phone, alert_email })
  // Carrier rule: the box must be ticked by the user, never pre-checked. It
  // starts false every time the form opens; the only way past it is a click.
  const [smsConsent, setSmsConsent] = useState(false)

  const toggleDay = (d: number) =>
    setForm((f) => ({ ...f, work_days: f.work_days.includes(d) ? f.work_days.filter((x) => x !== d) : [...f.work_days, d].sort() }))

  // Consent already on file covers only the number it was given for. Change
  // the number and it must be granted again — that's what makes the stored
  // record meaningful rather than a one-time formality.
  const phoneEntered = !!form.alert_phone.trim()
  const normalizedPhone = normalizeUsPhone(form.alert_phone)
  const consentOnFile = !!sms_consent_at && !!normalizedPhone && sms_consent_phone === normalizedPhone
  const needsConsent = phoneEntered && !consentOnFile

  const save = async () => {
    if (phoneEntered && !normalizedPhone) {
      setErr("That phone number doesn't look right — a 10-digit US number like (864) 555-1234 works.")
      return
    }
    if (needsConsent && !smsConsent) {
      setErr('Tick the SMS consent box to save an alert phone number, or clear the number.')
      return
    }
    setSaving(true); setErr(null)
    try {
      const ok = await updateCompanySettingsAction({ ...form, sms_consent: smsConsent || consentOnFile })
      if (!ok) { setErr('Could not save. You may not have admin rights, or the database rejected it.'); return }
      setEditing(false)
      router.refresh()
    } catch { setErr('Could not save. Please try again.') }
    finally { setSaving(false) }
  }

  const hoursLabel = `${work_start}–${work_end} · ${work_days.map((d) => DAYS[d]).join(' ')}`

  return (
    <section className="bg-navy-900 rounded-xl border border-navy-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-navy-800 flex items-center gap-2">
        <h2 className="font-semibold text-sm text-muted">Company</h2>
        {editable && !editing && (
          <button onClick={() => setEditing(true)} className="ml-auto inline-flex items-center gap-1 text-xs text-teal hover:underline">
            <Pencil className="h-3 w-3" /> Edit
          </button>
        )}
      </div>
      <div className="p-4 space-y-3">
        {editing ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="co-name" className="text-xs">Company name</Label>
              <Input id="co-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Working hours <span className="text-faint font-normal">— outside these, movement triggers theft alerts</span></Label>
              <div className="flex items-center gap-2 mt-1">
                <Input type="time" value={form.work_start} onChange={(e) => setForm((f) => ({ ...f, work_start: e.target.value }))} className="w-32" />
                <span className="text-faint text-sm">to</span>
                <Input type="time" value={form.work_end} onChange={(e) => setForm((f) => ({ ...f, work_end: e.target.value }))} className="w-32" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Work days</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {DAYS.map((d, i) => (
                  <button
                    key={d} type="button" onClick={() => toggleDay(i)}
                    className={'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ' +
                      (form.work_days.includes(i) ? 'bg-amber/20 border-amber text-amber' : 'border-navy-700 text-faint hover:text-ink')}
                  >{d}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="alert-phone" className="text-xs">Alert phone (SMS)</Label>
                <Input id="alert-phone" type="tel" placeholder="(864) 555-1234" value={form.alert_phone} onChange={(e) => setForm((f) => ({ ...f, alert_phone: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="alert-email" className="text-xs">Alert email</Label>
                <Input id="alert-email" type="email" placeholder="you@company.com" value={form.alert_email} onChange={(e) => setForm((f) => ({ ...f, alert_email: e.target.value }))} />
              </div>
            </div>
            <p className="text-[11px] text-faint -mt-1 leading-snug">Where theft &amp; geofence alerts are sent.</p>

            {/* Carrier-required opt-in. The rule is explicit: the box must be
                ACTIVELY ticked, never pre-checked — so `smsConsent` starts
                false on every open and the save is gated on it. The wording
                here is quoted verbatim on the public /sms page; keep the two
                in sync, because that page is the evidence a reviewer reads. */}
            {needsConsent && (
              <label className="flex gap-2.5 items-start rounded-lg border border-amber/30 bg-amber/5 px-3 py-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smsConsent}
                  onChange={(e) => setSmsConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 flex-none accent-amber cursor-pointer"
                />
                <span className="text-[11.5px] text-muted leading-snug">
                  I agree to receive equipment and security alert text messages from HammerTrack at
                  the number above. Message frequency varies by alert activity. Message and data
                  rates may apply. Reply STOP to unsubscribe or HELP for help. See our{' '}
                  <a href="/sms" target="_blank" rel="noopener noreferrer" className="text-teal hover:underline">SMS alerts program</a>{' '}
                  and <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-teal hover:underline">privacy policy</a>.
                </span>
              </label>
            )}
            {consentOnFile && (
              <p className="text-[11px] text-teal/90 leading-snug">
                ✓ SMS consent on file for {sms_consent_phone} — recorded{' '}
                {sms_consent_at ? new Date(sms_consent_at).toLocaleDateString() : ''}. Changing the
                number requires agreeing again.
              </p>
            )}
            {err && <p className="text-xs text-alert">{err}</p>}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setEditing(false); setForm({ name, work_start, work_end, work_days: [...work_days], alert_phone, alert_email }) }} disabled={saving}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Row label="Company Name" value={name} />
            <Row label="Plan" value={<Badge>{plan}</Badge>} />
            <Row label="Working hours" value={<span className="font-mono text-xs">{hoursLabel}</span>} />
            <Row label="Alerts to" value={<span className="font-mono text-xs">{alert_phone || alert_email || '— not set'}</span>} />
            {!editable && <p className="text-xs text-faint">Sign in to a live account to edit company settings.</p>}
          </div>
        )}
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-medium text-muted">{value}</span>
    </div>
  )
}
