/**
 * The founder board's content — HammerTrack's own operating picture.
 *
 * Brian, Aug 28: "I want all of my Hammertrack items combined... to do list
 * road map financials, all of it. it feels Scattered and needs to have one
 * home for everything."
 *
 * This is that one home's SOURCE. Live numbers (devices reporting, assets on
 * the map) are read from the database by the page; everything here is the
 * standing picture that only changes when a decision changes.
 *
 * ── Where this fits the sync rule ──────────────────────────────────────
 * The repo already requires that any roadmap / to-do / cost change updates
 * marketing/system-map.html and the cost docs in the SAME commit. This file
 * joins that set: it is the single place the board reads from, so a change
 * here plus the graphic plus the docs keeps all three honest. Numbers here
 * are transcriptions of docs/ — if they ever disagree, the docs win.
 */

export type Owner = 'brian' | 'build'
export type TaskState = 'open' | 'flight' | 'done'
export type Severity = 'stop' | 'warn' | 'none'

export interface BoardTask {
  id: number
  title: string
  /** Why it matters / what it unblocks. Shown under the title while open. */
  why?: string
  owner: Owner
  state: TaskState
  sev?: Severity
}

/** Mirrors the working task list. Ids match so a conversation and the board
 *  can refer to the same number. */
export const TASKS: BoardTask[] = [
  { id: 4, title: 'Exact hours & cost engine', why: 'Zone sessions at ingest, daily rollups, retroactive backfill. The spine every money feature sits on.', owner: 'build', state: 'flight' },
  { id: 47, title: 'Device onboarding single pane', why: 'Shipped — /assets/onboard. Per-model checklist plus live status, so nobody opens a vendor console.', owner: 'build', state: 'flight' },
  { id: 48, title: 'Founder board at /board', why: 'This page.', owner: 'build', state: 'flight' },

  { id: 46, title: 'Pay the declined KORE invoice', why: 'Card declined 18 Aug on KWI202303478475. An account in arrears can suspend SIMs mid-rollout — put it on the Mercury vendor card.', owner: 'brian', state: 'open', sev: 'stop' },
  { id: 40, title: 'Revive T1-b in the 2003 Chevy', why: 'Silent since 13 Aug. SIM is healthy and unpaused, so it is the power path — bypass the OBD extension, check the port fuse.', owner: 'brian', state: 'open', sev: 'stop' },
  { id: 17, title: "Revive Trey's 2500HD tracker", why: 'Silent 75 h and counting.', owner: 'brian', state: 'open', sev: 'stop' },
  { id: 41, title: 'Apple Developer + Play Console enrollment', why: 'D-U-N-S landed in early Aug and nothing else blocks the app stores. Match the dnb.com record to the LLC name verbatim first — Apple checks it literally.', owner: 'brian', state: 'open', sev: 'warn' },
  { id: 43, title: 'Send the KORE / Teltonika email', why: 'Draft is in Gmail: pre-configuration miss, the missing 14th SIM, and four hardware questions before order #2.', owner: 'brian', state: 'open', sev: 'warn' },
  { id: 45, title: 'Green Driving config to all five FMM00As', why: 'One round trip in Configurator + FOTA. Unblocks harsh accel/brake in driver grades, which today score only sustained speed and night driving.', owner: 'brian', state: 'open', sev: 'warn' },
  { id: 1, title: 'QuickBooks connect', why: 'Align the redirect URI in Vercel and the Intuit app, then retry from /accounting. Marketing claims this today and no customer can use it.', owner: 'brian', state: 'open', sev: 'warn' },
  { id: 19, title: 'Supabase auth config', why: 'Enable the Google provider and fix the Site URL — it still points at vercel.app, so auth emails and redirects land wrong.', owner: 'brian', state: 'open' },
  { id: 3, title: 'Set the Greenville parcel service URL', why: 'Turns on parcel lines and tap-for-owner on the map.', owner: 'brian', state: 'open' },
  { id: 18, title: 'Decide the tow-latency wording', why: '"2 min movement to text" on the splash and /demo — depends on the Twilio verdict.', owner: 'brian', state: 'open' },

  { id: 44, title: 'Tool trailer gateway', why: 'Wired FMM650 inside the trailer plus manifest alerts — "you left the yard with 38 of 40 tags."', owner: 'build', state: 'open' },
  { id: 42, title: 'Vehicle & equipment camera pilot', why: 'DualCam-class over the Teltonika rails. Research says this likely needs FMC650 (Cat 1), not the FMM650 we own.', owner: 'build', state: 'open' },
  { id: 8, title: 'Zone financials', why: 'Contract bid, change orders and cost-code budgets against the DCG master list.', owner: 'build', state: 'open' },
  { id: 15, title: 'Map wow-pack tier 2', why: 'Bid Ghost, storm-$ ledger, vendor money map, then/now split.', owner: 'build', state: 'open' },
  { id: 16, title: 'Wow-pack P2 follow-ups', why: 'Deferred from the 12 Aug ship-check.', owner: 'build', state: 'open' },
  { id: 21, title: 'UX sweep batch 2', why: 'Deferred audit items.', owner: 'build', state: 'open' },
  { id: 12, title: 'UI polish tier 2', why: 'Motion pass, empty states, haptics.', owner: 'build', state: 'open' },
  { id: 34, title: 'Nationwide parcels add-on', why: 'Evaluate Regrid vs ReportAll and price it as an upsell.', owner: 'build', state: 'open' },
  { id: 35, title: 'Reconcile setup.sql with the migration series', why: 'Missing 056–073 hardening, so fresh installs drift from production.', owner: 'build', state: 'open' },
  { id: 38, title: 'Scope flespi ingest ident lookup per company', why: 'Pre-existing; both reviewers flagged it.', owner: 'build', state: 'open' },

  { id: 39, title: 'Trail rollups + map viz polish', owner: 'build', state: 'done' },
  { id: 37, title: 'Demo realism overhaul', owner: 'build', state: 'done' },
  { id: 36, title: 'Phone gesture wave', owner: 'build', state: 'done' },
  { id: 33, title: 'Map declutter round 2', owner: 'build', state: 'done' },
  { id: 32, title: 'Clock-out replay staleness policy', owner: 'build', state: 'done' },
  { id: 31, title: 'Hand-scrubbable radar timeline', owner: 'build', state: 'done' },
  { id: 30, title: 'Map / layers UX study + fix batch', owner: 'build', state: 'done' },
  { id: 29, title: 'Idempotency & visibility hardening', owner: 'build', state: 'done' },
  { id: 28, title: 'Unified Ask assistant — one brain, three doors', owner: 'build', state: 'done' },
  { id: 27, title: 'In-app help centre + support scaffolding', owner: 'build', state: 'done' },
  { id: 26, title: 'Agent Interface (MCP server)', owner: 'build', state: 'done' },
  { id: 25, title: 'Multi-tenant hardening for customer #2', owner: 'build', state: 'done' },
  { id: 24, title: 'Offline field queue', owner: 'build', state: 'done' },
  { id: 23, title: 'QBO timesheet push', owner: 'build', state: 'done' },
  { id: 22, title: 'Per-company ingest API keys', owner: 'build', state: 'done' },
  { id: 20, title: 'Site-wide UX sweep', owner: 'build', state: 'done' },
  { id: 14, title: 'Map wow-pack', owner: 'build', state: 'done' },
  { id: 13, title: '/command first-switch TypeError', owner: 'build', state: 'done' },
  { id: 11, title: 'Admin-configurable daily log', owner: 'build', state: 'done' },
  { id: 10, title: 'Store listing pack', owner: 'build', state: 'done' },
  { id: 9, title: 'BusyBar across every slow flow', owner: 'build', state: 'done' },
  { id: 7, title: 'Tool presence hours from the pairing log', owner: 'build', state: 'done' },
  { id: 6, title: 'Asset sheet close on phone', owner: 'build', state: 'done' },
  { id: 5, title: 'Zone hours/cost bar chart', owner: 'build', state: 'done' },
  { id: 2, title: 'Migration 055 + auto-migrations', owner: 'brian', state: 'done' },
]

