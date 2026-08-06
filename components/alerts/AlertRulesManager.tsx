'use client'

/**
 * Alert rules, redesigned around how an owner actually thinks ("the current
 * rules page is a mess — not understandable", Jul 31):
 *
 *  1. A PROTECTION MATRIX — zones down, protections across, one tap per cell,
 *     column headers flip a whole protection on/off for every zone at once.
 *     35 flat rows become ~9 readable ones.
 *  2. SPECIAL RULES — anything scoped to one asset or carrying custom tuning
 *     (speed limit, watch window) reads as a plain sentence with inline edit.
 *  3. A CUSTOM RULE builder with real parameters: idle minutes, speed limit,
 *     a custom watch window (nights/weekends), and "text me" escalation.
 */

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Plus, Trash2, X, Moon, DoorOpen, ArrowLeftRight, Timer, Gauge, MessageSquareWarning, Pencil, Check } from 'lucide-react'
import type { AlertRule, AlertRuleParams, AlertTrigger, Geofence, AssetWithLocation } from '@/lib/types'
import {
  createAlertRuleAction, toggleAlertRuleAction, deleteAlertRuleAction,
  updateAlertRuleAction, bulkZoneRulesAction,
} from '@/lib/actions/alerts'

type MatrixCol = 'after_hours_movement' | 'left_site' | 'inout' | 'idle'

const COLS: { key: MatrixCol; label: string; icon: typeof Moon; hint: string; texts: boolean }[] = [
  { key: 'after_hours_movement', label: 'Theft watch', icon: Moon, hint: 'Moves outside work hours → texts you', texts: true },
  { key: 'left_site', label: 'Left site', icon: DoorOpen, hint: 'Drives out of the zone → texts you', texts: true },
  { key: 'inout', label: 'In/out log', icon: ArrowLeftRight, hint: 'Logs arrivals & departures (site log, zone history) — quiet', texts: false },
  { key: 'idle', label: 'Idle', icon: Timer, hint: 'Sitting 60+ minutes → flagged in alerts', texts: false },
]

const TRIGGER_WORDS: Record<AlertTrigger, string> = {
  after_hours_movement: 'moves after hours',
  left_site: 'leaves',
  enter: 'arrives at',
  exit: 'departs',
  idle: 'sits idle at',
  speeding: 'speeds in',
}

const DAY_CHIPS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** Rules the matrix owns: zone-wide, core trigger, no custom tuning. */
function isMatrixRule(r: AlertRule): boolean {
  if (r.asset_id) return false
  if (r.trigger === 'speeding') return false
  const p = r.params ?? {}
  return !p.start && !p.max_mph
}

