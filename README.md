# ht-starter

The HammerTrack starter — clone this to begin ANY new app (health app, map
apps, map games) with the plumbing already done. Extracted Aug 2026 from
github.com/briandillardre/hello-world (HammerTrack).

## What's in the box (builds and runs with zero env vars)
- **Next.js 14** (App Router, TypeScript) on the HammerTrack dark theme
  (Tailwind config, fonts, colors — `tailwind.config.ts`, `app/globals.css`)
- **MapLibre map** at `/map`: free CARTO dark + Esri satellite basemaps,
  live NEXRAD weather radar toggle, nav + geolocate controls. $0/mo in keys.
- **Supabase helpers** (`lib/supabase-server.ts`) — point at a NEW Supabase
  project per app (never share HammerTrack's).
- **Resend email helper** (`lib/email.ts`) — inert until RESEND_API_KEY set.
- **Brand module** (`lib/brand.ts`) — set the app's name/domain in one place.

## Start a new app
1. Use this repo as a GitHub template (or clone + re-init git).
2. `npm install && npm run dev`
3. Rename in `lib/brand.ts` (or NEXT_PUBLIC_BRAND_NAME env).
4. New Supabase project (free tier) → `.env.local` from `.env.example`.
5. New Vercel project → import the repo. Done.

## When you need more, steal from HammerTrack (hello-world repo)
| Need | Copy from |
|---|---|
| Login/auth pages + "stay signed in" | `app/(auth)/`, `lib/actions/auth.ts`, `lib/supabase.ts` |
| Stripe subscriptions | `lib/stripe.ts`, `app/api/stripe/`, `lib/actions/billing.ts` |
| Push (ntfy + FCM) | `lib/notify.ts`, `lib/push.ts`, `app/api/push/` |
| Branded PDF export | `lib/pdf/` + call sites in reports/map |
| Weather layers (clouds, wind particles, NOAA temps, lightning, satellites, day/night) | `components/map/MapView.tsx` + `app/api/` weather routes — lift layer by layer |
| Timeline/replay + trails | `components/map/TimelinePlayback.tsx` + MapView playback wiring |
| Geofence drawing | `components/geofences/` |
| AI assistant pattern | `lib/assistant/`, `app/api/assistant/` |
| Auto-migrations on deploy | `scripts/migrate.mjs` + build script |
| PWA/Capacitor app shell | `capacitor.config.ts`, `mobile-shell/`, `docs/APP-STORE-PLAYBOOK.md` |
| Error reporting + health cron | `lib/monitor.ts`, `app/api/cron/health/` |

## Rules (learned the hard way)
- **One repo, one app, one Supabase project, one Vercel project.** Never grow
  a second app inside HammerTrack — clean books and clean diligence matter.
- **Health app:** its own everything, strictest privacy posture; assume
  HIPAA-adjacent until proven otherwise. Never co-mingle its data.
- Update THIS template when you improve a shared piece worth keeping —
  it's the vehicle for cross-app learnings.
- Each app gets its own CLAUDE.md; that file (not chat history) is the
  memory any Claude session works from.
