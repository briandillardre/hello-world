# Brain Ball 🧠⚽ — Kids' Adaptive Learning Game

Live at **https://hammertrack.ai/play** (unlisted — not indexed, not linked from the site).

Built for Marshall (b. 2020-09-15) and Lincoln (b. 2022-02-10). Roll a smiley ball into the
right answer bubble and it eats it and grows (hole.io style). Wrong answers gently reveal the
correct bubble and shrink nothing — encouragement only.

**Whalehogs theming** (the Dillard crew name — Marshall misheard Avicii's "wild heart" as
"whalehog"): the picker is badged "A Whalehogs Game", selecting a kid runs the family ritual
("Dada says: Today's going to be a…" → tap → **GREAT DAY!!!** with confetti and a spoken yell),
encouragement lines include "We don't say can't!" and "Whalehogs never quit!", and there's an
unlockable Whalehog ball skin in the shop.

## How it works

| Piece | File | What it does |
|---|---|---|
| Game canvas | `components/game/BallGame.tsx` | 10-question rounds: chomping ball eats the answer then vacuums the board, combo audio, streak gear, bonus/speed/read rewards. **🏈 Quick Drive** (per-kid mode): same questions rendered as a drive — striped field, WHALEHOGS end zone, +10 yards per correct (+15 hot), TOUCHDOWN at 100 then a fresh drive |
| 🏟️ Game Day | `lib/game/football.ts` (pure drive engine) + the play-call sheet & mini-games in `BallGame.tsx` | **Real football rules, kid-sized AND hands-on** (Nov 3 "help the boys understand rules of football"; Nov 6 "needs to be interactive … pull back and swing method like golf games"): call the play, answer the question to EARN it, then **run it with a finger** — 🏃 Run / 🎯 Pass = drag the smiley carrier past four chasing robot tacklers (the yards you steer are the yards the drive gets; a pass is caught 15 deep but a wrong answer is INTERCEPTED), 🛡️ defense = drag your ball to CATCH the Robots' weaving runner before the dashed breakaway line, 🦵 FG/XP = **pull the teed ball back and let go** (pull length = power with a live yardage readout, direction = aim; short is short, wide is wide). Wrong answers blow the play up at the snap (sack / INT / blocked kick). Engine takes the mini-game's outcome (`applyPlay(state, call, {correct, yards, made, tackled})`) and owns real downs ("2nd & 4", yellow first-down + blue scrimmage lines, turnover on downs), TD = 6 + XP (extends the round by one when the TD lands on Q10), 2-play DEFENSE stands (2 tackles = punt, 1 = Robots FG, 0 = Robots TD), scoreboard in the end zone, win/tie/lose on the summary. One `fieldGeom()` mapping + canvas-scaled glyphs keep it right on phones. Harness `node scripts/football-test.mjs` (39 assertions incl. a 500-play fuzz) — run it after ANY change to the engine |
| App shell | `components/game/PlayApp.tsx` | Picker → GREAT DAY ritual → home (quests, streaks) → game → spoken summary; shop; review; grown-ups gate |
| Fun Zone | `components/game/FunZone.tsx` | **Earned free play** — right answers bank play-time seconds (5s each, +2s for speed, +15s perfect round, 6-min cap); the Fun Zone is a no-questions arcade where the ball chases the kid's finger and gobbles snacks against that countdown. Time's up → "earn more by playing a round." The learning loop is the arcade's coin slot. |
| Voice answers | `lib/game/voice-answer.ts` + the 🎤 in `BallGame.tsx` | **Kids answer out loud**: tap the mic, say it, the ball rolls to the match — letter names ("why" → Y), number words ("twenty one" → 21), sight/CVC words, multi-word settings ("the beach"), spelled blends ("ess see" → sc). Ambiguity (b vs B) refuses and asks for a tap — never a guess. Rides `lib/speech-input.ts` (browser recognizer / native plugin / honest "needs the app update"); mic hidden on emoji-only boards. Harness `node scripts/voice-answer-test.mjs` — run after ANY change to the matcher |
| Miss review | `components/game/MissReview.tsx` | Missed questions replayed one at a time, read aloud, with the "why" spoken on success |
| Personality quiz | `components/game/PersonalityQuiz.tsx` | "Who Am I?" four-temperaments animals, saved with history |
| Parent dashboard | `components/game/ParentDashboard.tsx` | Kids: age-norm bell curves + US/SC/Global benchmarks (was "TN" until Oct 2026 — a Nashville-demo leftover; the kids are in South Carolina). Adults: IQ-style 3-signal scores, consistency, speed |
| Daily parent email | `lib/game/report.ts` + `/api/cron/brainball-report` (hourly; sends ≥ 7 PM ET) | **Max one email per day, only on days a kid played** (Brian, Oct 29): AMIRA-style standings per skill ("scored better than X% of kids their age", US/SC/Global, trend), today's accuracy/streak, the school-assessment card, honest caveats. Sent to the parent account's own email (cloud sync must be signed in — no account, no data server-side). Send stamp claimed compare-and-set in `brainball_profiles.last_report_at` (migration 141); `report_optout` turns it off. **Recipients** (migration 142): the signed-in parent sets up to 5 addresses on the account card ("📬 Daily report goes to"); empty = the account's own email; the cron validates/dedupes and only mails when the owner's auth email is confirmed. Harness `node scripts/brainball-report-test.mjs` — run it after ANY change to report.ts or the norms |
| Parent accounts | `components/game/AccountSync.tsx` + `lib/game/sync.ts` | Google/email sign-in, cloud profile sync (Supabase) |
| Question banks | `lib/game/questions.ts` | Kid bank (7 skills, pre-K→1st) + adult bank (mental math, sequences, vocab, analogies, logic, spelling) |
| Adaptive engine | `lib/game/adaptive.ts` | Elo/IRT ability per skill (kids cap 99, adults 120), speed-weighted updates, age norms, adult adjusted scores |
| Speech | `lib/game/speech.ts` | Best-available voice ranking (novelty voices blacklisted, network/natural voices preferred), natural rate, **sentence-by-sentence utterances with slight pitch drift** so long lines don't flatten into monotone, excited prosody for celebrations |
| Persistence | `lib/game/storage.ts` | localStorage profiles (Marshall, Lincoln + Brian/Leslie testers), review queue, habit-loop fields |

