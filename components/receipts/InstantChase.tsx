'use client'

import { useState, useTransition } from 'react'
import { Zap, Copy, Check, Trash2, Send } from 'lucide-react'
import { enableInstantChaseAction, saveCardAction, deleteCardAction, sendTestChargeAction, type CompanyCard } from '@/lib/actions/cards'

/**
 * Instant receipt chase setup — the card issuer's own alert emails become the
 * swipe-time trigger. Three steps the admin does once: enable the inbound
 * address, forward card alerts to it, map each card's last-4 to the person
 * carrying it.
 */
export function InstantChase({ address: initialAddress, cards, members, canManage, ready = { inbound: false, push: false, sms: false } }: {
  address: string | null
  cards: CompanyCard[]
  members: { id: string; name: string; phone?: string | null }[]
  canManage: boolean
  /** Which legs of the chase can fire right now (server env). */
  ready?: { inbound: boolean; push: boolean; sms: boolean }
}) {
  const [address, setAddress] = useState(initialAddress)
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(!!initialAddress)
  const [error, setError] = useState<string | null>(null)
  const [last4, setLast4] = useState('')
  const [label, setLabel] = useState('')
  const [holder, setHolder] = useState('')
  const [cell, setCell] = useState('')
  const [test, setTest] = useState<{ link: string; pushed: number; texted: boolean } | null>(null)
  const [pending, start] = useTransition()

  const memberName = (id: string | null) => members.find((m) => m.id === id)?.name ?? '—'
  const memberPhone = (id: string | null) => members.find((m) => m.id === id)?.phone ?? null
  const legs: { label: string; ok: boolean; fix: string }[] = [
    { label: 'Bank alert email', ok: ready.inbound, fix: 'RESEND_INBOUND_SECRET is not set in Vercel — the inbound webhook refuses mail until it is.' },
    { label: 'Push to phones', ok: ready.push, fix: 'No FCM service account in Vercel — pushes cannot send.' },
    { label: 'Texts', ok: ready.sms, fix: 'Twilio is not configured — the ladder pushes only.' },
  ]

  return (
    <section className="rounded-xl border border-navy-800 bg-navy-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 p-4 text-left"
      >
        <span className="w-8 h-8 rounded-lg bg-amber/15 border border-amber/30 grid place-items-center flex-none">
          <Zap className="h-4 w-4 text-amber" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-display font-bold text-sm text-ink">Instant chase — ping on every swipe</span>
          <span className="block text-[11.5px] text-faint truncate">
            {address ? address : 'Forward your bank’s card alerts; we ping the cardholder in seconds'}
          </span>
        </span>
        <span className="text-faint text-xs">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-navy-800 pt-4">
          {!address ? (
            <div className="flex items-start gap-3">
              <p className="text-[12.5px] text-muted flex-1">
                Turn this on to get a company inbound address. Point Chase / Capital One instant
                transaction alert emails at it and whoever carries the card gets a
                &ldquo;snap the receipt?&rdquo; push seconds after every swipe.
              </p>
              <button
                type="button"
                disabled={!canManage || pending}
                onClick={() => start(async () => {
                  const r = await enableInstantChaseAction()
                  if (r.ok && r.address) { setAddress(r.address); setError(null) }
                  else setError(r.error ?? 'Failed')
                })}
                className="rounded-lg bg-amber text-[#1a1100] font-bold text-sm px-3.5 py-2 disabled:opacity-40 flex-none"
              >
                {pending ? '…' : 'Enable'}
              </button>
            </div>
          ) : (
            <>
              <div>
                <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-faint mb-1">Your inbound address</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate rounded-lg bg-navy-950 border border-navy-700 px-3 py-2 text-[12.5px] text-teal">{address}</code>
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard?.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                    className="rounded-lg border border-navy-700 p-2 text-muted hover:text-ink"
                    aria-label="Copy address"
                  >
                    {copied ? <Check className="h-4 w-4 text-teal" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5" title="Whether each leg of the chase can fire right now">
                {legs.map((l) => (
                  <span key={l.label} title={l.ok ? 'ready' : l.fix} className={'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ' + (l.ok ? 'border-teal/40 bg-teal/10 text-teal' : 'border-alert/40 bg-alert/10 text-alert')}>
                    {l.ok ? '✓' : '✗'} {l.label}
                  </span>
                ))}
              </div>
              {!ready.inbound && canManage && (
                <p className="text-[12px] text-alert">Bank alerts cannot reach us yet: add <code className="font-mono">RESEND_INBOUND_SECRET</code> in Vercel (Resend → Inbound webhook signing secret) and redeploy.</p>
              )}

              <ol className="text-[12.5px] text-muted space-y-1.5 list-decimal pl-5">
                <li><span className="text-ink">Chase:</span> chase.com → Profile &amp; Settings → Alerts → add this address as an alert recipient, turn on &ldquo;transaction&rdquo; alerts for each card (set the dollar threshold to $0).</li>
                <li><span className="text-ink">Capital One:</span> capitalone.com → Alerts → add email → enable purchase notifications. Any other bank works too — forward its per-purchase alert emails here.</li>
                <li>Map each card below so the right person gets the ping.</li>
              </ol>

              <div>
                <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-faint mb-1.5">Who carries which card</p>
                {cards.length > 0 && (
                  <div className="rounded-lg border border-navy-800 divide-y divide-navy-800 mb-2">
                    {cards.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span className="font-mono text-ink">…{c.last4}</span>
                        {c.label && <span className="text-faint text-xs truncate">{c.label}</span>}
                        <span className="ml-auto text-muted text-xs text-right">{memberName(c.user_id)}{memberPhone(c.user_id) ? <span className="block text-faint font-mono text-[10.5px]">{memberPhone(c.user_id)}</span> : null}</span>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => start(async () => { await deleteCardAction(c.id) })}
                            className="text-faint hover:text-red-400"
                            aria-label={`Remove card ${c.last4}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={last4}
                      onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="Last 4"
                      inputMode="numeric"
                      className="w-20 rounded-lg bg-navy-950 border border-navy-700 px-2.5 py-2 text-sm text-ink"
                    />
                    <input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="Label (optional)"
                      className="flex-1 min-w-[120px] rounded-lg bg-navy-950 border border-navy-700 px-2.5 py-2 text-sm text-ink"
                    />
                    <select
                      value={holder}
                      onChange={(e) => { setHolder(e.target.value); setCell(memberPhone(e.target.value) ?? '') }}
                      className="rounded-lg bg-navy-950 border border-navy-700 px-2.5 py-2 text-sm text-ink"
                    >
                      <option value="">Cardholder…</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <input
                      value={cell}
                      onChange={(e) => setCell(e.target.value)}
                      placeholder="Cell for texts"
                      inputMode="tel"
                      title="The chase texts this number at the 1 h, 4 h and daily rungs"
                      className="w-36 rounded-lg bg-navy-950 border border-navy-700 px-2.5 py-2 text-sm text-ink"
                    />
                    <button
                      type="button"
                      disabled={pending || last4.length !== 4}
                      onClick={() => start(async () => {
                        const r = await saveCardAction({ last4, label, userId: holder, phone: cell })
                        if (r.ok) { setLast4(''); setLabel(''); setHolder(''); setCell(''); setError(null) }
                        else setError(r.error ?? 'Failed')
                      })}
                      className="rounded-lg bg-navy-700 text-ink font-semibold text-sm px-3 py-2 disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>

              {canManage && (
                <div className="rounded-lg border border-navy-800 bg-navy-950 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-[12.5px] text-muted flex-1">Prove the loop: a $12.34 test swipe on your name fires the same push and text a real card alert would. Snap any photo to close it.</p>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => start(async () => {
                        const r = await sendTestChargeAction()
                        if (r.ok && r.link) { setTest({ link: r.link, pushed: r.pushed ?? 0, texted: !!r.texted }); setError(null) }
                        else setError(r.error ?? 'Failed')
                      })}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber/50 bg-amber/10 text-amber font-semibold text-sm px-3 py-2 disabled:opacity-40 flex-none"
                    >
                      <Send className="h-3.5 w-3.5" /> Send me a test swipe
                    </button>
                  </div>
                  {test && (
                    <p className="text-[12px] text-teal">
                      Test charge created · push to {test.pushed} device{test.pushed === 1 ? '' : 's'}{test.texted ? ' · text sent' : ''}. The amber bar is now on every screen for you —
                      or <a href={test.link} target="_blank" rel="noreferrer" className="underline">open the capture link</a>.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
          {error && <p className="text-sm text-alert">{error}</p>}
        </div>
      )}
    </section>
  )
}
