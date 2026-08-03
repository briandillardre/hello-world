# <App Name> — Project Instructions

> Template note: this repo began as `ht-starter` (extracted from HammerTrack).
> Fill in the sections below for THIS app, then delete this note. Keep this
> file current — it is the memory every Claude session starts from.

## What This Is
<one paragraph: what the app does, who it's for, owner: Brian Dillard>

## Stack
- Next.js 14 (App Router, TypeScript), Tailwind (HammerTrack dark theme)
- Supabase — its OWN project (never HammerTrack's): <project name>
- MapLibre GL (free CARTO/Esri tiles) — remove if this app has no map
- Vercel project: <name> · Domain: <domain>

## Key Files
- `lib/brand.ts` — app name/domain (single source of truth)
- `components/MapShell.tsx` — the map (basemaps + radar)
- `lib/supabase-server.ts`, `lib/email.ts` — server helpers

## Env Vars
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=            # optional
NEXT_PUBLIC_BRAND_NAME=    # optional override
```

## Conventions (inherited from HammerTrack — keep)
- Demo mode: features degrade gracefully with zero env vars; nothing throws.
- Optional vendors gate on env presence (unset = silent no-op).
- Migration-tolerant queries: a missing table renders a setup note, not a crash.
- Dev branches `claude/...` → PR → squash merge to the default branch.

## Pending / Next Steps
1. <first real task>