**17 skills on three shelves** (Nov 6 — Brian: "start working in history, business, geography, geology, and astrology … I want them to be very well versed. Whatever else we can add — add it"): 📚 **Reading & math** (the original seven), 🌍 **Our world** (science, machines, 🔭 space, 🌎 geography, 🪨 rocks & Earth, 🏛️ history, 💼 money & business) and 💡 **Think smart · big heart** (🤖 *Is it true?* — check the robot, fact vs opinion, AI smarts; 🧭 logic & steps — exact instructions, debugging, if-then; ❤️ heart — feelings, kindness, grit, gratitude). "Astrology" was read as astronomy: the Space skill is the real science, no horoscopes. The eight newest live in `lib/game/banks/<skill>.ts` (≈50 kid facts in five bands + ≈20 adult facts each, 603 total) behind one generic generator that skips recently-seen facts; harness `node scripts/brainball-banks-test.mjs` (answer length ≤ 20 chars for the phone bubbles, distinct choices, no read-aloud blanks, tier counts) — run it after ANY bank edit. **Mix keeps reading & math at half of every round** (`MIX_SHARE` in adaptive.ts: core 0.5 · world 0.35 · life 0.15, the least-practiced/lagging rule still steers inside each shelf) so new subjects add breadth without diluting the foundation; harness `node scripts/brainball-mix-test.mjs` (shares, every generator kid+adult at every difficulty, missions). Harnesses import TS through `scripts/lib/ts-import.mjs` (follows relative imports).

**🔨 Real-world missions** (`lib/game/missions.ts` + `components/game/MissionCard.tsx`): one off-screen mission a day on the home screen — build a tower that holds a book, help set the table, find the Moon, teach your brother something — age-fit (little/big), different for each brother, never the same two days running, read aloud on tap. "I did it!" opens a grown-up math gate; only then do the +15 coins land. Confirmed missions ride into the daily parent email (`missionLog`, filtered by the confirm time `at`). Each kid walks their own shuffled cycle of missions, so a mission never repeats on back-to-back days and every one comes round before any repeats. A day pays once (the day is read at confirm time) and the confirm adds 1 xp so the cloud merge keeps it.

**🤝 Brothers mode** (Brian said yes to it Nov 6; teaching is the deepest learning): on a kid's home, "Coach Lincoln!" appears for each younger brother. The younger brother plays a normal Mix round of HIS questions in his chosen game mode. The coaching strip says the rule ("help with words, not fingers"), and the big brother earns 2 🪙 per right answer + 5 for a ≥70% round (`coachRounds` counts them). **Coached answers are practice, not measurement:** they're saved with `coached: true`, never move the ability estimate, and are left out of accuracy, trends, speed and the daily email's numbers. The email adds a separate "🤝 N more with big-brother coaching" line, so the bell curves stay honest. Home always returns to the coach.

