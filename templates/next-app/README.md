# 🚀 New Project Template — Zero DevOps

The starter Brian's projects begin from. Everything boring is pre-decided:
Next.js 14 + Tailwind, Netlify deploys, Supabase auth in **demo mode** (the
app fully works with zero setup — sign-in lights up later when keys are added).

## Starting a new project (Brian's part: ~2 minutes)

1. **github.com** → **+** → **New repository** → name it → Private → Create.
   (Don't add any files.)
2. Grant Claude access to the new repo (same place you did for hello-world),
   then tell Claude: **"New project called ___ from the template. It should ___."**
3. Claude copies this template in, renames everything, builds the actual app,
   and pushes to `master`.
4. **netlify.com** → **Add new project** → **Import from GitHub** → pick the
   repo → Deploy. Done — every push auto-deploys, and Claude sends you the link.

## House rules (why there's no DevOps after this)

- **One host.** Netlify only. Never connect Vercel or a second host — that's
  where duplicate builds and PR comment spam come from.
- **No PR bots.** In Netlify: Project configuration → Notifications → delete
  "Deploy Preview comments". Claude sends the one link that matters.
- **Push to master.** Solo projects don't need pull requests. Claude tests
  before pushing; master auto-deploys. Use a PR only when you want a preview
  link to share before something goes live on a real domain.
- **Demo mode always.** Apps must fully work with zero env vars (see
  `lib/supabase.ts`). Real keys only get pasted into Netlify when a project
  proves it deserves them.
- **Secrets are Brian-only.** The only two jobs Claude can't do: pasting API
  keys into Netlify (Site configuration → Environment variables) and buying
  domains. Everything else is Claude's job.

## What's in the box

| File | What it is |
|---|---|
| `CLAUDE.md` | Standing instructions Claude reads automatically in every session |
| `app/` | Minimal working app (deploys green on day one) |
| `lib/supabase.ts` | Auth client with the demo-mode fallback pattern |
| `netlify.toml` | Netlify + Next.js build config |
| `.env.example` | The env vars that exist, all optional |
