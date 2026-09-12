# Notifications — every message we send, and its off switch

Written Sep 11 2026, after two evening digests landed on Brian's phone in the
same minute and one of them was another company's day. *"Fix whatever is
causing this. I need to cut down on clients feeling too spammed from this app.
Add a link in texts and emails to clients to go straight to turn off or change
notifications."*

## What was wrong

`/api/cron/digest`, `/api/cron/agenda` and `/api/cron/nag` each looped over
**every company** and POSTed the result to the single global
`NOTIFY_WEBHOOK_URL` — one founder ntfy topic.

Three consequences, in order of how bad they are:

1. **Cross-tenant leak.** Every company's fleet names, crew names, safety notes
   and open alerts were pushed to a topic belonging to someone else. With one
   real customer it was a privacy bug; at 25 it is the whole product's
   credibility.
2. **Nobody could turn it off.** There were no preferences for these three at
   all — no enabled flag, no channel, no hour, no timezone.
3. **The founder's phone got one notification per company per night.** That is
   the screenshot, and it is the symptom people notice first.

The Friday/Sunday digests (047) and the morning briefing (054) had always done
it correctly — per company, prefs-gated, at the company's own local hour. These
three simply never got the same treatment.

A fourth bug, same family: `saveDigestPrefsAction` rebuilt the prefs blob from
`friday`, `sunday` and `tz` only, so the **morning briefing was silently reset
to its default every time anyone touched any other toggle**. A customer who
turned off the 6 AM briefing got it back the next time they changed their
timezone.

## The model now

| Piece | Where |
|---|---|
| Preferences | `companies.digest_prefs` — one JSON blob, shape in `lib/weekly-digest.ts` (`DigestPrefs`) |
| Merge / sanitize | `resolveDigestPrefs` (read) and `cleanDigestPrefs` (write) — **both write every key**, which is what fixes the reset-on-save bug |
| Delivery | `lib/digest-delivery.ts` — `deliverSummary()` is the one door |
| Dedupe | `companies.last_*_at` stamps (106) + `sentSameLocalDay()` |
| The off switch | `/n/<token>` (signed, no login) and `Settings → Summaries` — **the same component**, `components/settings/NotifyPrefsForm.tsx` |
| Who gets the PUSH | `profiles.notify_prefs` (107) — per person, `lib/person-notify.ts`; `Settings → My phone` and the Team row |

### The summaries

| Summary | Cron | Pref key | Default |
|---|---|---|---|
| Evening digest | `/api/cron/digest` | `evening` | on, **push only**, 6 PM local |
| Morning site briefing | `/api/cron/briefing` | `briefing` | on, email, 6 AM local, weekdays |
| Monday agenda | `/api/cron/agenda` | `monday` | **off** |
| Friday wrap-up | `/api/cron/weekly` | `friday` | on, email, 4 PM local |
| Sunday week-ahead | `/api/cron/weekly` | `sunday` | on, email, 6 PM local |
| Still on the clock | `/api/cron/nag` | `nag` | **off** |

Push-only defaults are deliberate: a daily recap does not earn an inbox slot or
a text unless the owner asks for one. A brand-new company therefore gets **two**
recurring messages a day at most (one push, one email) and nothing on the
weekend but the two weekly emails.

The Monday agenda and the nag both default **off**. The evening digest is the
daily habit; a second recurring push nobody asked for is the complaint, not the
feature. Both are one tap away in Settings for an owner who wants them.

## Two switches, both have to say yes

