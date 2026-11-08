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
  front of the zone name (`26-084 North Lot`), and *Give it the next job
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

## Pay apps (migration 154)

Jobs → a job → **Pay apps** (costs only). DCG's PA1, PA2… tabs as screens:

- **Schedule of values** (`job_sov`): item, area, description, scheduled
  value, a line's own retainage % (variable retainage). *Build it from the
  won estimate*: one line per section, priced to the contract by each
  section's share of the direct cost, to the cent (only on an empty
  schedule). A line billed on a sent application can't be deleted.
- **Change orders** (`job_change_orders`): CO1, CO2… potential → pricing →
  submitted → approved / rejected / void; asked and approved amounts (minus
  for a credit), cost impact on the budget, schedule days, their CO number.
  The contract changes only by an APPROVED change order, and it joins the
  applications as its own line from its approval date. One on a sent
  application keeps its approved amount; an approved one is voided, never
  deleted.
- **Applications** (`job_pay_apps`): one draft at a time, numbered after the
  last. This period in dollars or as % complete to date, stored material
  (it carries until it is installed), retainage on work and on stored
  material (the job's, or a line's own), and a *final application* switch
  that releases all of it. The G702 lines 1–9 and the G703 columns A–I are
  computed live (`lib/jobs/payapp.ts`, cents inside every sum; line 5 takes
  the % of the total once, as the form does). **Send** (Manager+) computes
  the numbers on the server and FREEZES them; every later application
  builds on the last sent one (D = what it billed, line 7 = its line 6).
  Then: approved, paid (date and amount), lien waiver (partial / final).
  Only the last sent application can be voided, and a voided one frees its
  number for the resubmission.
- **PDF and Excel** off the screen (`lib/jobs/payapp-docs.ts`): the
  application page and the continuation sheet in the G702 / G703 layout
  (our own words throughout, the certification included — AIA's forms are copyrighted), and a workbook whose
  application sheet reads the continuation sheet by live formulas. In the
  Android app both go out as export links (the WebView has no download).
  The customer's own lien waiver and notarized affidavit forms are still
  theirs to attach.

## Job cost (migration 155)

Jobs → a job → **Job cost** (costs only). The PM Master's budget tab and its
WIP, with most of the actuals filling themselves in:

- **The budget** (`job_budget_lines`, Manager+): DIRECT cost from the awarded
  scope by cost type — L labor, M material, S subcontract, E equipment &
  trucking, O other — never the sell total. *Build it from the estimate*
  (only on an empty budget): each section's material → M, sub → S, haul and
  the lowboy → E, and the crew's install cost split labor / equipment by a
  share the estimator types (a crew's $/hr carries both). The ORIGINAL is
  the Managers' to set (and correct); the CURRENT budget = the original plus
  each APPROVED change order's cost impact, on the cost type the change
  order names (`cost_pcat`, picked on the change order in Pay apps).
- **Actuals that feed themselves** — read where they already live, totals
  only (no one's hours or pay is shown):
  - labor = time cards clocked to the site × each person's loaded rate (the
    $/hr on their phone in Assets), paid hours by the time cards' own rule
    (break taken off, an open shift counts to now) so job cost and the time
    cards agree; hours from people with no rate are counted and named as a
    count, never priced at a guess;
  - equipment = machine hours on the site from the hours ledger
    (`usage_daily`) × each machine's rates — trucks and machines only (fuel
    receipts count on top, so a machine's rate leaves its fuel out when the
    fuel comes in on receipts);
  - receipts coded to the job, by their category: fuel → F, repairs → R,
    material → M, tools and rentals → E, the rest → O (rejected ones never).
  Counting starts at the job's start date (else its award date, else the day
  it went on the log).
- **Costs entered or pasted** (`job_costs`, any editor): sub and supplier
  invoices, payroll adjustments — date, type (L M S E F R O), amount, vendor,
  reference, description (20,000 per job). *Paste from accounting* takes the rows straight out
  of Excel or Sheets (CSV or tabs, a header row skipped, `(1,250.00)` = a
  credit) and says which lines it skipped and why. F (fuel) and R (repairs)
  are actual-only: no budget of their own, never "over".
- **WIP**, cost to cost: % complete = cost to date ÷ the estimated total cost
  (the current budget, or what has been spent when that is more, or the PM's
  own *estimate at completion*, Manager+); earned = that % of the contract to
  date (the last sent pay app's line 3, else the contract plus approved
  change orders); over / under billing = billed − earned; retainage held and
  the forecast margin beside them.

`lib/jobs/cost.ts` is the pure half (`rollup`, `wip`, `budgetFromEstimate`,
`parseCosts`, `pcatOfReceipt`); `lib/db/jobcost.ts` reads, `lib/actions/
jobcost.ts` writes (service role after the edit + Jobs + costs checks).

## Issues & actions, documents, closeout (migration 156)

- **Issues & actions** (`job_issues`; Jobs → a job → Issues & actions): the
  PM Master's tab — numbered I-1, I-2… per job; kind (design / RFI, scope
  change, schedule, site condition, utilities, permit / inspection, safety,
  quality, payment, other), priority, open / waiting on a decision /
  resolved, owner (someone on the team), who has to decide, due date,
  schedule days, what it could cost (`job_issue_money`, costs only, the
  job_money pattern), the detail and how it was settled. High and late ones
  first. *Make it a change order* (costs) starts a potential change order
  with the issue's words, cost and days and links the two — Pay apps prices
  and sends it. Deleting is a Manager's.