**Original skills:** counting, numbers, math (add/subtract/missing addend), letters, sounds (phonics/rhymes),
shapes & patterns, sight words / CVC reading, **machines** (Nov 6 — Brian: "think mechanical design —
how gears work how pulleys work": wheels/ramps → levers & fulcrums, pulleys, gears mesh opposite +
gear ratios, hydraulics = excavator arms, triangles in bridges, bearings, torque, CAD top/side views,
3D printing layers & honeycomb infill, simulation; adults get a **Mechanical design** bank — lever
classes, mechanical advantage, tolerances/fits, fatigue, GD&T), and **science** (Nov 2 — Brian: "latest physics, quantum,
ai, biology, medicine… I want my boys prepared for the world of the singularity"): banded from age-4
senses/animals up through the body, space and germs to a kid-honest frontier — atoms, DNA, cells,
vaccines/mRNA, CRISPR, AI that learns from examples, qubits, fusion, gravity on the Moon. Every fact
real, words small. Adults get their own **Science & frontier** bank (relativity, entanglement,
transformers/hallucinations, AlphaFold, Higgs, immunotherapy, LIGO…). New skills added to the list
auto-appear on stored/cloud profiles via the normalize step in `applyAssessmentSeeds`.

**Adaptive:** every answer updates a 1–99 ability estimate (`theta`) per skill; the next question is
drawn near it (with periodic easy confidence questions). Correct on hard questions moves theta up
fast; the game gets harder or easier automatically.

**Real-world assessment seeds** (`ASSESSMENT_SEEDS` in `lib/game/storage.ts`): when a kid brings home
a real assessment, a version-stamped, floor-only seed starts their abilities where they actually are
(applied once per profile, never lowers an earned level, re-applied after cloud merges). Marshall's
Oct 2026 school reading check (99th percentile across all six reading areas, ~2 grade levels ahead)
seeds letters/sounds/words to 88–92, and its three practice tips became question content: **"sc"/"sk"
blend words** (scoot, school, skill, skip… as sound and spelling questions), **story settings**
(where/when mini-stories at the top of the words band), and **finish-the-rhyme poem couplets**. The
grown-ups report shows the assessment on a card above the curves.

**Bell curve:** the grown-ups report converts theta to a percentile against heuristic age
expectations (age 4 ≈ 30, age 5 ≈ 50, age 6 ≈ 70, SD 15) computed from each kid's exact birthdate.
It's framed as encouragement, not a clinical assessment.

**Rewards:** 2 coins per correct (+streak bonus), stars per round, coins buy ball skins.
Web Speech API reads every question aloud for pre-readers.

## App Store / Google Play plan

The game is **local-first**: with no Supabase env vars it runs fully on-device (no server calls,
no ads, no tracking). There IS an optional **parent account** (Google/email via Supabase) that
syncs kid profiles to the family's own database — so the store data-safety answers depend on
whether accounts are enabled in the shipped build:
- **Accounts disabled** (no env vars): declare "no data collected."
- **Accounts enabled**: declare account info (parent email) + app activity (game progress),
  collected optionally, not shared, not used for ads. Kids never sign in themselves; the
  account lives behind the grown-ups gate. Still no third-party ads/analytics either way.

Already in place:
- `public/brainball.webmanifest` — standalone PWA manifest scoped to `/play` (id, icons, portrait)
- `public/icons/brainball-{192,512,maskable-512}.png` — app icons
- Safe-area insets + `viewport-fit=cover` for notched phones
- Works offline after first load except fonts (add a service worker at packaging time if desired)

### ✅ The wrapper EXISTS (Nov 6 — `brainball-app/`, its own Capacitor app like HammerTrack's)
Separate shell, same architecture as the HammerTrack app: loads the live
`https://hammertrack.ai/play`, so web deploys update installed apps instantly.
`com.hammertrack.brainball` · portrait-locked · StatusBar is the ONLY native plugin
(no push/location/BLE/camera — the Kids Category posture) · kid-worded offline page
(`shell/index.html`, auto-reconnect) · icons + splashes generated for BOTH platforms
from `public/icons/brainball-512.png` · Android committed with versionCode 1 /
1.0.0 and the same `ANDROID_KEYSTORE_*` signing envs (one upload keystore signs
both apps) · iOS project committed, waits on the Apple enrollment like HammerTrack.
Release = the **`brainball-android-release`** workflow (bump versionCode first).
**One-time for Brian** (Play's API can't create apps): create "Brain Ball" in the
existing Play org account, fill Data Safety per the note above + the Families
questionnaire, upload the first AAB by hand (workflow artifact), grant the Play
service account access — hands-off after that. Full steps: `brainball-app/README.md`.

### Native niceties later
Haptics on correct answers, App Store in-app-purchase if the coin shop ever goes
paid, recorded narration for store builds.

## Parent accounts & cloud sync

Built and wired, activates when the production Supabase project is connected (same env vars as
the main app — see CLAUDE.md):

- **Sign-in options:** Google OAuth ("Continue with Google") + email/password, via the site's
  existing Supabase auth. The card lives at the top of the Grown-ups Progress Report.
- **Sync:** kid profiles auto-push (debounced) whenever progress changes; on sign-in, cloud and
  local copies merge per kid (whichever has more recorded answers wins), so a new phone picks up
  where the old one left off.
- **Storage:** `supabase/migrations/139_brainball.sql` — one row per parent
  (`brainball_profiles`), RLS locked to `auth.uid()`.
- **Google provider setup (one-time):** create an OAuth client at console.cloud.google.com with
  redirect `https://<project-ref>.supabase.co/auth/v1/callback`, paste ID + secret into Supabase →
  Authentication → Providers → Google, and add `https://hammertrack.ai/play` to the auth
  redirect allow-list. (Steps also in the migration file header.)
- **Demo mode:** without env vars the card explains sync is coming and play stays local-only.

### Down the road
- Move profiles from localStorage to Supabase (already in the stack) for multi-device sync.
- Replace Web Speech API with recorded voice for consistent narration in store builds.
- More question banks (time, money, spelling) — just add a generator in `lib/game/questions.ts`.
