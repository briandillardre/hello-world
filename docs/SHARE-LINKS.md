# Share links — exports that save inside the app, and "share this view"

Brian, Sep 19 2026: *"GIF won't save to phone. Need share option to send link
to show certain screen setup to team members either thru app or thru link."*

One table (`share_links`, migration 113), two kinds of link, one short URL
shape: **`hammertrack.ai/x/<id>`**.

## Why files became links

The Capacitor shell loads the live site in an Android WebView, and a WebView
has no download door: an `<a download>` click is a no-op unless the host app
wires a `DownloadListener` (ours does not), and `navigator.share` is browser
chrome the WebView does not have. So the GIF recorder — and the PDF before
it — built the file every time and handed it to nothing. Worse, the result
sheet reported the anchor click as *"Saved to your downloads."*

Now every finished export (GIF · PNG · PDF) goes into the **private `exports`
bucket** and comes back as a link:

| Door | What it is | Where it works |
|---|---|---|
| **Save** | In the shell: the signed storage URL (`Content-Disposition: attachment`). It is a FOREIGN host, and Capacitor hands foreign hosts to the system browser — Chrome downloads it like any file. In a browser: the blob, instantly, offline. | everywhere |
| **Send** | Web Share with the LINK where the browser has it; else the Messages app through an `sms:` URL (every WebView has that door); else the clipboard. | everywhere |
| **Copy link** | `hammertrack.ai/x/<id>` | everywhere |

The flow (`lib/export-upload.ts` → `lib/actions/share-links.ts`):

1. `mintExportUploadAction(kind, size)` — caller resolved, `map` feature
   required, never under view-as, daily ceilings (100 export links per
   company, 25 per person). It inserts a **pending row** first
   (`payload.pending`, expiry 2 h — the id is claimed before any object
   exists, so a finalize can only ever land on a row this caller minted) and
   returns a signed upload URL for `<folder>/exports/<id>.<ext>`. The folder
   is an HMAC of the company id (`exportFolder()`, keyed off
   `SHARE_LINK_SECRET`), not the id itself — an object path leaks nothing.
   The link id doubles as the object name.
