# Dashcams — the open option

*Oct 1 2026. Brian: "Need open source dash camera option." Researched the
same day; nothing built yet — the pilot needs one camera on one truck.*

## The finding

**No dashcam has truly open firmware** — OpenIPC targets IP cameras and
FPV drones, and its streamer is closed source ([OpenIPC](https://openipc.org/)).
What we CAN keep open is the data path: a 4G dashcam whose protocol flespi
already decodes sends its clips through the webhook we already run, into
our own storage, onto our own map. No vendor cloud, no lock-in — switching
camera brands is a new flespi channel, not a new platform.

## 1. flespi media (our existing pipe)

- Brands with video support: Howen, Jimi IoT, Teltonika, Queclink, Streamax,
  Meitrack, MettaX, Stonkam, Cipia and generic JT/T 808
  ([flespi KB](https://flespi.com/kb/video-telematics-integration)).
- Messages carry `media.video.*` / `media.image.*` links on media.flespi.io;
  `request_video` fetches a clip by camera, time and length; live video over
  WebRTC / HTTP-FLV / HLS. Video is included in the per-device fee; stored
  media costs ~€1/GB-month. flespi's own S3 upload only targets AWS and
  Oracle ([KB](https://flespi.com/kb/flespi-media-upload-to-s3)), so we copy
  files into a private Supabase bucket ourselves.

## 2. The candidates

| | Hardware | Notes |
|---|---|---|
| **Queclink CV200XNA** — pilot pick | ~$375 ([EmbeddedWorks](https://embeddedworks.net/product/tdev283/)) | US LTE bands, −20…70 °C, flespi handles `request_video`, HLS, harsh-brake/crash/SOS events ([flespi](https://flespi.com/blog/queclink-device-video-data-via-api)) |
| Streamax AD Plus 2.0 — fallback | ~$541 ([EmbeddedWorks](https://embeddedworks.net/product/tdev266/)) | −40…70 °C; flespi's biggest video brand, 2–3 live streams at once ([flespi](https://flespi.com/protocols/streamax)) |
| Jimi JC261P / JC450 | ~$349 ([Traxelio](https://traxelio.com/product/jimi-jc261p-01kxmfn666jrg05p15zggqarax)) | Older JC models upload only 1-minute segments; flespi recommends the JC450 ([flespi](https://flespi.com/protocols/concox)) |
| Teltonika DualCam + FMC650 | ~$132 + ~€122 | **Out for now:** the camera hosts (FMC125/225/650, Cat 1) are not on Teltonika's North America certificate list, and our Cat-M1 FMM650 is not a listed host ([wiki](https://wiki.teltonika-gps.com/view/Teltonika_DualCam), [certificates](https://wiki.teltonika-gps.com/view/Certificates_overview)). ~6 MB per 20 s clip, ~5 min to upload, no live view |
| JT/T 1078 cameras + an open-source server | 30–50% cheaper | Published Chinese standards; open servers exist (Traccar 6.13+ live HLS, [go-jt808](https://github.com/cuteLittleDevil/go-jt808) MIT, [lkm](https://github.com/lkmio/lkm) MIT) — but needs an always-on TCP/media server outside Vercel, and "works differently on every device" ([flespi](https://flespi.com/blog/most-popular-video-devices-in-2025)) |
| DIY (Raspberry Pi, phone, comma) | — | **No:** dashboards reach 180–200 °F; Pi 5 is rated 0–70 °C, iPhones 0–35 °C; a phone leaves with the driver; comma four ($999) is a driver-assist alpha, not a work-truck camera |

## 3. Data

Event clips only (harsh brake, crash, panic, "get clip"): ~20 clips × 6–15 MB
≈ 0.1–0.3 GB per truck per month — roughly $5–10 on pay-as-you-go
(Hologram $0.03/MB). Continuous upload would be ~1 GB per driving hour —
never. The cameras carry their own LTE SIM: our KORE pool is sized for
trackers (and the FMM00A's Cat-M1 radio could not carry video anyway).

## 4. What we build when the pilot camera arrives

1. Link a camera to its asset (flespi channel → device → our asset id).
2. Ingest: the webhook sees `media.*` links → copy the file into a private
   bucket → a row per clip (asset, time, place, event, size); short
   `media_ttl` in flespi.
3. Clip pins on the map (replay-aware, like photos) and a player on the
   asset page; a **Get clip** button that calls `request_video` for any
   moment on the timeline.
4. Harsh-brake clips fire from the camera's own events — and from the
   tracker's once Green Driving IO is on.

Risks to watch: SD cards ("TF card abnormal" errors reported on flespi),
carrier certification of the CV200XNA (unverified), and the clip-copy cost
in our storage.
