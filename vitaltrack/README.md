# VitalTrack

Your watch already knows. VitalTrack unifies **Garmin wearable data** (sleep,
steps, resting HR, HRV, stress, Body Battery), your **health record**
(injuries, conditions, meds, goals), and your **bloodwork** (upload any lab
PDF) into one preventative dashboard with an AI advisor that sees the whole
picture.

Plan, market research, and verdict: [`docs/HEALTH-APP-PLAN.md`](../docs/HEALTH-APP-PLAN.md)
(repo root). Regulatory guardrails are implemented in `lib/guardrails.ts` —
wellness framing only, never diagnosis.

## Run it (demo mode — zero config)

```bash
cd vitaltrack
npm install
npm run dev
```

Open http://localhost:3000 — with no env vars the app runs in **demo mode**:
18 months of realistic generated Garmin data, a populated health record, two
lab draws, and a canned advisor reply. Same pattern as HammerTrack.

## Deploy on Vercel

Create a new Vercel project from this repo and set **Root Directory** to
`vitaltrack`. Deploys work in demo mode with zero env vars; add the vars
below to go live.

## Go live (real data)

1. **Supabase** — create a project, run
   `supabase/migrations/001_initial.sql` in the SQL Editor, enable Email
   (magic link) auth, then set `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
2. **Anthropic** — set `ANTHROPIC_API_KEY` to enable the advisor and lab PDF
   parsing (`ANTHROPIC_MODEL` optional, defaults to Haiku for cost).
3. **Garmin backfill (works today, no API)** — Garmin Connect → Account
   Settings → Account Management → Export Your Data. Upload the daily-summary
   CSVs and activity `.fit` files in **Settings → Backfill**.
4. **Garmin live sync (Junction)** — sandbox is free for 50 users:
   - Sign up at junction.com, create a team, grab the API key.
   - Add a webhook pointing at `https://<your-app>/api/ingest/wearable`,
     subscribe to daily/sleep/workout summary events, and copy the signing
     secret into `JUNCTION_WEBHOOK_SECRET`.
   - Use Junction Link to connect your Garmin account, then map the Junction
     user id to your Supabase auth user id in the `integrations` table:
     `insert into integrations (user_id, provider, external_user_id)
      values ('<auth uid>', 'junction', '<junction user id>');`
5. **Data rights** — Settings has export-all (JSON) and delete-all built in.

## Architecture

```
Garmin watch → Garmin Connect → Junction webhook → /api/ingest/wearable → Supabase → dashboard
Garmin archive (CSV/FIT) ------→ /api/import/garmin ↗
Lab PDF ----------------------→ /api/labs/parse (Claude) → biomarkers
Everything -------------------→ lib/context.ts → /api/advisor/chat (Claude + guardrails)
```

Key files:

- `lib/types.ts` — all domain types
- `lib/mock-data.ts` — deterministic demo data
- `lib/db.ts` — data access (mock or Supabase w/ RLS)
- `lib/wearables.ts` — Junction payload normalizer (the flespi.ts of this app)
- `lib/context.ts` — builds the full user context for the AI
- `lib/guardrails.ts` — FDA-wellness system prompt + output filter + disclaimer
- `app/api/ingest/wearable/route.ts` — svix-verified webhook, fails closed
- `supabase/migrations/001_initial.sql` — schema + RLS

## Rules of the product

1. Never diagnose; never clinically classify a reading. Lifestyle framing +
   "discuss with your doctor" only. (docs/HEALTH-APP-PLAN.md §6)
2. No ad pixels or third-party trackers touching health data. Ever.
3. Export and delete must always work — the user's data is theirs.
