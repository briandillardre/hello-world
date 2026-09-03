// Assembles the full user context string fed to the AI advisor: wearable
// trends + health record + labs. This is the product's core idea — the AI
// sees the whole picture, not one silo.

import {
  getBiomarkers,
  getConditions,
  getDailyMetrics,
  getGoals,
  getMedications,
  getSleepSessions,
} from "./db";
import type { DailyMetrics } from "./types";

// User-entered / document-derived strings go into the system prompt — strip
// newlines and cap length so free text can't masquerade as new sections or
// instructions (defense-in-depth alongside the <user_data> delimiting).
function clean(s: string | null | undefined, max = 400): string {
  if (!s) return "";
  return String(s)
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, " ")
    .trim()
    .slice(0, max);
}

function avg(vals: Array<number | undefined>): number | null {
  const v = vals.filter((x): x is number => typeof x === "number");
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
}

function metricLine(label: string, days: DailyMetrics[], key: keyof DailyMetrics, unit: string): string {
  const last7 = avg(days.slice(-7).map((d) => d[key] as number | undefined));
  const last30 = avg(days.slice(-30).map((d) => d[key] as number | undefined));
  const prev30 = avg(days.slice(-60, -30).map((d) => d[key] as number | undefined));
  if (last30 === null) return "";
  const delta =
    prev30 !== null ? ` (prev 30d: ${prev30}${unit})` : "";
  return `- ${label}: last 7d avg ${last7}${unit}, last 30d avg ${last30}${unit}${delta}\n`;
}

export async function buildUserContext(userId: string): Promise<string> {
  const [days, sleep, conditions, meds, goals, biomarkers] = await Promise.all([
    getDailyMetrics(userId, 90),
    getSleepSessions(userId, 30),
    getConditions(userId),
    getMedications(userId),
    getGoals(userId),
    getBiomarkers(userId),
  ]);

  let ctx = "== WEARABLE TRENDS (Garmin) ==\n";
  ctx += metricLine("Steps", days, "steps", "");
  ctx += metricLine("Resting HR", days, "resting_hr", " bpm");
  ctx += metricLine("HRV", days, "hrv", " ms");
  ctx += metricLine("Stress (0-100)", days, "stress", "");
  ctx += metricLine("Body Battery", days, "body_battery", "");

  if (sleep.length) {
    const scores = sleep.map((s) => s.score).filter((s): s is number => s !== null);
    const durH =
      sleep.reduce((a, s) => a + (s.deep_s + s.light_s + s.rem_s), 0) /
      sleep.length /
      3600;
    ctx += `- Sleep: last 30d avg ${(durH).toFixed(1)}h/night, avg score ${
      scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : "n/a"
    }; ${sleep.filter((s) => s.deep_s + s.light_s + s.rem_s < 6.5 * 3600).length} nights under 6.5h\n`;
  }

  ctx += "\n== HEALTH RECORD ==\n";
  for (const c of conditions) {
    ctx += `- [${c.kind}/${c.status}] ${clean(c.name, 160)}${c.onset ? ` (onset ${c.onset}${c.resolved_at ? `, resolved ${c.resolved_at}` : ""})` : ""}${c.notes ? ` — ${clean(c.notes)}` : ""}\n`;
  }
  if (!conditions.length) ctx += "- (none recorded)\n";

  ctx += "\n== MEDICATIONS / SUPPLEMENTS ==\n";
  for (const m of meds) {
    ctx += `- ${clean(m.name, 120)}${m.dose ? ` ${clean(m.dose, 40)}` : ""} (${m.kind}${m.stopped ? `, stopped ${m.stopped}` : ""})${m.reason ? ` — ${clean(m.reason)}` : ""}\n`;
  }
  if (!meds.length) ctx += "- (none recorded)\n";

  ctx += "\n== GOALS ==\n";
  for (const g of goals.filter((g) => g.status === "active")) {
    ctx += `- ${clean(g.title, 160)}${g.metric && g.target_value ? ` (tracking ${clean(g.metric, 40)} ${g.direction} ${g.target_value})` : ""}\n`;
  }

  ctx += "\n== LAB HISTORY (by draw date) ==\n";
  const byDate = new Map<string, string[]>();
  for (const b of biomarkers) {
    const key = b.collected_at ?? "unknown date";
    const flag =
      (b.ref_high !== null && b.value > b.ref_high) ||
      (b.ref_low !== null && b.value < b.ref_low)
        ? " [OUT OF RANGE]"
        : "";
    const range =
      b.ref_low !== null || b.ref_high !== null
        ? ` (ref ${b.ref_low ?? ""}–${b.ref_high ?? ""})`
        : "";
    const list = byDate.get(key) ?? [];
    list.push(
      `${clean(b.name, 120)}: ${b.value} ${clean(b.unit, 20)}${range}${flag}`
    );
    byDate.set(key, list);
  }
  for (const [date, list] of Array.from(byDate.entries()).sort()) {
    ctx += `${date}:\n`;
    for (const line of list) ctx += `  - ${line}\n`;
  }
  if (!byDate.size) ctx += "- (no labs uploaded yet)\n";

  return ctx;
}
