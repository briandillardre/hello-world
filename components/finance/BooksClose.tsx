'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, RefreshCw } from 'lucide-react'
import { NO_REPLY } from '@/lib/action-reply'
import { CLOSE_STEPS, SIGN_ROLES, type CloseRecord, type SignRole, type StepTick } from '@/lib/books/close'
import { refreshBooksAction, signCloseAction, tickCloseStepAction } from '@/lib/actions/books'

const card = 'rounded-xl border border-navy-800 bg-navy-900/60 p-3'
const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** This month's close: tick each step (with a note), then sign it off. */
export function CloseChecklist({ month, monthLabel, record, canWrite, defaultName }: {
  month: string
  monthLabel: string
  record: CloseRecord | null
  canWrite: boolean
  defaultName: string
}) {
  const router = useRouter()
  const [items, setItems] = useState<Record<string, StepTick>>(record?.items ?? {})
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [role, setRole] = useState<SignRole>('owner')
  const [name, setName] = useState(defaultName)
  const signed = !!record?.signedAt
  const done = CLOSE_STEPS.filter((s) => items[s.key]).length
  const allDone = done === CLOSE_STEPS.length
  const locked = !canWrite || signed

  async function tick(key: string, on: boolean, withNote?: string) {
    if (locked || busy) return
    const prev = items
    const next = { ...items }
    if (on) next[key] = { by: null, name: defaultName, at: new Date().toISOString(), note: withNote ?? null }
    else delete next[key]
    setItems(next); setErr(null); setBusy(key)
    const r = await tickCloseStepAction(month, key, on, withNote ?? null).catch(() => undefined)
    setBusy(null)
    if (!r?.ok) { setItems(prev); setErr(r?.ok === false ? r.error : NO_REPLY); return }
    setNoteFor(null); setNote('')
    router.refresh()
  }

  async function sign() {
    if (locked || busy || !allDone) return
    setErr(null); setBusy('sign')
    const r = await signCloseAction(month, role, name).catch(() => undefined)
    setBusy(null)
    if (!r?.ok) { setErr(r?.ok === false ? r.error : NO_REPLY); return }
    router.refresh()
  }

  return (
    <div className={card + ' space-y-2'}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-semibold text-ink">{monthLabel} close</p>
        <p className="font-mono text-[12px] text-muted">{done} of {CLOSE_STEPS.length}</p>
      </div>
      <div className="h-1.5 rounded-full bg-navy-800" role="progressbar" aria-valuemin={0} aria-valuemax={CLOSE_STEPS.length} aria-valuenow={done}>
        <div className="h-1.5 rounded-full bg-teal" style={{ width: `${(done / CLOSE_STEPS.length) * 100}%` }} />
      </div>
      <ul className="divide-y divide-navy-800">
        {CLOSE_STEPS.map((s) => {
          const t = items[s.key]
          return (
            <li key={s.key} className="py-2">
              <div className="flex items-start gap-2.5">
                <button type="button" disabled={locked || busy !== null} onClick={() => tick(s.key, !t)} aria-pressed={!!t} aria-label={t ? `Untick: ${s.words}` : `Tick: ${s.words}`}
                  className={'mt-0.5 h-7 w-7 shrink-0 rounded-md border flex items-center justify-center ' + (t ? 'border-teal/60 bg-teal/20 text-teal' : 'border-navy-700 text-transparent') + (locked ? ' opacity-70' : '')}>
                  <Check className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className={'text-[13px] ' + (t ? 'text-ink' : 'text-muted')}>{s.words}</p>
                  <p className="text-[11.5px] text-faint">{s.why}</p>
                  {t && <p className="text-[11.5px] text-faint">✓ {t.name ?? 'Someone'} · {when(t.at)}{t.note ? ` · “${t.note}”` : ''}</p>}
                  {!t && !locked && (noteFor === s.key ? (
                    <div className="mt-1 flex gap-1.5">
                      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Note (optional) — e.g. “Chase ending 4410 off by $12, found it”"
                        className="min-w-0 flex-1 rounded-md border border-navy-700 bg-navy-950 px-2 py-1.5 text-[13px] text-ink" />
                      <button type="button" disabled={busy !== null} onClick={() => tick(s.key, true, note)} className="rounded-md border border-teal/50 bg-teal/15 px-2.5 text-[12px] text-teal">Tick</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => { setNoteFor(s.key); setNote('') }} className="mt-0.5 text-[11.5px] text-teal">Tick with a note</button>
                  ))}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {signed ? (
        <p className="rounded-lg border border-teal/40 bg-teal/10 p-2 text-[12.5px] text-teal">
          Signed off by {record!.signedName ?? 'someone'} ({SIGN_ROLES.find((r) => r.key === record!.signedRole)?.words ?? 'owner'}) · {when(record!.signedAt!)}
        </p>
      ) : canWrite ? (
        <div className="rounded-lg border border-navy-800 p-2 space-y-1.5">
          <p className="text-[12.5px] text-ink">Sign off the {monthLabel} books</p>
          <div className="flex flex-wrap gap-1">
            {SIGN_ROLES.map((r) => (
              <button key={r.key} type="button" onClick={() => setRole(r.key)} aria-pressed={role === r.key}
                className={'rounded-full border px-2.5 py-1 min-h-8 text-[12px] ' + (role === r.key ? 'border-teal/50 bg-teal/15 text-teal' : 'border-navy-700 text-muted')}>{r.words}</button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Name of the person signing" aria-label="Name of the person signing"
              className="min-w-0 flex-1 rounded-md border border-navy-700 bg-navy-950 px-2 py-1.5 text-[13px] text-ink" />
            <button type="button" disabled={!allDone || busy !== null || name.trim().length < 2} onClick={sign}
              className="rounded-md border border-amber/50 bg-amber/15 px-3 text-[12.5px] font-semibold text-amber disabled:opacity-50">{busy === 'sign' ? 'Signing…' : 'Sign off'}</button>
          </div>
          {!allDone && <p className="text-[11.5px] text-faint">Opens once every step is ticked.</p>}
        </div>
      ) : (
        <p className="text-[11.5px] text-faint">Read-only here.</p>
      )}
      {err && <p className="text-[12px] text-red-300">{err}</p>}
    </div>
  )
}

/** "Refresh from QuickBooks" — reads it now (once per 5 minutes). */
export function RefreshBooks({ disabled }: { disabled?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  async function go() {
    setBusy(true); setMsg(null)
    const r = await refreshBooksAction().catch(() => undefined)
    setBusy(false)
    if (!r?.ok) { setMsg({ ok: false, text: r?.ok === false ? r.error : NO_REPLY }); return }
    setMsg({ ok: true, text: r.missing.length ? `Read — but ${r.missing.join(', ')} didn’t come back.` : 'Read just now.' })
    router.refresh()
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={go} disabled={busy || disabled}
        className="inline-flex items-center gap-1.5 rounded-md border border-navy-700 px-3 py-1.5 min-h-9 text-[12.5px] text-ink disabled:opacity-50">
        <RefreshCw className={'h-3.5 w-3.5' + (busy ? ' animate-spin' : '')} /> {busy ? 'Reading QuickBooks…' : 'Refresh from QuickBooks'}
      </button>
      {msg && <span className={'text-[12px] ' + (msg.ok ? 'text-teal' : 'text-red-300')}>{msg.text}</span>}
    </div>
  )
}
