'use client'

/**
 * Crew cards and certifications: CDL medical cards, OSHA 10/30, flagger,
 * competent person… Each person sees and adds their own; Foreman and up see
 * the whole crew, soonest-to-run-out first, and add cards for the people
 * below them. A card that ran out is said plainly — a flagger whose card
 * lapsed last month is a citation waiting on the next inspection.
 */
import { useMemo, useState } from 'react'
import { IdCard } from 'lucide-react'
import { CREDENTIAL_KINDS, daysUntil, dueState, isDay } from '@/lib/beta/registers'
import type { BetaRecord } from '@/lib/db/beta'
import { useLang } from '@/lib/i18n'
import { AddButton, BetaPage, Notice, RecordEditor, RowActions, StatePill, card, fmtDay } from './ui'

type Opt = { id: string; name: string }
const label = (d: Record<string, unknown>) => (d.type === 'other' && d.other ? String(d.other) : CREDENTIAL_KINDS.find((k) => k.value === d.type)?.label ?? 'Card')

export function CredentialsView({ rows, people, addFor, me, today, demo, seesAll, canWrite, canRemoveAny }: {
  rows: BetaRecord[]; people: Opt[]; addFor: Opt[]; me: string | null; today: string; demo: boolean; seesAll: boolean; canWrite: boolean; canRemoveAny: boolean
}) {
  const { t } = useLang()
  const [editing, setEditing] = useState<BetaRecord | 'new' | null>(null)
  const [who, setWho] = useState('')
  const name = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people])
  const expiring = rows.filter((r) => { const s = dueState(r.dueOn, today, 60); return s === 'overdue' || s === 'soon' }).sort((a, b) => String(a.dueOn).localeCompare(String(b.dueOn)))
  const byPerson = new Map<string, BetaRecord[]>()
  for (const r of rows) if (r.personId) byPerson.set(r.personId, [...(byPerson.get(r.personId) ?? []), r])
  const ids = Array.from(byPerson.keys()).filter((id) => !who || id === who).sort((a, b) => (name.get(a) ?? '').localeCompare(name.get(b) ?? ''))
  const mine = rows.filter((r) => r.personId === me)

  return (
    <BetaPage title={seesAll ? 'Crew cards & certs' : t('My cards')} icon={<IdCard className="h-5 w-5 text-violet-300" />} demo={demo}
      blurb={seesAll ? 'Who holds which card, and what runs out next. Everyone can add their own from their phone; you can add them for your crew.' : t('Your cards and certifications. Add each one with its expiry — you’ll see it here before it runs out.')}>
      {canWrite && editing === null && <AddButton onClick={() => setEditing('new')}>{t('Add a card')}</AddButton>}
      {editing !== null && (
        <RecordEditor kind="credential" record={editing === 'new' ? null : editing} people={addFor} withMoney={false} onDone={() => setEditing(null)}
          fixed={!seesAll && me ? { personId: me } : {}} defaults={{}} />
      )}
      {seesAll && expiring.length > 0 && (
        <div className={`${card} space-y-1.5`}>
          <p className="font-semibold text-ink">Running out in the next 60 days</p>
          {expiring.map((r) => <Row key={r.id} r={r} who={name.get(r.personId ?? '') ?? 'Crew'} today={today} canWrite={canWrite} canRemove={canRemoveAny || r.personId === me} onEdit={() => setEditing(r)} t={t} />)}
        </div>
      )}
      {seesAll ? (
        <>
          <select className="rounded-lg border border-navy-700 bg-navy-950 px-2 py-2 text-ink text-[13px]" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {!ids.length && <Notice tone="info">No cards on file yet. Start with the ones an inspector asks for: CDL medical cards, flagger cards, the competent person on every trench.</Notice>}
          {ids.map((id) => (
            <div key={id} className={`${card} space-y-1.5`}>
              <p className="font-semibold text-ink">{name.get(id) ?? 'Crew'}</p>
              {byPerson.get(id)!.sort((a, b) => String(a.dueOn ?? '9').localeCompare(String(b.dueOn ?? '9'))).map((r) => <Row key={r.id} r={r} today={today} canWrite={canWrite} canRemove={canRemoveAny || r.personId === me} onEdit={() => setEditing(r)} t={t} />)}
            </div>
          ))}
        </>
      ) : (
        <div className={`${card} space-y-1.5`}>
          {!mine.length && <p className="text-faint">{t('Nothing yet.')}</p>}
          {mine.map((r) => <Row key={r.id} r={r} today={today} canWrite={canWrite} canRemove onEdit={() => setEditing(r)} t={t} />)}
        </div>
      )}
    </BetaPage>
  )
}

function Row({ r, who, today, canWrite, canRemove, onEdit, t }: { r: BetaRecord; who?: string; today: string; canWrite: boolean; canRemove: boolean; onEdit: () => void; t: (s: string) => string }) {
  const exp = isDay(r.data.expires) ? String(r.data.expires) : null
  const s = dueState(exp, today, 60)
  const left = exp ? daysUntil(today, exp) : null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-navy-800 pt-1.5 first:border-0 first:pt-0">
      <span className="min-w-0 text-ink">{label(r.data)}{who ? <span className="text-muted"> · {who}</span> : null}{r.data.number ? <span className="text-faint"> · #{String(r.data.number)}</span> : null}</span>
      <span className="flex items-center gap-2">
        <StatePill state={s === 'overdue' ? 'overdue' : s === 'soon' ? 'soon' : s === 'ok' ? 'ok' : 'none'}>
          {!exp ? t('Does not expire') : left! < 0 ? `${t('Expired')} ${fmtDay(exp)}` : `${t('Expires')} ${fmtDay(exp)}`}
        </StatePill>
        {canWrite && <RowActions id={r.id} onEdit={onEdit} canRemove={canRemove} />}
      </span>
    </div>
  )
}