export interface Stage {
  mark: string
  when: string
  title: string
  summary: string
  points: { text: string; tone?: 'ok' | 'wait' | 'no' }[]
  gate?: string
}

/** docs/PATH-TO-1B.md — valuation is arithmetic on ARR, so the stages are
 *  ARR milestones, not dates. */
export const STAGES: Stage[] = [
  {
    mark: '25', when: 'Stage 0 · now', title: "Founding 25 — prove it's a business",
    summary: '25 paying companies, under $100k ARR, near-zero churn. Funded by nothing but the monthly burn and your own time.',
    points: [
      { text: 'Pilot truck live since 6 Jul · Stripe billing live · Mercury live', tone: 'ok' },
      { text: 'PM Tier 1 money loop is the next real build', tone: 'wait' },
      { text: 'Zero paying customers today — this is the whole job', tone: 'no' },
    ],
    gate: '25 companies, and 3+ referrals that arrived unprompted.',
  },
  {
    mark: '$1M', when: 'Stage 1 · 2027–28', title: 'Prove distribution repeats',
    summary: '~350 companies at ~$250/mo blended. Valuation roughly $6–10M.',
    points: [
      { text: 'The theft-hook ad funnel, run properly across Upstate SC, then the Charlotte and Atlanta corridors' },
      { text: 'Equipment dealers as resellers — a tracker with every used-iron sale. One productive dealer is 5–15 customers a year, forever. Sign ten.' },
      { text: 'Expansion revenue starts: the $49 and $199 platform tiers lift ACV without new logos' },
    ],
    gate: 'CAC under 6 months of gross profit · net revenue retention above 100%.',
  },
  {
    mark: '$100M', when: 'Stage 2 · 2029–30', title: 'Prove the platform',
    summary: '~2,500 companies, ~$400/mo blended, $10–12M ARR at an 8–10× forward multiple.',
    points: [
      { text: 'Three engines running: SaaS (~60% of revenue), fintech attach, and the data layer' },
      { text: 'The financial layer is what makes a customer worth 3–5× their SaaS fee' },
    ],
  },
  {
    mark: '$1B', when: 'Stage 3', title: 'The arithmetic, not the fantasy',
    summary: '~$90–120M ARR. About 20,000 customers at ~$5k/yr blended — under 3% of just the US construction segment.',
    points: [
      { text: '~750,000 US construction firms with payroll; ~3.5M counting owner-operators; field services roughly double it' },
      { text: 'The risk was never market size — it is distribution and retention' },
    ],
  },
]