- **Documents** (`job_documents`, the private `jobdocs` bucket at
  `<company>/<id>`, 50 MB, signed upload, 10-minute download — the machine
  files pattern; unfinished uploads swept by health step 13): every paper by
  type — contract & proposal, signed change orders, lien waivers (against an
  application), invoices, W-9, bonds, COIs, permits, submittals, RFIs,
  inspections & tests, warranties & O&M, as-builts, letters, safety, other.
  The money papers (contract, change orders, lien waivers, invoices, W-9,
  bonds) are costs only — `costs_only` is CHECKed against the type in the
  database and the read policy hides them. Insurance, permits and bonds
  carry an expiry; the job page warns 30 days out and once they've run out.
  The type is guessed from the file name ("COI - …" → insurance). Plans stay
  in the plan room, photos on the site page.
- **Closeout that checks itself**: from Substantially complete on, the job
  page shows what still stands between the job and Closed — punch list
  finished, closeout must-dos checked off, change orders settled, issues
  resolved, the final application sent (retainage released), every
  application paid (to the cent, dollars only with costs), the final lien
  waiver in — each line opening the page where it is settled; plus a
  warning (never a block) when someone is still clocked in to the site or a
  truck or machine spent an hour there in the last 3 days. Moving the job
  to Closed is refused on the server while any of those is open; a Manager
  may close it anyway with a reason, kept on the job with who and when
  (`jobs.closed_note`, `closed_by`, `closed_at`; cleared if it reopens).

The checklist's COIs, submittals, approvals, as-builts and warranty items
open Documents; the final lien waiver opens Pay apps.

From the review pass (Nov 8, migration 157):
- A job billed outside Pay apps (T&M, unit price or milestone billing, or an
  internal job) with no application sent: the final application and its
  waiver are warnings at closeout, not blocks.
- Reopening a closed job is a Manager's; who closed it, when and why stay on
  the job.
- A site that holds a job can't be deleted (157) — the cascade used to take
  every sent application, change order, cost and document with it. Close the
  job instead. A personal zone's punch list and milestones are its owner's.
- Pay apps: *Mark sent* freezes the numbers (it never sent anything); a paid
  date with no amount is paid in full; a % complete cell changes the dollars
  only when someone typed in it; leaving an application with unsaved changes
  asks first.
- Job cost: with no budget and no estimate at completion, % complete reads
  "no budget yet" — never 100% — and the job stays out of earned, over / under
  and margin on Money across jobs. Hourly rates are read through the viewer's
  own access, so a phone or machine hidden from them is never priced in.

## Money across jobs (board #233)

Jobs → **Money across jobs** (`/jobs/portfolio`, costs only) — the Invoice
Tracking workbook from the jobs themselves; no tables of its own:

- **What customers owe**: every sent application not paid in full (short
  pays to the cent), due on receipt or net 15 / 30 / 45 / 60 from its date
  (a switch on the page; net 30 to start), aged current / 1–30 / 31–60 /
  61–90 / 90+ days past due, latest first, each opening the job's pay apps.
- **The WIP schedule**: every job won and not closed (awarded, active, on
  hold, substantially complete, financial closeout), cost to cost through
  job cost's own math — contract to date (the last sent application's line
  3, else the contract plus approved change orders), estimated cost (the
  current budget or the PM's estimate at completion), cost to date, %
  complete, earned, billed (the last sent application's line 4), over /
  (under) billing, retainage held, forecast margin — with totals that keep
  over- and under-billing apart (a bank wants both, never netted).
- **Cash by month**: the last six months — billed (what that month's
  applications asked for) against collected (what was paid that month).
- At the top: owed to us (and how much is past due), retainage held across
  every job, left to bill on the running jobs, under / over billed.

`lib/jobs/portfolio.ts` (pure: `arAging`, `lastSentByJob`, `cashByMonth`,
`wipSchedule`; the owed rule is closeout's `owedCents`) · `lib/db/portfolio.ts`
(applications and change orders through RLS; each running job's cost through
`getJobCost`, four at a time).

## Permissions

View level **Jobs** (`jobs`): on for Admin, Manager and Foreman; off for the
crew (Associate) by default; never a prospect's (`PROSPECT_NEVER`, and
`ht_prospect_lockdown` on every job table). Members read through RLS; every
write is a server action on the service role after the edit + Jobs checks
(dollars also need costs; the checklist template is Manager+).

## Still to build

Board #234: the proposal PDF and e-sign on proposals and change orders;
sub and supplier commitments (POs, subcontracts) as committed cost; a
per-sub COI list with expiry reminders; T&M tickets; pay apps to
QuickBooks as invoices once it connects.

Harnesses: `node scripts/jobs-test.mjs` — after ANY change to
`lib/jobs/job.ts`; `node scripts/payapp-test.mjs` — after ANY change to
`lib/jobs/payapp.ts` (these are invoices); `node scripts/jobcost-test.mjs` —
after ANY change to `lib/jobs/cost.ts`; `node scripts/closeout-test.mjs` —
after ANY change to `lib/jobs/issues.ts`, `documents.ts` or `closeout.ts`;
`node scripts/portfolio-test.mjs` — after ANY change to `lib/jobs/portfolio.ts`.
