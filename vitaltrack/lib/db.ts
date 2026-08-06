// Data access layer. Every function works in demo mode (mock data) and in
// real mode (Supabase with RLS via the cookie-bound client).

import { isMock } from "./supabase";
import { createUserClient } from "./supabase-server";
import {
  mockBiomarkers,
  mockConditions,
  mockDailyMetrics,
  mockEvents,
  mockGoals,
  mockLabReports,
  mockMedications,
  mockSleepSessions,
} from "./mock-data";
import type {
  Biomarker,
  Condition,
  DailyMetrics,
  Goal,
  LabReport,
  Medication,
  MetricType,
  SleepSession,
  TimelineEvent,
} from "./types";

function sinceIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export async function getDailyMetrics(
  userId: string,
  days: number
): Promise<DailyMetrics[]> {
  if (isMock) return mockDailyMetrics(days);
  const supabase = createUserClient();
  // Page newest-first: PostgREST caps responses (max-rows), and an
  // ascending query silently truncates the NEWEST data on long ranges —
  // exactly what the Today cards read.
  const pageSize = 1000;
  const maxRows = 40000;
  const rows: Array<{ ts: string; type: string; value: number }> = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await supabase
      .from("metric_samples")
      .select("ts, type, value")
      .eq("user_id", userId)
      .gte("ts", sinceIso(days))
      .order("ts", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  const byDay = new Map<string, DailyMetrics>();
  for (const row of rows) {
    const date = String(row.ts).slice(0, 10);
    const day = byDay.get(date) ?? { date };
    const rec = day as unknown as Record<string, unknown>;
    // Rows arrive newest-first; first value seen per (day, type) wins.
    if (rec[row.type as MetricType] === undefined)
      rec[row.type as MetricType] = Number(row.value);
    byDay.set(date, day);
  }
  return Array.from(byDay.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

export async function getSleepSessions(
  userId: string,
  days: number
): Promise<SleepSession[]> {
  if (isMock) return mockSleepSessions(days);
  const supabase = createUserClient();
  const { data, error } = await supabase
    .from("sleep_sessions")
    .select("*")
    .eq("user_id", userId)
    .gte("end_ts", sinceIso(days))
    .order("end_ts", { ascending: true })
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as SleepSession[];
}

export async function getConditions(userId: string): Promise<Condition[]> {
  if (isMock) return mockConditions;
  const supabase = createUserClient();
  const { data, error } = await supabase
    .from("conditions")
    .select("*")
    .eq("user_id", userId)
    .order("onset", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Condition[];
}

export async function getMedications(userId: string): Promise<Medication[]> {
  if (isMock) return mockMedications;
  const supabase = createUserClient();
  const { data, error } = await supabase
    .from("medications")
    .select("*")
    .eq("user_id", userId)
    .order("started", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Medication[];
}

export async function getGoals(userId: string): Promise<Goal[]> {
  if (isMock) return mockGoals;
  const supabase = createUserClient();
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Goal[];
}

export async function getLabReports(userId: string): Promise<LabReport[]> {
  if (isMock) return mockLabReports;
  const supabase = createUserClient();
  const { data, error } = await supabase
    .from("lab_reports")
    .select("*")
    .eq("user_id", userId)
    .order("collected_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as LabReport[];
}

export async function getBiomarkers(userId: string): Promise<Biomarker[]> {
  if (isMock) return mockBiomarkers;
  const supabase = createUserClient();
  const { data, error } = await supabase
    .from("biomarkers")
    .select("*")
    .eq("user_id", userId)
    .order("collected_at", { ascending: true, nullsFirst: true });
  if (error) throw error;
  return (data ?? []) as Biomarker[];
}

export async function getEvents(userId: string): Promise<TimelineEvent[]> {
  if (isMock) return [...mockEvents].sort((a, b) => b.ts.localeCompare(a.ts));
  const supabase = createUserClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .order("ts", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as TimelineEvent[];
}

// ── Mutations (no-ops in demo mode; routes surface a "demo mode" notice) ──

export async function insertRecordItem(
  userId: string,
  table: "conditions" | "medications" | "goals",
  values: Record<string, unknown>
): Promise<{ ok: boolean; demo?: boolean; error?: string }> {
  if (isMock) return { ok: false, demo: true };
  const supabase = createUserClient();
  const { error } = await supabase
    .from(table)
    .insert({ ...values, user_id: userId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function insertEvent(
  userId: string,
  event: Omit<TimelineEvent, "id" | "user_id">
): Promise<void> {
  if (isMock) return;
  const supabase = createUserClient();
  await supabase.from("events").insert({ ...event, user_id: userId });
}
