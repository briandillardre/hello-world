# Rest Stop Royale 👑

**King of the Hill at rest areas worldwide.**

Tap fast, guess gas prices, and play Bathroom Bingo to claim the crown at rest stops across the US (and the world). The person with the highest 30-day score at each rest area is the king — their name floats on the map with a golden crown.

---

## Features

- **Live Map** — dark CARTO tiles with 🚻 pins and 👑 crown markers for kings
- **Check In** — must be within 500m of a rest area (GPS) to play games
- **3 Mini-Games**
  - 🚛 **Trucker Tap** — tap as fast as possible for 10 seconds
  - ⛽ **Gas Guessr** — guess the gas price at 4 different stations
  - 🚽 **Bathroom Bingo** — check off what you actually see in the bathroom
- **Reviews** — rate cleanliness, vending, and vibes; leave a hot take
- **Hall of Kings** — global leaderboards per game + who currently holds each crown
- **15 Rest Areas** pre-loaded (US + Germany, France, Japan, UK)
- **Offline-first** — all scores stored locally with AsyncStorage; Supabase optional for multiplayer

---

## Quick Start

```bash
cd koth-app
npm install
npx expo start
```

Scan the QR code with **Expo Go** on your phone. You're in.

### Build a real APK

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview
```

---

## Multiplayer (Optional)

Run the Supabase migration to enable global leaderboards:

```bash
# From repo root
supabase db push  # or run supabase/migrations/003_koth.sql manually
```

Add to `koth-app/.env`:
```
EXPO_PUBLIC_SUPABASE_URL=your_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_key
```

---

## Adding Real Rest Areas

The app uses 15 hand-picked rest areas from `src/data/mockData.ts`. To add real OSM data, query the Overpass API:

```
[out:json];
node["highway"="rest_area"]["amenity"="rest_area"](bbox);
out body;
```

---

## Tech Stack

- Expo (React Native managed workflow)
- React Navigation (stack + bottom tabs)
- MapLibre GL JS via WebView (CARTO dark tiles, no API key needed)
- expo-location for GPS check-in detection
- AsyncStorage for offline-first score persistence
- Supabase for optional cloud sync
