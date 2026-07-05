# Brain Ball 🧠⚽ — Kids' Adaptive Learning Game

Live at **https://hammertrackai.com/play** (unlisted — not indexed, not linked from the site).

Built for Marshall (b. 2020-09-15) and Lincoln (b. 2022-02-10). Roll a smiley ball into the
right answer bubble and it eats it and grows (hole.io style). Wrong answers gently reveal the
correct bubble and shrink nothing — encouragement only.

## How it works

| Piece | File | What it does |
|---|---|---|
| Game canvas | `components/game/BallGame.tsx` | Rolling-ball round of 10 questions, particles, sounds, voice narration |
| App shell | `components/game/PlayApp.tsx` | Kid picker → home → game → summary, ball shop, grown-ups gate |
| Parent dashboard | `components/game/ParentDashboard.tsx` | Per-skill percentile vs age norms, bell curve, trends |
| Question banks | `lib/game/questions.ts` | 7 skills × 4–5 difficulty bands, generated (never repeats verbatim) |
| Adaptive engine | `lib/game/adaptive.ts` | Elo/IRT-style ability per skill; targets ~70–80% success rate |
| Persistence | `lib/game/storage.ts` | localStorage, per-kid profiles, coins/skins/history |

**Skills:** counting, numbers, math (add/subtract/missing addend), letters, sounds (phonics/rhymes),
shapes & patterns, sight words / CVC reading.

**Adaptive:** every answer updates a 1–99 ability estimate (`theta`) per skill; the next question is
drawn near it (with periodic easy confidence questions). Correct on hard questions moves theta up
fast; the game gets harder or easier automatically.

**Bell curve:** the grown-ups report converts theta to a percentile against heuristic age
expectations (age 4 ≈ 30, age 5 ≈ 50, age 6 ≈ 70, SD 15) computed from each kid's exact birthdate.
It's framed as encouragement, not a clinical assessment.

**Rewards:** 2 coins per correct (+streak bonus), stars per round, coins buy ball skins.
Web Speech API reads every question aloud for pre-readers.

## App Store / Google Play plan

The game is deliberately **fully client-side** (no server calls, no accounts, no ads, data stays on
device) — that makes store packaging simple AND keeps it clean under kids' policies (COPPA /
Apple Kids Category: no tracking, no personal data collected).

Already in place:
- `public/brainball.webmanifest` — standalone PWA manifest scoped to `/play` (id, icons, portrait)
- `public/icons/brainball-{192,512,maskable-512}.png` — app icons
- Safe-area insets + `viewport-fit=cover` for notched phones
- Works offline after first load except fonts (add a service worker at packaging time if desired)

### Google Play (easiest, do first)
1. Use **Bubblewrap** (`npm i -g @bubblewrap/cli`) or https://pwabuilder.com against
   `https://hammertrackai.com/brainball.webmanifest` to generate a **Trusted Web Activity** APK/AAB.
2. Host the generated `assetlinks.json` at `https://hammertrackai.com/.well-known/assetlinks.json`.
3. Play Console: one-time $25 developer fee, fill Data Safety form ("no data collected"),
   target audience = kids → complete the Families policy questionnaire.

### Apple App Store
Apple doesn't accept plain PWAs; wrap with **Capacitor** in a separate repo:
1. `npm create @capacitor/app brain-ball` → point it at the deployed URL (or export `/play`
   statically and bundle it for full offline).
2. `npx cap add ios`, set bundle id (e.g. `com.hammertrack.brainball`), icons from
   `public/icons/brainball-512.png`.
3. Apple Developer Program $99/yr; for the **Kids Category**: no third-party ads/analytics
   (we have none), parental gate before external links (the grown-ups math gate already exists).
4. Native niceties to add inside the wrapper later: haptics on correct answers, App Store
   in-app-purchase if the coin shop ever goes paid.

### Down the road
- Move profiles from localStorage to Supabase (already in the stack) for multi-device sync.
- Replace Web Speech API with recorded voice for consistent narration in store builds.
- More question banks (time, money, spelling) — just add a generator in `lib/game/questions.ts`.
