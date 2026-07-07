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

`setup.sql` is the 5 migrations (`001`–`005`) concatenated in order. It creates
every table, the Row‑Level‑Security policies that keep each company's data
private, and the `category / serial / photo_url` columns the Add Asset form
writes. Run it **once** on a fresh project. (Validated here against Postgres 16 +
PostGIS: applies clean, 12 tables, and the exact "add the pilot truck" insert
passes RLS.)

> Prefer running them one at a time? Run `supabase/migrations/001…005` in
> numeric order instead — same result.

## 3. Grab the API keys

In the project: **Settings → API**. Copy three values:

| Netlify env var name              | Where in Supabase                    |
|-----------------------------------|--------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`        | Project URL                          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | Project API keys → `anon` `public`   |
| `SUPABASE_SERVICE_ROLE_KEY`       | Project API keys → `service_role` ⚠️ secret |

## 4. Put the keys in Netlify + redeploy

1. Netlify → your site (**stately-heliotrope-0b2bff**) → **Site configuration →
   Environment variables**.
2. Add the three variables above.
3. Also add `INGEST_API_KEY` = any long random string (used in step 6 and by the
   flespi/OBD ingest endpoints; it is **not** the service‑role key).
4. **Deploys → Trigger deploy → Deploy site.** The site leaves demo mode the
   moment `NEXT_PUBLIC_SUPABASE_URL` is set to your real URL.

> The map and asset pages read the signed‑in user's session (a cookie), so once
> Supabase is wired they render per‑request instead of static — a newly added
> asset shows up on the next load without a rebuild.

## 5. Create your account + add the truck

1. Go to https://hammertrackai.com/register and sign up. Registration creates
   your company + admin profile (this is why step 2's signup policies matter).
2. Go to **Assets → Add Asset**:
   - Name: `F-350 Pilot Truck T1-a`
   - Type: **Vehicle**
   - Tracker ID: `868996068802222`
3. Submit. It now saves to the database and appears in the Assets list.

## 6. Make it show on the **map**

An asset in the list only gets a **map pin** once it has a location. Two ways:

**A — real hardware (the eventual path):** point your flespi stream at
`https://hammertrackai.com/api/ingest/flespi`. When T1‑a reports in, the
normalizer matches on `tracker_id` `868996068802222` and drops a pin.

**B — post a test location now (instant pin, no hardware):** run this from a
terminal, swapping in the `INGEST_API_KEY` you set in step 4. The coordinates
below are a Nashville job site:

```bash
curl -X POST https://hammertrackai.com/api/ingest/location \
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
