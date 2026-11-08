# Jobs — the bid to the final lien waiver

*Nov 8 2026. Brian: "Make sure the Preconstruction, Estimating, checklists,
etc. Have a natural flow on into project management flow, photos, tracking,
aia pay apps (we currently use sheets) … Ideally this basically runs my
business."*

DCG runs a job on three spreadsheets today: the **PM Master** (Projects,
Project Budget, Budget / Actual Cost Ledgers, Issues & Actions, Change
Orders, Milestones, Contacts, Documents, Closeout, a READ ME of the process),
a **per-job workbook** (Proposal V1…Vn → Contract, CO1…COn, PA1…PAn pay apps,
a PROJECT CHECKLIST) and the **Invoice Tracking** workbook (AR aging, WIP, the
project log, cash). The job in HammerTrack is those three joined to the site
that already reports itself — the plan room, the takeoff, the estimate, the
borings, the machine files, drone progress, photos, daily logs, time cards,
equipment hours.

## The model

- **One job per site** (`jobs`, migration 152). The site zone stays the
  project (046's zone = project = QuickBooks customer); the job number is the
  front of the zone name (`26-084 Haywood Mall`), and *Give it the next job
  number* writes both. A job never sits on a personal zone, a boundary, a
  supplier stop or a yard, and a site with a job can't be made personal (152
  extends 151's guard).
- **Stages** — the PM Master's Project Status list: Estimating → Bid
  submitted → Awarded → Active → Substantially complete → Financial closeout →
  Closed, with On hold, Lost, No bid and Cancelled off the road. A move fills
  in the award, start and completion dates when they are blank and never
  overwrites a typed one. Lost / no bid / cancelled take a reason.
- **The checklist** (`job_checklist`) is the job's own copy of the company's
  template (`job_templates`; the built-in one is DCG's PROJECT CHECKLIST,
  written generic — no supplier or people names). Sections: the bid · won —
  set it up · mobilize · every month · closeout. Each item can be a
  **must-do**, records who ticked it and when, takes a note, and opens the
  page the work is done on (takeoff, estimate, borings, machine files, plan
  room, photos, contacts, the contract, QuickBooks). The job page shows the
  sections that are NOW for its stage; *Ready to start* = every must-do of the
  set-up done (the PM Master's Setup Readiness).
- **The contract** — customer (the GC or owner who hires you) and their job
  number, the owner, contract / PO number and date, scope, exclusions, project
  / contract / billing type, risk, dates (bid due, awarded, NTP, start, target
  and actual completion), PM and superintendent, the address.
- **Dollars** (`job_money`): bid, contract, retainage on work and on stored
  material, bonded — read only with the costs ability (RLS, like every price
  since 130). A Foreman sees the job, its checklist and its contacts, never
  the dollars.
- **Contacts** (`job_contacts`): GC PM / super, owner, billing, engineer,
  architect, surveyor, inspector, utility, subs, suppliers — typed in by the
  company (people's names are the company's own data; none ship in code).

## The flow

1. A bid comes in → draw the site → **Jobs → Start a job** (or the site
   page's Job card). The bid checklist walks the takeoff, dirt takeoff,
   borings, estimate and proposal; each item links to its page.
2. Mark the estimate **Won** → *Set up the job*: the job moves to Awarded,
   remembers the estimate, takes its bid total as the bid (and as the contract
   amount while none is typed). Only a total that carries the margins is sent.
3. The won section: contract amount, QuickBooks customer with the same name,
   COIs and W-9, shop drawings, CAD and survey control, the machine model,
   IFC plans against the plans priced (the plan room's compare), schedule.
4. Mobilize, every month, closeout — then the job closes; completing the zone
   (the Z flip) stays on the Zones list.

## Permissions

View level **Jobs** (`jobs`): on for Admin, Manager and Foreman; off for the
crew (Associate) by default; never a prospect's (`PROSPECT_NEVER`, and
`ht_prospect_lockdown` on every job table). Members read through RLS; every
write is a server action on the service role after the edit + Jobs checks
(dollars also need costs; the checklist template is Manager+).

## Still to build

- **Pay apps** (board #230): schedule of values from the won estimate, change
  orders (potential → priced → submitted → approved), G702/G703 applications
  for payment with retainage on work and stored material, frozen once sent, a
  PDF and an Excel in the same columns as the sheet, lien waiver tracking.
- **Job cost** (board #231): the L/M/S/E budget from the estimate (Original
  never changes; Current only by approved change order), actuals that feed
  themselves (time cards × loaded rate, the equipment ledger, receipts by
  category, pasted sub and supplier invoices), cost to complete, WIP.
- **Issues & actions, documents, closeout that checks itself** (board #232).
- **The portfolio** — AR aging, WIP schedule, cash (board #233).

Harness: `node scripts/jobs-test.mjs` — run it after ANY change to
`lib/jobs/job.ts`.
