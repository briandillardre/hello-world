# Mobile Apps — When, Why, What It Costs

*Decision memo, Jul 14 2026. Question: when do native iOS/Android apps make
sense vs the PWA we ship today?*

## Where we are

The PWA (installable, manifest.json, bottom nav, /track phone-as-asset) covers
~90% of daily use: map, alerts, assets, clock-in pages all work in the phone
browser. What a PWA **cannot** do is exactly the list of features on the
roadmap:

| Feature | PWA? | Why native is required |
|---|---|---|
| Employee tracking in the background (app closed / screen off) | ❌ | iOS gives browsers no background location. Full stop. |
| Crew phone as a BLE gateway (phone hears tool tags) | ❌ | iOS Safari has no Web Bluetooth; background scanning needs native |
| Reliable push (theft alert wakes the phone at 2 AM) | ⚠️ | iOS PWA push exists (16.4+) but is best-effort; safety alerts deserve APNs |
| Geofenced auto clock-in/out | ❌ | Needs background region monitoring |
| Offline maps on remote sites | ⚠️ | Possible in PWA, much better native |

## The recommendation

**Don't build native yet. Build it when the first paying customer asks for
crew tracking or auto clock-in — and use Capacitor, not a rewrite.**

- Capacitor wraps the EXISTING Next.js app in a real iOS/Android shell and
  adds native plugins (background geolocation, BLE, push). One codebase, the
  web app stays the product; ~2–4 weeks to first store builds.
- Cost: Apple $99/yr + Google $25 one-time + a Mac for signing (or a cloud
  build service ~$40/mo while shipping).
- The native shell is also the unlock for the **phone-as-gateway** vision:
  every worker's phone becomes another set of ears for tool tags — better
  coverage than truck units alone, and the pairing_log (migration 021,
  kind='crew') is already designed to receive it.

## Trigger list (build when ANY fires)

1. A paying customer requires background employee tracking / auto clock-in.
2. Tool-tag coverage gaps become a sales objection (phone-gateway fixes it).
3. Theft-alert push reliability complaints on iOS.
4. Founding-25 cohort is >50% phone-primary users asking "is there an app?"

Until then: every sprint spent on the PWA improves BOTH the web product and
the future app (Capacitor ships the same code). Nothing built today is thrown
away — that's the point of choosing the wrapper over a native rewrite.

## What NOT to do

- No React Native / Swift rewrite — two codebases would halve feature speed
  at exactly the moment speed is the moat.
- No app-store presence "for credibility" before the native features exist —
  a wrapped map with no background powers invites 1-star "same as website"
  reviews.