/** docs/PRICING-TIERS.md. Run's platform price stays unpublished publicly;
 *  this is the founder view, so it shows. */
export const TIER_ROWS: { label: string; track: string; operate: string; run: string; emphasis?: boolean }[] = [
  { label: 'Who it’s for', track: '"Where’s my stuff"', operate: '"Run my crews on it"', run: '"Run the company on it"' },
  { label: 'Tracked machine', track: '$8/mo', operate: '$8/mo', run: '$8/mo' },
  { label: 'Tool tags', track: '$3/mo', operate: '25 included', run: '100 included' },
  { label: 'Platform fee', track: '$0', operate: '$49/mo', run: '$199/mo', emphasis: true },
  { label: 'Map, theft alerts, geofences', track: '✓', operate: '✓', run: '✓' },
  { label: 'Time clock, logs, QR maintenance', track: '—', operate: '✓', run: '✓' },
  { label: 'QuickBooks sync', track: '—', operate: '✓', run: '✓' },
  { label: 'AI assistant + digest', track: '—', operate: '—', run: '✓' },
  { label: 'Users', track: 'Unlimited', operate: 'Unlimited', run: 'Unlimited' },
  { label: 'Typical customer · 8 machines, 12 tags', track: '$100/mo', operate: '$113/mo', run: '$263/mo', emphasis: true },
]

