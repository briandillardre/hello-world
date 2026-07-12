# AI Roadmap — Seeing → Querying → Discussing → Driving

*Brian, Jul 12 2026: "I want to transition from seeing > querying >
discussing with AI > AI driving the ship." This doc is that ladder, mapped
onto what's actually built, with the gates between rungs and the guardrails
that keep "driving" from meaning "unsupervised."*

## The four stages

### 1 · Seeing — dashboards show, human notices ✅ BUILT
Map, Command Center, reports, alerts, site logs. The human does 100% of the
noticing and 100% of the deciding.

### 2 · Querying — human asks, AI computes ✅ BUILT (Jul 2026)
The assistant with tools: fleet snapshot, asset activity, site visits,
alerts, persisted memory, voice. The human still decides what's worth
asking. Every answer computed from live data, never guessed.

### 3 · Discussing — AI notices first, human decides ⟵ WE ARE HERE
The AI initiates. It reads the day and brings the exceptions to Brian
instead of waiting to be asked:
- **Evening digest** (first artifact — built Jul 2026): a push at 6 PM —
  who worked where, who never clocked out, unacknowledged alerts, machines
  gone dark, checks overdue. The AI writes it; a human reads it.
- **Safety triage**: a daily-log safety field mentioning injury/damage →
  immediate push, not tonight's digest.
- **Nag chains**: unclocked worker on an active site, machine past its
  grease interval → ping the responsible human, escalate one level if
  ignored (worker → foreman → Brian).
- **Anomaly flags**: "the excavator's idle % doubled this week",
  "fuel estimate vs OBD fuel level diverging on the Ram".
Gate to advance: three months of digests/triage where Brian rarely
overrides or corrects what the AI surfaced.

### 4 · Driving — AI acts, human audits
The AI executes inside hard rails, and every action is logged and
reversible:
- Drafts invoices from usage; **posts only after human ✓** (forever).
- Files receipts to QBO once its extraction accuracy is proven.
- Schedules maintenance and messages the operator directly.
- Reassigns geofence alert rules when a new zone is drawn.
- Runs the Monday meeting: agenda auto-built from the week's exceptions.
Gate: each action class graduates one at a time — propose-only → propose
with one-tap approve → autonomous with audit log — never all at once.

## Guardrails (permanent, not training wheels)

| AI may do autonomously | AI proposes, human taps ✓ | AI never does |
|---|---|---|
| Notify, digest, nag, escalate | Invoices, expenses, anything touching QuickBooks | Post to the books unreviewed |
| Compute, flag, rank, summarize | Messages to customers | Fire/discipline signals about a person (it reports facts, humans judge) |
| Schedule internal reminders | Maintenance work orders | Delete data |

Money and people always keep a human in the loop. That's not caution
theater — it's the GAAP screens/books boundary and basic employment sense,
and it's also the sales pitch: "the AI runs the paperwork, you run the
company."

## Build order from here

1. **Evening digest** — `/api/cron/digest`, Vercel cron 6 PM ET (shipped
   with this doc; needs `CRON_SECRET` env + push channel already set).
2. Safety triage (same pipeline, immediate priority path).
3. Receipts inbox with AI extraction → one-tap post to QBO (first
   stage-4 action class, starts propose-only).
4. Nag chains (needs per-user push identity — ntfy topic per user or SMS
   once Twilio verifies).
5. Anomaly detection over weekly aggregates.
6. Monday-meeting agenda builder.
