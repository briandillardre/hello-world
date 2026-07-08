'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { updateCompanySettingsAction } from '@/lib/actions/company'
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
  editable: boolean
}

/** Editable company name + working hours. Work hours drive the after-hours
 *  theft alert, so this is operational, not cosmetic. */
export function CompanySettings({ name, plan, work_start, work_end, work_days, alert_phone, alert_email, editable }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [form, setForm] = useState({ name, work_start, work_end, work_days: [...work_days], alert_phone, alert_email })

  const toggleDay = (d: number) =>
    setForm((f) => ({ ...f, work_days: f.work_days.includes(d) ? f.work_days.filter((x) => x !== d) : [...f.work_days, d].sort() }))

  const save = async () => {
    setSaving(true); setErr(null)
    try {
      const ok = await updateCompanySettingsAction(form)
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
                <Input id="alert-phone" type="tel" placeholder="+18645551234" value={form.alert_phone} onChange={(e) => setForm((f) => ({ ...f, alert_phone: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="alert-email" className="text-xs">Alert email</Label>
                <Input id="alert-email" type="email" placeholder="you@company.com" value={form.alert_email} onChange={(e) => setForm((f) => ({ ...f, alert_email: e.target.value }))} />
              </div>
            </div>
            <p className="text-[11px] text-faint -mt-1">Where theft &amp; geofence alerts are sent. SMS requires the Twilio keys in your hosting env.</p>
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
