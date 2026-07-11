# Field Ops — Clock, Daily Logs, QR Checks, and the AI Org

*Jul 11 2026. Brian + Nate's requirements: crews that "waste time, don't follow
directions, can't remember directions, can't communicate." The design principle
for every screen here: **the field guy does the least possible typing, and the
system extracts the most possible truth.** GPS is the witness; the log is the
confession; AI reconciles the two.*

## The loop (what ships in Phase 1 — built)

```
CLOCK IN  → pick where the day goes:  Project (zone) | Shop | Overhead | Maintenance
          → "plan for today" one-liner (optional but nagged)
WORK      → phone GPS already tracking (Go Live), machines already tracking
CLOCK OUT → BLOCKED until the daily log is filled:
              writeup (required) · photos · safety issues ·
              trucks fueled? · equipment fueled?
QR TAP    → sticker on every machine: Greased / Fueled / Radiator blowout /
            Air filter / Oil check — one tap, timestamped, shows "last done Xd ago"
OFFICE    → /logs: every log sorted by day → project, hours table per person,
            safety flagged red, photos inline
```

### Why clock-out is the leverage point
You can't force a writeup at 7am (nothing has happened) and you can't chase it
at 9pm (they're gone). Clock-out is the one moment the worker wants something
from the system (their hours) — so the log is the toll gate. No log, no
clock-out, no hours. Idiot-proof = incentive-aligned, not reminder-spammed.

### Forced-ness mechanics (phased)
- **Phase 1 (built):** clock-out is physically gated behind the log form.
  Still clocked in at 7 PM → the entry stays open and shows on /logs as
  "STILL CLOCKED IN" — public shame column in the morning meeting.
- **Phase 2:** geofence triggers — phone enters a job-site zone unclocked →
  push "Clock in to Riverfront?"; leaves the last zone of the day → push
  "Clock out + log?". Auto-draft the entry so it's one tap to accept.
  Missed-log nag at 6 PM via ntfy/SMS to the worker AND their foreman.
- **Phase 3:** payroll export only pays logged hours. Compliance hits 100%.

## The eight asks, mapped

| # | Ask | Where it lands |
|---|---|---|
| 1 | Writeup | Daily log form, required field (Phase 1 ✅) |
| 2 | Pictures | Daily log photos → `field-photos` bucket, inline on /logs (Phase 1 ✅) |
| 3 | Sorted by project | /logs groups day → project; clock-in picks the project (Phase 1 ✅) |
| 4 | Receipts | Photo-first flow, AI extraction → QBO (design below, Phase 2) |
| 5 | Ping super/foreman | Safety text or flagged writeup → ntfy push to foreman topic (Phase 2); AI triage decides what's ping-worthy (Phase 3) |
| 6 | Safety issues | Dedicated field on the log, rendered red on /logs (Phase 1 ✅) |
| 7 | Trucks/equipment fueled | Two toggles on the log (Phase 1 ✅) + QR "Fueled" tap per machine (Phase 1 ✅) — the log toggle is the crew-level answer, the QR tap is the machine-level record |
| 8 | Hours table + who-ran-what | Hours table on /logs (Phase 1 ✅); GPS worker↔machine pairing is the killer feature (design below, Phase 2) |

## Receipts (ask #4) — "I am not going to deal with it"

The only version that survives contact with the crew: **snap a photo, done.**
Nobody types a vendor name in a truck.

1. Worker taps "+ Receipt" in the daily log (or any time while clocked in),
   takes a photo. That's their entire job. Receipt inherits context for free:
   who, when, which project (from the open time entry), where (phone GPS —
   the fuel-station POI lookup we already do for stops).
2. AI pass (vision): extract vendor, total, date, fuel-vs-materials-vs-other.
   Confidence below threshold → leave fields blank, don't guess.
3. **Receipts inbox** on /accounting: one line per receipt — photo, extracted
   fields, suggested project + QBO category. Brian/bookkeeper taps ✓ →
   posted to QBO as a Purchase with the project class, photo attached as the
   document. Tap ✗ → back to the worker with a reason.
4. GAAP boundary stays intact: nothing posts to the books without the human ✓.

## Who-ran-what (ask #8) — the killer feature

**Problem:** payroll hours must attribute to projects (and eventually cost
codes: grading / stormwater / sewer), and machine hours must attribute to
operators. Today that's a foreman's memory. We have two GPS streams that
already know the answer.

**Correlation engine (Phase 2):**
- Inputs: the worker's phone trail (Go Live) + every machine trail, both
  already in `asset_locations`.
- A worker is "operating" a machine when both trails move together:
  distance < ~50 m while both moving, sustained ≥ 10 min. Score by
  co-movement fraction; hand off cleanly when the phone jumps to another
  machine ("Kody drove the 2500 until 11:40, then the 3500").
- Output per worker-day: segments of (machine, minutes, project-zone) with
  a confidence score. High confidence → pre-filled; low → "?" chip.
- **The foreman never enters data — he confirms it.** Clock-out for a
  foreman shows the day's proposed grid: rows = his crew, cells = machine +
  hours + project, pre-filled from GPS. He fixes what's wrong (rare) and
  signs. That signed grid is the labor cost record.
- Validation rule Brian asked for: each worker's attributed hours must total
  their clocked hours. The form won't sign off unbalanced.
- Cost codes (grading/stormwater/sewer) can't come from GPS — they come from
  the foreman's grid as a split within the project, defaulting to the whole
  day on one code. Zones-within-zones (a "sewer run" sub-zone) can automate
  this later for machines.

**Why this wins deals:** Tenna tracks machines. Nobody in the $3-8 bracket
turns two GPS streams into signed, project-attributed labor + equipment hours
with zero data entry. This is the demo moment for every GC with 10+ guys.

## QR equipment checks (built — Phase 1)

- Every asset gets a short slug; sticker QR points at `/t/{slug}`.
  Stickers print from the asset's QR — laminate, zip-tie or 3M tape at the
  operator's eye line (door jamb / ROPS post).
- Scan → sign-in (once per phone) → giant buttons: **Greased · Fueled ·
  Radiator blowout · Air filter · Oil check · Washed**. Each shows "last done
  X days ago" and goes **red past its interval** — the sticker answers "does
  it need grease?" before the tap. One tap logs who/what/when; optional note.
- Zero navigation, zero typing, works with gloves. The machine's check
  history shows on the same page (last 10).
- Phase 2: intervals per machine per check type (greased every 50 engine-hrs
  — we have engine hours from OBD); overdue checks page on /maintenance;
  ntfy nag to whoever's clocked into that machine's project.

## "I want AI to run the organization"

The assistant just got tools (fleet, activity, visits, alerts). The field-ops
tables become its next tool set, and the org chart looks like:

- **Every evening (digest):** "3 of 4 logged out with logs. Kody still
  clocked in. Excavator 336: greased 9 days ago — past the 7-day interval.
  Two receipts waiting for approval, $214 total. Riverfront labor today:
  38.5 hrs, all attributed."
- **Triage (ask #5):** safety text mentions anything injury/damage-shaped →
  immediate ntfy to Brian + foreman, not the evening digest.
- **Nag chains:** unclocked worker on site, unlogged clock-out, machine past
  a check interval — AI pings the responsible human, escalates one level if
  ignored (worker → foreman → Brian).
- **Answers:** "who ran the backhoe this week and what did it cost per hour
  on Maple St" — assistant tools over time_entries + pairing segments +
  rates. The foreman's signed grid makes the answer defensible.

## Phasing

| Phase | Scope | Status |
|---|---|---|
| 1 | Schema (015), /clock with gated log, photos, /logs office view, hours table, QR checks + sticker sheet | **Built** |
| 2 | Receipts inbox + AI extraction → QBO; geofence clock nags; worker↔machine pairing engine + foreman confirm grid; check intervals + overdue | Next — order by Brian's pain |
| 3 | AI digests, safety triage, escalation chains, payroll export | After 2's data exists |

**Migration to run: 015 (tables + `field-photos` bucket + asset QR slugs).**
Workers need accounts (invite from /team — viewer role is enough to clock).
