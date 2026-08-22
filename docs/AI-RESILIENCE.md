# AI Resilience — how HammerTrack survives (and rides) the AI wave

*Recorded Aug 21 2026 (Brian: "make sure this thing has legs to stand on even
when AI becomes so prevalent… I will own the data, and we need to make sure
other folks' AI, whatever they are using, can access this.")*

## The thesis

AI progress commoditizes SOFTWARE — features, dashboards, CRUD, integrations.
Anyone with a frontier model can clone an app's UI in months. It does NOT
commoditize:

1. **Atoms** — trackers bolted to machines, SIMs, KORE relationships,
   personal installs. The hardware install base gets MORE defensible as
   software gets cheaper.
2. **Proprietary data** — the cross-source ops graph (machines × crews ×
   dollars × weather × imagery, per zone, timeline-true). As models get
   smarter, value shifts FROM intelligence TO the context it reasons over.
   Better AI makes the data moat worth more.
3. **Money rails** — payroll hours and job-cost invoices flowing through us
   into QuickBooks. Ripping HammerTrack out then means breaking payroll.
4. **Vertical trust distribution** — contractors buy from a contractor,
   through dealers and supply houses. Invisible to San Francisco.

Also structural: AI erodes the INCUMBENT's moat (engineering headcount)
faster than ours. HammerTrack already runs at the AI-native cost structure
(~$130/mo burn) that Tenna/Samsara must painfully restructure into.

## The strategic move: be the tool AI calls, not the tool AI replaces

When contractors live inside AI assistants, the interface layer belongs to
Claude/ChatGPT — apps that ARE interfaces lose. Apps the assistants CALL win.

**HammerTrack Agent Interface (MCP server):** expose the customer's fleet to
whatever AI they use — "where's my excavator," "what did Riverside cost this
week," "clock my crew out" — answered by THEIR assistant through OUR data and
rails, authenticated per company.

- Prereq: per-company API keys (task #22) — the MCP server authenticates a
  company, never the platform.
- Scope v1 (read): asset locations/status, zone hours+costs, alerts,
  maintenance state. v2 (act): create punch items, assign WOs, clock events.
- This converts the platform shift from the biggest threat into a free
  distribution channel — and it's a moat Tenna cannot copy without our graph.

## Guardrails

- **Never market "AI" as the differentiator.** Every competitor bolts on a
  chatbot within a year and the word goes flat. Market OUTCOMES (texts at
  2 AM, hours that book themselves, jobs that show their burn). AI stays the
  invisible engine. (Applies to ads, splash, pricing — same standing as the
  splash truth rule.)
- **Rent intelligence, own context.** Models stay swappable commodities
  (Haiku today, whatever is best tomorrow); the schema, the ledger, and the
  telemetry are ours.
- **Data stays clean and exportable** — customers can always leave with
  their data (trust sells), but the cross-source graph only exists here.

## The build agenda this thesis ranks first

1. Close the money loops: QBO timesheet push (TimeActivity), then PM Tier 1
   (estimates → e-sign → change orders → pay apps).
2. Offline field queue — dead-zone jobsites must never lose a clock event or
   QR check.
3. Multi-tenant hardening for customer #2: per-company ingest keys, zero-
   touch onboarding, provisioning playbook.
4. Agent Interface (MCP) once #22 lands.
5. Support scaffolding (in-app help, onboarding guides) so 25 founding
   companies don't all text Brian at 6 AM.
