# VitalTrack — Health App Implementation Plan

**Owner:** Brian Dillard · Greenville, SC
**Written:** July 15, 2026 · Living document — update at every phase gate (same process as docs/BUSINESS-PLAN.md)
**Thesis:** A personal health OS that unifies your Garmin watch data, your full medical history (injuries, conditions, goals), and your bloodwork into one AI-driven preventative dashboard — first for Brian, then democratized at a price regular people can afford ($99/yr, not $365–499/yr).

---

## 0. The Verdict (asked for a yes/no — here it is)

**YES to building it — in two tracks with a hard gate between them.**

- **Track A — Personal Health OS (build now, unconditional YES).** Costs ~$0 on the existing Vercel/Supabase playbook, reuses ~60% of HammerTrack's architecture, and delivers real value to Brian on day one regardless of whether it ever becomes a business. This is also the only honest way to validate Track B — same "dogfood or die" rule as HammerTrack Phase 0.
- **Track B — Democratized SaaS (conditional YES, gated).** The market is real and growing 20%+/yr, and there is a genuinely empty quadrant (see §3). But unlike HammerTrack, this space is crawling with funded giants (Function $2.5B, Whoop $10B, Oura $11B), **and Brian has no built-in distribution channel for health** the way he does for construction. Do NOT spend SaaS money until the Track A exit gate and the Phase 1 demand gate both pass (§7).

**Why yes at all, given the giants:**
1. **The empty quadrant is real.** Labs+AI players (Function $365/yr, Superpower $499/yr) barely integrate wearables. Wearable players (Whoop, Oura) lock labs to their own hardware. PHR players (Guava, free) have no labs or AI. **Nobody serves the tens of millions of Garmin/Fitbit/Samsung owners with wearables + labs + medical history + AI under $150/yr.** Garmin users are specifically orphaned — even Garmin doesn't do it.
2. **Nobody joins the three data types.** No product on the market connects "your ACL surgery + your HRV trend + your ApoB" in one AI context. That's exactly the product Brian is asking for personally — and the r/QuantifiedSelf crowd maintains "elaborate, convoluted Excel docs" (~47 min/week of manual merging) because it doesn't exist.
3. **The Superpower $199 tier and Apple's Feb 2026 retreat** from its AI health coach (Project Mulberry scaled back) both confirm: affordable-preventative is the growth vector and the platform owners just left the lane open.
4. **The HammerTrack playbook transfers:** solo founder + Claude Code as the dev team + Vercel/Supabase near-zero fixed costs + undercut incumbents on price. The 88%-gross-margin math works even better here (no hardware COGS at all — users bring their own watch).

**Why the gate matters (the brutal truths, HammerTrack-style):**
1. **Distribution is the whole game, and this time you don't own a channel.** HammerTrack works because Brian knows 25 contractors by first name. There is no equivalent list for health app buyers. Track B lives or dies on content/community/ads — unproven muscle.
2. **The incumbents are racing down-market.** Function cut $499→$365 (promos to ~$250), Oura sells a 50-biomarker panel for $99. The window for a cheap unbundled player is open now but will narrow. If Track B doesn't show organic pull by the Phase 1 gate, keep it as a personal tool and lose nothing.

---

## 1. Concept & Positioning

**One-liner:** *"Your watch already knows. Your bloodwork confirms it. VitalTrack connects them — and tells you what to do about it before it becomes a diagnosis."*

- **BYO wearable.** Works with the Garmin you already own (then Fitbit, Apple Watch, Samsung, Oura). No $300 ring, no $199/yr strap subscription.
- **BYO labs.** Upload any lab PDF (Quest, Labcorp, Function, hospital) — parsed by AI into structured biomarkers. In-app lab ordering comes later (Phase 3).
- **Full health context.** Injuries, surgeries, conditions, family history, medications, goals — the longitudinal record every competitor ignores — feeding an AI that sees the whole picture.
- **Preventative, not diagnostic.** Wellness positioning (FDA Category 1/2 claims only — see §6). The AI suggests lifestyle changes and *"panels worth discussing with your doctor,"* never diagnoses.
- **Price to democratize:** free personal tier + **$99/yr Plus**. Netflix pricing against Function's $365 and Superpower's $499.