The company preferences decide **whether** a summary exists, **when** it goes,
and whether it also emails or texts the company's alert address. The person
preferences decide **whose phone lights up** (Brian, Sep 12: *"the push need to
be per person and admins can go in to change this for people"*).

| Push kind | What it is | Default |
|---|---|---|
| `alerts` | Theft, left-site, a tracker going quiet, safety reports | everyone |
| `receipts` | Their own card's missing receipt — push AND the chase texts | everyone |
| `evening` | The evening digest | Admin · Manager · Foreman |
| `monday` | The Monday agenda | Admin · Manager · Foreman |
| `nag` | Still on the clock | Admin · Manager |

An Associate is on the map and the clock, not the digest — so a new crew
member's phone is quiet without anyone configuring them, while still getting a
2 AM theft alert and the receipt for a card they personally ran.

`audienceTokens()` in `lib/push.ts` is the one resolver: every company-wide
push joins `device_tokens` to `profiles` and keeps only the devices whose owner
wants that kind. Three cases, and they are not the same case
(`audienceFilter()` is the pure half, so they are unit-tested):

| The token belongs to | Summaries | Alerts |
|---|---|---|
| Somebody on the roster | their switch | their switch |
| A user id that is not on the roster (they left) | dropped | **dropped** |
| No user id at all (a pre-100 row) | dropped | kept |

A removed employee's phone must stop buzzing with the company's theft alerts
the moment they are off the team — `removeMemberAction` deletes their
`device_tokens` rows, and this filter is the belt to that suspenders. A legacy
row we cannot attribute is the opposite call: nobody should get a digest we
cannot attribute, and nobody should miss a theft alert over a stale join.

If the `profiles` read itself **fails**, there is no roster, so every token is
unattributable and the same rule applies: alerts still go out, summaries do
not. A digest is worth losing to a transient error; a muted phone staying
muted is the entire feature.

**What is stored is SPARSE** — only the switches somebody actually touched.
Writing all five on every save froze a person against their own role: promote
a Foreman to Admin and they should start getting the nag, but a resolved
`false` on file is indistinguishable from a chosen one. Untouched keys keep
following `defaultPersonNotify(role)` forever. The blob also carries `_by` /
`_at` (ignored by every resolver, which reads `PUSH_KINDS` only): an admin may
silence a subordinate's theft alerts — a shop hand's phone should not scream at
2 AM — but the person sees *who did it and when* on their own card, and can
change it back.

The **Master Admin** resolves as Admin here exactly as they do on /team
(`notifyRole()`, one helper, three call sites). An owner whose stored role is
blank would otherwise fall to Associate and silently lose their own digest.

**Who can change it:** yourself, always — including an Associate whose role has
no other settings at all; nobody needs permission to quiet their own phone.
Somebody else only if you outrank them (docs/ROLES.md) **and** hold the team
ability, checked server-side in `lib/actions/person-notify.ts`. `profiles` is
write-locked for sessions (068), so the write itself is service-role behind
that check, and view-as is refused outright.

**Where the card lives.** `settings` is an Admin-only view level, so /settings
404s for a Manager, Foreman or Associate — which for one day made "yourself,
always" false for three of the four roles. The card therefore has its own
route, **`/settings/phone`**, exempted in `featureForPath` (`UNGATED_PATHS`)
and reachable without any view level. Admins see it inside Settings as before;
everyone else reaches it from the More drawer's account button and the map's
company menu, both of which now point there instead of at a page they 404 on.

**Money never rides the push.** `getInsightHeadlines` takes `includeMoney` and
it is `false` for the digest and agenda, because those go to *every* registered
device in the company and Roles v2 says a Foreman or Associate never sees
dollars. The Friday/Sunday/briefing emails pass `true` — those go to
`alert_email`, which is the owner.

**Alerts are not summaries.** Theft, left-site and after-hours events go
through `dispatchAlerts` (`lib/notify.ts`) and are untouched by any of this.
Silencing summaries never silences a 2 AM alert — the `/n` page says so out
loud, because someone who thinks it might will not press the button.

### Every cron runs hourly

A per-company hour and timezone needs an hourly cron; a fixed UTC send is the
wrong hour for half the map and, for the Monday agenda, sometimes the wrong
day. The gate is cheap by design: prefs come off the company row that the loop
already reads, and the expensive fact-gathering happens only for companies
whose hour it actually is.

### Claim the slot, then send

`claimSend()` writes the `last_*_at` stamp **before** delivery, matching on the
previous value so it is a compare-and-set. Stamping *after* the send looked
fine until you count the ways a run dies in between — `maxDuration` kills the
lambda mid-loop, the model call hangs, the UPDATE errors. The company would
then still be un-stamped, still inside the grace window, and (with the
longest-waited-first sort) *first* in line next hour: the same digest, twice.
Proven against production: two runs racing from the same previous value, one
wins, one gets nothing.

The claim also covers the company with no assets, which bails out before it
composes anything. Its slot is already taken, so an asset-less trial account
can no longer sit at the front of the batch every hour forever and starve the
real customers behind it.

The model call is bounded (`timeout: 12_000, maxRetries: 1`) — the SDK default
is ten minutes with two retries, and one hung request would eat the whole
60-second budget.

`?force=1` (with the cron secret) skips the schedule and the claim, so a test
poke neither dedupes nor silences that evening's real send. It does **not**
skip the off switch: a company that unsubscribed is never sent to, by any path.

All three crons **fail closed** on `CRON_SECRET`, matching `/api/cron/usage`
and `/memo`. They spend model tokens and mail every company; an unset secret
must mean no run, not an open door.

### The founder webhook

`NOTIFY_WEBHOOK_URL` is a founder/dev mirror, not a delivery channel. It now
only ever receives the **platform owner's own company**, resolved by
`isPlatformOwnerCompany()`: the Master Admin is the company creator, so
`profiles.id === companies.id`, and that user's confirmed email must appear in
`PLATFORM_OWNER_EMAILS`.

It **fails closed** — an unresolvable owner, an unset allow-list, or any error
means no webhook. A wrong `true` ships a customer's day to someone else's
phone; a wrong `false` costs the founder a duplicate they already get by push.

## The link in every email and text

`lib/notify-token.ts`. Same idea as share links: the token **is** the grant, so
there is no table and nothing to look up.

* Packed binary — 16 bytes of company id, 2 bytes of expiry day, 12 bytes of
  HMAC — so the whole URL is ~65 characters. The first cut used JSON+base64 and
  produced a 157-character link that ate an entire SMS segment on its own and
  read like spam.
* 180 days. A digest sits in an inbox a long time, and a dead unsubscribe link
  is how you get marked as spam.
* What it grants is deliberately tiny: read and write `digest_prefs` for one
  company, plus that company's name to show on the page. Not assets, not crew,
  not costs.
* **It can only make things quieter** (`onlyQuieter()`). A 180-day link sitting
  in a shared or forwarded inbox, with no revocation path, must not be able to
  switch every summary to email + text and become a spam amplifier aimed at the
  owner's phone on our Twilio bill. Hours and timezone stay editable; turning a
  summary back **on** is a signed-in action. The action returns what it actually
  stored, so the page never shows a switch the server refused.
* The signing key is always **derived**, never the raw `SHARE_LINK_SECRET`, so a
  leaked unsubscribe link can be revoked without killing every public replay
  link too.
* SMS truncation reserves room for the tail **first**, so the opt-out link is
  never the part that gets cut.

`shell()` in `lib/weekly-digest.ts` renders the email footer, so every summary
email inherits it. `smsOptOut()` is the text equivalent.

## Adding a new recurring message

1. Add its key to `DigestPrefs` + `DIGEST_DEFAULTS` + `resolveDigestPrefs` +
   `cleanDigestPrefs` (all four, or it gets dropped on save — that was the bug).
2. Add a `last_<x>_at` column and gate on `sentSameLocalDay`.
3. Deliver through `deliverSummary()`. Never fetch `NOTIFY_WEBHOOK_URL` yourself.
4. Add a row to `NotifyPrefsForm` — it serves the signed-in page and the
   signed-out one at once.
5. Add it to the table above and to the `notifications` help guide.

## Alerts use the same rule

`dispatchAlerts` (`lib/notify.ts`) and the clock-out safety note
(`lib/actions/fieldops.ts`) are not summaries, but they had the same shape of
bug and are fixed the same way:

* The safety note used to POST straight to the global webhook, so any crew
  member on any customer could put their own name plus free text into a topic
  belonging to someone else. It goes to the company's own devices now.
* `ALERT_SMS_TO` and `NOTIFY_WEBHOOK_URL` are **founder fallbacks**, not
  channels. A customer who never set `alert_phone` — the default for every new
  signup — was having their theft alerts texted to the founder's number. Both
  are gated on `isPlatformOwnerCompany()` and both fail closed.
* `mirrorOwnerWebhook()` is the one call for any non-summary path that wants the
  founder mirror.

## Known gaps

* **Money is still stripped from every push**, even though the audience is now
  resolved per person and their role is right there. Restoring it would mean
  composing two variants of the same digest (one with dollars, one without) and
  doubling the model call — worth doing only if an owner asks why the push says
  less than the email.
* **Email and SMS are still per company**, addressed to `alert_email` /
  `alert_phone`. Only the push is per person. A second admin who wants their own
  copy of the Friday email has to be added to that address.
* **Vercel Analytics would carry the token** if `NEXT_PUBLIC_VERCEL_ANALYTICS`
  is ever switched on — add a `beforeSend` that rewrites `/n/`, `/r/`, `/share/`
  and `/t/` URLs first. (Client error reports already scrub them: `safePath()`
  in `components/system/ErrorReporter.tsx`.)
* **The missing-receipt ladder has no company-level off switch** — it is opt-in
  by construction (no card-alert inbound, no charges to chase) and each message
  can be closed with "No receipt", but a company that turns the feature on gets
  the full 15 min / 1 h / 4 h / 24 h / twice-daily ladder. Deliberate for now
  (Brian, Sep 9: "annoy the hell out of them until they take a picture") —
  revisit if a customer complains. The *person* switch does cover it end to
  end: `receipts` off means no push **and no text** (the SMS rung used to sit
  outside the gate, so switching it off still bought six texts over two weeks).