export function AlertRulesManager({ rules, geofences, assets, editable }: {
  rules: AlertRule[]
  geofences: Geofence[]
  assets: AssetWithLocation[]
  editable: boolean
}) {
  // Local mirror so taps feel instant; server revalidation resyncs via props.
  const [local, setLocal] = useState(rules)
  useEffect(() => setLocal(rules), [rules])
  const [pending, start] = useTransition()
  const [adding, setAdding] = useState(false)

  // Personal zones never fire alerts — keep them out of the grid entirely.
  const zones = useMemo(() => geofences.filter((g) => !g.owner_id), [geofences])
  const zoneName = (id: string) => geofences.find((g) => g.id === id)?.name ?? 'Unknown zone'
  const assetName = (id: string | null) => (id ? assets.find((a) => a.id === id)?.name ?? 'Unknown asset' : null)

  const matrixRules = local.filter(isMatrixRule)
  const specialRules = local.filter((r) => !isMatrixRule(r))

  const cellRules = (zoneId: string, col: MatrixCol): AlertRule[] => {
    const trigs: AlertTrigger[] = col === 'inout' ? ['enter', 'exit'] : [col]
    return matrixRules.filter((r) => r.geofence_id === zoneId && trigs.includes(r.trigger))
  }
  type CellState = 'on' | 'off' | 'none'
  const cellState = (zoneId: string, col: MatrixCol): CellState => {
    const rs = cellRules(zoneId, col)
    if (!rs.length) return 'none'
    return rs.some((r) => r.active) ? 'on' : 'off'
  }

  /** Optimistically flip a cell locally, then let the server catch up. */
  const applyLocal = (zoneIds: string[], col: MatrixCol, on: boolean) => {
    const trigs: AlertTrigger[] = col === 'inout' ? ['enter', 'exit'] : [col]
    setLocal((prev) => {
      let next = prev.map((r) =>
        !r.asset_id && zoneIds.includes(r.geofence_id) && trigs.includes(r.trigger) && isMatrixRule(r)
          ? { ...r, active: on }
          : r
      )
      if (on) {
        for (const z of zoneIds) {
          for (const t of trigs) {
            if (!next.some((r) => !r.asset_id && r.geofence_id === z && r.trigger === t && isMatrixRule(r))) {
              next = [...next, {
                id: `tmp-${z}-${t}`, company_id: '', geofence_id: z, asset_id: null,
                trigger: t, idle_minutes: t === 'idle' ? 60 : null, active: true,
              }]
            }
          }
        }
      }
      return next
    })
  }

  const setCell = (zoneId: string, col: MatrixCol) => {
    if (!editable) return
    const on = cellState(zoneId, col) !== 'on'
    applyLocal([zoneId], col, on)
    start(async () => {
      const trigs: AlertTrigger[] = col === 'inout' ? ['enter', 'exit'] : [col]
      for (const t of trigs) await bulkZoneRulesAction([zoneId], t, on)
    })
  }

  const setColumn = (col: MatrixCol) => {
    if (!editable || !zones.length) return
    const on = !zones.every((z) => cellState(z.id, col) === 'on')
    const ids = zones.map((z) => z.id)
    applyLocal(ids, col, on)
    start(async () => {
      const trigs: AlertTrigger[] = col === 'inout' ? ['enter', 'exit'] : [col]
      for (const t of trigs) await bulkZoneRulesAction(ids, t, on)
    })
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start gap-2 flex-wrap">
        <div>
          <h2 className="font-semibold text-ink">Alert rules</h2>
          <p className="text-xs text-faint mt-0.5 max-w-md">
            Each cell is one protection on one zone. <span className="text-muted">Theft watch and Left site text you</span>;
            In/out and Idle just log. Tap a column header to set every zone at once.
          </p>
        </div>
        {editable && (
          <button onClick={() => setAdding((v) => !v)} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-xs px-3 py-1.5 hover:bg-amber-600">
            {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {adding ? 'Cancel' : 'Custom rule'}
          </button>
        )}
      </div>

      {adding && editable && (
        <CustomRuleForm geofences={zones} assets={assets} onDone={() => setAdding(false)} />
      )}

      {zones.length === 0 ? (
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          Draw a zone on the map first — rules watch zones.
        </p>
      ) : (
        <>
        {/* Cell-state legend — the desktop tooltips don't exist on touch. */}
        <p className="mb-1.5 font-mono text-[10.5px] text-faint flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="inline-grid place-items-center w-4 h-4 rounded-full border border-dashed border-navy-600 text-navy-500 text-[9px] leading-none">+</span> not set</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-teal/50" /> paused</span>
          <span className="flex items-center gap-1 text-amber/90">✓ on</span>
          <span className="text-faint/70">· tap a cell to cycle</span>
        </p>
        <div className="rounded-xl border border-navy-800 bg-navy-900 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-800">
                <th className="text-left font-medium text-faint text-xs px-3 py-2 min-w-[130px]">Zone</th>
                {COLS.map(({ key, label, icon: Icon, hint, texts }) => {
                  const allOn = zones.every((z) => cellState(z.id, key) === 'on')
                  return (
                    <th key={key} className="px-1.5 py-2 text-center min-w-[74px]">
                      <button
                        onClick={() => setColumn(key)}
                        disabled={!editable}
                        title={`${hint}${editable ? ` — tap to turn ${allOn ? 'OFF' : 'ON'} for all zones` : ''}`}
                        className={'inline-flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 transition-colors ' + (editable ? 'hover:bg-navy-800' : '')}
                      >
                        <Icon className={'h-3.5 w-3.5 ' + (texts ? 'text-amber' : 'text-teal')} />
                        <span className="text-[10px] font-semibold text-muted leading-none">{label}</span>
                        {editable && <span className="text-[9px] font-mono text-faint leading-none">{allOn ? 'all on' : 'set all'}</span>}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id} className="border-b border-navy-800/60 last:border-0">
                  <td className="px-3 py-1.5">
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full flex-none" style={{ background: z.color }} />
                      <span className="text-[12.5px] text-muted truncate max-w-[160px]">{z.name}</span>
                    </span>
                  </td>
                  {COLS.map(({ key }) => {
                    const st = cellState(z.id, key)
                    const idleMin = key === 'idle' ? cellRules(z.id, 'idle')[0]?.idle_minutes : null
                    return (
                      <td key={key} className="px-1.5 py-1.5 text-center">
                        <button
                          onClick={() => setCell(z.id, key)}
                          disabled={!editable || pending}
                          title={st === 'on' ? 'On — tap to pause' : st === 'off' ? 'Paused — tap to enable' : 'Not set — tap to protect'}
                          className={
                            'inline-flex items-center justify-center w-9 h-6 rounded-full border transition-colors ' +
                            (st === 'on'
                              ? 'bg-amber/20 border-amber/50 text-amber'
                              : st === 'off'
                                ? 'bg-navy-800 border-navy-700 text-faint'
                                : 'border-dashed border-navy-700 text-navy-700 hover:text-faint')
                          }
                        >
                          {st === 'on' ? (
                            <span className="inline-flex items-center gap-0.5 text-[9.5px] font-mono font-bold">
                              <Check className="h-3 w-3" />{key === 'idle' && idleMin ? `${idleMin}m` : ''}
                            </span>
                          ) : st === 'off' ? (
                            <span className="w-2 h-2 rounded-full bg-navy-600" />
                          ) : (
                            <Plus className="h-3 w-3" />
                          )}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Special rules — one asset, custom windows, speed limits */}
      {specialRules.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-faint uppercase tracking-wider">Special rules</h3>
          {specialRules.map((r) => (
            <SpecialRuleRow key={r.id} rule={r} zoneName={zoneName(r.geofence_id)} assetName={assetName(r.asset_id)} editable={editable} />
          ))}
        </div>
      )}
    </div>
  )
}

/** "CAT 336 leaves Equipment Yard — texts you" style sentence for one rule. */
function ruleSentence(r: AlertRule, zone: string, asset: string | null): string {
  const who = asset ?? 'Anything'
  const p = r.params ?? {}
  if (r.trigger === 'speeding') return `${who} over ${p.max_mph ?? '?'} mph in ${zone}`
  if (r.trigger === 'after_hours_movement' && p.start && p.end) {
    const days = p.days?.length ? ` (${p.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(' ')})` : ''
    return `${who} moves ${p.start}–${p.end}${days} near ${zone}`
  }
  if (r.trigger === 'idle') return `${who} sits idle ${r.idle_minutes ?? 60}+ min at ${zone}`
  return `${who} ${TRIGGER_WORDS[r.trigger]} ${zone}`
}

function SpecialRuleRow({ rule, zoneName, assetName, editable }: {
  rule: AlertRule
  zoneName: string
  assetName: string | null
  editable: boolean
}) {
  const [pending, start] = useTransition()
  const [active, setActive] = useState(rule.active)
  const [editing, setEditing] = useState(false)
  const [mph, setMph] = useState(rule.params?.max_mph ?? 45)
  const [idleMin, setIdleMin] = useState(rule.idle_minutes ?? 60)

  const texts = rule.trigger === 'after_hours_movement' || rule.trigger === 'left_site' || !!rule.params?.critical
  const toggle = () => start(async () => { const next = !active; setActive(next); await toggleAlertRuleAction(rule.id, next) })
  const remove = () => start(async () => { if (confirm('Delete this rule?')) await deleteAlertRuleAction(rule.id) })
  const saveTuning = () => start(async () => {
    if (rule.trigger === 'speeding') await updateAlertRuleAction(rule.id, { params: { ...(rule.params ?? {}), max_mph: mph } })
    if (rule.trigger === 'idle') await updateAlertRuleAction(rule.id, { idle_minutes: idleMin })
    setEditing(false)
  })

  const Icon = rule.trigger === 'speeding' ? Gauge : rule.trigger === 'idle' ? Timer : rule.trigger === 'after_hours_movement' ? Moon : DoorOpen

  return (
    <div className="bg-navy-900 rounded-xl border border-navy-800 px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon className={'h-4 w-4 flex-none ' + (active ? 'text-amber' : 'text-faint')} />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-ink truncate">{ruleSentence(rule, zoneName, assetName)}</p>
          <p className="text-[10.5px] text-faint flex items-center gap-1">
            {texts && <><MessageSquareWarning className="h-3 w-3 text-amber" /> texts you · </>}{active ? 'on' : 'paused'}
          </p>
        </div>
        {editable && (
          <>
            {(rule.trigger === 'speeding' || rule.trigger === 'idle') && (
              <button onClick={() => setEditing((v) => !v)} title="Adjust" className="grid place-items-center w-8 h-8 rounded-lg text-faint hover:text-ink hover:bg-navy-800 flex-none">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            <button onClick={toggle} disabled={pending} title={active ? 'Pause' : 'Enable'} className={'relative w-10 h-6 rounded-full transition-colors flex-none ' + (active ? 'bg-amber' : 'bg-navy-700')}>
              <span className={'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ' + (active ? 'left-[18px]' : 'left-0.5')} />
            </button>
            <button onClick={remove} disabled={pending} title="Delete" className="grid place-items-center w-8 h-8 rounded-lg text-faint hover:text-alert hover:bg-navy-800 flex-none">
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
      {editing && (
        <div className="mt-2 flex items-center gap-2 pl-7">
          {rule.trigger === 'speeding' ? (
            <>
              <label className="text-[11px] text-faint">Limit</label>
              <input type="number" min={5} max={90} value={mph} onChange={(e) => setMph(Number(e.target.value))}
                className="w-16 bg-navy-950 border border-navy-700 rounded-lg text-ink text-xs px-2 py-1 outline-none focus:border-amber" />
              <span className="text-[11px] text-faint">mph</span>
            </>
          ) : (
            <>
              <label className="text-[11px] text-faint">Idle</label>
              <input type="number" min={5} value={idleMin} onChange={(e) => setIdleMin(Number(e.target.value))}
                className="w-16 bg-navy-950 border border-navy-700 rounded-lg text-ink text-xs px-2 py-1 outline-none focus:border-amber" />
              <span className="text-[11px] text-faint">minutes</span>
            </>
          )}
          <button onClick={saveTuning} disabled={pending} className="rounded-lg bg-amber text-[#1a1100] font-bold text-[11px] px-2.5 py-1 hover:bg-amber-600">Save</button>
        </div>
      )}
    </div>
  )
}

const BUILDER_TRIGGERS: { key: AlertTrigger; label: string; hint: string }[] = [
  { key: 'after_hours_movement', label: 'Theft watch', hint: 'movement during quiet hours — texts you' },
  { key: 'left_site', label: 'Left site', hint: 'drives out of the zone — texts you' },
  { key: 'enter', label: 'Arrived', hint: 'shows up inside the zone' },
  { key: 'idle', label: 'Idle too long', hint: 'sits still past your limit' },
  { key: 'speeding', label: 'Speeding', hint: 'over a speed limit inside the zone' },
]

function CustomRuleForm({ geofences, assets, onDone }: {
  geofences: Geofence[]
  assets: AssetWithLocation[]
  onDone: () => void
}) {
  const [trigger, setTrigger] = useState<AlertTrigger>('after_hours_movement')
  const [geofenceId, setGeofenceId] = useState(geofences[0]?.id ?? '')
  const [assetId, setAssetId] = useState('')
  const [idle, setIdle] = useState(60)
  const [mph, setMph] = useState(45)
  const [customWindow, setCustomWindow] = useState(false)
  const [winStart, setWinStart] = useState('22:00')
  const [winEnd, setWinEnd] = useState('05:00')
  const [days, setDays] = useState<number[]>([])
  const [textMe, setTextMe] = useState(false)
  const [pending, start] = useTransition()

  const submit = () => start(async () => {
    if (!geofenceId) return
    const params: AlertRuleParams = {}
    if (trigger === 'speeding') params.max_mph = mph
    if (trigger === 'after_hours_movement' && customWindow) {
      params.start = winStart; params.end = winEnd
      if (days.length && days.length < 7) params.days = days
    }
    if (textMe && (trigger === 'enter' || trigger === 'idle' || trigger === 'speeding')) params.critical = true
    await createAlertRuleAction({
      geofence_id: geofenceId,
      asset_id: assetId || null,
      trigger,
      idle_minutes: trigger === 'idle' ? idle : null,
      params: Object.keys(params).length ? params : null,
    })
    onDone()
  })

  const sel = 'w-full bg-navy-950 border border-navy-700 rounded-lg text-ink text-xs px-3 py-2 outline-none focus:border-amber'
  const canText = trigger === 'enter' || trigger === 'idle' || trigger === 'speeding'

  return (
    <div className="bg-navy-900 rounded-xl border border-amber/40 p-4 space-y-3">
      <div>
        <label className="font-mono text-[10px] uppercase tracking-wide text-faint">When…</label>
        <select value={trigger} onChange={(e) => setTrigger(e.target.value as AlertTrigger)} className={sel}>
          {BUILDER_TRIGGERS.map((t) => <option key={t.key} value={t.key}>{t.label} — {t.hint}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="font-mono text-[10px] uppercase tracking-wide text-faint">Zone</label>
          <select value={geofenceId} onChange={(e) => setGeofenceId(e.target.value)} className={sel}>
            {geofences.length === 0 && <option value="">No zones — draw one first</option>}
            {geofences.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-wide text-faint">Which asset</label>
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={sel}>
            <option value="">All assets</option>
            {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      {trigger === 'idle' && (
        <div>
          <label className="font-mono text-[10px] uppercase tracking-wide text-faint">Idle minutes</label>
          <input type="number" min={5} value={idle} onChange={(e) => setIdle(Number(e.target.value))} className={sel} />
        </div>
      )}
      {trigger === 'speeding' && (
        <div>
          <label className="font-mono text-[10px] uppercase tracking-wide text-faint">Speed limit (mph, inside this zone)</label>
          <input type="number" min={5} max={90} value={mph} onChange={(e) => setMph(Number(e.target.value))} className={sel} />
        </div>
      )}
      {trigger === 'after_hours_movement' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={customWindow} onChange={(e) => setCustomWindow(e.target.checked)} className="accent-amber" />
            Custom watch window <span className="text-faint">(default: outside company work hours)</span>
          </label>
          {customWindow && (
            <div className="pl-6 space-y-2">
              <div className="flex items-center gap-2">
                <input type="time" value={winStart} onChange={(e) => setWinStart(e.target.value)} className="bg-navy-950 border border-navy-700 rounded-lg text-ink text-xs px-2 py-1.5 outline-none focus:border-amber" />
                <span className="text-xs text-faint">to</span>
                <input type="time" value={winEnd} onChange={(e) => setWinEnd(e.target.value)} className="bg-navy-950 border border-navy-700 rounded-lg text-ink text-xs px-2 py-1.5 outline-none focus:border-amber" />
                <span className="text-[10.5px] text-faint">wraps midnight fine</span>
              </div>
              <div className="flex items-center gap-1">
                {DAY_CHIPS.map((d, i) => (
                  <button key={i} type="button"
                    onClick={() => setDays((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i])}
                    className={'w-6 h-6 rounded-full text-[10px] font-bold transition-colors ' + (days.includes(i) || days.length === 0 ? 'bg-amber/20 text-amber' : 'bg-navy-800 text-faint')}
                    title={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]}
                  >{d}</button>
                ))}
                <span className="text-[10px] text-faint ml-1">{days.length === 0 ? 'every day' : 'watch these days'}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {canText && (
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={textMe} onChange={(e) => setTextMe(e.target.checked)} className="accent-amber" />
          <MessageSquareWarning className="h-3.5 w-3.5 text-amber" /> Text me when this fires (treat as critical)
        </label>
      )}

      <button onClick={submit} disabled={pending || !geofenceId} className="w-full rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm py-2 hover:bg-amber-600 disabled:opacity-60">
        {pending ? 'Saving…' : 'Create rule'}
      </button>
    </div>
  )
}
