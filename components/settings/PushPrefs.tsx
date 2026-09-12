'use client'

import { useState, useTransition } from 'react'
import { BellRing, Check } from 'lucide-react'
import { savePersonNotifyAction, mutePersonPushAction } from '@/lib/actions/person-notify'
import { PUSH_KIND_META, allPushOff, type PersonNotifyPrefs, type PushKind } from '@/lib/person-notify'

/**
 * One person's phone switches (Brian, Sep 12: "the push need to be per person
 * and admins can go in to change this for people").
 *
 * Rendered twice with the same code: on Settings for yourself, and inside a
 * teammate's row on /team for an admin setting it on their behalf. `whose`
 * changes only the wording — the action re-checks the ladder server-side and
 * never trusts this component about who is allowed to do what.
 */
export function PushPrefs({
  userId,
  initial,
  whose = 'mine',
  firstName,
  compact = false,
  changedBy = null,
}: {
  userId: string
  initial: PersonNotifyPrefs
  whose?: 'mine' | 'theirs'
  firstName?: string
  /** Team-row rendering: no card chrome, tighter. */
  compact?: boolean
  /** Somebody else last set these — shown so an admin silencing a
   *  subordinate's alerts is never invisible to them (sec-check, Sep 12). */
  changedBy?: { name: string; at: string | null } | null
}) {
  const [p, setP] = useState(initial)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  /** Once I touch a switch myself, the "somebody else set these" note is stale. */
  const [touched, setTouched] = useState(false)
  const theirs = whose === 'theirs'
  const who = firstName || 'they'

  function apply(patch: Partial<Record<PushKind, boolean>>) {
    const prev = p
    setP({ ...p, ...patch })
    setSaved(false)
    setTouched(true)
    start(async () => {
      const r = await savePersonNotifyAction(userId, patch)
      if (r.ok && r.prefs) { setP(r.prefs); setError(null); setSaved(true); setTimeout(() => setSaved(false), 2200) }
      else { setError(r.error ?? 'Save failed'); setP(prev) }
    })
  }

  function muteAll() {
    const prev = p
    setP(Object.fromEntries(PUSH_KIND_META.map((k) => [k.key, false])) as PersonNotifyPrefs)
    setSaved(false)
    setTouched(true)
    start(async () => {
      const r = await mutePersonPushAction(userId)
      if (r.ok && r.prefs) { setP(r.prefs); setError(null); setSaved(true); setTimeout(() => setSaved(false), 2200) }
      else { setError(r.error ?? 'Save failed'); setP(prev) }
    })
  }

  const silent = allPushOff(p)
  const changedNote = changedBy && !touched
    ? `${changedBy.name} set these${changedBy.at ? ` on ${new Date(changedBy.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}. You can change them back.`
    : null

  const body = (
    <>
      {changedNote && (
        <p className="mb-3 rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 text-[11.5px] text-muted">{changedNote}</p>
      )}
      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}
      <div className="space-y-1.5">
        {PUSH_KIND_META.map(({ key, label, blurb, serious }) => {
          const on = p[key]
          // "My missing receipts" reads wrong when an admin is looking at
          // somebody else's phone.
          const title = key === 'receipts' && !theirs ? 'My missing receipts' : label
          return (
            <button
              key={key}
              type="button" role="switch" aria-checked={on} disabled={pending}
              onClick={() => apply({ [key]: !on })}
              className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60 ${
                on ? 'border-teal/40 bg-teal/10' : 'border-navy-800 bg-navy-950'
              }`}
            >
              <span className={`relative mt-0.5 h-5 w-9 flex-none rounded-full transition-colors ${on ? 'bg-teal' : 'bg-navy-700'}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[13px] font-semibold ${on ? 'text-ink' : 'text-muted'}`}>{title}</span>
                <span className="block text-[11px] leading-relaxed text-faint">{blurb}</span>
                {serious && !on && (
                  <span className="mt-0.5 block text-[11px] font-medium text-amber">
                    {theirs ? `${who} will not be told about theft on this phone.` : 'You will not be told about theft on this phone.'}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex items-center gap-3">
        {silent ? (
          <p className="text-xs text-teal">
            {theirs ? `${who} gets no notifications on their phone.` : 'This phone stays silent.'}
          </p>
        ) : (
          <button
            type="button" onClick={muteAll} disabled={pending}
            className="rounded-lg border border-navy-700 bg-navy-950 px-3 py-1.5 text-xs font-semibold text-ink hover:border-navy-600 disabled:opacity-40"
          >
            {theirs ? `Mute ${who}` : 'Mute my phone'}
          </button>
        )}
        {pending && <span className="text-[11px] text-faint">Saving…</span>}
        {!pending && saved && <span className="flex items-center gap-1 text-[11px] text-teal"><Check className="h-3 w-3" /> Saved</span>}
      </div>
    </>
  )

  if (compact) return <div className="mt-2">{body}</div>

  return (
    <section className="rounded-xl border border-navy-800 bg-navy-900 p-4">
      <div className="mb-1 flex items-center gap-2">
        <BellRing className="h-4 w-4 text-amber" />
        <h2 className="flex-1 font-display text-sm font-bold text-ink">My phone</h2>
      </div>
      <p className="mb-3 text-[11.5px] text-faint">
        What buzzes on <span className="text-muted">your</span> device, separate from what the company sends.
        A summary still has to be switched on for the company above before anyone gets it.
      </p>
      {body}
    </section>
  )
}