/** docs/COST-SCALE-2026-07.md */
export const COST_CURVE: { label: string; cells: string[]; emphasis?: boolean }[] = [
  { label: 'MRR', cells: ['$0', '$2,100', '~$11,000', '~$56,000'], emphasis: true },
  { label: 'SIMs in field', cells: ['2', '200', '800', '4,000'] },
  { label: 'SIM + flespi COGS', cells: ['$5', '~$400', '~$1,360', '~$6,000'] },
  { label: 'Fixed infra', cells: ['$130', '$130', '~$300', '~$900'] },
  { label: 'Stripe fees', cells: ['$0', '~$70', '~$330', '~$1,650'] },
  { label: 'Plaid + AI usage', cells: ['$0', '~$30', '~$150', '~$700'] },
  { label: 'Total cost', cells: ['$135', '~$630', '~$2,140', '~$9,250'] },
  { label: 'Gross margin', cells: ['—', '70%', '81%', '83%'], emphasis: true },
]
export const COST_COLS = ['Now (pilot)', '25 customers', '100', '500']

/** docs/OPERATING-MODEL.md — the step-jumps in the cash curve. S1 is the one
 *  deliberate exception to the trigger rule: it fires at zero customers
 *  because the constraint it relieves is founder hours, not demand. */
export const HIRES: { role: string; trigger: string; cost: string; when: string; note?: string }[] = [
  { role: 'S1 — PT field sales & install', trigger: '0 customers — founder hours are the binding constraint, not demand', cost: '$800 base + $200/account', when: 'Sep 2026',
    note: 'Hired for the rolodex, comp weighted to commission. 60-day kill rule: under 8 demos/mo or 3 activated accounts → pure commission or part ways.' },
  { role: 'H1 — PT installer / support', trigger: '30 customers', cost: '—', when: 'absorbed by S1',
    note: 'Grow S1\u2019s hours at the 30-customer trigger instead of adding a second person.' },
  { role: 'H2 — FT ops / install tech', trigger: '90 customers', cost: '$5,400', when: 'Jul 2028' },
  { role: 'H3 — PT admin / CS', trigger: '110 customers', cost: '$1,200', when: 'Oct 2028' },
]

/**
 * The outreach plan — docs/BUSINESS-PLAN.md Phase 1 plus the Aug 28 S1
 * amendment. Ordered by expected yield, which is also the order to work it:
 * warm names first, because a beachhead is defined by who returns your calls.
 */
export const SELLING_MOTION: { step: string; detail: string }[] = [
  { step: 'The 25-name list', detail: 'Personal demo on YOUR live fleet, on your phone, at their yard. Close rate should be 40%+ with the Founding 25 offer.' },
  { step: 'Local dealer pilots (2)', detail: 'Free tracking on two Upstate dealers\u2019 rental fleets. Rental theft is THEIR pain — when it saves them once, they become the channel.' },
  { step: 'Contractor Facebook groups', detail: 'Where Upstate crews already talk. The theft hook travels by word of mouth in these faster than by ad spend.' },
  { step: 'The theft-hook ad funnel', detail: 'Facebook/Instagram → hammertrack.ai/demo → /register. Ad variants written and waiting in marketing/ad-variants.md.' },
]

