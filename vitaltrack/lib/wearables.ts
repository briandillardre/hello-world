// Junction (ex-Vital) webhook payload normalizer → VitalTrack schema.
// Same role as lib/flespi.ts in HammerTrack: many vendor field conventions
// in, one schema out. Handles the summary event types we care about now
// (sleep, daily activity summaries, workouts); unknown events are accepted
// and ignored so webhook retries don't pile up.

interface NormalizedMetric {
  ts: string;
  type: string;
  value: number;
}

interface NormalizedSleep {
  start_ts: string;
  end_ts: string;
  deep_s: number;
  light_s: number;
  rem_s: number;
  awake_s: number;
  score: number | null;
}

interface NormalizedActivity {
  start_ts: string;
  type: string;
  duration_s: number;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
}

export interface NormalizedEvent {
  junctionUserId: string | null;
  metrics: NormalizedMetric[];
  sleep: NormalizedSleep | null;
  activity: NormalizedActivity | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Junction events look like:
 *   { event_type: "daily.data.sleep.created", user_id, client_user_id, data: {...} }
 * Field names below cover Junction's summary shapes for Garmin-sourced data;
 * anything missing is simply skipped (partial data beats dropped webhooks).
 */
export function normalizeJunctionEvent(payload: unknown): NormalizedEvent {
  const out: NormalizedEvent = {
    junctionUserId: null,
    metrics: [],
    sleep: null,
    activity: null,
  };
  if (!payload || typeof payload !== "object") return out;
  const p = payload as Record<string, unknown>;
  out.junctionUserId =
    (typeof p.user_id === "string" && p.user_id) ||
    (typeof p.client_user_id === "string" && p.client_user_id) ||
    null;

  const eventType = typeof p.event_type === "string" ? p.event_type : "";
  const data = (p.data ?? {}) as Record<string, unknown>;
  const day =
    (typeof data.calendar_date === "string" && data.calendar_date) ||
    (typeof data.date === "string" && String(data.date).slice(0, 10)) ||
    new Date().toISOString().slice(0, 10);
  const dayTs = `${day}T00:00:00.000Z`;

  if (eventType.includes("sleep")) {
    const start =
      (typeof data.sleep_start === "string" && data.sleep_start) ||
      (typeof data.bedtime_start === "string" && data.bedtime_start) ||
      null;
    const end =
      (typeof data.sleep_end === "string" && data.sleep_end) ||
      (typeof data.bedtime_stop === "string" && data.bedtime_stop) ||
      null;
    if (start && end) {
      out.sleep = {
        start_ts: start,
        end_ts: end,
        deep_s: num(data.deep) ?? num(data.deep_sleep_duration_seconds) ?? 0,
        light_s: num(data.light) ?? num(data.light_sleep_duration_seconds) ?? 0,
        rem_s: num(data.rem) ?? num(data.rem_sleep_duration_seconds) ?? 0,
        awake_s: num(data.awake) ?? num(data.awake_duration_seconds) ?? 0,
        score: num(data.score) ?? num(data.sleep_score),
      };
    }
    const nightHrv = num(data.average_hrv) ?? num(data.hrv_average);
    if (nightHrv !== null)
      out.metrics.push({ ts: dayTs, type: "hrv", value: nightHrv });
  } else if (eventType.includes("workout") || eventType.includes("activity.created")) {
    const start =
      (typeof data.time_start === "string" && data.time_start) ||
      (typeof data.start_time === "string" && data.start_time) ||
      null;
    if (start) {
      out.activity = {
        start_ts: start,
        type:
          (typeof data.sport === "string" && data.sport) ||
          (typeof data.activity_type === "string" && data.activity_type) ||
          "workout",
        duration_s: num(data.duration_seconds) ?? num(data.moving_time) ?? 0,
        distance_m: num(data.distance) ?? num(data.distance_meters),
        avg_hr: num(data.average_hr) ?? num(data.avg_heart_rate),
        max_hr: num(data.max_hr) ?? num(data.max_heart_rate),
        calories: num(data.calories),
      };
    }
  } else {
    // Daily summary family: steps/activity/body/vitals.
    const mappings: Array<[string, unknown]> = [
      ["steps", data.steps],
      ["calories", data.calories_total ?? data.calories],
      ["distance_m", data.distance ?? data.distance_meters],
      ["resting_hr", data.resting_heart_rate ?? data.heart_rate_resting],
      ["hrv", data.average_hrv ?? data.hrv_average],
      ["stress", data.average_stress_level ?? data.stress_avg],
      ["body_battery", data.body_battery ?? data.max_body_battery],
      ["spo2", data.average_oxygen_saturation ?? data.spo2_average],
      ["respiration", data.average_breathing_rate ?? data.respiratory_rate],
      ["weight", data.weight_kg ?? data.weight],
    ];
    for (const [type, raw] of mappings) {
      const value = num(raw);
      if (value !== null) out.metrics.push({ ts: dayTs, type, value });
    }
  }
  return out;
}
