/**
 * The method behind the driver safety score, in plain words, built FROM the
 * engine's own constants (SAFETY_METHOD) — the insurer report's appendix can
 * never describe a threshold or weight the math does not use.
 */
import { G_MPH_PER_S, GPS_RULES, SAFETY_METHOD } from './driving-score'

const mphps = (g: number) => (g * G_MPH_PER_S).toFixed(1)
const ms2 = (g: number) => (g * 9.80665).toFixed(1)
const clock = (min: number) => {
  const h = Math.floor(min / 60) % 24
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`
}

export interface MethodSection { title: string; body: string[] }

export function methodSections(): MethodSection[] {
  const M = SAFETY_METHOD
  const L = M.thresholds.light, Hv = M.thresholds.heavy
  const tier = (i: number) => M.speedTiers[i]
  return [
    {
      title: 'Scope and exposure',
      body: [
        'Road vehicles only — pickups, vans, dump trucks and tractors. Machines and tools never enter a driving score, and neither does a vehicle carrying only a battery tracker (it records a position every few minutes, too seldom to see a drive).',
        'Every vehicle carries a cellular tracker plugged into its diagnostic port (or wired in). While the truck moves it records position and speed every 1–6 seconds; parked, it checks in about hourly.',
        'Exposure is the miles and hours the tracker recorded while the truck was moving (consecutive records no more than two minutes apart). Driving with no records in between — tracker unplugged, switched off, or out of coverage — is reported as a data gap, never counted as driving. Days are cut at midnight in the company\'s own time zone.',
      ],
    },
    {
      title: 'Harsh events (scored from the accelerometer only)',
      body: [
        `Light vehicles (10,000 lb GVWR or less): hard braking ${L.harsh_brake} g (${ms2(L.harsh_brake)} m/s², about ${mphps(L.harsh_brake)} mph lost per second), hard launch ${L.harsh_accel} g, hard cornering ${L.harsh_corner} g. Medium and heavy trucks: ${Hv.harsh_brake} g, ${Hv.harsh_accel} g, ${Hv.harsh_corner} g. Severe at ${M.severeFactor}× the threshold. Cornering counts at 30 km/h (19 mph) and up. The class comes from the GVWR in the vehicle's specs, else its model (a one-ton pickup — F-350, 3500 — and up, or a commercial make, is medium/heavy), else its type on the map (dump truck, day cab, semi, mixer, box or water truck = heavy), else light.`,
        `An event is SCORED only when it comes from the tracker's own accelerometer (Teltonika "Green Driving", configured to these thresholds) AND the speed stream confirms it within ±${M.confirm.windowS} seconds: at least ${M.confirm.minMph} mph slower (braking) or faster (launch), or at least ${M.confirm.minTurnDeg}° of turn (cornering) — from the truck's own speedometer where it reports one, otherwise GPS. A spike the speed does not confirm (a pothole, a dropped tool) is listed as unconfirmed and not scored.`,
        `Until the accelerometer is switched on, harsh events are not measured and the score is speeding plus late night. Hard stops and launches ESTIMATED from GPS speed are shown for coaching only and never scored (records ${GPS_RULES.minDtS}–${GPS_RULES.maxDtS} s apart at ${GPS_RULES.minMph}+ mph; invalid fixes, out-of-step event records, single wild readings, anything past ${GPS_RULES.maxG} g, and speeds that disagree with the ground covered are all thrown out).`,
        'Possible impacts (the tracker\'s crash detection, 1.5 g for 5 ms) are listed with time and place, never scored automatically.',
      ],
    },
    {
      title: 'Speeding',
      body: [
        `Against a posted limit, Samsara's tiers: moderate = ${tier(0).minOver}–${tier(1).minOver - 1} mph over for ${tier(0).minS} s or more, heavy = ${tier(1).minOver}–${tier(2).minOver - 1} over for ${tier(1).minS} s, severe = ${tier(2).minOver}+ over for ${tier(2).minS} s. HammerTrack does not hold road speed limits yet, so the tiers apply only inside sites with their own posted limit (set by the company), and only well inside the site's fence — never on a road running along it.`,
        `Limit known or not: ${M.maxSpeed.light} mph or more (${M.maxSpeed.heavy} for medium and heavy trucks) for ${M.maxSpeed.minS} seconds is severe speeding, counted once. Driving 70 on an interstate posted 70 is not penalized.`,
        'The report states the share of miles driven where a posted limit was known.',
      ],
    },
    {
      title: 'Late night',
      body: [`Driving between ${clock(M.lateNight.fromMin)} and ${clock(M.lateNight.toMin)} company time. ${clock(M.evening.fromMin)} to midnight is shown but not scored, and early crew starts (4–6 AM) are never penalized.`],
    },
    {
      title: 'The score',
      body: [
        'Each vehicle starts at 100; points come off, and the result is held between 0 and 100:',
        `• Harsh events, per 1,000 miles driven with the accelerometer on: hard braking ${M.eventWeights.harsh_brake}, hard cornering ${M.eventWeights.harsh_corner}, hard launch ${M.eventWeights.harsh_accel} per event (Motive's published defaults); a severe event counts ${M.severeMultiplier}×.`,
        `• Speeding, per 1% of moving time: moderate ${tier(0).weight}, heavy ${tier(1).weight}, severe ${tier(2).weight} (Samsara's published weights).`,
        `• Late night, per 1% of moving time: ${M.lateNight.weightPerPct}.`,
        `No score until a period holds ${M.credibility.minMiles} miles and ${M.credibility.minHours} hours of driving. Under ${M.credibility.fullMiles.toLocaleString()} miles a vehicle's or driver's score is blended toward the fleet's (weight on its own = √(miles ÷ ${M.credibility.fullMiles.toLocaleString()})), the actuarial square-root rule. The fleet score is the same math over all vehicles' miles together, so it is mileage-weighted. Grades: A 90+, B 80–89, C 70–79, D 60–69, F under 60; risk bands 90+ low, 75–89 mild, 60–74 medium, under 60 high.`,
        'Raw rates (events per 1,000 miles by type, share of time per speeding tier, late-night share, miles, hours, and events per 100 engine hours for trucks that work more than they drive) are published next to every score.',
      ],
    },
    {
      title: 'Data quality, printed with every score',
      body: [
        'Event source (accelerometer on, partly on, or off; confirmed and unconfirmed counts; GPS estimates), speed source (the truck\'s own speedometer vs GPS), share of miles with a known speed limit, device uptime (days reporting), share of driving actually recorded, times the tracker lost truck power or was unplugged, GPS or cell jamming, towing, impossible GPS jumps refused at the door, and the share of miles tied to a named driver.',
      ],
    },
    {
      title: 'Drivers',
      body: [
        'A drive is matched to a person only when their phone — clocked in on the HammerTrack app — rides within 150 m of the moving truck for five minutes or more, and it counts toward that person only when theirs was the only phone aboard. Per-driver results stay inside the company and are not part of this report.',
      ],
    },
    {
      title: 'Version',
      body: [`HammerTrack Safety Score v${M.version}. When the method changes the version changes and past days are recalculated under it. The thresholds and weights start from published industry defaults and will be recalibrated once enough history exists.`],
    },
  ]
}
