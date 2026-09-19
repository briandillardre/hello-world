'use client'

import { useEffect, useRef, useState } from 'react'
import { Share2, X, Link2, Send, Check, Smartphone } from 'lucide-react'
import { createViewLinkAction, listTeammatesAction, sendViewLinkAction, type Teammate } from '@/lib/actions/share-links'
import { deliverLink, copyText } from '@/lib/map-export'
import type { SharedView } from '@/lib/share-links'
import { toast } from '@/components/ui/feedback'

/**
 * Share THIS SCREEN with the team (Brian, Sep 19: "Need share option to send
 * link to show certain screen setup to team members either thru app or thru
 * link").
 *
 * The snapshot is what a saved view keeps plus the camera, the time range and
 * playhead, what is followed or open, and the division filter — everything
 * that makes the map read the way it reads right now. It becomes a row and a
 * short link (migration 113). Two ways out:
 *   • the link, copied or sent (Web Share / Messages) — anyone in the company
 *     who opens it lands on the same screen after signing in;
 *   • straight to teammates' phones as an in-app notification whose tap
 *     opens the view. The list says who can actually be reached — a person
 *     with no phone in the app is shown, not silently skipped.
 *
 * The link is minted on the first door tapped, with the title as typed at
 * that moment; retitling after that mints a fresh one (rows are cheap, a
 * stale title in somebody's push is not).
 */
