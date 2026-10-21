// Demo-mode data: ~18 months of realistic daily Garmin-style metrics for a
// fictional user, plus health record, labs, and timeline. Deterministic
// (seeded PRNG) so every load looks the same.

import { DEMO_USER_ID } from "./env";
import type {
  Biomarker,
  Condition,
  DailyMetrics,
  Goal,
  LabReport,
  Medication,
  SleepSession,
  TimelineEvent,
} from "./types";

const DAYS = 540;

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dateStr(daysAgo: number): string {
  // Local calendar date — toISOString would shift a day on TZs ahead of UTC.
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

interface DemoDay extends DailyMetrics {
  sleep: SleepSession;
}

function buildDays(): DemoDay[] {
  const rand = mulberry32(42);
  const days: DemoDay[] = [];
  for (let ago = DAYS - 1; ago >= 0; ago--) {
    const date = dateStr(ago);
    const dow = new Date(date + "T12:00:00Z").getUTCDay();
    const weekend = dow === 0 || dow === 6;
    // Slow improvement trend over the window + weekly rhythm + noise.
    const progress = (DAYS - ago) / DAYS; // 0 → 1
    // A rough patch ~4 months ago (illness/stress) visible in every metric.
    const roughPatch = ago > 110 && ago < 132 ? 1 : 0;

    const steps = Math.round(
      (weekend ? 6500 : 9800) + rand() * 4200 - roughPatch * 3500
    );
    const resting_hr = Math.round(
      63 - progress * 5 + rand() * 4 + roughPatch * 7
    );
    const hrv = Math.round(38 + progress * 12 + rand() * 14 - roughPatch * 12);
    const stress = Math.round(
      32 + rand() * 22 + roughPatch * 25 - progress * 6
    );
    const body_battery = Math.round(
      55 + progress * 12 + rand() * 25 - roughPatch * 20
    );
    const score = Math.round(
      68 + progress * 10 + rand() * 18 - roughPatch * 18
    );
    const totalSleepS = Math.round((6.2 + rand() * 1.8 - roughPatch * 0.8) * 3600);
    const deep_s = Math.round(totalSleepS * (0.15 + rand() * 0.06));
    const rem_s = Math.round(totalSleepS * (0.2 + rand() * 0.05));
    const awake_s = Math.round(totalSleepS * 0.05);
    const light_s = totalSleepS - deep_s - rem_s - awake_s;

    const bedtime = new Date(date + "T00:00:00");
    bedtime.setDate(bedtime.getDate() - 1);
    bedtime.setHours(22, Math.floor(rand() * 90), 0, 0);
    const wake = new Date(bedtime.getTime() + (totalSleepS + awake_s) * 1000);

    days.push({
      date,
      steps,
      resting_hr,
      hrv,
      stress: Math.min(95, Math.max(8, stress)),
      body_battery: Math.min(100, Math.max(10, body_battery)),
      calories: Math.round(2100 + steps * 0.04),
      sleep: {
        id: `demo-sleep-${date}`,
        user_id: DEMO_USER_ID,
        start_ts: bedtime.toISOString(),
        end_ts: wake.toISOString(),
        deep_s,
        light_s,
        rem_s,
        awake_s,
        score: Math.min(98, Math.max(35, score)),
        source: "demo",
      },
    });
  }
  return days;
}

let cache: DemoDay[] | null = null;
function demoDays(): DemoDay[] {
  if (!cache) cache = buildDays();
  return cache;
}

export function mockDailyMetrics(days: number): DailyMetrics[] {
  return demoDays()
    .slice(-Math.min(days, DAYS))
    .map(({ sleep, ...rest }) => rest);
}

export function mockSleepSessions(days: number): SleepSession[] {
  return demoDays()
    .slice(-Math.min(days, DAYS))
    .map((d) => d.sleep);
}

export const mockConditions: Condition[] = [
  {
    id: "demo-c1",
    user_id: DEMO_USER_ID,
    name: "Right knee — meniscus tear + arthroscopic repair",
    kind: "surgery",
    onset: "2019-06-10",
    resolved_at: "2020-01-15",
    status: "resolved",
    severity: 4,
    notes:
      "Ladder fall on a jobsite. Repaired 2019; occasional stiffness after long days on concrete. Avoids deep squats.",
  },
  {
    id: "demo-c2",
    user_id: DEMO_USER_ID,
    name: "Lower back strain (recurring)",
    kind: "injury",
    onset: "2022-03-01",
    resolved_at: null,
    status: "managed",
    severity: 3,
    notes: "Flares 2-3x/year with heavy lifting. PT stretches help when consistent.",
  },
  {
    id: "demo-c3",
    user_id: DEMO_USER_ID,
    name: "Borderline high blood pressure (told at checkup, not medicated)",
    kind: "condition",
    onset: "2024-11-20",
    resolved_at: null,
    status: "active",
    severity: 2,
    notes: "Doctor said recheck in a year. Wants to handle with lifestyle first.",
  },
  {
    id: "demo-c4",
    user_id: DEMO_USER_ID,
    name: "Father — heart disease (bypass at 61)",
    kind: "family_history",
    onset: null,
    resolved_at: null,
    status: "active",
    severity: null,
    notes: "Paternal grandfather also had an early heart attack.",
  },
];

export const mockMedications: Medication[] = [
  {
    id: "demo-m1",
    user_id: DEMO_USER_ID,
    name: "Vitamin D3",
    dose: "2000 IU",
    kind: "supplement",
    started: "2025-01-05",
    stopped: null,
    reason: "Low-normal on last bloodwork",
  },
  {
    id: "demo-m2",
    user_id: DEMO_USER_ID,
    name: "Ibuprofen (as needed)",
    dose: "400 mg",
    kind: "medication",
    started: "2022-03-01",
    stopped: null,
    reason: "Back flare-ups",
  },
];

export const mockGoals: Goal[] = [
  {
    id: "demo-g1",
    user_id: DEMO_USER_ID,
    title: "Resting HR under 58",
    metric: "resting_hr",
    target_value: 58,
    direction: "below",
    deadline: null,
    status: "active",
    notes: null,
  },
  {
    id: "demo-g2",
    user_id: DEMO_USER_ID,
    title: "Average 7.5h sleep",
    metric: "sleep_score",
    target_value: 80,
    direction: "above",
    deadline: null,
    status: "active",
    notes: "Sleep score proxy — real target is time in bed by 10pm.",
  },
  {
    id: "demo-g3",
    user_id: DEMO_USER_ID,
    title: "10k steps every workday",
    metric: "steps",
    target_value: 10000,
    direction: "above",
    deadline: null,
    status: "active",
    notes: null,
  },
];

export const mockLabReports: LabReport[] = [
  {
    id: "demo-l1",
    user_id: DEMO_USER_ID,
    source_lab: "Quest Diagnostics",
    collected_at: "2025-02-18",
    file_path: null,
    parsed_at: "2025-02-20",
  },
  {
    id: "demo-l2",
    user_id: DEMO_USER_ID,
    source_lab: "Quest Diagnostics",
    collected_at: "2026-01-12",
    file_path: null,
    parsed_at: "2026-01-14",
  },
];

const bm = (
  report_id: string,
  collected_at: string,
  name: string,
  value: number,
  unit: string,
  ref_low: number | null,
  ref_high: number | null,
  loinc: string | null = null
): Biomarker => ({
  id: `demo-b-${report_id}-${name.replace(/\W+/g, "")}`,
  report_id,
  user_id: DEMO_USER_ID,
  name,
  loinc,
  value,
  unit,
  ref_low,
  ref_high,
  collected_at,
});

export const mockBiomarkers: Biomarker[] = [
  // Draw 1 — Feb 2025
  bm("demo-l1", "2025-02-18", "Total Cholesterol", 212, "mg/dL", null, 200),
  bm("demo-l1", "2025-02-18", "LDL-C", 138, "mg/dL", null, 100),
  bm("demo-l1", "2025-02-18", "HDL-C", 44, "mg/dL", 40, null),
  bm("demo-l1", "2025-02-18", "Triglycerides", 149, "mg/dL", null, 150),
  bm("demo-l1", "2025-02-18", "ApoB", 108, "mg/dL", null, 90, "1884-6"),
  bm("demo-l1", "2025-02-18", "Lp(a)", 18, "nmol/L", null, 75, "10835-7"),
  bm("demo-l1", "2025-02-18", "HbA1c", 5.6, "%", null, 5.7, "4548-4"),
  bm("demo-l1", "2025-02-18", "Fasting Glucose", 98, "mg/dL", 70, 100),
  bm("demo-l1", "2025-02-18", "Fasting Insulin", 11.2, "uIU/mL", 2, 19.6),
  bm("demo-l1", "2025-02-18", "hs-CRP", 2.4, "mg/L", null, 3),
  bm("demo-l1", "2025-02-18", "TSH", 2.1, "mIU/L", 0.4, 4.5),
  bm("demo-l1", "2025-02-18", "Vitamin D (25-OH)", 24, "ng/mL", 30, 100),
  bm("demo-l1", "2025-02-18", "Ferritin", 88, "ng/mL", 30, 400),
  bm("demo-l1", "2025-02-18", "Testosterone (Total)", 512, "ng/dL", 264, 916),
  bm("demo-l1", "2025-02-18", "ALT", 32, "U/L", null, 44),
  bm("demo-l1", "2025-02-18", "Creatinine", 1.02, "mg/dL", 0.74, 1.35),
  bm("demo-l1", "2025-02-18", "Uric Acid", 6.8, "mg/dL", 3.7, 8.0),
  // Draw 2 — Jan 2026 (mostly improved — matches the wearable trend)
  bm("demo-l2", "2026-01-12", "Total Cholesterol", 196, "mg/dL", null, 200),
  bm("demo-l2", "2026-01-12", "LDL-C", 121, "mg/dL", null, 100),
  bm("demo-l2", "2026-01-12", "HDL-C", 49, "mg/dL", 40, null),
  bm("demo-l2", "2026-01-12", "Triglycerides", 118, "mg/dL", null, 150),
  bm("demo-l2", "2026-01-12", "ApoB", 96, "mg/dL", null, 90, "1884-6"),
  bm("demo-l2", "2026-01-12", "HbA1c", 5.4, "%", null, 5.7, "4548-4"),
  bm("demo-l2", "2026-01-12", "Fasting Glucose", 92, "mg/dL", 70, 100),
  bm("demo-l2", "2026-01-12", "Fasting Insulin", 8.1, "uIU/mL", 2, 19.6),
  bm("demo-l2", "2026-01-12", "hs-CRP", 1.1, "mg/L", null, 3),
  bm("demo-l2", "2026-01-12", "TSH", 1.9, "mIU/L", 0.4, 4.5),
  bm("demo-l2", "2026-01-12", "Vitamin D (25-OH)", 38, "ng/mL", 30, 100),
  bm("demo-l2", "2026-01-12", "Ferritin", 95, "ng/mL", 30, 400),
  bm("demo-l2", "2026-01-12", "Testosterone (Total)", 587, "ng/dL", 264, 916),
  bm("demo-l2", "2026-01-12", "ALT", 27, "U/L", null, 44),
  bm("demo-l2", "2026-01-12", "Creatinine", 0.98, "mg/dL", 0.74, 1.35),
  bm("demo-l2", "2026-01-12", "Uric Acid", 6.1, "mg/dL", 3.7, 8.0),
];

export const mockEvents: TimelineEvent[] = [
  {
    id: "demo-e1",
    user_id: DEMO_USER_ID,
    ts: "2019-06-10T09:00:00Z",
    kind: "injury",
    title: "Knee injury — ladder fall",
    detail: "Meniscus tear, right knee",
  },
  {
    id: "demo-e2",
    user_id: DEMO_USER_ID,
    ts: "2019-08-02T09:00:00Z",
    kind: "surgery",
    title: "Arthroscopic meniscus repair",
    detail: null,
  },
  {
    id: "demo-e3",
    user_id: DEMO_USER_ID,
    ts: "2024-11-20T09:00:00Z",
    kind: "condition",
    title: "Checkup: borderline high blood pressure noted",
    detail: "Recheck in 12 months; lifestyle-first plan",
  },
  {
    id: "demo-e4",
    user_id: DEMO_USER_ID,
    ts: "2025-02-18T09:00:00Z",
    kind: "lab_draw",
    title: "Bloodwork — baseline panel (Quest)",
    detail: "17 markers. Vitamin D low, ApoB high.",
  },
  {
    id: "demo-e5",
    user_id: DEMO_USER_ID,
    ts: "2025-01-05T09:00:00Z",
    kind: "medication",
    title: "Started Vitamin D3 2000 IU",
    detail: null,
  },
  {
    id: "demo-e6",
    user_id: DEMO_USER_ID,
    ts: "2026-01-12T09:00:00Z",
    kind: "lab_draw",
    title: "Bloodwork — follow-up panel (Quest)",
    detail: "Vitamin D corrected, ApoB improved 108→96, hs-CRP halved.",
  },
];
