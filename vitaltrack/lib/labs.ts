import type { ParsedLab } from "./types";

/** Validates an untrusted ParsedLab-shaped payload (model output or client
 *  confirm request) into a clean, bounded structure. Returns null when
 *  nothing usable survives. */
export function validateParsedLab(input: unknown): ParsedLab | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const biomarkers = (Array.isArray(obj.biomarkers) ? obj.biomarkers : [])
    .filter(
      (b): b is Record<string, unknown> =>
        !!b &&
        typeof b === "object" &&
        typeof (b as Record<string, unknown>).name === "string" &&
        typeof (b as Record<string, unknown>).value === "number" &&
        Number.isFinite((b as Record<string, unknown>).value as number)
    )
    .slice(0, 300)
    .map((b) => ({
      name: String(b.name).slice(0, 120),
      loinc: typeof b.loinc === "string" ? b.loinc.slice(0, 20) : null,
      value: b.value as number,
      unit: typeof b.unit === "string" ? b.unit.slice(0, 30) : null,
      ref_low: typeof b.ref_low === "number" ? b.ref_low : null,
      ref_high: typeof b.ref_high === "number" ? b.ref_high : null,
    }));
  if (!biomarkers.length) return null;
  return {
    source_lab:
      typeof obj.source_lab === "string" ? obj.source_lab.slice(0, 120) : null,
    collected_at:
      typeof obj.collected_at === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(obj.collected_at)
        ? obj.collected_at
        : null,
    biomarkers,
  };
}