2. The device streams the blob to storage with `uploadToSignedUrl` — never
   through a server action (Vercel's ~4.5 MB body cap would eat a medium GIF).
3. `finalizeExportAction(path, filename, title)` — the path must belong to
   the caller's own pending row; the object must be there, be the MIME type
   it claims, and fit 25 MB (else it is removed and the pending row goes);
   the row is UPDATED to `kind: 'file'` with a 30-day expiry and a 7-day
   signed URL comes back for the Save button. A pending row nobody finalizes
   expires on its own two hours later (the same sweep as any expired link).

**Public by link, on purpose.** A replay GIF is meant to reach a client, an
insurance claim, a subcontractor — people with no login. The id is the whole
secret: 12 characters of a 31-letter alphabet (~2^59), lowercase with no
look-alikes because it gets read off a text. Every miss on `/x/` costs one
indexed read behind a per-IP limiter (60/min). 30 days, then the row and the
object go together (health cron, step 6).

`deliverFile()` in `lib/map-export.ts` no longer tries the anchor inside the
shell and no longer claims `downloaded` there.

## Share this view

The export flyout's fourth answer. `buildSharedView()` in MapView snapshots:

- the Layers panel state — the same `MapViewCfg` a saved view stores (basemap,
  3D, terrain, radar, precip, overlays, parcels, trail mode, zones, markers)
- the camera (center, zoom, bearing, pitch)
- the time range, a custom window's bounds, and the playhead
- what is followed (asset or `zone:<id>`) and what is open (asset / zone)
- the division filter (106) — including "no filter", which is part of the picture
- labels off, sunlight mode, per-overlay opacity

`components/map/ShareViewSheet.tsx` shows it in plain words (chips), lets the
sender title it, and offers **Copy link**, **Send** (share sheet / Messages)
and **Send in the app** — a roster of teammates with a checkbox each. The
list marks who has no phone in the app yet, so the sender is never told
"Sent" about a phone that does not exist. The push (`sendPushToUser`,
strict, roster-only, `kind: 'shares'` — the sixth per-person switch, *Shared
map views*, on by default for every role) carries `data.url = /x/<id>`; the
tap opens the short link, which lands on the view. Every send writes one
row per recipient to `share_link_sends` (migration 114) — the audit trail
and where the caps count from: 25 recipients per send, 100 per link, 100
sends per sender per day.

The link is minted as the sheet OPENS (clipboard and share sheets need the
tap's gesture — an awaited server round trip first loses it on Safari and
Chrome alike), with the title as typed; retitling re-mints after a short
pause, so by the time a thumb reaches a button the link with the new title
exists. Rows are cheap; a stale title in somebody's push is not.

**Opening one.** `/x/<id>` for a view redirects into `/map?v=<id>` — through
`/login?next=…` when signed out, so a texted link still lands on the screen
it named after signing in. The map page reads the row with the caller's own
client (`lib/db/share-links.ts` → RLS: `kind = 'view' AND company_id =
current_company_id()`), re-validates the payload, and MapView applies it ONCE
when the map is ready: `applyView` for the layers, `jumpTo` for the camera
(and the shell-first boot fit stands down for it, the same way it does for a
restored last camera — on a cold boot the fleet lands a second later and
used to yank the map off the shared spot), `handleRange` + playhead,
division, and a short poll for the open sheet's subject AND the follow
target (shell-first boot streams assets in after mount; follow in particular
must wait, because the release effect drops a followId whose track is not on
the map yet; a subject hidden from this person by the visibility ladder
simply never appears — the right outcome). Then `?v=` is stripped from the
URL and a toast says who shared it. The recipient owns the map from there —
a shared view is a starting point exactly like a saved one. 180 days.

## The validator is the safety story

A shared view is applied straight to somebody else's map state, so
`cleanSharedView()` in `lib/share-links.ts` runs on the way IN (the action)
and on the way OUT (the page read). Unknown keys are dropped; unknown basemap
or trail-mode ids fall back rather than fail; ids are `[A-Za-z0-9_:-]{1,80}`;
overlays/opacity are capped at 40 keys; a custom range with no usable bounds
opens on Live; the cleaned JSON is capped at 6 KB. `scripts/share-links-test.mjs`
(40 assertions) — **run it after ANY change to that file.**

Ids named in a view are only ever resolved on the recipient's side against
their own RLS-scoped assets and zones, so a link cannot leak another
company's data or a hidden machine.

## Housekeeping

- `share_links` RLS: members SELECT their company's **view** links only. File
  links are read by `/x/` with the service client, by id. There is no
  INSERT/UPDATE/DELETE policy — every write is a server action on the service
  client after it has checked the caller (and refused `viewingAs`).
- The `exports` bucket is private with no `storage.objects` policies: uploads
  ride signed upload URLs, downloads signed URLs, both minted by the service
  role.
- `share_link_sends` (114): service role only, RLS on, no policies, cascades
  with its link.
- Health cron step 6, daily: expired rows go (file links take their object
  with them — objects first, rows second, so "row exists ⇒ object exists"
  stays true), and objects uploaded but never finalized are removed after a
  day. Only a path of our own shape
  (`<16 hex>/exports/<12-char id>.<gif|png|pdf>`) is ever handed to
  `remove()`; the live-row check runs in slices of 200 ids and a slice that
  fails counts as all-live. Bounded: 200 rows and 500 company folders per run.
- Ceilings per company per day: 100 file links (25 per person), 200 view
  links; 25 recipients per send, 100 per link, 100 sends per sender per day.
- The export result sheet takes a link only for the export it is still
  showing (a sequence per export, not a filename compare — two PNGs in one
  second share a name), and the GIF recorder does the same across Stop / Record.
