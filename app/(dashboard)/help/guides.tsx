import type { ReactNode } from 'react'
import { Satellite, Clock, Hexagon, Siren, QrCode, CreditCard, type LucideIcon } from 'lucide-react'

/**
 * Help center content — one place for all guide copy so /help (the card grid)
 * and /help/[slug] (the guide pages) never drift apart.
 *
 * Every claim in here is checked against the real product before it ships:
 * no invented buttons, no roadmap features described as live. Contractor
 * voice — short, honest, no fluff.
 *
 * PRICING SYNC (Brian, Aug 5): the billing guide restates the Founding-25
 * terms from docs/PRICING-TIERS.md. Any change to those terms updates this
 * file in the SAME commit as /pricing, the splash ladder, /demo, and the doc.
 */

/** Bold action path — "Settings → Company" style. */
function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>
}

/** Guide paragraph. */
function P({ children }: { children: ReactNode }) {
  return <p className="text-[13.5px] text-muted leading-relaxed">{children}</p>
}

/** Guide bullet list. */
function L({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-[13.5px] text-muted leading-relaxed">
          <span className="text-amber flex-none mt-[1px]">›</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}

export interface HelpGuide {
  slug: string
  title: string
  tagline: string
  icon: LucideIcon
  sections: { heading: string; body: ReactNode }[]
}

export const GUIDES: HelpGuide[] = [
  {
    slug: 'tracker-install',
    title: 'Tracker install day',
    tagline: 'Plug in the trucks, mount the pucks, watch them go live.',
    icon: Satellite,
    sections: [
      {
        heading: 'Before you touch the hardware',
        body: (
          <>
            <P>
              Add the asset in the app first: <B>Assets → Add Asset</B>. Name it, pick the type,
              and enter the <B>Tracker ID</B> printed on the tracker&apos;s kit — the ID is what
              ties the hardware to the right machine. Trackers come set up for our network, and
              your first install is done with you, in person or on the phone.
            </P>
            <P>
              Do <B>one unit first</B>. Install it, watch it show up on <B>Map</B> on the drive home,
              then knock out the rest. If something&apos;s wrong with your setup you find out on unit
              one, not unit ten.
            </P>
          </>
        ),
      },
      {
        heading: 'Trucks — OBD plug-in',
        body: (
          <L
            items={[
              <>Find the OBD2 port — under the dash, driver&apos;s side, usually just left of the steering column.</>,
              <>Push the unit in until it seats. No tools, no wiring.</>,
              <>Start the engine and let the truck sit or take a short drive — it appears on the map on its first report.</>,
            ]}
          />
        ),
      },
      {
        heading: 'Machines — GPS puck',
        body: (
          <L
            items={[
              <>Mount with a clear view of the sky — top of the cab, battery box lid, or high on the frame. Metal directly above the puck weakens the fix.</>,
              <>Out of the weather-blast and pressure-washer line where you can, and out of easy sight — a thief who can&apos;t find it can&apos;t rip it off.</>,
              <>Battery-powered pucks need no wiring. Machines that live outside drain batteries faster on frequent reporting — ask us about solar or wiring to 12V aux.</>,
            ]}
          />
        ),
      },
      {
        heading: 'What "first report" looks like',
        body: (
          <>
            <P>
              <B>Ignition on = live.</B> Moving vehicles record every few seconds and stream straight
              to the map.
            </P>
            <P>
              <B>Engine off = asleep.</B> The unit sleeps to save power and checks in about once an
              hour. An hour of silence from a parked truck is normal — not a dead tracker. If a unit
              hasn&apos;t reported for several hours <em>while being driven</em>, that&apos;s when to
              call us.
            </P>
          </>
        ),
      },
    ],
  },
  {
    slug: 'trackers',
    title: 'Swapping & moving trackers',
    tagline: 'Boxes move between machines. Here is how to tell the app, and how to undo it.',
    icon: Satellite,
    sections: [
      {
        heading: 'The drawer',
        body: (
          <>
            <P>
              Every tracker you own is either <B>on a machine</B> or in the <B>Unassigned drawer</B>.
              See both on <B>Trackers</B> (More → Trackers). A box lands in the drawer when you take
              it out of a machine, delete a machine, or log a new box on Hardware setup before it
              has a home.
            </P>
            <P>
              A tracker in the drawer that is already installed keeps reporting — the app holds those
              pings for 30 days and puts them on the machine the moment you assign it. Install now,
              name it later, lose nothing.
            </P>
          </>
        ),
      },
      {
        heading: 'Telling the app what happened',
        body: (
          <>
            <P>Open the machine under <B>Assets</B> and tap <B>Tracker</B>. Pick the case that matches:</P>
            <L
              items={[
                <><B>Put a tracker on</B> — the machine has none. Pick from the drawer, take one off another machine, or type a new IMEI.</>,
                <><B>Swap</B> — a different box went in as this one came out. Say where the old one went: the drawer, or another machine.</>,
                <><B>Take it out</B> — into the drawer. The machine keeps all its history.</>,
                <><B>Move it</B> — to another machine, no replacement. This record keeps everything up to the move; the other machine gets the tracker and everything after.</>,
                <><B>Renamed onto a new machine</B> — you reused a record for a different truck. The old truck&apos;s history splits off to its own record.</>,
              ]}
            />
            <P>
              The <B>date and time</B> matters: history is cut at that moment, so each machine keeps only
              its own past. Get it close. The sheet spells out exactly what will happen before you confirm.
            </P>
          </>
        ),
      },
      {
        heading: 'Undo, and the 30 days',
        body: (
          <>
            <P>
              Every tracker change shows on <B>Trackers → Recent changes</B> with an <B>Undo</B> for 30
              days — pings go back where they were and the tracker returns to its previous machine.
            </P>
            <P>
              <B>Deleting a machine</B> is also a 30-day thing. It leaves the map and the lists, its
              tracker goes to the drawer, and <B>Trackers → Recently deleted</B> brings it back whole
              until the window closes. After 30 days it is gone for good.
            </P>
          </>
        ),
      },
    ],
  },
  {
    slug: 'clock-and-logs',
    title: 'Clock in & daily logs',
    tagline: "The crew's day in one card — and the log that gets them off the clock.",
    icon: Clock,
    sections: [
      {
        heading: 'Clocking in',
        body: (
          <>
            <P>
              Open <B>Clock</B> (bottom bar on a phone). Pick where the day&apos;s going —{' '}
              <B>Project, Shop, Office / other, or Maintenance</B>.
            </P>
            <P>
              On <B>Project</B>, the phone&apos;s GPS suggests the nearest job site automatically.
              If it guessed wrong, just pick the right one — a manual pick is never overridden.
              Type a one-line plan for the day, hit the big <B>Clock in</B> button, done.
            </P>
            <P>
              No job sites in the list yet? Someone needs to draw a zone first — see{' '}
              <B>Zones 101</B>. Until then, Shop works.
            </P>
          </>
        ),
      },
      {
        heading: 'Clocking out — the daily log is the way out',
        body: (
          <>
            <P>
              Hit <B>Clock out</B> and the daily log opens. No log, no clock-out — that&apos;s on
              purpose. What&apos;s on the form is up to your office (writeup, safety issues, trucks
              fueled, photos, receipts…) — admins build it in <B>Settings → Daily log form</B>.
            </P>
            <P>
              Photos: <B>Take photo</B> or <B>From gallery</B>, as many as you want — they stack up
              as thumbnails, tap <B>×</B> to drop one. Then <B>Log it &amp; clock out</B>.
            </P>
          </>
        ),
      },
      {
        heading: 'Where the hours end up',
        body: (
          <L
            items={[
              <><B>Daily logs</B> — the office&apos;s morning read: last 7 days, who was where, what got done, plus the hours table.</>,
              <>Each job-site zone&apos;s page — tracked hours and cost against the budget.</>,
              <>The Friday wrap-up digest and the morning site briefing, if your company has them on (<B>Settings → Weekly summaries</B>).</>,
            ]}
          />
        ),
      },
    ],
  },
  {
    slug: 'zones',
    title: 'Zones 101',
    tagline: 'Draw your sites, yard, and perimeters — everything else keys off them.',
    icon: Hexagon,
    sections: [
      {
        heading: 'Drawing a zone',
        body: (
          <P>
            On <B>Map</B>, tap the <B>hexagon button (bottom-left)</B>, then tap corners around the
            site and name it. <B>Zones → Draw Zone</B> takes you to the same tool. Don&apos;t
            overthink the shape — you can edit it later from the zone&apos;s page.
          </P>
        ),
      },
      {
        heading: 'The four kinds — pick the right one',
        body: (
          <L
            items={[
              <><B>Job site</B> — where the work is. Clock-ins pick from these, and they carry the hours, usage, invoicing, the site log, and the budget.</>,
              <><B>Boundary</B> — an outline-only theft perimeter (your property line, a laydown lot). Exit and after-hours alerts fire, but it never counts hours or billing.</>,
              <><B>Yard</B> — home base. A machine sleeping in a yard shows a calm teal lock on the map at night instead of an amber &quot;out in the open&quot; warning.</>,
              <><B>Vendor</B> — supply houses. Stops there get named (&quot;Lowe&apos;s — 22 min&quot;), never count as job time, and a card swiped during the visit auto-suggests which job the receipt belongs to.</>,
            ]}
          />
        ),
      },
      {
        heading: 'Budgets and the rest',
        body: (
          <P>
            Open a job-site zone&apos;s page for the <B>Project Hub</B> — punch list, milestones, and
            budget vs. tracked actuals. Set a budget and the map&apos;s Burn Map layer shades the site
            green→red as tracked cost eats it. Zone notes (&quot;gate code 4188&quot;) live there too.
          </P>
        ),
      },
    ],
  },
  {
    slug: 'theft-alerts',
    title: 'Theft & alerts',
    tagline: 'The 2 AM text, and how to make sure it actually reaches you.',
    icon: Siren,
    sections: [
      {
        heading: 'How the after-hours alert works',
        body: (
          <P>
            When a tracked machine starts <B>moving outside your work hours</B>, that&apos;s a
            critical alert — the theft text. Your work hours and work days are set in{' '}
            <B>Settings → Company</B>, so get those right first: alerts are quiet while you&apos;re
            working and armed when you&apos;re not.
          </P>
        ),
      },
      {
        heading: 'Get the text on your phone',
        body: (
          <>
            <P>
              Put your cell number in <B>Settings → Company → Alert phone</B>. A real theft text
              looks like:
            </P>
            <P>
              <span className="font-mono text-[12.5px] text-amber">
                HammerTrack: Takeuchi TB235 is moving outside work hours — possible theft
              </span>
            </P>
            <P>
              Don&apos;t wait for 2 AM to find out if it works — <B>Settings → Alert delivery
              test</B> fires a clearly-labeled test through the exact same pipeline. If the test
              lands, the real one will.
            </P>
          </>
        ),
      },
      {
        heading: 'When one fires',
        body: (
          <>
            <P>
              Open <B>Alerts</B> and tap the alert row — the map opens on a replay of that moment
              (a 3-hour window, scrubber parked right where it happened). Watch which way the
              machine went before you call it in.
            </P>
            <P>
              Machines also throw a <B>left-site alert</B> (&quot;Peterbilt 567 left Creekside&quot;)
              when they exit a zone they shouldn&apos;t. One honest caveat: a puck on a parked
              machine sleeps between check-ins, so a machine towed dead-quiet may not report until
              its next wake-up — another reason to mount pucks out of sight.
            </P>
          </>
        ),
      },
    ],
  },
  {
    slug: 'qr-checks',
    title: 'QR equipment checks',
    tagline: 'One gloved tap logs who greased, fueled, or serviced the machine.',
    icon: QrCode,
    sections: [
      {
        heading: 'Print the stickers',
        body: (
          <P>
            Go to <B>hammertrack.ai/qr</B> (there&apos;s also a QR stickers button on{' '}
            <B>Daily logs</B>) and hit <B>Print</B> — one card per machine. Print on adhesive label
            stock or laminate paper stickers, and stick them at the operator&apos;s eye line — door
            jamb, ROPS post.
          </P>
        ),
      },
      {
        heading: 'Scanning one',
        body: (
          <>
            <P>
              Point the phone camera at the sticker. It opens the machine&apos;s check-in page — big
              buttons, built for gloves: <B>Greased · Fueled · Radiator blown out · Air filter blown
              out · Oil checked · Washed</B>. Each button shows how long since it was last done and
              turns red when it&apos;s overdue — the sticker tells the operator what the machine
              needs before they even tap.
            </P>
            <P>
              You have to be signed in — the record needs to know <em>who</em> did the work. Muddy
              sticker won&apos;t scan? The short URL printed under the code gets to the same page.
            </P>
          </>
        ),
      },
      {
        heading: 'What gets logged',
        body: (
          <P>
            One tap = one timestamped record: who, what, which machine, when. That history feeds the
            machine&apos;s service record, so &quot;when was the 130 last greased&quot; stops being a
            radio call.
          </P>
        ),
      },
    ],
  },
  {
    slug: 'billing',
    title: 'Billing & your plan',
    tagline: 'Founding 25 pricing, hardware at cost, cancel anytime.',
    icon: CreditCard,
    sections: [
      {
        heading: 'Your Founding 25 deal',
        body: (
          <>
            <L
              items={[
                <><B>$6/mo per tracked machine</B> and <B>$3/mo per tool tag</B> — Operate features included, no platform fee.</>,
                <><B>Free 30-day pilot</B> to start — no credit card.</>,
                <><B>12-month price lock</B> on assets you&apos;ve enrolled.</>,
                <><B>First install done with you</B>, in person or on the phone.</>,
                <><B>Hardware at cost</B> — trackers are a pass-through, we don&apos;t mark them up. No setup fees, ever.</>,
                <><B>Month-to-month, cancel anytime.</B> No contract.</>,
                <><B>Unlimited users</B> — every crew member gets a login. We never charge per seat.</>,
              ]}
            />
            <P>
              That works out to about half the price of Tenna, with $0 setup.
            </P>
          </>
        ),
      },
      {
        heading: 'Managing your subscription',
        body: (
          <P>
            Everything lives in <B>Settings</B>: the plan card shows your subscription status, and{' '}
            <B>Subscribe — Founding 25</B> / <B>Manage billing</B> are right on it. Manage billing
            opens the secure Stripe portal — update the card, download invoices, or cancel there.
            Only billing admins see the buttons.
          </P>
        ),
      },
      {
        heading: 'Ordering more hardware',
        body: (
          <P>
            Hardware ships in batches. A refundable deposit holds your kit when a batch is
            scheduled, and it stays refundable until the kit ships. Need more trackers or tags?
            Email <B>support@hammertrack.ai</B> and we&apos;ll get you into the next batch.
          </P>
        ),
      },
    ],
  },
]

export function getGuide(slug: string): HelpGuide | undefined {
  return GUIDES.find((g) => g.slug === slug)
}
