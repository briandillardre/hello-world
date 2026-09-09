# Receipt Chase — instant "send the receipt" nagging

*Design doc, Jul 15 2026. Requested by Holy City Paving (founding customer #1):
the moment a company card is swiped, the employee holding that card gets
pinged — and KEEPS getting pinged — until a photo of the receipt is captured
and categorized for job costing. "This would solve 90% of the receipt problem."*

## The flow

1. **Purchase happens** → card feed fires a transaction event
   (amount, merchant, last-4, timestamp).
2. **Card → employee mapping** (admin sets once: "…4821 = Miguel") resolves
   who gets chased.
3. **Ping** within seconds-to-minutes of the swipe: SMS + push with a magic
   link — *"$84.12 at Lowe's on card …4821 — snap the receipt: [link]"*.
   Link opens straight into the phone camera (PWA `capture` input, no login
   friction — the link IS the auth, scoped to that one transaction).
4. **Capture + categorize**: photo → pick category & sub-category → pick job
   (zone list). Categories come from either:
   - admin-defined list (Settings → Receipt categories), or
   - synced QuickBooks chart/classes/projects once QBO is connected —
     so the choice the employee makes IS the job-cost line.
5. **The nag ladder** (BUILT Sep 9 2026, migration 099 — runs every 15 min):
   - T+15 min: push (rung 2)
   - T+1 h: push + text to the cardholder's cell (rung 3, `profiles.phone`)
   - T+4 h: push + text, sharper (rung 4)
   - T+24 h: push + text, AND the owner/admins get one push + the office line
     one text ("Trey hasn't snapped the $312 Home Depot receipt from Tue")
     (rung 5, `expenses.escalated_at`)
   - Then 7 AM and 5 PM company-local, every day, for two weeks; after that the
     nightly digest carries it like any aging charge
   - Every push carries the capture link as its TAP TARGET (FCM `data.url`,
     opened by the app) — one tap lands on the camera
   - In between, the in-app bar (`components/receipts/ReceiptNagBar.tsx`)
     rides EVERY screen the cardholder opens: "2 receipts need your photo ·
     $402" → Snap (camera right there, same /api/r/<token> door) · No receipt
     (closes with the person's reason) · Later (shrinks to a pill for 10 min,
     never goes away)
   - Captured → nags stop instantly, receipt lands in the existing inbox

## The honest constraint: how fast is "instant"?

The swipe→ping delay is set by WHERE we hear about the transaction:

| Feed | Latency | Notes |
|---|---|---|
| **Corporate card platform (Ramp, Brex, Divvy)** | **seconds** | Real webhooks on auth. Ramp/Divvy also nag natively — but generic, not job-coded, not in our system |
| **Plaid transactions webhook** (works with Chase, CapOne, most banks) | **minutes → few hours** (bank-dependent; pending-transaction support varies) | The right default for "keep the cards you have" |
| QuickBooks bank feed | 1–3 days | Too slow — this is the problem we're solving |

Recommendation: **build on Plaid** (works with whatever cards Holy City
already carries; ~$0.30/connected account/mo at small scale) and treat
Ramp-style platforms as a premium "instant mode" integration later. Chase's
own SMS alert speed comes from being the card issuer — Plaid is the closest
anyone else can legally get without issuing cards.

## What already exists (this is mostly assembly)

- Receipts inbox with AI extraction + approve-to-QBO (shipped)
- Magic-link pattern (share links), PWA camera, Twilio SMS path (pending
  EIN → live), push via ntfy/web push, zones for job attribution
- QBO OAuth + posting

## Build list (v1 ≈ 3–4 days once Plaid keys exist)

1. Migration: `card_mappings` (last4 → profile), `card_transactions`
   (plaid txn id, amount, merchant, status: outstanding/captured/approved,
   nag_state), `receipt_categories` (admin list, optional qbo refs)
2. `/api/plaid/webhook` + Plaid Link setup page (admin connects the bank)
3. Nag engine on the existing hourly cron (ladder above) + instant first
   ping on webhook arrival
4. `/r/[token]` capture page: camera → category → job → done
5. Receipts page "Outstanding" tab + admin category settings

Blockers: Plaid account (free sandbox, ~15-min signup) and Twilio (EIN,
already in motion). Push-only works before Twilio lands.

## Where it shows on the map (Sep 9 2026)
Layer **Receipts** (My sites group, needs the costs permission): every card
swipe pinned where it happened — the truck standing in the vendor zone at
swipe time (051 handshake), else the cardholder's phone (`expenses.swipe_lat/
lng/swipe_asset_id`). Red while the photo is owed (popup: Snap now for the
cardholder), teal once captured, pinned where the PHOTO was taken (capture
page GPS or EXIF → `receipts.lat/lng/taken_at`) with the picture in the popup.
Live = last 30 days, refreshed every minute; replays follow the window.
`/api/receipts-map` returns an empty layer to roles without costs.

## Proving the loop without a card
Receipts → Instant chase → **Send me a test swipe**: a real $12.34 charge on
your name fires the same push (tap opens the camera) and text the webhook
would. The three readiness chips on that card say which legs can fire right
now (bank alert email = `RESEND_INBOUND_SECRET`, push = FCM, texts = Twilio).
