# SC foreclosure crawler (Master-in-Equity sales)

Pulls the monthly Master-in-Equity sale list for each county, then for every
case grabs the **Order of Foreclosure / Form 4 judgment** (what is owed), the
**Notice of Sale** (deficiency waived or demanded, TMS, legal description,
bid-interest terms) and the **county property card** (owner, acreage, year
built, sq ft, FMV, last sale), and writes a one-paragraph write-up per
property plus a CSV.

Counties: **Greenville, Pickens, Spartanburg, Oconee** (Upstate) and
**Horry, Charleston, Georgetown, Beaufort, Berkeley, Dorchester, Colleton**
(coastal). `--county upstate`, `--county coastal`, or a list; default is all.

## Run it on your PC (not the cloud)

The SC Judicial Public Index, qPublic (Cloudflare) and the Greenville
Journal's MIE site all refuse cloud/data-centre IPs. From a normal home or
office connection they work. Everything else (county PDFs, Spartan Weekly,
Greenville Real Property) works from anywhere.

```bash
cd tools/foreclosures
npm install
npx playwright install chromium          # once
export ANTHROPIC_API_KEY=sk-ant-...      # optional but recommended: reads scanned orders, fills in $ owed
node src/cli.mjs run --headed            # first run: watch the browser, accept the index disclaimer / solve any captcha once
node src/cli.mjs run                     # later runs headless; the ./profile folder keeps the cookies
```

Output lands in `out/<sale date>/`:

| file | what |
|---|---|
| `report.md` | one section per county, one block per property: owed, deficiency, write-up, links |
| `report.csv` | same as a spreadsheet (open in Excel) |
| `<county>.json` | full state – resumable; re-running only fills gaps |
| `docs/` | every order / notice PDF downloaded (`<county>-<case>-order.pdf` …) |
| `dump/` | page HTML + screenshots when you pass `--dump` (send these when a county breaks) |

### Commands

```
node src/cli.mjs list   [--county greenville,pickens] [--date 10/05/2026]      # just the roster
node src/cli.mjs run    [--county …] [--date …] [--headed] [--dump] [--no-ai]
                        [--skip-index] [--skip-property] [--force] [--only 2026-CP-23-00155] [--include-cancelled]
node src/cli.mjs report [--date …]                                             # rebuild report from the JSON
node src/cli.mjs run --seed seeds/greenville-2026-09-08.json --county greenville   # use a hand-transcribed list
```

Default date = the next sale day (first Monday, Tuesday when that's a holiday).
Default counties = the four Upstate ones. `--county horry` etc. for coastal.

## Where each piece comes from

| | Sale list | Notice of Sale (deficiency, TMS, legal) | Order / Form 4 ($ owed) | Property card |
|---|---|---|---|---|
| Greenville | Journal MIE site (mie.greenvillejournal.com) | same | **same site attaches the Order PDF** – no index trip needed; index is the fallback | greenvillecounty.org Real Property search |
| Pickens | county roster PDF (co.pickens.sc.us → revize) | Public Index docket image | Public Index docket image | qPublic (AppID 927) |
| Spartanburg | county DocumentCenter folder 114 + Spartan Weekly notices | Spartan Weekly (full text, no browser) | Public Index docket image | qPublic |
| Oconee | statewide court rosters (Master's Sales) | Public Index | Public Index | qPublic (AppID 1030) |
| Horry | county Principal Sales page (HTML table, **prints the judgment amount + deficiency Yes/No**, links the judgment + notice images) | linked Public Index image | linked Public Index image (index opt-in with `--index`) | county Land Records link only |
| Charleston | Master's running auction list (HTML, **prints the judgment amount**) | Public Index (jcmsweb) | list figure; `--index` to pull the order | — |
| Georgetown | county DocumentCenter monthly PDF/XLS (deficiency Yes/No, cancellations) | Public Index | Public Index | — |
| Beaufort · Berkeley · Dorchester · Colleton | statewide court rosters (browser) | Public Index | Public Index | Colleton qPublic; others — |

Sale days differ on the coast: Charleston sells the **first Tuesday** (register
by noon the Monday before), Berkeley the **first Wednesday**, Georgetown at
**noon**. `saleDateFor()` in `src/config.mjs` handles that; Dorchester and
Colleton schedules are unverified (assumed first Monday 11:00).

## Reading the numbers

- **Owed** = the judgment total the court entered (usually "total amount due as
  of <date>") **plus per-diem interest** to sale day when the order states a per
  diem. That is the plaintiff's *credit-bid ceiling*, not the opening bid – the
  bank can and does open lower. When county FMV is available the write-up
  says whether the debt is under or over it (equity → expect competition;
  over → bank takes it back).
- **Deficiency waived** = sale is final at the fall of the gavel.
  **Deficiency demanded** = bidding stays open 30 days; anyone can top the
  day-of bid at the reopen (Pickens/Greenville reopen dates are on the roster).
  Spartanburg notices sometimes carry *both* sentences (boilerplate not
  cleaned up) – the report flags those as **CONFLICTING** with both quotes so
  you can call the plaintiff's attorney.
- The regex pass is deterministic; with `ANTHROPIC_API_KEY` the tool also has
  Claude read the actual PDF (handles scans and odd phrasings) and reports
  which pass produced the number (`extractedBy`).

## When something breaks

Run again with `--dump` and send me `out/<date>/dump/*.html`. The
browser-driven sources (Public Index, qPublic, Journal MIE, the statewide
roster app for Beaufort/Berkeley/Dorchester/Colleton) were written from their
documented page structure but could not be exercised from the cloud sandbox,
so expect one round of selector fixes on the first real run. Verified live
without a browser: Pickens, Spartanburg (notices), Greenville property cards,
Horry, Charleston, Georgetown.

## Adding a county

1. Add an entry in `src/config.mjs` (case-number code, index URL, `roster:
   'sccourts'` + the county's `RosterSelection.aspx` URL, and its qPublic ids
   if it uses qPublic).
2. If its sale list is *not* on the statewide roster app, add
   `src/counties/<name>.mjs` with a `list<Name>(saleDate, {page})` and wire it
   in `cli.mjs → list()`.