Target user (Track B): the regular person with a Garmin/Fitbit who will never pay $400/yr for a longevity club membership — the actual "democratize preventative health" market, deliberately NOT the Huberman-optimizer elite every funded competitor chases.

---

## 2. Name & Domain Brainstorm (screened Jul 15, 2026)

Screen method: DNS resolution (resolves = taken; no DNS = likely available). **Verify at Namecheap before buying — DNS screen isn't authoritative.**

### Recommended: **VitalTrack** — vitaltrack.ai
Brand-family play: **HammerTrack tracks your fleet. VitalTrack tracks you.** Same "-Track" suffix, same owner story ("the contractor who built a tracker for his trucks built one for his body"), instantly explainable. vitaltrack.com is taken, but the .ai pattern matches hammertrackai.com — and for an AI-first health product, .ai is on-brand rather than a compromise.

| Candidate | .com | .ai | Notes |
|---|---|---|---|
| **VitalTrack** ⭐ | taken | **available** | Brand family with HammerTrack; first choice |
| **VitalCompass** | **available** | **available** | Both TLDs open — strongest fallback; "compass" = guidance positioning |
| **OpenVitals** | taken | **available** | Best fit for the "democratize" mission framing |
| MarkerTrack | **available** | — | Biomarker + Track family; a bit clinical |
| Prevently | **available** | — | Says the mission; slightly startup-generic |
| Biomarkr | **available** | taken | Dated dropped-vowel style |
| Preventix | **available** | — | Pharma-sounding |
| EverBaseline / SelfBaseline | **available** | — | "Baseline" concept is good; compounds are clunky |
| VitalOS | **available** | taken | "Health OS" positioning |
| PulseAtlas / EveryMarker | **available** | — | Bench options |

Taken (checked, skip): vitalstack, healthstack, healthtrack, bodyledger, healthledger, baselinehealth, trackwell, bedrockhealth, keystonehealth, northstarhealth, healthatlas, truebaseline, vitalgauge, healthcompass, wellbase, steadyhealth.

**Action:** buy **vitaltrack.ai** + **vitalcompass.com** (~$80–100 + ~$12) — the second is cheap insurance and a redirect, same as hammertracks.com/hammertrax.com. Trademark search on "VitalTrack" before Phase 2 spend (the name is used by some medical device products — a health-tech trademark check is a real to-do, ~$350 DIY like HammerTrack).

---

## 3. Market Viability & Competitors

