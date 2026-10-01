# ELD and hours of service — what contractors actually need

*Oct 1 2026. Researched the day Brian asked to close the gaps against Linxup
("Dashcams, eld logbooks, buying online. Let's solve this"). Linxup sells ELD
at $30/vehicle/mo plus a $99 tablet on a 3-year contract
([pricing](https://www.linxup.com/pricing/)). Shipped the same day:
**DOT short-haul records** on /timecards/short-haul (migration 126,
`lib/short-haul.ts`).*

## 1. Who needs an ELD — usually nobody on a contractor's crew

- **Commercial motor vehicle (CMV):** 10,001 lb+ GVWR or GCWR (a truck plus
  the trailer it pulls), placarded hazmat, or certain passenger vans. A
  pickup under 10,001 lb with no trailer is outside Part 395 entirely
  ([49 CFR 390.5](https://www.law.cornell.edu/cfr/text/49/390.5)).
- **Short-haul exception** ([395.1(e)](https://www.law.cornell.edu/cfr/text/49/395.1)),
  expanded in 2020 from 100 mi / 12 h to 150 / 14
  ([85 FR 33396](https://www.govinfo.gov/content/pkg/FR-2020-06-01/html/2020-11469.htm)):
  - **(e)(1) CDL drivers:** within 150 **air**-miles (172.6 statute) of the
    normal work reporting location; back there and released within 14
    consecutive hours; property carriers need 10 consecutive hours off
    between each 14 on.
  - **(e)(2) non-CDL drivers:** within 150 air-miles, back each day; no
    driving after the 14th hour on 5 days of any 7, or after the 16th hour
    on 2 days of any 7. Exempt from the 14-hour rule and from logs.
  - **Instead of logs,** the carrier keeps time records for 6 months: when
    the driver reported, total hours on duty, when released, and the prior
    7 days' total for new or intermittent drivers.
- **When an ELD is required:** a day that misses a condition needs a paper
  log (RODS) for that day. A driver needs an ELD only when logs are needed
  on **more than 8 days in any 30**
  ([395.8(a)(1)(iii)](https://www.law.cornell.edu/cfr/text/49/395.8);
  [FMCSA FAQ](https://eld.fmcsa.dot.gov/FAQ/Topics?name=ELD_Exceptions_and_Exemptions)).
  Vehicles with pre-2000 engines are exempt.
- **South Carolina intrastate:** the FMCSRs apply at 26,001 lb+, placarded
  hazmat or 16+ passengers; driving limits are 12 h driving / 16 h on duty /
  70 h in 7 / 80 h in 8 ([S.C. Code 56-5](https://www.scstatehouse.gov/code/t56c005.php)).
  An SC-specific short-haul radius was not found (unverified).
- **Estimate (ours):** a 10–25 truck contractor has 0–2 drivers who ever
  need an ELD — a lowboy hauler on distant jobs (Greenville → Charleston is
  ~174 air-miles, outside the radius) or a crew that routinely runs past 14 h.

## 2. What we built: DOT short-haul records (migration 126)

The time clock already holds the record: clock-in = reported for duty,
clock-out = released, and the phone's own fixes give how far the driver
went. `/timecards/short-haul` (link at the top of Time cards):

- **Who:** a manager marks each person *CDL driver* or *Commercial driver,
  no CDL* (`profiles.driver_class`; only marked drivers get records).
- **Per driver per day:** reported, released, hours on duty (clocked minus
  unpaid breaks), start-to-release span, prior 7 days, farthest air-miles
  from where the day started (`shorthaul_reach()` — every phone fix in the
  shift measured from the day's first clock-in), distance of the release
  point from the start.
- **Verdict per day:** Met · Log needed (with the reason: past 150
  air-miles, not back at the start, past 14 h, under 10 h off, past 16 h,
  3rd long day in 7) · Can't verify (no clock-in location, no phone GPS) ·
  On duty. A forgotten clock-out is "fix the time card", never a long day.
- **The ELD line:** log days in the last 30, warning at 6, "this driver
  needs an ELD" past 8. Drivers closest to the line sort first.
- **CSV** with the record fields an auditor asks for.
- **Caveats in the product copy:** federal rule only (SC intrastate can
  differ); the 14/16-hour checks use the on-duty span as a stand-in for "last
  drove"; the reporting location is where the day's first clock-in happened.

Harness: `node scripts/short-haul-test.mjs` (70 assertions — exactly 150
air-miles is inside, exactly 14 h is inside, 10 h off exactly is enough,
the 2-in-7 rule across a rolling window, multi-shift days, overnight
shifts, forgotten clock-outs, the 8-in-30 count).

## 3. Becoming an ELD provider — not now

- Steps ([App. A to Subpart B of Part 395](https://www.law.cornell.edu/cfr/text/49/appendix-A_to_subpart_B_of_part_395);
  [FMCSA provider page](https://eld.fmcsa.dot.gov/Provider)): request a
  provider account, submit a public key, pass the web-services format test
  and the file validator, self-certify each model/version with 10 required
  disclosures. No published fee; vendors report weeks to list. FMCSA
  overhauled vetting Dec 1 2025 ([Land Line](https://landline.media/fmcsa-announces-complete-overhaul-of-eld-vetting-process/)).
- The device must be **engine-synchronized**: power, motion, miles and
  engine hours from the ECM; GPS cannot decide motion; manual entry when the
  ECM has the data gets a device removed ([FMCSA tech FAQ](https://eld.fmcsa.dot.gov/File/Index/a146fc5b-db96-a9f9-e053-0100007f8710)).
  Malfunctions, unidentified driving (>30 min/24 h), annotated edits that
  never overwrite, a 10-segment output file, and telematics (web services +
  email) or local (USB + Bluetooth) transfer.
- FMCSA revoked 82 devices Jan 2025 – Jul 2026 ([Land Line](https://landline.media/can-fmcsa-actually-fix-the-eld-system/));
  an "ELD Revisions" proposed rule is expected Nov 2026
  ([Unified Agenda](https://www.reginfo.gov/public/do/eAgendaViewRule?pubId=202510&RIN=2126-AC50)).
- Estimate: 3–4 engineers × 9–12 months to list, then ~1 FTE to keep it
  listed. Our own trucks would need engine data first (the RAM 2500 answers
  only fuel + VIN; the F650/F750 nothing over the OBD port — see the J1939
  test below).

## 4. When a customer does need an ELD — partner

- **Garmin eLog:** FMCSA-registered, about $297 one-time, no subscription;
  plugs into J1939/J1708 ports, so CDL trucks, not pickups
  ([GPS Nation](https://www.gpsnation.com/products/garmin-elog-compliant-eld)).
- **Pacific Track PT30:** reads J1939/J1708/OBD-II over Bluetooth, ~$190,
  behind dozens of white-label HOS apps, with Android/iOS SDKs
  ([Pacific Track](https://pacifictrack.com/solutions/)).
- **ETAnow:** white-labels an ELD under our own FMCSA registration, app and
  portal 2–3 weeks after we get an ID; pricing not published ([ETAnow](https://etanow.com/eld/)).
- **Teltonika:** the FMM00A/FMC00A have an **ELD mode** (`setparam 40000:2`)
  that reads 35+ J1939 parameters — engine hours, dashboard mileage, VIN,
  RPM, fuel, coolant, DTC count — and streams them as JSON over Bluetooth
  ([wiki](https://wiki.teltonika-gps.com/view/How_to_read_ELD_data_with_FMX00A)).
  No FMCSA listing names Teltonika hardware (Oct 1 scan): it is the engine
  link an ELD app is built on, not an ELD.
- Open source: nothing usable (README-only or trip-planner repos).

## 5. Plan

1. **Done:** short-haul records from the time clock (above).
2. **When a customer crosses 8-in-30:** refer the driver to Garmin eLog (CDL
   trucks) or a PT30-based app; show their HOS beside ours later if they use
   Samsara ([API](https://developers.samsara.com/docs/compliance-guide)).
3. **At ~50+ ELD trucks across customers:** white-label (ETAnow-class) under
   our own registration, on the FMM00A's ELD mode. Reassess building after
   the Nov 2026 proposed rule.
