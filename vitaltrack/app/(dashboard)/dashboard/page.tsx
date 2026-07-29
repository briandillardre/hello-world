import { redirect } from "next/navigation";
import { getUserId } from "@/lib/supabase-server";
import { getDailyMetrics, getSleepSessions, getGoals } from "@/lib/db";
import { Sparkline } from "@/components/Sparkline";
import { RangePicker } from "@/components/RangePicker";
import { RANGE_DAYS, type DailyMetrics, type RangeKey } from "@/lib/types";

export const dynamic = "force-dynamic";

function latest(days: DailyMetrics[], key: keyof DailyMetrics): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const v = days[i][key];
    if (typeof v === "number") return v;
  }
  return null;
}

function average(days: DailyMetrics[], key: keyof DailyMetrics): number | null {
  const vals = days
    .map((d) => d[key])
    .filter((v): v is number => typeof v === "number");
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

function MetricCard({
  label,
  value,
  unit,
  avg,
  series,
  goodDirection,
}: {
  label: string;
  value: number | null;
  unit: string;
  avg: number | null;
  series: Array<number | undefined>;
  goodDirection?: "up" | "down";
}) {
  const first = series.find((v): v is number => typeof v === "number");
  const last = [...series]
    .reverse()
    .find((v): v is number => typeof v === "number");
  let trendColor = "#0d9488";
  if (goodDirection && first !== undefined && last !== undefined && first !== last) {
    const improving = goodDirection === "up" ? last > first : last < first;
    trendColor = improving ? "#0d9488" : "#dc2626";
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-3xl font-bold mt-1">
        {value ?? "—"}
        <span className="text-base font-normal text-slate-400 ml-1">{unit}</span>
      </p>
      <p className="text-xs text-slate-400 mt-0.5">
        {avg !== null ? `avg ${avg}${unit ? ` ${unit}` : ""} over range` : ""}
      </p>
      <div className="mt-3">
        <Sparkline values={series} width={200} height={44} stroke={trendColor} />
      </div>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  const range = (
    ["7d", "30d", "90d", "1y", "all"].includes(searchParams.range ?? "")
      ? searchParams.range
      : "30d"
  ) as RangeKey;
  const days = await getDailyMetrics(userId, RANGE_DAYS[range]);
  const sleep = await getSleepSessions(userId, RANGE_DAYS[range]);
  const goals = (await getGoals(userId)).filter((g) => g.status === "active");

  const series = (key: keyof DailyMetrics) => days.map((d) => d[key] as number | undefined);

  const sleepScores = sleep.map((s) => s.score ?? undefined);
  const lastSleep = sleep[sleep.length - 1];
  const lastSleepH = lastSleep
    ? (lastSleep.deep_s + lastSleep.light_s + lastSleep.rem_s) / 3600
    : null;
  const avgScore = (() => {
    const v = sleep.map((s) => s.score).filter((s): s is number => s !== null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  })();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Today</h1>
          <p className="text-sm text-slate-500">
            {days.length ? `${days.length} days of data` : "No data yet — connect your Garmin in Settings"}
          </p>
        </div>
        <RangePicker current={range} basePath="/dashboard" />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          label="Sleep score"
          value={lastSleep?.score ?? null}
          unit={lastSleepH ? `· ${lastSleepH.toFixed(1)}h last night` : ""}
          avg={avgScore}
          series={sleepScores}
          goodDirection="up"
        />
        <MetricCard
          label="Resting heart rate"
          value={latest(days, "resting_hr")}
          unit="bpm"
          avg={average(days, "resting_hr")}
          series={series("resting_hr")}
          goodDirection="down"
        />
        <MetricCard
          label="HRV (overnight)"
          value={latest(days, "hrv")}
          unit="ms"
          avg={average(days, "hrv")}
          series={series("hrv")}
          goodDirection="up"
        />
        <MetricCard
          label="Steps"
          value={latest(days, "steps")}
          unit=""
          avg={average(days, "steps")}
          series={series("steps")}
          goodDirection="up"
        />
        <MetricCard
          label="Stress"
          value={latest(days, "stress")}
          unit="/100"
          avg={average(days, "stress")}
          series={series("stress")}
          goodDirection="down"
        />
        <MetricCard
          label="Body Battery"
          value={latest(days, "body_battery")}
          unit="/100"
          avg={average(days, "body_battery")}
          series={series("body_battery")}
          goodDirection="up"
        />
      </div>

      {goals.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-3">Goals</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {goals.map((g) => {
              let current: number | null = null;
              if (g.metric === "sleep_score") current = avgScore;
              else if (g.metric)
                current = average(days.slice(-7), g.metric as keyof DailyMetrics);
              const hit =
                current !== null &&
                g.target_value !== null &&
                (g.direction === "below"
                  ? current <= g.target_value
                  : current >= g.target_value);
              return (
                <div
                  key={g.id}
                  className="bg-white rounded-xl border border-slate-200 p-4"
                >
                  <p className="font-medium text-sm">{g.title}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {current !== null && g.target_value !== null ? (
                      <>
                        7-day avg <b>{current}</b> vs target{" "}
                        {g.direction === "below" ? "≤" : "≥"} {g.target_value}{" "}
                        <span className={hit ? "text-vital-600" : "text-amber-600"}>
                          {hit ? "· on track" : "· keep pushing"}
                        </span>
                      </>
                    ) : (
                      "tracked manually"
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
