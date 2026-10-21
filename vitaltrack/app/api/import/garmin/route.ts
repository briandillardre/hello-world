// Garmin backfill import — ToS-safe route while Garmin's API program is
// paused. Accepts files from Garmin Connect's "Export Your Data" archive:
//   - FIT activity files (parsed with fit-file-parser)
//   - CSV daily summaries (flexible header matching: date + steps /
//     restingHeartRate / hrv / stress / bodyBattery columns)

import { NextRequest, NextResponse } from "next/server";
import { getUserId, createUserClient } from "@/lib/supabase-server";
import { isMock } from "@/lib/supabase";
import { sameOriginOk } from "@/lib/security";

export const runtime = "nodejs";
export const maxDuration = 120;

const HEADER_MAP: Array<[RegExp, string]> = [
  [/^steps?$/i, "steps"],
  [/resting.?heart.?rate|restinghr|resting_hr/i, "resting_hr"],
  [/^hrv|heart.?rate.?variability/i, "hrv"],
  [/stress/i, "stress"],
  [/body.?battery/i, "body_battery"],
  [/^(total.?)?calories\b/i, "calories"],
  [/distance/i, "distance_m"],
  [/spo2|oxygen/i, "spo2"],
  [/respiration|breathing/i, "respiration"],
  [/weight/i, "weight"],
];

// Quote-aware CSV line splitter — Garmin exports quote thousands-separated
// numbers ("10,509"), which a naive split(",") shears into shifted columns.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // US M/D/YYYY
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

interface MetricRow {
  user_id: string;
  ts: string;
  type: string;
  value: number;
  source: string;
}

function csvToMetrics(text: string, userId: string): MetricRow[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const dateCol = headers.find((h) => /date|day/i.test(h));
  if (!dateCol) return [];
  // One column per metric type (first match wins) — e.g. "Calories" and
  // "Active Calories" both match /calories/, and duplicate (ts, type) rows
  // in a single upsert make Postgres reject the whole batch.
  const typedCols: Array<[string, string]> = [];
  for (const h of headers) {
    if (h === dateCol) continue;
    const match = HEADER_MAP.find(([re]) => re.test(h));
    if (match && !typedCols.some(([, t]) => t === match[1]))
      typedCols.push([h, match[1]]);
  }
  const byKey = new Map<string, MetricRow>();
  for (const row of rows) {
    const date = parseDate(row[dateCol] ?? "");
    if (!date) continue;
    for (const [col, type] of typedCols) {
      const value = parseFloat(String(row[col]).replace(/[",]/g, ""));
      if (Number.isFinite(value)) {
        byKey.set(`${date}|${type}`, {
          user_id: userId,
          ts: `${date}T00:00:00.000Z`,
          type,
          value,
          source: "import",
        });
      }
    }
  }
  return Array.from(byKey.values());
}

async function fitToActivity(buf: Buffer, userId: string) {
  // fit-file-parser has no types; loaded dynamically and guarded.
  const mod = (await import("fit-file-parser")) as {
    default: new (opts: Record<string, unknown>) => {
      parse: (b: Buffer, cb: (err: unknown, data: Record<string, unknown>) => void) => void;
    };
  };
  const FitParser = mod.default;
  const parser = new FitParser({
    force: true,
    lengthUnit: "m",
    speedUnit: "m/s",
    mode: "list",
  });
  const data = await new Promise<Record<string, unknown>>((resolve, reject) => {
    parser.parse(buf, (err, d) => (err ? reject(err) : resolve(d)));
  });
  const sessions = (data.sessions ?? []) as Array<Record<string, unknown>>;
  const s = sessions[0];
  if (!s || !s.start_time) return null;
  const startTs = new Date(s.start_time as string | Date).toISOString();
  const numOr = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    user_id: userId,
    start_ts: startTs,
    type: String(s.sport ?? "workout"),
    duration_s: Math.round(numOr(s.total_timer_time) ?? numOr(s.total_elapsed_time) ?? 0),
    distance_m: numOr(s.total_distance),
    avg_hr: numOr(s.avg_heart_rate),
    max_hr: numOr(s.max_heart_rate),
    calories: numOr(s.total_calories),
    source: "import",
  };
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = 100 * 1024 * 1024;

export async function POST(req: NextRequest) {
  if (!sameOriginOk(req))
    return NextResponse.json({ error: "cross-origin blocked" }, { status: 403 });
  const userId = await getUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (isMock)
    return NextResponse.json(
      { error: "demo mode: imports are disabled (data would not persist)" },
      { status: 503 }
    );

  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (!Number.isFinite(contentLength) || contentLength > MAX_REQUEST_BYTES)
    return NextResponse.json({ error: "upload too large" }, { status: 413 });

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length)
    return NextResponse.json({ error: "no files" }, { status: 400 });

  const supabase = createUserClient();
  let metricsWritten = 0;
  let activitiesWritten = 0;
  const errors: string[] = [];

  for (const file of files) {
    const name = file.name.toLowerCase();
    if (file.size > MAX_FILE_BYTES) {
      errors.push(`${file.name}: over 25MB, skipped`);
      continue;
    }
    try {
      if (name.endsWith(".csv")) {
        const metrics = csvToMetrics(await file.text(), userId);
        for (let i = 0; i < metrics.length; i += 500) {
          const chunk = metrics.slice(i, i + 500);
          const { error } = await supabase
            .from("metric_samples")
            .upsert(chunk, { onConflict: "user_id,ts,type" });
          if (error) throw new Error(error.message);
          metricsWritten += chunk.length;
        }
        if (!metrics.length) errors.push(`${file.name}: no recognized columns`);
      } else if (name.endsWith(".fit")) {
        const activity = await fitToActivity(
          Buffer.from(await file.arrayBuffer()),
          userId
        );
        if (activity) {
          const { error } = await supabase
            .from("activities")
            .upsert(activity, { onConflict: "user_id,start_ts" });
          if (error) throw new Error(error.message);
          activitiesWritten += 1;
        } else {
          errors.push(`${file.name}: no session record found`);
        }
      } else {
        errors.push(`${file.name}: unsupported (upload .csv or .fit)`);
      }
    } catch (err) {
      errors.push(`${file.name}: ${err instanceof Error ? err.message : "parse failed"}`);
    }
  }

  return NextResponse.json({
    ok: true,
    metricsWritten,
    activitiesWritten,
    errors,
  });
}