export const S1_SHAPE: { label: string; value: string }[] = [
  { label: 'Who', value: 'ONE part-time field sales & install person, hired for their rolodex — dealer counter or sales guy, rental coordinator, retired super. Someone Upstate contractors already return calls from.' },
  { label: 'What they do', value: 'Demo on the showroom company, close with the DCG field-report one-pager, and do the first install on the spot — the offer\u2019s "first install done with you" becomes their job.' },
  { label: 'Comp', value: '$800/mo base (10–15 hrs/wk) + $200 per activated account + $1,000 bonus at 25. All-in ≈ $336/account at pace; payback stays ~6 months at founder-pricing margin.' },
  { label: 'Founder keeps', value: 'The first 3 demos (pitch calibration), the warm-intro list, and the account-level tasks — Twilio verdict, QBO keys, showroom seed.' },
  { label: 'Kill rule', value: '60 days. Fewer than 8 demos/month or 3 activated accounts → restructure to pure commission or part ways.' },
  { label: 'Cash', value: '~+$2.4k/quarter pre-close burn. Worst-case cumulative drawdown moves ~$8.5k → ~$11k. Still self-funding.' },
]

/** docs/COMPETITORS.md — the Aug 24 recon. Sell on friction, not features. */
export const COMPETITORS: { name: string; note?: string; price: string; friction: string; lead?: boolean }[] = [
  { name: 'Tenna', note: 'John Deere-owned since ~Feb 2026', price: '$15–30/asset, quote-only', lead: true,
    friction: '$5k–20k implementations. They do have BLE tags and claim QuickBooks now — sell on implementation cost, contract friction and small-crew fit, not missing features.' },
  { name: 'Samsara', price: '$27–60/vehicle', friction: 'Three-year contracts; small fleets prepay all three years up front.' },
  { name: 'Verizon Connect', price: '$23–45/vehicle', friction: '36-month auto-renew and a contract-trap reputation.' },
  { name: 'GPS Trackit', price: '$24–36/vehicle', friction: 'Month-to-month, but a leased-hardware exit trap.' },
  { name: 'FleetWatcher', note: 'AlignOps', price: '—', friction: 'Paving e-ticketing and hauler logistics. Heavy setup, different buyer.' },
]

export const VENDORS: { name: string; state: 'live' | 'warn' | 'stop' | 'idle'; stateLabel: string; note: string }[] = [
  { name: 'Mercury', state: 'live', stateLabel: 'live', note: 'Approved 5 Aug. One named virtual card per vendor. The opening deposit is owner capital, not income.' },
  { name: 'Google Workspace', state: 'live', stateLabel: 'live', note: 'hammertrack.ai · sales@, hello@ and support@ all verified receiving.' },
  { name: 'Supabase', state: 'live', stateLabel: 'live', note: 'Pro. Billing entity is the LLC.' },
  { name: 'D-U-N-S', state: 'live', stateLabel: 'issued', note: 'Landed early Aug. Unblocks both app-store organisation accounts. Never file again — duplicates are slow to merge.' },
  { name: 'Twilio', state: 'warn', stateLabel: 'in review', note: 'Number bought and compliance profile approved, toll-free verification still pending. Voice is enabled but has no greeting — do not publish the number.' },
  { name: 'KORE', state: 'stop', stateLabel: 'invoice due', note: 'Declined card on the 14 Aug invoice. Connectivity agreement still pending in their system.' },
  { name: 'Apple / Google Play', state: 'idle', stateLabel: 'not started', note: 'Nothing blocks enrollment except the enrollment itself.' },
]

export const ENV_PENDING: { text: string; tone: 'no' | 'wait' }[] = [
  { text: 'QBO_* — no customer can connect QuickBooks until this ships', tone: 'no' },
  { text: 'CRON_SECRET — the usage cron fails closed without it, so ledger and trail rollups stop', tone: 'wait' },
  { text: 'NEXT_PUBLIC_PARCEL_SERVICE_URL — turns on parcel lines and tap-for-owner', tone: 'wait' },
  { text: 'Supabase Auth Site URL still points at vercel.app, so auth emails land wrong', tone: 'wait' },
]

export const ENV_LIVE: string[] = [
  'Auto-migrations run on every master build — pushing a migration file IS the migration',
  'flespi channel 1401177 → webhook → ingest, verified end to end',
  'hammertrack.ai on Vercel since 5 Aug; the .com 301s to it; Workspace MX intact',
  'Stripe billing, Resend and push registration all wired',
]

