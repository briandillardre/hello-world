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
