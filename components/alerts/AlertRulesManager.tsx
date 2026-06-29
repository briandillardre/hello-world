'use client'

import { useState, useTransition } from 'react'
import { Plus, Trash2, ShieldAlert, X } from 'lucide-react'
import type { AlertRule, AlertTrigger, Geofence, AssetWithLocation } from '@/lib/types'
import { createAlertRuleAction, toggleAlertRuleAction, deleteAlertRuleAction } from '@/lib/actions/alerts'

const TRIGGERS: { key: AlertTrigger; label: string; hint: string }[] = [
  { key: 'after_hours_movement', label: 'After-hours movement', hint: 'Theft alert — moves outside work hours' },
  { key: 'left_site', label: 'Left site', hint: 'Asset leaves the zone' },
  { key: 'exit', label: 'Exit zone', hint: 'Crosses out of the zone' },
  { key: 'enter', label: 'Enter zone', hint: 'Crosses into the zone' },
  { key: 'idle', label: 'Idle too long', hint: 'Sits idle past N minutes' },
]
const TRIGGER_LABEL = Object.fromEntries(TRIGGERS.map((t) => [t.key, t.label])) as Record<AlertTrigger, string>

interface Props {
  rules: AlertRule[]
  geofences: Geofence[]
  assets: AssetWithLocation[]
  editable: boolean
}

export function AlertRulesManager({ rules, geofences, assets, editable }: Props) {
  const [adding, setAdding] = useState(false)
  const fenceName = (id: string) => geofences.find((g) => g.id === id)?.name ?? 'Unknown zone'
  const assetName = (id: string | null) => (id ? assets.find((a) => a.id === id)?.name ?? 'Unknown asset' : null)

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold text-ink">Alert rules</h2>
        <span className="text-xs text-faint">{rules.length}</span>
        {editable && (
          <button onClick={() => setAdding((v) => !v)} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-xs px-3 py-1.5 hover:bg-amber-600">
            {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {adding ? 'Cancel' : 'New rule'}
          </button>
        )}
      </div>

      {adding && editable && (
        <NewRuleForm geofences={geofences} assets={assets} onDone={() => setAdding(false)} />
      )}

      {rules.length === 0 && !adding && (
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          No alert rules yet. {editable ? 'Add one to get notified about theft, left-site, idle, and zone crossings.' : 'Sign in to your company to manage rules.'}
        </p>
      )}

      {rules.map((r) => (
        <RuleRow
          key={r.id}
          rule={r}
          scope={`${fenceName(r.geofence_id)}${assetName(r.asset_id) ? ` · ${assetName(r.asset_id)}` : ' · all assets'}`}
          triggerLabel={TRIGGER_LABEL[r.trigger]}
          editable={editable}
        />
      ))}
    </div>
  )
}

function RuleRow({ rule, scope, triggerLabel, editable }: { rule: AlertRule; scope: string; triggerLabel: string; editable: boolean }) {
  const [pending, start] = useTransition()
  const [active, setActive] = useState(rule.active)

  const toggle = () => start(async () => { const next = !active; setActive(next); await toggleAlertRuleAction(rule.id, next) })
  const remove = () => start(async () => { if (confirm('Delete this alert rule?')) await deleteAlertRuleAction(rule.id) })

  return (
    <div className="bg-navy-900 rounded-xl border border-navy-800 p-4 flex items-center gap-3">
      <ShieldAlert className={'h-5 w-5 flex-none ' + (active ? 'text-amber' : 'text-faint')} />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-ink text-sm">{triggerLabel}{rule.trigger === 'idle' && rule.idle_minutes ? ` (${rule.idle_minutes}m)` : ''}</p>
        <p className="text-xs text-faint truncate">{scope}</p>
      </div>
      {editable && (
        <>
          <button onClick={toggle} disabled={pending} title={active ? 'Disable' : 'Enable'} className={'relative w-10 h-6 rounded-full transition-colors flex-none ' + (active ? 'bg-amber' : 'bg-navy-700')}>
            <span className={'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ' + (active ? 'left-[18px]' : 'left-0.5')} />
          </button>
          <button onClick={remove} disabled={pending} title="Delete" className="grid place-items-center w-8 h-8 rounded-lg text-faint hover:text-alert hover:bg-navy-800 flex-none">
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  )
}

function NewRuleForm({ geofences, assets, onDone }: { geofences: Geofence[]; assets: AssetWithLocation[]; onDone: () => void }) {
  const [geofenceId, setGeofenceId] = useState(geofences[0]?.id ?? '')
  const [assetId, setAssetId] = useState<string>('')
  const [trigger, setTrigger] = useState<AlertTrigger>('after_hours_movement')
  const [idle, setIdle] = useState(60)
  const [pending, start] = useTransition()

  const submit = () =>
    start(async () => {
      if (!geofenceId) return
      await createAlertRuleAction({
        geofence_id: geofenceId,
        asset_id: assetId || null,
        trigger,
        idle_minutes: trigger === 'idle' ? idle : null,
      })
      onDone()
    })

  const sel = 'w-full bg-navy-950 border border-navy-700 rounded-lg text-ink text-xs px-3 py-2 outline-none focus:border-amber'

  return (
    <div className="bg-navy-900 rounded-xl border border-amber/40 p-4 space-y-3">
      <div>
        <label className="font-mono text-[10px] uppercase tracking-wide text-faint">Trigger</label>
        <select value={trigger} onChange={(e) => setTrigger(e.target.value as AlertTrigger)} className={sel}>
          {TRIGGERS.map((t) => <option key={t.key} value={t.key}>{t.label} — {t.hint}</option>)}
        </select>
      </div>
      {trigger === 'idle' && (
        <div>
          <label className="font-mono text-[10px] uppercase tracking-wide text-faint">Idle minutes</label>
          <input type="number" min={5} value={idle} onChange={(e) => setIdle(Number(e.target.value))} className={sel} />
        </div>
      )}
      <div>
        <label className="font-mono text-[10px] uppercase tracking-wide text-faint">Zone</label>
        <select value={geofenceId} onChange={(e) => setGeofenceId(e.target.value)} className={sel}>
          {geofences.length === 0 && <option value="">No zones — draw one first</option>}
          {geofences.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      <div>
        <label className="font-mono text-[10px] uppercase tracking-wide text-faint">Asset (optional)</label>
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={sel}>
          <option value="">All assets in this zone</option>
          {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <button onClick={submit} disabled={pending || !geofenceId} className="w-full rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm py-2 hover:bg-amber-600 disabled:opacity-60">
        {pending ? 'Saving…' : 'Create rule'}
      </button>
    </div>
  )
}
