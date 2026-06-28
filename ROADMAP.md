# HammerTrack — Roadmap & Status

Living checklist of what's done, in progress, and still to do. Updated as we build.
Legend: ✅ done · 🟡 in progress / partial · ⬜ to do

---

## 🌐 Website / Marketing
- ✅ Branded marketing homepage (theft-hook headline, navy "mission control" look)
- ✅ "See the live map" as the primary CTA (clickable live-map console)
- ✅ "How it works — three steps" section
- ✅ "Who it's for" + crew-tracking / Ask-AI / live-cost features + Nashville credibility line
- ✅ Pricing page (Tenna comparison)
- ✅ Public demo landing page (/demo)
- ⬜ Testimonial / social proof (add once you have a quote)
- ⬜ Short 60-sec demo video

## 🗺️ Live Map / Demo
- ✅ Dark + Satellite basemaps (Satellite is now the default)
- ✅ Asset clustering, color-coded types, pin glow
- ✅ Geofence zones (Riverfront Tower, Maple St Grading, Equipment Yard) + tap-for-presence/cost popover
- ✅ Timeline replay (Live → All time) with up to 1M× speed + date/time readout
- ✅ Trails / Heatmap movement modes on any range
- ✅ Live job-site cost (labor + equipment) that accrues with the timeline
- ✅ Weather layer (radar overlay + conditions) with location label
- ✅ Readable dark popups; one popover at a time; closeable asset panel
- ✅ Collapsible left sidebar (icon rail)
- ✅ Zone-popover cost now matches the selected timeline range/scrub
- ⬜ **Custom date/time range** (From / To pickers, right of "All time") — NEXT
- ⬜ Trails follow real roads (demo uses a synthetic street grid; **real GPS will follow roads automatically**)
- ⬜ Camera pins → real snapshot images (currently a placeholder frame)

## 📱 Field Tracker (phone/iPad, web)
- ✅ Clock-in GPS tracking page (/track): live dot + breadcrumb trail, time/distance/speed/accuracy
- ✅ Keeps screen awake while on the clock; clock-out summary
- ⬜ Feed the shared dashboard map (needs Supabase — see Infra)
- ⬜ Native background app (true all-day tracking when phone is locked) — separate small app, later

## 🛰️ Trackers / Hardware
- ✅ Order placed: 2× Teltonika **FMM00A** (OBD-II, Cat-M1, BT/BLE 4.0, AT&T) — arriving ~Jun 29
- ✅ flespi normalizer built (Teltonika FMM family → our schema)
- ✅ Ingest endpoints built (/api/ingest/flespi, /obd2, /location)
- ⬜ Create flespi account, add device IMEIs, point webhook → hammertrackai.com/api/ingest/flespi
- ⬜ Plug FMM00A into a truck's OBD port → appears on the live map
- ⬜ BLE tool tags (BlueCharm BC021) — later phase
- ⬜ Equipment GPS (Teltonika TAT141 + solar) — later phase

## 🔌 Integrations
- ✅ QuickBooks Online OAuth + invoice/expense scaffolding (lib/qbo.ts)
- ⬜ Connect live QuickBooks (env vars + app at developer.intuit.com)
- ⬜ Geofence-verified labor hours → QuickBooks timesheets/payroll export
- ⬜ Ask-AI: upgrade to real Claude phrasing (add ANTHROPIC_API_KEY) — premium tier

## 🧠 AI Assistant
- ✅ "Ask your fleet" grounded Q&A on every screen (who's on site, equipment, labor hours, cost, alerts)
- ✅ Works free in demo; upgrades to Claude when an API key is added
- ⬜ Daily / weekly proactive summary text

## ⚙️ Infrastructure / Deploy
- ✅ Moved hosting **Netlify → Vercel** (Netlify was out of credits + slow). Auto-deploys on push (~1 min)
- ✅ Auto-cleanup of stale service workers / caches
- ⬜ Point **hammertrackai.com** DNS at Vercel
- ⬜ Move Vercel project to free **Hobby** plan before the 14-day Pro trial ends
- ⬜ **Supabase** project: run migrations (001 + 002), seed demo data, add keys to Vercel — NEXT
- ⬜ Login / auth so the dashboard shows the real company + user (replaces "HammerTrack Demo")
- ⬜ Optional: **MapTiler** key for a richer 3D dark basemap (free tier)

---

## 🎯 Immediate next steps (in order)
1. **Supabase** — stand up the database (unlocks live data + the phone tracker on the map).
2. **flespi + FMM00A** — when the trackers arrive, connect them to the live map.
3. **Custom date/time range** on the timeline.
4. **Point the domain** (hammertrackai.com) at Vercel + move to free Hobby plan.
