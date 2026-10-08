# Auto takeoff from aerial imagery: research (Oct 8 2026)

Prompt: a Facebook ad for **TruTec AI** ("Start with the property. Select…"). The questions were how it works, who else does the same thing, and how HammerTrack could build its own version for DCG and the sister paving company.
Status: research only. Nothing is built. Prices and terms are as found on Oct 8 2026, and every vendor number below needs a quote before anyone relies on it.

## 1. TruTec AI: what we know
- **Product:** AI takeoffs for paving contractors. You pick the property, and it measures the whole site from recent high-resolution aerial imagery. Coverage is the US and Canada. It also accepts your own drone photos or plans.
- **What it measures (20+ line items):** asphalt area, parking stalls, ADA stalls and markings, islands, crosswalks, curb and gutter (LF), and wheel stops. Its published material covers parking lots, HOA streets and driveways. **Nothing we found says it does landscaping** (turf or mulch beds), so it is a paving-only tool.
- **Output:** a white-labelled PDF for the client to sign off on, or a DXF that goes straight into CAD.
- **Distribution:** since Mar 2026 it is built into **OneCrew**, a paving business platform, as "Instant Takeoffs". OneCrew says measurements come back in seconds and flow into estimating and job planning. The quote attributed to the TruTec CEO in OneCrew's post says it identifies paving surfaces and boundaries "directly from imagery".
- **Imagery source:** **not disclosed.** "Recent high-res aerial" across all of the US and Canada almost certainly means a licensed aerial vendor: Nearmap (3 to 7 cm, refreshed several times a year in metros), EagleView, or Vexcel. Google and Esri terms would not allow it (see §4). This is our inference, not something they state.
- **AI method:** not disclosed. "Computer vision" in their words. The industry pattern is a semantic or instance segmentation model trained on that vendor's imagery (asphalt, concrete, paint), then post-processing that turns raster masks into polygons and lines (stall counting, curb centrelines).
- **Pricing:** custom quote only. Third-party roundups place it as a tool for "high-volume parking-lot estimators".

## 2. Competitors doing the same thing
| Vendor | Trades | Imagery | Method | Price (public) |
|---|---|---|---|---|
| **Attentive.ai — Automeasure** | landscaping, snow, paving (+ blueprint takeoff) | "latest HD imagery" (vendor not named) | AI + **human-in-the-loop QA**; one 2024 review reports a 40 h+ turnaround on a parking lot | per site by acreage: 10 ac paving surface $15, striping $30, advanced paving $34; landscaping $32; 25 ac ≈ $32–87 (page dated ~Apr 2025) |
| **SiteRecon (Scout)** | landscaping, also parking lots and driveways | multiple aerial sources | AI segmentation + editing tools | free 2/mo; $39/mo for 20 credits; $79/mo for 50; $399–799/yr acre-credit plans (≈ $1.6–2 per credit) |
| **Go iLawn** | landscaping (mostly residential) | aerial imagery, manual drawing tools | mostly manual measuring | ~$19.95/mo + per-address searches (dated) |
| **Deep Lawn** | lawn care (residential) | aerial / satellite | AI auto-measure + instant quote | from ~$75/mo |
| **Nearmap AI** | data layers (roof, pavement, vegetation, …) | its own aerials | its own models run over its own captures | quote only; raw Vertical imagery ~$107/km² on a marketplace (Jun 2026) |
| **OneCrew (TruTec inside)** | paving | TruTec's | TruTec's | OneCrew subscription |

Takeaway: the moat is **licensed high-res imagery + a model trained on it + human QA for the hard sites**. A per-site price of $15–$90 is what the market currently tolerates.