export function ShareViewSheet({ open, onClose, snapshot, summary, defaultTitle }: {
  open: boolean
  onClose: () => void
  snapshot: SharedView
  /** Plain words for what the recipient will see: basemap, layers, range, subject. */
  summary: string[]
  defaultTitle: string
}) {
  const [title, setTitle] = useState(defaultTitle)
  /** The link plus the title it was minted FROM (as typed) — the server
   *  normalises whitespace, so comparing against its answer re-minted on
   *  every tap (ship-check). */
  const [link, setLink] = useState<{ id: string; url: string; path: string; title: string; typed: string } | null>(null)
  const [linking, setLinking] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [team, setTeam] = useState<Teammate[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [sentLine, setSentLine] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    let gone = false
    listTeammatesAction().then((t) => { if (!gone) setTeam(t) }).catch(() => { if (!gone) setTeam([]) })
    return () => { gone = true }
  }, [open])

  const linkRef = useRef(link)
  linkRef.current = link
  const mintSeq = useRef(0)
  const mint = async (typed: string) => {
    const seq = ++mintSeq.current
    setLinking(true)
    setErr(null)
    try {
      const r = await createViewLinkAction({ title: typed, view: snapshot })
      if (seq !== mintSeq.current) return null // a newer title won
      if (!r.ok) { setErr(r.error); return null }
      const l = { id: r.id, url: r.url, path: r.path, title: r.title, typed }
      setLink(l)
      return l
    } catch {
      if (seq === mintSeq.current) setErr('Could not make the link — try again.')
      return null
    } finally {
      if (seq === mintSeq.current) setLinking(false)
    }
  }
  const typedTitle = () => title.trim().slice(0, 80) || defaultTitle
  const ensureLink = async () => {
    const t = typedTitle()
    if (linkRef.current && linkRef.current.typed === t) return linkRef.current
    return mint(t)
  }
  // Minted as the sheet opens, so the first Copy / Send happens inside the
  // tap (clipboard and share sheets need the gesture; an awaited server
  // round trip first loses it on Safari and Chrome alike). Retitling
  // re-mints after a short pause for the same reason — by the time the
  // thumb reaches a button, the link with the new title already exists.
  useEffect(() => {
    if (!open) return
    const t = typedTitle()
    if (linkRef.current?.typed === t) return
    const h = setTimeout(() => { void mint(t) }, linkRef.current ? 600 : 0)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, title])

  const copy = async () => {
    const l = await ensureLink()
    if (!l) return
    if (await copyText(l.url)) { setCopied(true); setTimeout(() => setCopied(false), 1800) }
    else toast('Could not copy — press and hold the link to copy it.', { variant: 'error' })
  }

  const send = async () => {
    const l = await ensureLink()
    if (!l) return
    const how = await deliverLink(l.url, `${l.title} — a HammerTrack map view`, l.title)
    if (how === 'copied') toast('Link copied — paste it into a text or an email.', { variant: 'success' })
    else if (how === 'none') toast('No share sheet here — use Copy link.', { variant: 'error' })
  }

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const sendTeam = async () => {
    if (!picked.size || sending) return
    const l = await ensureLink()
    if (!l) return
    setSending(true)
    setSentLine(null)
    try {
      const r = await sendViewLinkAction(l.id, Array.from(picked), note.trim() || null)
      if (!r.ok) { setErr(r.error); return }
      const parts: string[] = []
      if (r.sent.length) parts.push(`Sent to ${listNames(r.sent)}.`)
      if (r.noPhone.length) parts.push(`${listNames(r.noPhone)} ${r.noPhone.length === 1 ? 'has' : 'have'} no phone in the app yet — send ${r.noPhone.length === 1 ? 'them' : 'them'} the link.`)
      setSentLine(parts.join(' ') || 'Nothing went out.')
      setPicked(new Set())
    } catch {
      setErr('Could not send — try again.')
    } finally {
      setSending(false)
    }
  }

  if (!open) return null
  const reachable = (team ?? []).filter((t) => t.phone)
  const btn = 'flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-semibold disabled:opacity-40'

  return (
    <div className="fixed inset-0 z-[82] flex items-end md:items-center justify-center bg-navy-950/60" onClick={onClose}>
      <div
        className="w-full md:max-w-md bg-navy-900 border border-navy-700 rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[calc(88dvh-var(--ht-safe-bottom,0px))] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-navy-800">
          <Share2 className="h-4 w-4 text-amber" />
          <h2 className="font-display font-bold text-[15px] text-ink flex-1">Share this view</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="grid place-items-center w-8 h-8 rounded-full bg-navy-800 border border-navy-700 text-faint hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <p className="text-[12.5px] text-muted leading-snug">
            Whoever opens it sees the map set up exactly like this — same layers, same spot, same time — then it is theirs to move.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {summary.map((s) => (
              <span key={s} className="rounded-full border border-navy-700 bg-navy-950 px-2.5 py-1 text-[11.5px] font-semibold text-muted">{s}</span>
            ))}
          </div>

          <label className="block space-y-1">
            <span className="font-mono text-[9px] uppercase tracking-wider text-faint">Call it</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 80))}
              className="w-full bg-navy-950 border border-navy-700 rounded-xl px-3 py-2.5 text-sm text-ink outline-none focus:border-amber/50"
            />
          </label>

          <div className="flex gap-2">
            <button type="button" onClick={copy} disabled={linking} className={btn + ' border border-navy-700 bg-navy-950 text-ink'}>
              <Link2 className="h-4 w-4" /> {copied ? 'Copied' : linking ? 'Making link…' : 'Copy link'}
            </button>
            <button type="button" onClick={send} disabled={linking} className={btn + ' bg-amber text-[#1a1100] font-display font-bold'}>
              <Send className="h-4 w-4" /> Send
            </button>
          </div>
          <p className="text-[11.5px] text-faint leading-snug min-h-[1em]">
            {link
              ? <><span className="font-mono text-ink break-all">{link.url.replace(/^https?:\/\//, '')}</span> · your team signs in and lands here · 180 days</>
              : 'The link is for your company — a teammate signs in and lands on this screen.'}
          </p>

          <div className="pt-2 border-t border-navy-800 space-y-2">
            <p className="font-mono text-[9px] uppercase tracking-wider text-faint flex items-center gap-1.5">
              <Smartphone className="h-3 w-3" /> Send in the app
            </p>
            {team === null && <p className="text-[12px] text-faint">Loading your team…</p>}
            {team !== null && team.length === 0 && <p className="text-[12px] text-faint">Nobody else is on the team yet.</p>}
            {team !== null && team.length > 0 && (
              <ul className="rounded-xl border border-navy-800 divide-y divide-navy-800 max-h-56 overflow-y-auto">
                {team.map((t) => {
                  const on = picked.has(t.id)
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        disabled={!t.phone}
                        onClick={() => toggle(t.id)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left disabled:opacity-50"
                      >
                        <span className={'grid place-items-center w-5 h-5 rounded-md border flex-none ' + (on ? 'bg-teal/20 border-teal text-teal' : 'border-navy-700 text-transparent')}>
                          <Check className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] text-ink truncate">{t.name}</span>
                          <span className="block text-[11px] text-faint capitalize">
                            {t.role}{t.phone ? '' : ' · no phone in the app yet'}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {reachable.length > 0 && (
              <>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 140))}
                  placeholder="A note with it (optional)"
                  className="w-full bg-navy-950 border border-navy-700 rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-faint outline-none focus:border-amber/50"
                />
                <button
                  type="button"
                  onClick={sendTeam}
                  disabled={!picked.size || sending || linking}
                  className="w-full rounded-xl border border-teal/50 bg-teal/15 text-teal py-3 text-sm font-semibold disabled:opacity-40"
                >
                  {sending ? 'Sending…' : picked.size ? `Send to ${picked.size} teammate${picked.size === 1 ? '' : 's'}` : 'Pick who gets it'}
                </button>
              </>
            )}
            {sentLine && <p className="text-[12px] text-teal">{sentLine}</p>}
          </div>

          {err && <p className="text-[12px] text-alert">{err}</p>}
        </div>

        <div className="p-4 pt-2 pb-[calc(1rem+var(--ht-safe-bottom,0px))] border-t border-navy-800">
          <button type="button" onClick={onClose}
            className="w-full rounded-xl border border-navy-700 text-muted py-3 text-sm font-semibold hover:text-ink">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
