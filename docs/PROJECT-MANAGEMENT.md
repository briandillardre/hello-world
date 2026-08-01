# Project Management per Zone — Research & Build Plan

*Aug 1 2026. Brian's ask: "add project management tools in here per project
geofence — look at other project management solutions and come up with a solid
plan." This doc is the deep dive; migration 046 + the Project Hub on the zone
page is the implementation.*

## The landscape — what's out there and what it costs

| Product | Target | Price | What it's actually good at | What kills it for our customers |
|---|---|---|---|---|
| **Procore** | Commercial GCs, $10M+ revenue | ~$375+/mo base, custom annual (scales on volume; commonly $10-50k/yr) | RFIs, submittals, drawings, bidding, full financials — the enterprise standard | Price, 6-week onboarding, needs a back-office person to run it |
| **Buildertrend** | Residential builders/remodelers | $199–$799/mo | Client-facing: selections, change orders, client portal, schedules | Homeowner-centric workflow; a grading or paving contractor has no "selections" |
| **Fieldwire** (Hilti) | Field crews, all sizes | Free–$54/user/mo | **Punch lists / tasks on plans** — the field favorite; simple, fast, mobile | Per-user pricing stacks up; no cost/accounting side; separate app to adopt |
| **Raken** | Field supervisors | ~$30+/user/mo | **Daily reports** + time cards + production tracking | Single-purpose; another app, another login, another subscription |
| **Contractor Foreman** | Small GCs (budget pick) | $49–$249/mo flat | 35 features for one price — the "everything, cheap" play | Jack of all trades, master of none; clunky UX; no telematics |
| **CompanyCam** | All trades | ~$24/user/mo | Job-site photos auto-organized per project | Photos only |
| **monday / Asana / Trello** | Generic | $0–$20/user/mo | Flexible lists | Zero construction awareness; someone has to type everything in |
| **Reality for our target** | Owner-operator → ~30-person GC | $0 | **Group texts + a spreadsheet + the owner's memory** | Nothing is written down; punch items die in text threads |

## The insight that shapes the build

Every PM product above shares one weakness: **a human has to feed it.** Daily
logs get typed, hours get entered, progress gets updated — or (usually) they
don't, and the tool dies in month two. HammerTrack's unfair advantage is that
the job site **reports itself**: trackers already produce who-was-there,
equipment hours, accrued cost, site weather, trips, and stops per zone with
zero data entry. We already have (shipped): the site log (visits), daily logs
w/ photos + receipts at clock-out, per-zone weather receipts, job costing →
QBO invoices, zone notes, the project folder link, and zone completion (the
Z-flip). **That's 70% of Raken + the cost side of Procore, self-feeding.**

What's genuinely missing is the *forward-looking* half — the three things a
small GC writes on a legal pad today:

