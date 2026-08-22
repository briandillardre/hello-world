'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Users } from 'lucide-react'
import { getQboTimeStatusAction, saveEmployeeMappingAction, type QboTimeStatus } from '@/lib/actions/qbo-time'

/**
 * Crew ↔ QBO employee mapping — the setup step for the timesheet push.
 * Map each HammerTrack worker to a QuickBooks employee here, then push each
 * day's GPS-verified hours from Daily logs (/logs) as TimeActivity rows so
 * payroll and job costing run off tracked time.
 */

export function QboTimeCard({ demo }: { demo: boolean }) {
  const [status, setStatus] = useState<QboTimeStatus | null>(null)
  const [loading, setLoading] = useState(!demo)
  const [saving, setSaving] = useState<string | null>(null)   // userId mid-save
  const [saved, setSaved] = useState<string | null>(null)     // userId just saved
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (demo) return
    let cancelled = false
    getQboTimeStatusAction()
      .then((s) => { if (!cancelled) setStatus(s) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [demo])

  const save = async (userId: string, qboEmployeeId: string) => {
    if (!status) return
    const name = status.employees.find((e) => e.id === qboEmployeeId)?.name ?? ''
    setSaving(userId)
    setSaved(null)
    setSaveError(null)
    // Optimistic — the select shows the new pick immediately.
    setStatus((s) => s && {
      ...s,
      mappings: qboEmployeeId
        ? { ...s.mappings, [userId]: qboEmployeeId }
        : Object.fromEntries(Object.entries(s.mappings).filter(([k]) => k !== userId)),
    })
    const r = await saveEmployeeMappingAction(userId, qboEmployeeId || null, name)
    setSaving(null)
    if ('error' in r) setSaveError(r.error)
    else setSaved(userId)
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-faint uppercase tracking-wider">Timesheets → QuickBooks Payroll</h2>
      <div className="bg-navy-900 rounded-xl border border-navy-800 p-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-lg bg-teal/15 flex items-center justify-center flex-shrink-0">
            <Users className="h-6 w-6 text-teal" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-ink">Crew → QuickBooks employees</p>
            <p className="text-xs text-faint">
              Map each worker once, then push each day&rsquo;s GPS-verified hours from Daily logs.
            </p>
          </div>
        </div>

        {demo && (
          <p className="mt-3 text-xs text-amber bg-amber/15 border border-amber/30 rounded-lg p-2">
            Demo connection. On a live account, clock-ins/outs push to QuickBooks as timesheet
            (TimeActivity) rows — employee, date, hours, and the job-site zone as the customer —
            so payroll and job costing run off tracked time.
          </p>
        )}

        {!demo && loading && (
          <div className="mt-3 flex items-center gap-2 py-4 text-faint text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking QuickBooks…
          </div>
        )}

        {!demo && !loading && status && (
          <>
            {status.error && (
              <p className="mt-3 text-xs text-amber bg-amber/15 border border-amber/30 rounded-lg p-2">{status.error}</p>
            )}
            {!status.error && !status.connected && (
              <p className="mt-3 text-xs text-amber bg-amber/15 border border-amber/30 rounded-lg p-2">
                QuickBooks isn&rsquo;t connected — connect it above, then map your crew here.
              </p>
            )}
            {!status.error && status.connected && status.workers.length === 0 && (
              <p className="mt-3 text-xs text-faint bg-navy-950 border border-navy-800 rounded-lg p-3">
                No crew profiles yet — teammates show up here once they join from the Team page.
              </p>
            )}
            {!status.error && status.connected && status.workers.length > 0 && status.employees.length === 0 && (
              <p className="mt-3 text-xs text-amber bg-amber/15 border border-amber/30 rounded-lg p-2">
                No active employees found in QuickBooks — add your crew under Payroll → Employees
                in QuickBooks first, then reload this page.
              </p>
            )}
            {!status.error && status.connected && status.workers.length > 0 && status.employees.length > 0 && (
              <div className="mt-3 rounded-lg border border-navy-800 divide-y divide-navy-800">
                {status.workers.map((w) => (
                  <div key={w.userId} className="p-3 flex items-center gap-3 text-sm">
                    <span className="flex-1 text-ink font-medium truncate">{w.name}</span>
                    <select
                      value={status.mappings[w.userId] ?? ''}
                      onChange={(e) => save(w.userId, e.target.value)}
                      disabled={saving === w.userId}
                      className="bg-navy-950 border border-navy-700 rounded-lg text-xs text-ink px-2 py-1.5 max-w-[55%] focus:outline-none focus:border-teal/60 disabled:opacity-60"
                    >
                      <option value="">Not mapped</option>
                      {status.employees.map((e) => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                    {saving === w.userId && <Loader2 className="h-3.5 w-3.5 animate-spin text-faint flex-shrink-0" />}
                    {saved === w.userId && saving !== w.userId && <Check className="h-4 w-4 text-[#34d399] flex-shrink-0" />}
                  </div>
                ))}
              </div>
            )}
            {saveError && (
              <p className="mt-2 text-xs text-alert bg-alert/10 border border-alert/30 rounded-lg p-2">{saveError}</p>
            )}
            {!status.error && status.connected && status.workers.length > 0 && status.employees.length > 0 && (
              <p className="mt-3 text-xs text-faint">
                Then open <span className="font-mono text-teal">/logs</span> and hit
                &ldquo;Push day&rdquo; on any day — each completed clock entry posts once (re-pushes
                skip what&rsquo;s already in QuickBooks).
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}