## 3. What resolution the job needs
- Asphalt vs concrete vs turf area: ~15–30 cm is enough.
- Striping, stall counting, wheel stops, crosswalks, curb lines: **≤ 10 cm** (a 4" stripe is ~10 cm wide). That is drone or Nearmap/EagleView-class imagery.
- Sentinel-2 (10 m, already in HammerTrack) is useless for this. NAIP (60 cm, public domain, every ~2 yrs) can do coarse asphalt/turf area only.

## 4. Imagery options for HammerTrack, with licensing
| Source | Res | Licence to run AI and keep the vectors? | Notes |
|---|---|---|---|
| **User drone orthos** (already supported: zone imagery, DJI EXIF auto-place) | 1–3 cm | **Yes, the customer owns them** | Best quality and zero licence risk. Brian flies a Mavic Air 2 daily. Needs a stitched ortho (the HammerTrack Aerial / ODM plan, task #169) for anything bigger than one frame. |
| **Esri World Imagery** (our keyless basemap) | ~30 cm–1 m in the US, Vivid/Maxar | **Narrow.** The grant quoted by OSM is "trace features and validate edits in the creation of vector data". Running a model at scale over the keyless tiles for a commercial product is **not clearly permitted**, and the keyless endpoint is not licensed for production use at all. | Fine for a human tracing over it (what the zones and dirt tools do today). Don't run batch AI on it without an ArcGIS licence and written terms. |
| **Google (Maps/Earth/Map Tiles)** | high | **No.** "You will not create content based on Google Maps Content", plus no extraction or export | Off the table. |
| **Nearmap** | 5–7 cm, several captures/yr in Greenville & Charleston metros | **Yes under contract** (AI Feature API, or imagery with a derived-data clause) | Quote only. Govt schedules start ~$5.2k/yr. Ask about a per-property API / partner tier. Nearmap AI's own pavement / vegetation layers could replace building a model. |
| **EagleView / Vexcel** | 7–15 cm | yes under contract | quote only, enterprise-leaning |
| **NAIP (USDA)** | 60 cm | **Public domain** | coarse area-only estimate, a free "first pass" |
| **SC county / statewide orthos** | often 3–6" | usually public record; confirm per county | Greenville and Charleston counties publish orthos via ArcGIS. Check each county's licence and refresh year before using. |

## 5. Model options
1. **SAM 2 (Meta, Apache-2.0), click-to-segment.** The user taps the lot and SAM returns a clean polygon. No training. Best MVP. Runs on a GPU worker (Replicate / Modal / fal: about $0.001–0.01 per image tile) or in the browser (SAM-2 tiny/ONNX via onnxruntime-web, so no server cost; the encoder takes ~1–3 s per 1024² tile on a laptop and is slow on old phones).
2. **Text-prompted open models** (Grounding DINO + SAM, or SAM 3 / "segment by concept" if its licence allows): "asphalt", "parking stripe", "mulch bed" with no clicks. Good for the first auto-pass, but it needs a human check.
3. **A custom segmentation model** (SegFormer / U-Net fine-tuned on DCG's own drone orthos labelled with asphalt, concrete, stripe, curb, turf, bed). This is where TruTec-level quality comes from. It needs a few hundred labelled tiles, which can bootstrap from SAM-assisted labels.
4. **Hosted APIs:** Nearmap AI (licensed features, no model work) or Roboflow-hosted models. The fastest path to auto-everything costs the most per property.
5. **Post-processing (pure TS, harness-testable like lib/dirt):** mask → polygon (marching squares + simplify) → areas in UTM (reuse `lib/dirt/tm.ts`); stripe skeleton → LF and stall count; curb = asphalt-boundary edges minus shared edges with landscape/property line; turf vs bed vs tree canopy.

Cost per property (rough): drone + SAM in the browser ≈ $0. GPU SAM ≈ $0.01–0.10. Nearmap imagery would dominate: a 2-acre lot is ~0.008 km², so cents at the marketplace rate, but contract minimums are thousands per year. Human QA (if offered) is $5–20 of labour.

## 6. Proposed MVP for HammerTrack ("Site takeoff" next to Dirt takeoff)
**Scope, paving:** asphalt SF/SY, concrete SF, striping LF + stall count + ADA count, curb LF, crack-seal/sealcoat area (= asphalt), with an optional overlay calculation (tons at thickness, as in the dirt Thickness step). **Scope, landscaping:** turf SF, bed SF (+ mulch CY at depth), hard edge LF, tree count.
1. **Imagery:** the zone's placed drone shot first (licence-clean, sharp). If there is none, show the Esri basemap for **manual tracing only** (allowed), and offer NAIP or a county ortho for an auto pass.
2. **Interaction:** draw the property (or use the zone) → tap features; SAM 2 snaps each to a polygon → assign a class → the editor (reuse the dirt editor's polygon tools) fixes edges.
3. **Auto pass (phase 2):** text-prompted segmentation over the whole zone, then human review. Train a DCG model off the corrected outputs.
4. **Output:** quantity table + "Copy for estimate" + PDF (existing export pipeline) + DXF later; stored per zone like `dirt_takeoffs`, under the add-on gate (`company_addons`), price unpublished under the pricing sync rule.
5. **Truth rule:** splash/marketing say ROADMAP until shipped; never claim "AI from any address" until a licensed imagery source is signed.

Effort guess: MVP (drone/manual + browser SAM click-to-segment + quantities) is ~1–2 weeks. Auto pass + custom model is a further 4–8 weeks plus labelling. A Nearmap contract is a business decision (ask for a quote covering Upstate + Charleston).

## Open questions for Brian
- Is the sister paving company the first user (parking-lot bids) or DCG?
- Get a Nearmap quote? Ask for the AI Feature API price per property.
- Try TruTec/OneCrew or Attentive on one known lot to set an accuracy bar.

## Sources
- [ForConstructionPros: TruTec AI takeoffs for paving contractors](https://www.forconstructionpros.com/construction-technology/automation-and-ai/product/22973894/trutec-trutec-ai-takeoffs-for-paving-contractors)
- [OneCrew: Instant Takeoffs powered by TruTec](https://www.getonecrew.com/post/onecrew-introduces-ai-takeoffs-inside-the-paving-workflow) · [OneCrew instant takeoffs](https://www.getonecrew.com/resources/instant-takeoffs)
- [MyQuoteIQ: top 10 AI tools for asphalt paving 2026](https://myquoteiq.com/top-10-ai-tools-for-asphalt-paving-businesses-in-2026/) (vendor-published)
- [Attentive.ai pricing](https://attentive.ai/pricing) · [Attentive paving maintenance](https://attentive.ai/paving-maintenance) · [Capterra: Automeasure](https://www.capterra.co.uk/software/1042529/automeasure)
- [SiteRecon Scout FAQs](https://help.siterecon.ai/scout-ai-faqs) · [Capterra: SiteRecon](https://www.capterra.com/p/276749/SiteRecon/)
- [CLCA: Go iLawn](https://clca.org/member-resources/member-benefits/go-ilawn/) · [Deep Lawn profile](https://www.extruct.ai/hub/deeplawn-com)
- [NCTCOG 2026 subscription pricing (Nearmap)](https://www.nctcog.org/getmedia/896281ed-b5c4-4a54-9cd3-cc219c4a2311/Subscription_Pricing_2026.pdf) · [SkyWatch: Nearmap](https://skywatch.com/geospatial-data-providers/nearmap/)
- [OSM wiki: Esri imagery terms](https://wiki.openstreetmap.org/wiki/Esri) · [OSM wiki: Google](https://wiki.openstreetmap.org/wiki/Google_Maps) · [Google Maps Platform terms summary](https://conductatlas.com/platform/google-maps/google-maps-platform-terms-of-service/no-scraping-or-content-extraction/)
