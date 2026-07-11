# Idea Lab — the beehive gets a hive

One inbox, one scorecard, one experiment at a time. HammerTrack gets 80%+ of
all effort until it has real MRR. Everything else lives here and waits its
turn. Review at business-plan phase gates only.

## The rules (Musk 5-step, applied to ideas)
1. **Question the requirement** — who pays, and can Brian name 10 reachable buyers?
2. **Delete** — if it uses neither the engine nor construction distribution, kill it now.
3. **Simplify** — the test is phone calls, not code. No demo before 15 conversations.
4. **Accelerate** — one experiment at a time, two-week timebox.
5. **Automate** — only after someone has paid.

**Kill test is written BEFORE the experiment starts.** Example: "Call 15
dumpster rental companies; <5 would pay $10/can/mo → dead."

## Scorecard (0–2 each, 10 max — don't build below 7)
| Question | Weight |
|---|---|
| Who pays, how much, how often? | 0–2 |
| Can I name 10 buyers I can reach this month? | 0–2 |
| Reuses the live-map engine? | 0–2 |
| Uses my construction-world distribution? | 0–2 |
| Can it be killed/proven in 2 weeks of calls? | 0–2 |

## The engine (the real asset)
Not a construction app — a **live-things-on-a-map engine**: device ingest
(flespi/OBD/BLE) → normalize → store → live map → replay → zones →
entry/exit events → alerts → cost accrual → invoices. Any vertical that is
"things moving, someone accountable, someone billing" can reuse ~90% of it.

## Active bet
- **HammerTrack** — construction asset tracking. Pilot live. Everything below waits.

## Next in line (scored, waiting for a phase gate)
| Idea | Score | Why it waits | Kill test when green-lit |
|---|---|---|---|
| Roll-off dumpster / porta-john tracking | 9 | Same stack, same buyer psychology, fragmented market, nobody under $15/unit | 15 calls to rental cos; <5 at ~$10/can/mo → dead |
| Snow & ice contractor ops | 8 | GPS breadcrumb = slip-and-fall legal proof; compliance sells itself; seasonal | 15 plow contractors; <5 would pay for service-verification logs → dead |
| Dirt/haul load ticketing | 8 | Site log (entry/exit per zone) is already 70% of the product | 10 GCs + 5 hauling cos; <5 confirm lost-ticket pain costs real money → dead |
| Traffic counts for contractors/civils (rent-a-sensor) | 7 | Real permit-study demand; hardware R&D; wrong to start solo | 10 civil engineers; <4 rent at $X/wk → dead |
| Rental yard utilization | 7 | Cost engine pointed at their P&L; longer sales motion | 10 independent rental stores; <4 demo requests → dead |

## Parking lot (fun ≠ business — revisit only if the filter changes)
- **ADS-B 3D plane map** — incumbents free & global (FR24, ADSB.exchange). Build once as a weekend engine demo, never as a company.
- **King-of-the-hill road-trip game** — hit-driven consumer lottery; no revenue model; maybe a marketing feature someday.
- **Public restroom reviews** — Flush/SitOrSquat exist free; UGC cold-start; feature not company.
- **Celebrity-voice funny GPS** — right-of-publicity lawsuits (Waze *licensed* voices), stereotype maps are brand poison, novelty churn.
- **Live geo-sentiment heatmaps** — salvaged organ from the above; real B2B tech, crowded, far from distribution edge.

## Process for a green-lit experiment
1. New session, new repo — HammerTrack codebase stays clean; lift engine modules as needed.
2. Week 1: the calls. Week 2: paper demo / landing page only if calls pass.
3. Passed kill test → it earns a scoped MVP sprint. Failed → move to Parking lot with a one-line autopsy.
