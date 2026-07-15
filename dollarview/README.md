# DollarView

**Where does my dollar go?** — a public transparency app that turns city/county/school-district
finances into infographics any taxpayer can read: a personalized tax receipt, a drill-down
budget map, and every capital project with its real cost and an honest, derived status.

Standalone Next.js app — lives in this repo but shares no code or deployment with the
HammerTrack app at the repo root.

## Run it

```bash
cd dollarview
npm install
npm test        # receipt math + data pack validation
npm run dev     # http://localhost:3000
```

Zero configuration — no env vars, no database. Entity data ships as typed, git-reviewable
data packs in `data/entities/` (fictional **Riverbend, SC** demo + a partial real
**Greenville, SC** preview).

## Key paths

- `lib/receipt.ts` — the tax-receipt math (pure, unit-tested; SC assessment ratios, millage, Act 388, LOST credit)
- `lib/budget.ts` — budget tree + treemap layout (pure d3-hierarchy math, shared with OG images)
- `lib/projects.ts` — derived project health (`on_track / at_risk / over_budget / delayed / complete`)
- `data/entities/*.ts` — per-entity data packs, validated by `lib/schema.ts` in tests
- `app/[entity]/…` — landing, receipt, budget explorer, projects, vendors
- `app/embed/[entity]/receipt` — iframe-able receipt (frame-ancestors *)
- `app/api/og/…` — edge-rendered share images that reuse the same math

## Deploying (Vercel)

Create a **separate Vercel project** on this repo with **Root Directory = `dollarview`**
("Include source files outside of the Root Directory" off). No env vars needed; optionally
set `NEXT_PUBLIC_SITE_URL` for absolute OG URLs.