export const RULES: { name: string; text: string }[] = [
  { name: 'Checks & balances', text: 'Any session shipping substantive code or public copy runs ship-check, truth-check and sec-check before it ends, and fixes confirmed findings the same session.' },
  { name: 'Sync rule', text: 'Any roadmap, to-do or cost change updates the system-map infographic, this board and the cost docs in the same commit. The graphic is a view of the roadmap; never let them drift.' },
  { name: 'Splash truth', text: 'Nothing on a marketing page may claim functionality that does not exist. Roadmap items say ROADMAP; shipped items may say LIVE. Every session that ships or re-scopes a feature re-audits the splash in the same commit.' },
  { name: 'Pricing sync', text: 'Any change to tiers, Founding-25 terms or the pilot offer updates /pricing, the splash ladder, /demo, the billing guide and the tiers doc — all in one commit.' },
  { name: 'Testing rule', text: 'Anything touching timeline, radar or history gets clicked through every range on both /map and /command. Nothing animates while the timeline is stopped.' },
  { name: 'Ship-to-live', text: 'Once validated, open the PR and squash-merge to master without asking. Live is where Brian reviews.' },
]

/** Standing marketing exposure — claims that are currently ahead of reality.
 *  Kept on the board so they can't quietly age. */
export const TRUTH_WATCH: string[] = [
  'QuickBooks is claimed as built-in, but no customer can connect until the Intuit app ships.',
  'The two-minute theft-text claim depends on Twilio toll-free verification clearing.',
]

export const DOC_INDEX: { group: string; files: string[] }[] = [
  { group: 'Money', files: ['PRICING-TIERS.md', 'UNIT-ECONOMICS.md', 'COST-SCALE-2026-07.md', 'OPERATING-MODEL.md', 'BUSINESS-PLAN.md'] },
  { group: 'Strategy', files: ['PATH-TO-1B.md', 'GROWTH-PLATFORM.md', 'AI-RESILIENCE.md', 'COMPETITORS.md', 'FOUNDING-25.md'] },
  { group: 'Hardware & ops', files: ['DEVICE-ONBOARDING.md', 'TELTONIKA-DEVICES.md', 'FLEET-TELEMATICS.md', 'PROVISIONING.md', 'APP-STORE-PLAYBOOK.md'] },
]

/** Where each class of iron belongs — the allocation that stops someone
 *  carrying an OBD plug out to a Class-8 dash it cannot fit. */
export const IRON: { machines: string; fit: string }[] = [
  { machines: 'Peterbilt 567 · International LF627', fit: 'FMM650 + ALL-CAN300 — the dash is 9-pin Deutsch J1939, an OBD-II plug physically will not fit' },
  { machines: 'Sakai SW990 · LeeBoy 8500C · Sany PQ190', fit: 'FMM650 + CAN for true engine hours, fuel and fault codes' },
  { machines: 'Takeuchi TB235 and battery-only machines', fit: 'TAT141, wired to 12/24 V aux where the machine has it' },
  { machines: 'Light-duty trucks', fit: 'FMM00A in the OBD port — also the BLE gateway that tools ride on' },
]

export const BURN = [
  { amount: '$25', what: 'Supabase Pro' },
  { amount: '$20', what: 'Vercel Pro' },
  { amount: '~$48', what: 'Workspace, domains, mailbox' },
  { amount: '~$37', what: 'Twilio + QuickBooks' },
]

export function taskCounts(tasks: BoardTask[] = TASKS) {
  return {
    open: tasks.filter((t) => t.state !== 'done').length,
    brian: tasks.filter((t) => t.state === 'open' && t.owner === 'brian').length,
    build: tasks.filter((t) => t.state !== 'done' && t.owner === 'build').length,
    done: tasks.filter((t) => t.state === 'done').length,
    total: tasks.length,
  }
}