### Market size
- Digital health: ~$347B (2025) → ~$946B by 2030, ~20–24% CAGR (Grand View; estimates range $199B–$420B for 2025).
- Wearable healthcare devices: $45.3B (2025) → $76B (2030). Oura ~5M paid members / ~$1B 2025 revenue; Whoop 2.5M members, $1.1B run-rate.
- DTC lab testing: ~$3.6–4.7B (2025), 9–14.5% CAGR. Raw panels are commoditizing fast (Quest $29–500 direct; Oura's 50-marker panel $99) — **value is migrating from the blood draw to the interpretation layer**, which is exactly where VitalTrack plays.

### Competitor table

| Player | Price | What they do | What they DON'T do | Scale |
|---|---|---|---|---|
| **Function Health** | $365/yr (was $499) | 160+ lab tests, clinician review, AI insights | Real wearable integration (Apple-only, reviewers call it broken); no injury/condition record; annual cadence, not daily | $2.5B val, $350M raised, "hundreds of thousands" of members |
| **Superpower** | $499/yr; new $199 tier | 100+ biomarkers 2×/yr, AI concierge, bio-age score | Wearable depth half-baked (via Junction API, HealthKit missing at launch); no PHR | $30M Series A @ $300M+, 150K waitlist |
| **InsideTracker** | $149/yr + $340/panel (≈$1.5K/yr quarterly) | Labs + Garmin/Oura-informed recommendations | Medical history, physician layer, AI chat; expensive per draw | Sub-scale (~$17.5M raised since 2009) |
| **Whoop** | $199–359/yr + hardware | Recovery/strain/sleep; 65-marker labs $199/yr add-on | Third-party wearables (closed hardware); PHR; conditions | $10.1B val, 2.5M members, Abbott + Mayo investors |
| **Oura** | $299–499 ring + $69/yr; $99 lab panel | Sleep/readiness; lab panels + PDF lab uploads (Jun 2026) | Non-Oura wearables; medical history; deep interpretation | ~$11B val, ~5M paid members |
| **Marek Health** | $1K–3K+/yr realistic | Telehealth optimization, TRT crowd | Wearables, affordability, app experience | Niche |
| **Levels** | $200/yr + $100–200/mo CGM | Glucose/metabolic niche | General prevention; too expensive for regular people | Niche |
| **Guava Health** | Free(mium) | PHR + wearable imports (incl. Garmin), symptom tracking | Labs ordering, AI insights, clinician anything | Indie |
| **Bearable** | $35/yr | Symptom/mood correlation (chronic illness) | Labs, AI, wearable depth | Indie |
| **Heads Up Health** | $299/**mo** | The original wearables+labs unifier — **pivoted B2B to clinics** | Affordable consumer anymore — *left the consumer slot vacant* | B2B |
| **Empirical Health** | Free + $9/mo consults | Apple Watch + labs preventive cardiology | Garmin/Android; narrow specialty; 4 states | Indie |
| **Apple / Google** | Free / $9.99/mo | Platform health layers, AI coaches (Google GA May 2026) | Labs, biomarker panels, cross-ecosystem data, PHR curation; **Apple scaled back its AI coach Feb 2026** | Platform |
| **OpenHealth** (OSS) | Self-host | Labs + records + local LLM chat | Wearable APIs, hosting, polish (3.9K GitHub stars = demand signal) | OSS |

### The gap matrix (why the quadrant is empty)

| | Wearables | Labs | Medical history | AI insights | <$150/yr |
|---|---|---|---|---|---|
| Function / Superpower | ✗ (weak) | ✓ | ✗ | ✓ | ✗ |
| Whoop / Oura | ✓ (own HW only) | ✓ (own ecosystem) | ✗ | ✓ | ✗ |
| Guava / Bearable | ✓ | ✗ | ✓ | ✗ | ✓ |
| Apple / Google | ✓ (own ecosystem) | ✗ | ✗ | partial | ✓ |
| **VitalTrack** | **✓ BYO** | **✓ BYO→order** | **✓** | **✓** | **✓ $99/yr** |

### Honest risk list
- Function keeps cutting price; Oura/Whoop bundle labs cheap; a platform coach ships eventually. **Mitigation:** BYO-everything neutrality is structural — hardware players can't copy it without cannibalizing hardware; labs players won't do Garmin depth for a niche.
- Garmin's official API is **paused for new applicants** (no ETA) — integration must route through an aggregator (§5). Aggregator dependency = per-user COGS forever.
- No distribution channel (the #1 risk — see §0 and the Phase 1 gate).
- Consumer trust: health data + solo founder. Mitigation: no ad pixels ever, plain-English privacy policy, export/delete buttons from day one (§6 — this is also the law).

---

## 4. Product Spec

### 4.1 Core surfaces (Track A, v1)
1. **Today dashboard** — sleep score, resting HR, HRV trend, steps, stress/Body Battery (if available), with 7/30/90-day sparklines. Same time-range discipline as HammerTrack's map: every range (Today / 7d / 30d / YTD / All) must work before shipping.
2. **Health record** — structured longitudinal profile:
   - Conditions & injuries (e.g., back injury 2019, knee surgery) with dates, status (active/resolved/managed), notes, attachments
   - Medications & supplements with start/stop dates
   - Family history
   - Goals ("get resting HR under 60," "fix sleep," "lose 15 lbs") with target metrics the dashboard tracks automatically
3. **Labs** — PDF upload → Claude parses into biomarker rows (analyte, value, unit, reference range, collection date, LOINC code) → trend charts across draws → flagged out-of-range values in wellness language.
4. **AI advisor (Claude)** — chat + weekly digest with the FULL context: wearable trends + health record + labs. Answers "why is my sleep worse this month?", produces the **bloodwork suggestion engine** (§4.4), drafts questions to bring to a doctor visit. Reuses the HammerTrack AI-dispatcher pattern (ANTHROPIC_API_KEY, Haiku for cheap queries, Sonnet/Opus for the weekly deep-dive).
5. **Timeline** — unified event stream (injury, lab draw, PR workout, illness, med change) over the metric charts — the "what changed and when" view. Reuses HammerTrack's timeline/scrubber UI thinking.

### 4.2 Data model (Supabase, mirrors HammerTrack schema style)
```
profiles            — user, DOB, sex, height; RLS by user_id (vs company_id in HammerTrack)
metric_samples      — (user_id, ts, type, value, source) — steps, hr, resting_hr, hrv,
                      stress, body_battery, spo2, respiration, weight …
                      partitioned by month like positions; hypertable-style indexes
sleep_sessions      — start/end, stages (deep/light/rem/awake), score, source
activities          — workouts: type, duration, distance, avg/max HR, load, FIT file ref
conditions          — injuries/diagnoses: name, onset, resolved_at, status, severity, notes
medications         — name, dose, start/stop, reason
lab_reports         — upload ref (Supabase storage), source lab, collected_at, parsed_at
biomarkers          — (report_id, loinc, name, value, unit, ref_low, ref_high, flag)
goals               — metric target, deadline, status
events              — timeline stream (unified from all above + manual entries)
ai_digests          — weekly AI summaries, suggestions, citations to the user's own data
integrations        — per-user provider tokens (aggregator user_id, scopes, status)
```
Same patterns as HammerTrack: migrations in `supabase/migrations/`, RLS on everything, demo mode with mock data (a fictional user with 18 months of realistic Garmin data — the /demo funnel).

### 4.3 Ingest architecture (the HammerTrack pipeline, re-skinned)
```
Garmin watch → Garmin Connect cloud → [aggregator webhook]  → /api/ingest/wearable → normalize → Supabase → dashboard
                                       (Junction or Terra)     (= flespi → /api/ingest/flespi pattern, incl.
                                                                x-signature verification, timing-safe, fail-closed)
Lab PDF     → upload → /api/labs/parse (Claude vision)       → biomarkers table
Manual      → forms  → conditions/meds/goals/events
Phase 2:  Capacitor app (existing shell pattern) reads HealthKit/Health Connect → /api/ingest/health-bridge
```

### 4.4 Bloodwork & biomarker suggestion engine
Baseline panel the AI recommends to every user (all standard, cheap, and defensible — framed as *"discuss with your doctor"* per §6):

| Category | Markers | Why |
|---|---|---|
| Metabolic | HbA1c, fasting glucose, **fasting insulin** | Diabetes risk a decade early; insulin is the leading indicator nobody orders |
| Cardiovascular | Lipid panel + **ApoB** + **Lp(a)** (once/lifetime) | ApoB beats LDL for risk; Lp(a) is genetic and 1-in-5 people have it high |
| Inflammation | hs-CRP | Systemic inflammation baseline |
| Kidney/liver/general | CMP, CBC | Standard baseline, catches a lot |
| Thyroid | TSH (reflex free T4) | Energy/sleep/weight complaints |
| Hormonal | Total + free testosterone (men), estradiol context | Directly interacts with Garmin recovery/sleep/energy trends |
| Micronutrient | Vitamin D, ferritin/iron panel, B12 | Cheap, commonly low, affects HRV/sleep/fatigue |
| Urate | Uric acid | Metabolic + joint (relevant to injury history) |

Cost reality to show users: this whole panel is ~$100–250 cash at Quest/Labcorp direct — vs $365–499 in the membership clubs. **The suggestion engine is the democratization story in one screen.**

Smart-suggestion layer (v1.5): rules + AI over the user's own data — e.g., declining HRV + poor sleep + high stress → suggest thyroid + ferritin + vitamin D; family history of heart disease → ApoB/Lp(a) priority; on a statin → CK + liver panel reminder; knee injury history + high training load → discuss uric acid/inflammation. Every suggestion carries the wellness-safe framing and cites the user's own trend data.

### 4.5 What we explicitly do NOT build
- No diagnosis, no clinical classification of readings, no treatment protocols (§6 — this is the FDA line).
- No mental-health "therapy" framing (state AI-therapy laws).
- No CGM integration in v1 (Levels' niche; revisit Phase 3).
- No own-hardware, ever. BYO is the moat.

---

## 5. Garmin Integration — Decision (researched Jul 15, 2026)

**Reality check: Garmin's official Connect Developer Program is PAUSED for new applicants** (application form removed, no ETA; existing keys unaffected). Also, the unofficial garth/python-garminconnect scraping route **broke March 2026** (Cloudflare TLS fingerprinting; deprecated) — and holding users' Garmin passwords was never acceptable for a SaaS anyway.

| Route | Cost | Gets Body Battery/stress/HRV? | Verdict |
|---|---|---|---|
| **Junction (ex-Vital)** | ~$0.50/user/mo, $300/mo min; **free 50-user sandbox** | ✓ full Garmin depth | **Winner.** Free sandbox covers all of Track A + alpha; also has a **lab-ordering API** for Phase 3 — one vendor for both halves of the product |
| Terra | 100K free credits/mo, then $399/mo | ✓ | Strong fallback; generous free tier, no lab API |
| Rook / Spike / Thryve | ~$1/user/mo class | ✓ | Bench |
| Garmin direct | Free-ish after approval | ✓ | **Blocked (paused).** Apply under HAMMERTRACK LLC the day it reopens — at scale it removes aggregator COGS |
| HealthKit / Health Connect bridge (Capacitor) | $0 | ✗ (no Body Battery/stress; HRV unreliable) | Phase 2 supplement — free multi-brand coverage (Apple Watch, Samsung) via the existing Capacitor shell pattern |
| Garmin account archive ZIP / FIT upload | $0 | ✓ (FIT preserves proprietary fields) | Build in v1: ToS-safe backfill of years of history + zero-integration onboarding |

**Decision:** Junction sandbox (Brian + up to 49 alpha users, $0) + FIT-archive upload for backfill. Flip Junction to paid at Phase 2 launch (COGS ~$6/user/yr against $99/yr price = still ~90% software margin, the HammerTrack margin profile). Apply for direct Garmin access when the program reopens.

Aggregator COGS at scale: 1,000 paying users ≈ $500/mo Junction ≈ 6% of revenue. Acceptable; direct Garmin key later makes it ~0.

---

## 6. Regulatory Guardrails (researched Jul 15, 2026 — the do-not-cross lines)

**FDA:** Stay inside the **General Wellness policy** (updated Jan 6, 2026 — favorably). Rules baked into product + prompts:
- Never state a user *has* a condition. Never classify a reading clinically ("Stage 1 hypertension" = device claim — this exact thing earned **Whoop a warning letter in Jul 2025**; they re-labeled and FDA closed it Jun 2026).
- Allowed framing: Category 1 (fitness/sleep/stress, no disease mention) and Category 2 ("a healthy lifestyle may help reduce the risk of type 2 diabetes / heart disease" — well-accepted associations only) + "worth discussing with your doctor."
- AI output filters: forbidden-claims list, eval suite, output logging. **The model's output is labeling** — a disclaimer doesn't cure a diagnosis claim.
- In-product disclaimer at the point of every AI output (not buried in ToS): informational/wellness only, not medical advice, consult a physician, 911 for emergencies.

**Privacy (HIPAA mostly does NOT apply to DTC — these do):**
- **FTC Health Breach Notification Rule** (2024 update explicitly covers health apps): 60-day breach notification incl. *unauthorized disclosure* — ad-pixel sharing counts as a breach. GoodRx ($1.5M), BetterHelp ($7.8M), Premom precedents.
- **Rule zero: NO ad pixels/SDKs touching health data. Ever.** This is the #1 enforcement kill zone.
- **Washington My Health My Data Act** (+ Nevada SB 370): separate consumer-health-data privacy policy linked from homepage, opt-in consent to collect, *separate* consent to share, private right of action. Build the consent flow once, to the WA standard, apply everywhere.
- Data rights UI from day one: export everything, delete everything. (Also the best trust marketing a solo founder has.)

**Phase 3 lab ordering (not before):** physician-network-as-a-service (SteadyMD/OpenLoop — 50-state clinician networks with lab-approval APIs) or Junction's lab API which bundles physician authorization. Excluded states at launch: **NY, NJ, RI** (direct-access testing restricted — Function excludes RI too; everyone excludes these three at launch). MSO/friendly-PC structure if we ever employ clinicians; the LLC never "practices medicine." Until Phase 3, **PDF upload only = zero CLIA/physician exposure** (user supplies their own results).

**Entity/insurance:** operate under **HAMMERTRACK LLC initially** (SC single-member, EIN done) with a DBA, or spin a sibling LLC at Phase 2 (~$110 in SC — cheap; do it at first paying customer for liability isolation). Tech E&O + cyber with health-data coverage at Phase 2 (~$1.5–3K/yr, quote via Vouch/Founder Shield). ToS: not-medical-advice, no doctor-patient relationship, liability cap, arbitration.

---

## 7. Phases: Today → Decision (HammerTrack-style, with exit gates)

### Phase 0 — Build It For Brian (Jul–Sep 2026) — *"Dogfood or die"* · Budget ≈ $100
Goal: **Brian's complete health picture live in one dashboard** — Garmin flowing daily, history entered, last bloodwork parsed, first AI weekly digest delivered.

- [ ] Buy vitaltrack.ai + vitalcompass.com (~$100); verify trademark landscape informally
- [ ] New repo `vitaltrack` (this plan doc moves there); scaffold = HammerTrack pattern: Next.js 14 + Supabase + Tailwind/shadcn + Vercel + demo mode
- [ ] Migrations 001 (schema §4.2, RLS) + mock-data demo user
- [ ] Junction sandbox → connect Brian's Garmin → `/api/ingest/wearable` webhook (port the flespi handler: signature check, timing-safe, fail-closed)
- [ ] Garmin archive ZIP import (FIT parser) → backfill Brian's full history
- [ ] Health record UI: enter every prior injury/issue/goal — **this is the context file the AI runs on**
- [ ] Lab PDF upload → Claude parsing → biomarkers table (test on Brian's most recent bloodwork; if none exists, get the §4.4 baseline panel at Quest, ~$150–250 cash — instant dogfood of the suggestion engine)
- [ ] AI advisor v1: chat with full context + Sunday weekly digest email (Resend, already know the pattern)
- [ ] Wellness-language guardrails in the system prompt + output filter from day one (cheaper than retrofitting)

**Exit gate:** 60 consecutive days of automatic Garmin sync; Brian acts on ≥3 AI suggestions he considers genuinely valuable; the bloodwork suggestion engine produced a panel Brian actually took to a doctor. **If the tool isn't compelling to its own builder, stop here — keep it personal, spend nothing more.**

### Phase 1 — Quiet Alpha (Oct–Dec 2026) — *"Do 25 strangers care?"* · Budget ≈ $500
Goal: **25 users (Junction sandbox cap ~50), ≥40% weekly-active after 30 days, ≥5 unprompted "this is great" signals.**

- [ ] Polish onboarding: connect Garmin in <3 min (the "truck on the map in 10 minutes" rule, translated)
- [ ] Landing page at vitaltrack.ai with demo mode (the /demo funnel pattern) — hook: *"Your $400 watch collects the data. Nobody shows you what it means. We do — free."*
- [ ] Recruit: friends/family, Dillard Construction crew (blue-collar preventative health is literally the underserved segment), r/Garmin + r/QuantifiedSelf show-and-tell posts, one local gym
- [ ] WA-standard consent flow + privacy policy + export/delete buttons (§6)
- [ ] Instrument retention (PostHog free tier or Supabase events)

**Exit gate (the Track B go/no-go):** retention + organic pull hit targets AND ≥10 alpha users say they'd pay $99/yr (or 5 actually prepay). **Miss → VitalTrack stays a free personal/friends tool; total sunk cost <$600 and Brian keeps the best personal health dashboard money can't buy. Hit → Phase 2.**

### Phase 2 — Public Launch (Q1 2027) — *"$99 against their $499"* · Budget ≈ $3–5K
Goal: **500 free / 100 paying ($99/yr ≈ $10K ARR) in 6 months.**

- [ ] Spin sibling LLC or DBA; Stripe billing (autopay only); Tech E&O + cyber
- [ ] Junction → paid plan ($300/mo min — the COGS line that gates this phase)
- [ ] Pricing: **Free** = 1 wearable, 90-day history, monthly digest · **Plus $99/yr** = full history, labs parsing, weekly AI digest, unlimited uploads, family sharing later
- [ ] Fitbit/Apple/Samsung via Junction + Capacitor HealthKit/Health Connect bridge (reuse HammerTrack's shell + APP-STORE-PLAYBOOK.md; D-U-N-S already done via HAMMERTRACK LLC)
- [ ] GTM channels (in order): SEO comparison content ("Function Health alternative," "what your Garmin HRV means" — Empirical Health proves this works), r/Garmin & r/QuantifiedSelf presence, YouTube walkthroughs, $500/mo paid test max
- [ ] Apply for direct Garmin API access the day the program reopens (under the LLC)

**Exit gate:** 100 paying, monthly logo churn <3%, CAC <$50, support <5 hrs/wk.

### Phase 3 — The Full Loop (2027+) — *"Suggest it, order it, track it"*
Only after Phase 2 gate: in-app lab ordering (Junction lab API or SteadyMD physician network; skip NY/NJ/RI at launch) at panel cost + ~$29 convenience fee; family plans; more wearables; optional physician-visit prep reports; revisit CGM. North star: **the $99/yr product that does what the $499/yr products do, for people who were never going to buy those.**

---

## 8. Cost Curve (Track A → Phase 2)

| Item | Phase 0 | Phase 1 | Phase 2 |
|---|---|---|---|
| Domains | ~$100 | — | ~$100/yr |
| Vercel + Supabase | $0 (hobby/free) | $0–25/mo | ~$45/mo (pro tiers) |
| Junction | $0 (sandbox) | $0 (sandbox ≤50 users) | $300/mo min |
| Anthropic API | ~$5–15/mo (Haiku digests) | ~$30/mo | ~$100–300/mo (scale w/ users) |
| Insurance / legal / LLC | $0 | $0 | ~$2–4K one-time+annual |
| Marketing | $0 | ≤$500 total | ≤$500/mo |
| **Total at risk before the go/no-go gate** | | **< $1,000** | |

Unit economics at Phase 2: $99/yr price − (~$6 Junction + ~$3 AI + ~$1 infra)/user/yr ≈ **90% gross margin** — better than HammerTrack (no hardware, no SIMs, no shipping, no 2 AM install support).

---

## 9. Reuse Map from HammerTrack (~60% of the architecture)

| HammerTrack asset | VitalTrack reuse |
|---|---|
| Next.js 14 + Supabase + Vercel + demo-mode pattern | Identical scaffold; `isMock` demo user with 18 months of realistic data |
| `/api/ingest/flespi` webhook (signature, timing-safe, fail-closed, normalizer) | `/api/ingest/wearable` for Junction webhooks — same shape: external device cloud → webhook → normalize → Postgres |
| `lib/flespi.ts` multi-vendor normalizer | `lib/wearables.ts` — Garmin/Fitbit/Apple field conventions → one schema |
| `lib/alerts-engine.ts` (pure evaluation) | Health nudges: resting-HR spike, HRV decline streak, sleep-debt threshold, goal drift |
| Timeline / scrubber / time-range discipline (the testing rule) | Metric trends + event timeline; same click-every-range shipping rule |
| RLS multi-tenant schema, migrations, setup.sql flow | Same, keyed on user_id; GO-LIVE.md process |
| AI dispatcher (ANTHROPIC_API_KEY, Haiku) | AI advisor + digest + PDF lab parsing |
| Capacitor shell + APP-STORE-PLAYBOOK.md + D-U-N-S | HealthKit/Health Connect bridge app in Phase 2 |
| Resend email, Twilio (A2P already registered) | Weekly digest email; optional SMS nudges |
| /demo funnel + pricing-page-vs-incumbent pattern | vitaltrack.ai/demo + pricing page vs Function/Superpower/Whoop table |
| LLC + EIN + bank + bookkeeper stack | Operate under HAMMERTRACK LLC (DBA) until Phase 2 spin-out |

Not reused: MapLibre/geo stack, flespi/Hologram/hardware logistics, QBO integration.

---

## 10. Kill Criteria (write them down now, honor them later)

- Phase 0: Brian stops opening it for 2 straight weeks → it's not real; archive.
- Phase 1: <40% 30-day retention or zero organic enthusiasm → stays a free personal tool forever; no Phase 2 spend.
- Phase 2: 6 months, <50 paying or CAC >$150 → freeze acquisition spend, run it as a lifestyle side-product, revisit in 12 months.
- Any phase: FDA/FTC posture shifts against wellness AI apps → re-scope to pure tracking (no AI suggestions) and reassess.
- Standing rule: **VitalTrack never gets to jeopardize HammerTrack's Phase 1–2 execution** — HammerTrack has revenue, references, and a channel; this is the side bet. Time-box VitalTrack to nights/weekends until HammerTrack's Founding-25 gate is passed.
