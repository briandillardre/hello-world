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

### The summaries

| Summary | Cron | Pref key | Default |
|---|---|---|---|
| Evening digest | `/api/cron/digest` | `evening` | on, **push only**, 6 PM local |
| Morning site briefing | `/api/cron/briefing` | `briefing` | on, email, 6 AM local, weekdays |
| Monday agenda | `/api/cron/agenda` | `monday` | on, **push only**, 7 AM local Monday |
| Friday wrap-up | `/api/cron/weekly` | `friday` | on, email, 4 PM local |
| Sunday week-ahead | `/api/cron/weekly` | `sunday` | on, email, 6 PM local |
| Still on the clock | `/api/cron/nag` | `nag` | **off** |

Push-only defaults are deliberate: a daily recap does not earn an inbox slot or
a text unless the owner asks for one. The nag is off because it is the least
actionable thing we send and the fastest way to teach someone to swipe our
notifications away.

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

The `last_*_at` stamp is what stops an hourly cron, a retry, or a manual poke
from sending twice. It is written even when no channel is configured —
otherwise the cron rebuilds that company's digest every hour, all evening, for
a send that can never land.

Both `/api/cron/digest` and `/api/cron/agenda` take `?force=1` (with the cron
secret) to skip the hour gate and the stamp when you are testing.

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
  not costs. The worst a leaked link can do is silence summaries its own
  recipient already receives.
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

## Known gaps

* **Preferences are per company, not per person.** Everyone on the company's
  registered devices gets the same push. Per-person mute is the next step and
  matters most once a company has more than one admin.
* **The missing-receipt ladder has no company-level off switch** — it is opt-in
  by construction (no card-alert inbound, no charges to chase) and each message
  can be closed with "No receipt", but a company that turns the feature on gets
  the full 15 min / 1 h / 4 h / 24 h / twice-daily ladder. Deliberate for now
  (Brian, Sep 9: "annoy the hell out of them until they take a picture") —
  revisit if a customer complains.
