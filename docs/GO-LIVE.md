# Go Live: wiring HammerTrack to a real database

Right now the site runs in **demo mode** — it shows 10 fake Nashville assets and
the **Add Asset** form runs but has nothing to save into. This guide flips it to
a real Supabase database so assets you add persist and your pilot trucks show on
the map.

You need ~20 minutes and logins for **Supabase** and **Netlify**. Steps 1, 2, 4
are things only you can do (they need your accounts); everything is copy‑paste.

---

## 1. Create the Supabase project

1. Go to https://supabase.com → **New project**.
2. Name it `hammertrack` (or anything). Pick a strong DB password and save it.
3. Region: pick **East US** (closest to Nashville).
4. Wait ~2 min for it to provision.

## 2. Create the tables (paste once)

1. In the project: **SQL Editor** → **New query**.
2. Open `supabase/setup.sql` from this repo, copy the **whole file**, paste it in.
3. Press **Run**. You should see "Success. No rows returned."

`setup.sql` is the 7 migrations (`001`–`007`) concatenated in order. It creates
every table, the Row‑Level‑Security policies that keep each company's data
private, and the `category / serial / photo_url` columns the Add Asset form
writes. Run it **once** on a fresh project. (Validated here against Postgres 16 +
PostGIS: applies clean, 12 tables, and the exact "add the pilot truck" insert
passes RLS.)

> Prefer running them one at a time? Run `supabase/migrations/001…007` in
> numeric order instead — same result.

## 3. Grab the API keys

In the project: **Settings → API**. Copy three values:

| Env var name                      | Where in Supabase                    |
|-----------------------------------|--------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`        | Project URL                          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | Project API keys → `anon` `public`   |
| `SUPABASE_SERVICE_ROLE_KEY`       | Project API keys → `service_role` ⚠️ secret |

## 4. Put the keys in your host + redeploy

Set these on **whichever host actually serves the live app** — Vercel or
Netlify. (As of Jul 2026 the app is deployed on **Vercel**
`hammertrackjune28.vercel.app`, which is also where the flespi webhook points.
The `hammertrackai.com` domain / Netlify project in the notes are the earlier
setup.)

- **Vercel:** Project → **Settings → Environment Variables**.
- **Netlify:** Site → **Site configuration → Environment variables**.

1. Add the three Supabase variables above.
2. Add `INGEST_API_KEY` = any long random string (used in step 6 and by the
   OBD/location ingest endpoints; it is **not** the service‑role key).
3. Add `FLESPI_WEBHOOK_TOKEN` = the exact value in your flespi webhook's
   `x-flespi-token` header, so real tracker data is accepted (fails closed
   otherwise).
4. **Redeploy** (Vercel: Deployments → ⋯ → Redeploy; Netlify: Trigger deploy).
   The app leaves demo mode the moment `NEXT_PUBLIC_SUPABASE_URL` is set to your
   real URL.

> The map and asset pages read the signed‑in user's session (a cookie), so once
> Supabase is wired they render per‑request instead of static — a newly added
> asset shows up on the next load without a rebuild.

## 5. Create your account + add the truck

1. Go to `<your-live-url>/register` (e.g. `https://hammertrackjune28.vercel.app/register`)
   and sign up. Registration creates your company + admin profile (this is why
   step 2's signup policies matter).
2. Go to **Assets → Add Asset**:
   - Name: `F-350 Pilot Truck T1-a`
   - Type: **Vehicle**
   - Tracker ID: `868996068802222`
3. Submit. It now saves to the database and appears in the Assets list.

## 6. Make it show on the **map**

An asset in the list only gets a **map pin** once it has a location. Two ways:

**A — real hardware (the eventual path):** your flespi webhook already POSTs to
`https://hammertrackjune28.vercel.app/api/ingest/flespi` (channel 1401177). Once
the DB + `FLESPI_WEBHOOK_TOKEN` are set and T1‑a reports in, the normalizer
matches on `tracker_id` `868996068802222` and drops a pin. If you later move the
app to a different URL, update the webhook URI to match.

**B — post a test location now (instant pin, no hardware):** run this from a
terminal, swapping in the `INGEST_API_KEY` you set in step 4. The coordinates
below are a Nashville job site:

```bash
curl -X POST https://hammertrackjune28.vercel.app/api/ingest/location \
  -H "x-api-key: YOUR_INGEST_API_KEY" \
  -H "content-type: application/json" \
  -d '{"tracker_id":"868996068802222","lat":36.1627,"lng":-86.7816,"battery":88}'
```

Expect `{"ok":true}`. Reload `/map` — the F‑350 pin is at the site. A `404 No
asset found with that tracker_id` means step 5 didn't save (check the tracker ID
matches exactly).

---

## Troubleshooting

- **Add Asset still does nothing / "Could not save":** the site is still in demo
  mode (env var not set or deploy not triggered), or `setup.sql` didn't run.
  Confirm `NEXT_PUBLIC_SUPABASE_URL` in Netlify is your real project URL and you
  redeployed after adding it.
- **Asset saved but no map pin:** expected until it has a location — do step 6.
- **`401 Unauthorized` from the curl:** `x-api-key` doesn't match the
  `INGEST_API_KEY` you set in Netlify.
- **Second run of `setup.sql` errors:** normal — it's a one‑time script; the
  errors just mean the tables already exist.
