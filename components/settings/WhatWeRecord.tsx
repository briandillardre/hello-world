import { ShieldCheck } from 'lucide-react'
import { OFF_SHIFT_GRID_M } from '@/lib/location-policy'

/**
 * "What HammerTrack records about you" — the plain-words list a crew member
 * reads on My phone (and from the shift recorder's disclosure). Every line
 * is what the code does today (docs/LOCATION-PRIVACY.md); change the code
 * and this list in the same commit. No hooks, so a server page and a client
 * sheet can both render it.
 */
const LINES: { title: string; body: string }[] = [
  {
    title: 'On the clock',
    body: 'From clock-in to clock-out, your phone’s location — up to every 30 seconds, sooner when you move. In the app it keeps recording with the screen off, and a notification shows the whole time. It shows you on the crew map and backs up your time card. Tool tags your phone hears ride with you on the map.',
  },
  {
    title: 'Riding in a company truck',
    body: 'On the clock, when yours is the only phone riding in a company truck (within about 150 m for 5 minutes or more), that truck’s driving — speeding, hard stops, late-night miles — counts toward your driver safety score. With other phones aboard, only the miles you rode along are noted. You and the people above you can see your score; it is never in the insurer report.',
  },
  {
    title: 'Clocking in and out',
    body: 'The spot where you tap Clock in and Clock out, saved on your time card — plus a photo if your company asks for one, and a random code for this phone (so one phone clocking in two people stands out).',
  },
  {
    title: 'Off the clock',
    body: `No location of yours is kept automatically (Go Live, and photos or receipts you send, are below). While the app is open on your screen it still listens for Bluetooth tags. When it hears any tag (the phone can’t tell your company’s from a shop’s), it sends where the phone is so HammerTrack can check it against your company’s tools. If it’s one of them, it keeps only the tag’s rough area — about ${OFF_SHIFT_GRID_M} m — and nothing that says it was your phone (its exact spot only for an item in recovery, seen only by Admins); for any other tag it keeps nothing.`,
  },
  {
    title: 'Privacy zones',
    body: `Inside a zone your company marked private — and near its edge, where GPS can’t be sure — the automatic records stop: no shift points, no tag-listener fixes, no Go Live. A tag heard there keeps only its rough area, about ${OFF_SHIFT_GRID_M} m, even for an item in recovery. What you do on purpose still carries its spot: a clock-in or clock-out tap (your time card shows it only as “in a privacy zone”), or a photo or receipt you send.`,
  },
  {
    title: 'Go Live',
    body: 'Only when you turn on Share location: your dot on the crew map until you stop. Stopping it also stops the tag listener’s reports until you next clock in.',
  },
  {
    title: 'Photos, receipts and daily logs',
    body: 'Carry the spot where you took or sent them.',
  },
  {
    title: 'Company trucks and machines',
    body: 'Tracked all the time by their own trackers — after hours and inside privacy zones too. That is the company’s equipment, not your phone.',
  },
  {
    title: 'Turning the tag listener off',
    body: 'My phone → “This phone hears tags”, or the Tag scanner page. Off means no Bluetooth listening on this phone at all. It never runs with the app closed.',
  },
]

export function WhatWeRecord({ compact = false }: { compact?: boolean }) {
  const list = (
    <ul className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {LINES.map((l) => (
        <li key={l.title} className={compact ? 'text-[12px] leading-snug text-muted' : 'text-[12.5px] leading-snug text-muted'}>
          <span className="font-semibold text-ink">{l.title}.</span> {l.body}
        </li>
      ))}
    </ul>
  )
  if (compact) return list
  return (
    <section id="what-we-record" className="rounded-xl border border-navy-800 bg-navy-900 p-4 space-y-3 scroll-mt-20" aria-labelledby="what-we-record-title">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-teal flex-none" />
        <h2 id="what-we-record-title" className="font-display font-bold text-sm text-ink">What HammerTrack records about you</h2>
      </div>
      {list}
    </section>
  )
}