1. **The punch list** — what still needs doing, who owns it, by when
   (Fieldwire's core loop, and the most-used feature in every field PM tool).
2. **Milestones** — the schedule as ten dated line items ("grade complete
   8/15", "base down 8/22", "pave 9/1"), not a Gantt dependency graph nobody
   maintains.
3. **Budget vs actual** — one number the owner sets, burned against by the
   equipment-hours + receipts data we already track automatically.

## v1 scope (built now — migration 046 + Project Hub on the zone page)

- `project_tasks`: title, open/done, normal/high priority, assignee (team
  member), due date. Flat list, newest first, overdue glows. Add in two taps.
- `project_milestones`: name + target date + done. Rendered as a schedule
  strip with a progress bar; next milestone called out.
- `geofences.budget`: one number. Actual = tracked equipment cost (the same
  accrual engine that prices invoices) + job-coded receipts. Honest labeling
  of what the window covers; over-budget turns red.
- Everything renders inside the existing zone page (the "job cockpit"), which
  is already the project record: usage, invoicing, site log, weather, notes,
  folder, completion. Site zones only — boundaries and yards aren't projects.

## Deliberately NOT built (and the trigger that changes the answer)

| Feature | Why not now | Build when |
|---|---|---|
| Gantt / dependencies | Small GCs don't maintain them; milestones cover it | A 50+ person GC pays for it |
| RFIs / submittals | Commercial-GC paperwork; our beachhead has none | First commercial GC >$10M asks |
| Drawings / plan markup | Fieldwire's moat, huge build, tablets in the field | Never build; integrate if demanded |
| Client portal | Wrong stage; owner IS the client contact | Founding-25 feedback says otherwise |
| Change orders | QBO already handles the money side for our size | Multiple customers ask |
| Crew scheduling / dispatch | Adjacent product; AI dispatcher may cover it | Revisit with the AI roadmap |

## Competitive roadmap (added Aug 1 2026 — Brian: "everyone hates Procore")

Procore isn't hated for missing features — it's the $10–50k/yr price, 6-week
onboarding, and the back-office babysitter it needs. We win by covering the
20% a 5–50 person contractor actually opens, flat per-asset, zero onboarding,
on data that feeds itself. Build order (effort roughly ascending within tier):

**Tier 1 — the money loop (wins deals):**
1. **Estimates → proposals → e-sign** — line-item estimate, branded PDF,
   client signs via magic link (no DocuSign fee), winner converts to a zone
   with budget pre-filled.
2. **Change orders with e-sign** — the #1 place small GCs lose money; scope +
   price + tap-to-sign, auto-added to zone budget and the QBO invoice.
3. **Pay apps (AIA G702/703-style) + lien waiver tracking** — continuation
   sheet PDF off the cost data we already accrue.

**Tier 2 — daily operations (keeps them):**
4. **Files & photos hub per zone** — native uploads (plans, contracts,
   permits) + auto-filed field photos; kills the CompanyCam sub.
5. **Crew schedule board** — week-view who's-on-which-job grid feeding the
   existing clock-in/geofence loop; AI dispatcher reads/writes it.
6. **Safety pack** — toolbox-talk log + incident reports w/ photos, tied to
   daily logs (insurance-premium talking point).
7. **Sub compliance / COI tracking** — per-sub folder: certificate of
   insurance w/ expiry alerts ("GL expires in 30 days — don't let them on
   site"), W-9, license, lien waivers received. A table + reminder cron, not
   a product; agents charge $100+/mo for this alone (myCOI, SmartCompliance).
8. **T&M tickets** — time-and-materials extras signed in the field. UNFAIR
   ADVANTAGE: our ticket attaches tracked machine hours + operator time +
   weather automatically — evidence Procore can't generate.

**Tier 3 — build when a customer demands it:**
9. RFIs / submittals-lite — first commercial GC >$10M.
10. Inspections/checklists with templates (QR equipment checks already exist;
    extend to site checklists).
11. **Closeout / turnover package** — one-click branded PDF binder: photos,
    daily logs, weather record, punch history, warranty list. Mostly
    assembled from data we already have; great "wow" demo.
12. Delay-notice letters backed by our per-zone weather receipts — automatic
    documentation for weather-delay claims. Differentiator nobody else has.
13. Sub directory + "send scope, collect quotes" — the most of
    BuildingConnected we'd ever build. Never the network itself.

**Never build:** drawings/BIM viewer + markup (Fieldwire/Autodesk moat), bid
network (can't out-network Autodesk), accounting (QBO is the ledger, forever).

## The full Procore GC-side inventory (so nothing surprises us in a demo-off)

Have ✅ / roadmap ⬜ (tier above) / skip ✖:
project directory ✅ · daily logs ✅(self-feeding) · photos ✅→⬜4 · punch ✅ ·
schedule ⬜5 (P6/MS Project sync ✖) · budget ✅ · prime contract ✖(QBO) ·
commitments/subcontracts + POs ⬜(thin table, Tier 2–3) · change events/orders
⬜2 · pay apps/invoicing ⬜3 · direct costs ✅(receipts/expenses) · cash-flow
forecast ✖(QBO) · estimating/bidding ⬜1/13 · prequalification ✖ · COI &
compliance ⬜7 · RFIs ⬜9 · submittals ⬜9 · transmittals ✖ · meeting minutes
✖(notes cover it) · correspondence/notices ⬜12 (weather-backed only) ·
drawings + specs ✖ · inspections ⬜10 · observations ✖(punch covers it) ·
incidents ⬜6 · T&M tickets ⬜8 · action plans ✖ · closeout/warranty/O&M ⬜11 ·
Procore Pay (sub payments + waiver exchange) ✖(waiver *tracking* only) ·
analytics ✅(reports/scorecard) · equipment tracking ✅(we're better) ·
timesheets ✅ · workforce planning ⬜5.

## Who Procore serves (Brian's question, Aug 1)

Three personas, priced separately, all annual contracts on construction volume:
1. **General contractors** — the core (what everything above maps).
2. **Specialty contractors / subs** — field + financials sold downstream,
   often because their GC forced Procore on them (resentment = our opening:
   subs who hate the seat they were forced to buy).
3. **Owners / developers** — "Procore for Owners": capital-program portfolio,
   funding sources, owner-side budgets, portfolio analytics. Real but
   secondary; owners often just get logins to the GC's instance.

Implication for us: stay GC/sub-side. The owner/developer angle for
HammerTrack (an owner watching their GC's live site) is a share-link feature,
not a product line.

## Fit by client size (mirrors the system-map infographic)

- **Owner-operator (1–5 people):** punch list on the phone replaces the legal
  pad. Budget bar is the whole financial dashboard. Sell THIS.
- **Small GC 5–30 (beachhead):** punch list + milestones + self-feeding site
  log kills their Raken/Fieldwire shopping trip — PM becomes a retention moat
  and justifies the per-asset price without per-user fees. **Our per-asset
  pricing means PM is effectively free vs $54/user/mo Fieldwire.**
- **Mid contractor 30–100:** needs assignee accountability (built) and will
  start asking for RFIs/change orders (recorded above, not built).
- **Regional fleet 100+:** wants API export of tasks/milestones into their
  existing Procore. Don't compete with Procore there — coexist.
