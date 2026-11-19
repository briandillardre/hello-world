'use client'

/**
 * What each machine really costs an hour: owning (depreciation, interest,
 * insurance and tax) plus operating (fuel, repairs, wear) — on the hours it
 * actually ran, from the hours ledger, not a guessed 1,500. Then the two
 * questions it answers: rent or own, keep or replace.
 */
import { useState } from 'react'
import { Gauge } from 'lucide-react'
import type { OwningResult } from '@/lib/beta/owning'
import type { BetaRecord } from '@/lib/db/beta'
import { BetaPage, Notice, RecordEditor, btn, card, money } from './ui'

export interface OwningRow {
  asset: { id: string; name: string; type: string }
  sheet: BetaRecord | null
  result: OwningResult | null
  measuredHours: number | null
  repairs12: number | null
  rate: number | null
}

const SOURCE = { measured: 'hours the ledger measured on sites and yards this past year', planned: 'the planned hours typed on the sheet', default: 'a default 1,200 hours — no ledger hours yet' }

export function OwningView({ rows, demo, canWrite }: { rows: OwningRow[]; demo: boolean; canWrite: boolean }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const set = rows.filter((r) => r.sheet)
  const unset = rows.filter((r) => !r.sheet)
  return (
    <BetaPage title="What a machine really costs" icon={<Gauge className="h-5 w-5 text-violet-300" />} demo={demo}
      blurb="Owning + operating cost per hour, on the hours each machine really ran. Use it to set the rate jobs are charged, and to decide rent vs own and keep vs replace.">
      {!set.length && <Notice tone="info">Start with your three most expensive machines: price, salvage, life, and what fuel and repairs run. The hours come from the ledger.</Notice>}
      <div className="space-y-2">
        {set.map((r) => <Machine key={r.asset.id} r={r} canWrite={canWrite} editing={editing === r.asset.id} onEdit={() => setEditing(r.asset.id)} onDone={() => setEditing(null)} />)}
      </div>
      {unset.length > 0 && (
        <div className={`${card} space-y-1.5`}>
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-ink">No cost sheet yet ({unset.length})</p>
            {unset.length > 8 && <button type="button" className={btn} onClick={() => setShowAll((v) => !v)}>{showAll ? 'Fewer' : 'All'}</button>}
          </div>
          {(showAll ? unset : unset.slice(0, 8)).map((r) => (
            <div key={r.asset.id} className="border-t border-navy-800 pt-1.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-ink min-w-0">{r.asset.name} <span className="text-faint text-[12px]">{r.measuredHours ? `· ${r.measuredHours.toLocaleString('en-US')} hrs this year` : ''}</span></span>
                {canWrite && editing !== r.asset.id && <button type="button" className={btn} onClick={() => setEditing(r.asset.id)}>Set up</button>}
              </div>
              {editing === r.asset.id && <RecordEditor kind="owning" fixed={{ assetId: r.asset.id }} withMoney onDone={() => setEditing(null)} defaults={{ lifeYears: 8, interestPct: 7, repairPct: 70 }} label={`Cost sheet · ${r.asset.name}`} />}
            </div>
          ))}
        </div>
      )}
    </BetaPage>
  )
}

function Machine({ r, canWrite, editing, onEdit, onDone }: { r: OwningRow; canWrite: boolean; editing: boolean; onEdit: () => void; onDone: () => void }) {
  const x = r.result
  return (
    <div className={`${card} space-y-2`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{r.asset.name}</p>
          {x && <p className="text-faint text-[12px]">On {x.hoursYear.toLocaleString('en-US')} hours a year — {SOURCE[x.hoursSource]}</p>}
        </div>
        <div className="text-right">
          <p className="font-display font-bold text-xl text-ink">{x ? `${money(x.total, true)}/hr` : '—'}</p>
          {canWrite && !editing && <button type="button" className={btn} onClick={onEdit}>Edit</button>}
        </div>
      </div>
      {editing && <RecordEditor kind="owning" record={r.sheet} fixed={{ assetId: r.asset.id }} withMoney onDone={onDone} label={`Cost sheet · ${r.asset.name}`} />}
      {x && (
        <div className="grid gap-2 sm:grid-cols-2">
          <table className="text-[12.5px] w-full">
            <tbody>
              <tr><td className="text-muted font-semibold" colSpan={2}>Owning {money(x.owning.total, true)}/hr</td></tr>
              <tr><td className="text-faint">Depreciation</td><td className="text-right text-ink">{money(x.owning.depreciation, true)}</td></tr>
              <tr><td className="text-faint">Interest</td><td className="text-right text-ink">{money(x.owning.interest, true)}</td></tr>
              <tr><td className="text-faint">Insurance, tax, storage</td><td className="text-right text-ink">{money(x.owning.insuranceTax, true)}</td></tr>
            </tbody>
          </table>
          <table className="text-[12.5px] w-full">
            <tbody>
              <tr><td className="text-muted font-semibold" colSpan={2}>Operating {money(x.operating.total, true)}/hr</td></tr>
              <tr><td className="text-faint">Fuel</td><td className="text-right text-ink">{money(x.operating.fuel, true)}</td></tr>
              <tr><td className="text-faint">Repairs (lifetime reserve)</td><td className="text-right text-ink">{money(x.operating.repairs, true)}</td></tr>
              <tr><td className="text-faint">Wear parts</td><td className="text-right text-ink">{money(x.operating.wear, true)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      {x?.rateWords && <Notice tone={/under its real cost/.test(x.rateWords) ? 'warn' : 'info'}>{x.rateWords}</Notice>}
      {x?.rentWords && <Notice tone="info">{x.rentWords}</Notice>}
      {x?.replaceWords && <Notice tone={/Replace-now/.test(x.replaceWords) ? 'warn' : 'good'}>{x.replaceWords}</Notice>}
      {x && r.repairs12 !== null && !x.replaceWords && <p className="text-faint text-[12px]">Repairs in the last 12 months: {money(r.repairs12)} — add what it would sell for to see keep-vs-replace.</p>}
    </div>
  )
}
