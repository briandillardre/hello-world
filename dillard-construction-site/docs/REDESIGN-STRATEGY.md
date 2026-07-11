# Dillard Construction Group — Website Redesign & Exit-Positioning Strategy
**Date:** July 11, 2026 · **Companion to:** `ONLINE-PRESENCE-AUDIT.md` · **Deliverable:** the static site in this folder

---

## 1. The Strategic Frame: This Website's Job Is the Multiple

The goal isn't "a nicer website." It's closing the gap between how the company *operates* and how it *reads* — because at sale time, that gap is priced.

What construction M&A research says buyers pay for (FMI, Roadmap Advisors, CT Acquisitions, Good Hope Advisors):
- **Multiples:** 4–6× EBITDA for small commercial operators; 6–8× mid-market; 7–9× for "professionalized platforms." Owner-operated firms without management depth trade at 2–3.8× SDE. **The same revenue can be worth 2–4 extra turns depending on how institutional the company looks and runs.**
- **Recurring revenue** (maintenance/sealcoat/striping/stormwater contracts) commands **50–100% valuation premiums**; 40%+ recurring → premium multiples.
- **Management depth beyond the owner** is the #1 broker theme. Buyers discount owner-dependence constantly.
- **Safety (EMR)** is a diligence metric: sub-0.80 EMR is required just to prequalify with many GCs; a published, trending EMR reads as operational maturity.
- **Fleet with utilization + maintenance records** lets a buyer forecast post-close capex — DCG literally has this data streaming off HammerTrack.
- **Crew tenure** (3+ years) = 15–25% premium.
- **The proof it works locally:** King Asphalt (Liberty, SC) — professional site, careers culture page, SCAPA awards, acquisition timeline — sold to **Construction Partners Inc. in 2021**. CPI is still densifying SC and its stated criteria are "strong and experienced local management team, well-established reputation for quality." **The website is where that reputation is legible before an LOI.**

Every page of the new site maps to a diligence question:

| Page | Customer job | Buyer-diligence job |
|---|---|---|
| Home | Win the estimate call | "Professional platform" first impression; facts bar |
| Services (+3 detail pages) | Rank for local keywords; qualify leads | Scope breadth = revenue diversity |
| Pavement/stormwater maintenance sections | Sell recurring programs | **Builds the recurring-revenue book buyers pay 50–100% premiums for** |
| Projects | Proof with specs | Project history database; repeat-client evidence |
| Safety & Systems | Prequalification shortcut | EMR + telematics + documented ops = "runs on systems, not tribal knowledge" |
| About | Trust, local story | Management depth beyond Brian; credentials |
| Careers | Fix the actual labor constraint | Crew depth/tenure story |
| Contact (estimate + bid-invite forms) | Two funnels: owners and GCs | Active commercial pipeline signal |

**The HammerTrack angle — handled carefully:** the site presents the telematics platform as *how DCG operates* ("technology-forward operations"), never as a second venture. A distracting side business muddies an acquisition; a GPS-tracked, PM-scheduled, utilization-reported fleet strengthens one. The Safety & Systems page does exactly this.

---

## 2. Brand Direction

- **Positioning line (replaces "strives to be a top…"):** *"From raw ground to final striping. Self-performed."* — states the combined sitework+paving scope no local competitor's site owns, and says it with confidence.
- **Voice:** confident, specific, lightly dry. Real numbers over adjectives ("$55M projects," "nine counties," "4.7★"), and honest-contractor lines ("photos without scope are just pictures of dirt"). No stock-photo corporate-speak.
- **Palette (locked to the real brand):** DCG brand green `#92FE48` (sampled from the 2024 logo) / asphalt charcoal `#16181A` / white. High-vis green + black reads jobsite-authentic. Darker green `#37800C` handles text-on-light for accessibility.
- **Logo:** the real 2024 mark (black wordmark + green corner brackets, transparent PNG) is front and center in a white header on every page, and on a white chip in the dark footer. Web-optimized to 28KB (`img/logo.png` + `@2x`) from the 330KB master.
- **Credential badging system:** Veteran-Owned ★ · Unlimited Group 5 · Licensed/Bonded/Insured · USDOT 4392256 · 4.7★ — repeated in a trust bar and footer on every page.
- **Photography plan (the single biggest visual upgrade available):** half-day professional shoot — crew group shot with iron, drone footage of an active grading site, paver laying mat, and a HammerTrack map screenshot. Every placeholder block in the site is labeled with exactly which shot goes where.

## 3. Information Architecture

```
Home
├── Services (overview + markets + process)
│   ├── Sitework & Grading          ← targets "sitework contractor Greenville SC"
│   ├── Asphalt Paving              ← targets "asphalt paving Greenville SC"
│   ├── Stormwater & Utilities      ← targets "stormwater contractor upstate SC"
│   └── (maintenance programs section — recurring revenue)
├── Projects (spec-driven case study cards, 6–12)
├── Safety & Systems (EMR + fleet + technology)
├── About (partners, credentials, story)
├── Careers (4 role cards + culture)
└── Contact (estimate form + GC bid-invite form)
```
Old /photos and /request-an-estimate 301-redirect to /projects and /contact (configured in `netlify.toml`).

