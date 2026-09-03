// All VitalTrack domain types. Mirrors supabase/migrations/001_initial.sql.

export type MetricType =
  | "steps"
  | "resting_hr"
  | "hrv"
  | "stress"
  | "body_battery"
  | "spo2"
  | "respiration"
  | "weight"
  | "calories"
  | "distance_m";

export interface MetricSample {
  user_id: string;
  ts: string; // ISO — daily summaries are stamped at local midnight
  type: MetricType;
  value: number;
  source: string; // 'garmin' | 'junction' | 'import' | 'manual' | 'demo'
}

/** One row per calendar day, pivoted from metric_samples for dashboard use. */
export interface DailyMetrics {
  date: string; // YYYY-MM-DD
  steps?: number;
  resting_hr?: number;
  hrv?: number;
  stress?: number;
  body_battery?: number;
  spo2?: number;
  respiration?: number;
  weight?: number;
  calories?: number;
}

export interface SleepSession {
  id: string;
  user_id: string;
  start_ts: string;
  end_ts: string;
  deep_s: number;
  light_s: number;
  rem_s: number;
  awake_s: number;
  score: number | null;
  source: string;
}

export interface Activity {
  id: string;
  user_id: string;
  start_ts: string;
  type: string;
  duration_s: number;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  source: string;
}

export type ConditionStatus = "active" | "managed" | "resolved";

export interface Condition {
  id: string;
  user_id: string;
  name: string;
  kind: "injury" | "condition" | "surgery" | "family_history";
  onset: string | null; // YYYY-MM-DD
  resolved_at: string | null;
  status: ConditionStatus;
  severity: number | null; // 1-5
  notes: string | null;
}

export interface Medication {
  id: string;
  user_id: string;
  name: string;
  dose: string | null;
  kind: "medication" | "supplement";
  started: string | null;
  stopped: string | null;
  reason: string | null;
}

export interface Goal {
  id: string;
  user_id: string;
  title: string;
  metric: MetricType | "sleep_score" | null; // auto-tracked when set
  target_value: number | null;
  direction: "above" | "below" | null;
  deadline: string | null;
  status: "active" | "achieved" | "abandoned";
  notes: string | null;
}

export interface LabReport {
  id: string;
  user_id: string;
  source_lab: string | null;
  collected_at: string | null; // YYYY-MM-DD
  file_path: string | null; // supabase storage ref
  parsed_at: string | null;
}

export interface Biomarker {
  id: string;
  report_id: string;
  user_id: string;
  name: string;
  loinc: string | null;
  value: number;
  unit: string | null;
  ref_low: number | null;
  ref_high: number | null;
  collected_at: string | null; // denormalized from report for trend queries
}

export interface TimelineEvent {
  id: string;
  user_id: string;
  ts: string;
  kind:
    | "injury"
    | "condition"
    | "surgery"
    | "lab_draw"
    | "medication"
    | "goal"
    | "activity"
    | "illness"
    | "note";
  title: string;
  detail: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Parsed result shape returned by the lab PDF parser. */
export interface ParsedLab {
  source_lab: string | null;
  collected_at: string | null;
  biomarkers: Array<{
    name: string;
    loinc: string | null;
    value: number;
    unit: string | null;
    ref_low: number | null;
    ref_high: number | null;
  }>;
}

export type RangeKey = "7d" | "30d" | "90d" | "1y" | "all";

export const RANGE_DAYS: Record<RangeKey, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
  all: 100000,
};
