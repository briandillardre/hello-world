# PROJECT_NAME — Project Instructions

<!-- Claude: on first use, replace PROJECT_NAME throughout and fill in the
     "What This Is" section from Brian's description. Delete this comment. -->

## What This Is
(One paragraph: what the app does, who it's for.)
Owner: Brian Dillard (briandillardre@gmail.com), Nashville TN.

## Workflow — how Brian works (do not deviate)
- **Push straight to `master`.** No pull requests unless Brian asks for a
  shareable preview. Netlify auto-deploys master.
- **Test before pushing**: `npm run build` must pass, and exercise the changed
  flow in a real browser (Playwright) when it has a UI.
- **After every push**: message Brian the live/preview link + a plain-English
  summary, and send a push notification when work is complete and deployed.
- **Never connect additional hosts** (Vercel etc.) or enable PR comment bots.
- Brian is not a developer — explain in outcomes, not jargon. Ask before
  anything hard to reverse (deleting data, changing domains, spending money).

## Tech Stack (pre-decided — don't relitigate)
- Next.js 14 (App Router, TypeScript), Tailwind CSS
- Netlify hosting (netlify.toml + @netlify/plugin-nextjs)
- Supabase for auth/database WHEN needed — always behind the demo-mode
  pattern in `lib/supabase.ts` (app fully works with zero env vars)
- lucide-react icons; keep dependencies minimal

## Conventions
- Demo mode first: every feature must degrade gracefully with no env vars.
- Mobile-first: Brian reviews everything on his phone.
- Kid/family-friendly and wholesome content standards apply to everything.
- Secrets live only in Netlify env vars (Brian pastes them); `.env.example`
  documents names, never values.

## Env Vars (all optional — demo mode covers their absence)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## Status / Next Steps
(Claude: keep this section current as the project evolves.)