**Phase-2 SEO expansion (after launch):** county/city landing pages (`/service-areas/spartanburg-sitework-paving` …) for the nine counties, and a quarterly project-news post. Only after real photos and 2–3 real case studies exist — thin pages hurt more than help.

## 4. Technical Approach

- **Pure static HTML/CSS/JS** — no build step, no framework, no Wix. Loads in milliseconds, scores ~100 on Core Web Vitals, editable by any human or AI, portable to any host forever. This is deliberate: a contractor site doesn't need React; it needs to be fast, indexable, and never break.
- **Hosting: Vercel** (same account/dashboard as HammerTrack — one place for everything). `vercel.json` provides clean URLs, old-Wix-path redirects, and cache/security headers. Forms post to **Web3Forms** (free, no backend — one access key pasted into `contact.html`, submissions arrive by email, `thanks.html` success page wired).
- **SEO plumbing shipped:** consistent `Title | Dillard Construction Group` pattern, unique meta descriptions, canonicals, Open Graph, JSON-LD (`GeneralContractor` with `aggregateRating`, per-service `Service` schema), sitemap.xml, robots.txt, clean-URL redirects.
- **Accessibility:** semantic HTML, aria labels, reduced-motion support, high-contrast palette.

## 5. Migration Workflow (Wix → new site)

1. **Content fill (Brian, ~2 evenings):** replace every `[bracketed]` placeholder — project names/quantities, EMR, fleet table, pay ranges, 2 more review quotes (pull from Birdeye), real photos into `/img`.
2. **Deploy to Vercel** on a temp URL (new project, root directory `dillard-construction-site`), review on phone + desktop, test both forms.
3. **DNS cutover at Namecheap:** add the domain in the Vercel project, update DNS (same 5-minute process as hammertrackai.com). Keep Wix live until DNS propagates, then cancel the Wix plan (~$200+/yr saved).
4. **Post-launch (same week):** Google Search Console — submit sitemap, request indexing; update GBP website link; update Facebook/Instagram/LinkedIn links.
5. **Redirect map is already in `netlify.toml`** — old Wix paths (/photos, /request-an-estimate) land correctly, preserving any existing link equity.

## 6. Content Operating Rhythm (15 min/week, non-negotiable)

| Cadence | Action | Why |
|---|---|---|
| Per finished project | Phone photos + 3 lines of scope → new project card | The Projects page is the living diligence record |
| Weekly | Text the Google-review link to one happy customer | 15 reviews → 50+ by mid-2027; GBP is the #1 local channel |
| Monthly | One FB/IG/LinkedIn post (drone clip, crew shot, finished lot) | An "alive" company reads as a growing one — to customers and acquirers |
| Quarterly | Update fleet table, EMR, counties; one news blurb | Freshness signal |
| Yearly | Refresh photography | Cheapest credibility money can buy |

## 7. Roadmap

**Phase 1 — Launch (this month):** fill placeholders → deploy → DNS cutover → GBP fix + review-link habit + LinkedIn page + citation corrections (see audit §9).
**Phase 2 — Local SEO dominance (quarter 2–3):** county landing pages, 6+ spec'd case studies, GBP posts, SCAPA membership (their Quality Pavement Awards are a purchasable-with-effort credibility asset King Asphalt used).
**Phase 3 — Exit-ready (12–24 months pre-sale):** publish EMR trend + safety awards; add named non-partner staff to About (management depth); maintenance-contract book marketed as a product with its own landing page; quarterly "news" cadence so the 18 months before a sale look like an unbroken growth story; consider a one-page "For general contractors" prequalification page with downloadable packet.

## 8. What Was Delivered in This Folder

| File | Purpose |
|---|---|
| `index.html` | Homepage — hero, facts bar, trust bar, services grid, why-DCG, featured projects, testimonials, service area, CTA |
| `services.html` | Overview + site concrete/finish/GC anchors + **maintenance programs** + markets + process |
| `asphalt-paving.html`, `sitework-grading.html`, `stormwater-utilities.html` | Keyword-targeted service pages with FAQ/differentiator sections |
| `projects.html` | Spec-driven case-study template (6 cards with fill-in guidance) |
| `safety.html` | Safety program + **Systems/technology page** (the HammerTrack-powered ops story) + fleet table |
| `about.html` | Partner bios (corrected, upgraded), credentials, company story |
| `careers.html` | 4 role cards + culture pitch |
| `contact.html` | Estimate form + **GC bid-invite form** + direct partner contacts |
| `css/site.css`, `js/site.js` | Design system + progressive enhancement (no dependencies) |
| `vercel.json`, `sitemap.xml`, `robots.txt`, `thanks.html` | Deploy config, redirects, SEO plumbing, form success page |
| `docs/` | This strategy + the audit |

Every `[bracketed]` item in the HTML is a decision or fact only Brian can supply. Nothing else blocks launch.
