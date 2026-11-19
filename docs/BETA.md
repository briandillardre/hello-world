# The Beta section (`/beta`, migration 162)

Brian, Nov 19: *"Build all of this into hammertrack in a beta section."* These are the ten gaps from that night's read, plus the activation funnel and a public status page. Every tool runs on data HammerTrack already holds.

## Who sees what

- **View level `beta`.** On by default for Admin, Manager, Foreman and Associate. It is in `PROSPECT_NEVER`.
- **Each tool has its own rule** in `lib/beta/tools.ts` (`canOpen`). The hub draws its cards from the same list, so a card never leads to a 404. A typed URL to a tool the login can't open 404s (`requireBetaTool` in `lib/beta/server.ts`).
- **Records live in one table, `beta_records`.** `kind` says which tool and `data` holds the fields. Validation is `lib/beta/registers.ts` → `cleanRecord`, used by both the form and the server.
- **Members hold SELECT only.** Writes go through `lib/actions/beta.ts` on the service role, after the session checks.
- **Dollar kinds** (`rental`, `owning`, `worker_class`) are `costs_only`. The kind CHECKs this and the read policy enforces it with `ht_viewer_can_costs()`.
- **A crew member reads only their own cards.** Foreman and up read everyone's.

| Tool | Path | Opens for | Engine |
|---|---|---|---|
| Certified payroll | `/beta/payroll` | Manager+ with $ and the time clock | `lib/beta/payroll.ts`, `payroll-pdf.ts` |
| Lien clock | `/beta/liens` | Manager+ with Jobs | `lib/beta/lien.ts` |
| Weather-delay packet | `/beta/weather` | Foreman+ | `lib/beta/weather.ts` + `weatherPacketAction` |
| 811 locate tickets | `/beta/locates` | Foreman+ | `registers.ts` (`addWorkdays`) |
| Haul tickets | `/beta/haul` | Foreman+ | `lib/beta/haul.ts` |
| Truck inspections (DVIR) | `/beta/dvir` | anyone with Assets or Maintenance | `lib/beta/dvir.ts` |
| Crew cards & certs | `/beta/credentials` | everyone (own); Foreman+ (crew) | `registers.ts` |
| Español | `/beta/espanol` | everyone | `lib/i18n.ts` |
| What a machine really costs | `/beta/owning` | Manager+ with $ | `lib/beta/owning.ts` |
| Rentals | `/beta/rentals` | Foreman+ with $ | `lib/beta/rentals.ts` |
| Activation | `/beta/activation` | the founder only | `lib/beta/activation.ts` |
| Status | `/status` (public) | everyone | `lib/beta/status.ts`, health cron step 14 |

## Rules worth knowing

**Certified payroll**
- Overtime is hours past 40 in the workweek across ALL jobs, paid at 1.5 × the base rate. Fringe is never multiplied.
- A job's share of that overtime is the hours worked on it after the 40th hour, in time order.
- Open shifts are left out.
- A worker with no payroll class gets no invented pay; the form shows one problem line instead.
- Deductions and net pay stay blank for the payroll company to fill in.
- ID is the last four digits only. The server refuses a whole SSN.

**Lien clock (South Carolina)**
- Notice of furnishing: 90 days from first furnishing (§ 29-5-23).
- Lien: 90 days from last furnishing (§ 29-5-90).
- Suit: 6 months from filing the lien (§ 29-5-120).
- Public jobs: bond notice 90 days after last furnishing for second-tier claimants, and bond suit within one year.
- First and last furnished come from zone sessions plus time cards, unless typed on the sheet. While the job is running, "last" is today.
- The page says it is a reminder, not legal advice.

**Weather packet**
- A day is claimed only when the weather crossed the contract's line AND the site worked under half its median day.
- Days the crew worked through are listed but not claimed.
- The contract's anticipated weather days come off the top.
- A day with no weather record is never claimed.

**811**
- Dig no sooner than 3 working days after the call; the ticket is good for 15 working days.
- Holidays are not modelled, and the page says so.

**Rentals**
- The bill is the cheapest mix of 4-week, week and day rates, plus delivery.
- "Idle on rent" fires only for a rental tied to a tracked machine: 3 or more days with no ledger hours and no moving fix.

**DVIR**
- Covers the 396.11 items.
- Every defect opens a work order (`source_ref dvir:<id>:<item>`).
- An out-of-service defect shows DO NOT OPERATE until a Foreman+ certifies the repair, and the next driver then signs that they saw it.

**Haul tickets**
- Tickets carry no prices. A ticket row is not costs-only and is readable by every foreman.

**Status page**
- One `status_checks` row an hour, kept 120 days.
- A day with no check is "no data", never "up".

Harness: `node scripts/beta-test.mjs` (112 assertions). Run it after ANY change to `lib/beta`.

What's next is board #237: reminders that push, a real LCPtracker import, an attorney read of the lien counts, ticket photos, an offline DVIR, more Spanish, and a footer link to /status.
