import { redirect } from "next/navigation";
import { getUserId } from "@/lib/supabase-server";
import { getBiomarkers, getLabReports } from "@/lib/db";
import { LabUpload } from "@/components/LabUpload";
import { Sparkline } from "@/components/Sparkline";
import type { Biomarker } from "@/lib/types";

export const dynamic = "force-dynamic";

// The democratization screen: the baseline panel and its rough cash price,
// framed as "ask your doctor" (wellness-safe, plan §4.4/§6).
const SUGGESTED_PANEL = [
  ["Metabolic", "HbA1c · fasting glucose · fasting insulin", "~$30–60"],
  ["Cardiovascular", "Lipid panel + ApoB (+ Lp(a) once)", "~$50–90"],
  ["Inflammation", "hs-CRP", "~$25–40"],
  ["Baseline", "CMP · CBC", "~$25–40"],
  ["Thyroid", "TSH (reflex free T4)", "~$25–40"],
  ["Hormonal", "Total + free testosterone", "~$40–60"],
  ["Micronutrient", "Vitamin D · ferritin/iron · B12", "~$50–90"],
  ["Joints/metabolic", "Uric acid", "~$15–25"],
] as const;

function flagOf(b: Biomarker): "high" | "low" | null {
  if (b.ref_high !== null && b.value > b.ref_high) return "high";
  if (b.ref_low !== null && b.value < b.ref_low) return "low";
  return null;
}

export default async function LabsPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");
  const [reports, biomarkers] = await Promise.all([
    getLabReports(userId),
    getBiomarkers(userId),
  ]);

  // Group by marker name for trend view, ordered by collection date.
  const byName = new Map<string, Biomarker[]>();
  for (const b of biomarkers) {
    const list = byName.get(b.name) ?? [];
    list.push(b);
    byName.set(b.name, list);
  }
  const markers = Array.from(byName.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  return (
    <div className="max-w-4xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold mb-1">Labs</h1>
        <p className="text-sm text-slate-500">
          {reports.length
            ? `${reports.length} report${reports.length > 1 ? "s" : ""} · ${byName.size} markers tracked`
            : "No labs yet — upload your first report below."}
        </p>
      </div>

      <LabUpload />

      {markers.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Biomarker trends</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {markers.map(([name, rows]) => {
              const last = rows[rows.length - 1];
              const flag = flagOf(last);
              return (
                <div
                  key={name}
                  className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{name}</p>
                    <p className="text-lg font-bold">
                      {last.value}
                      <span className="text-xs font-normal text-slate-400 ml-1">
                        {last.unit}
                      </span>
                      {flag && (
                        <span
                          className={`ml-2 text-xs px-2 py-0.5 rounded-full align-middle ${
                            flag === "high"
                              ? "bg-red-100 text-red-700"
                              : "bg-blue-100 text-blue-700"
                          }`}
                        >
                          {flag === "high" ? "above range" : "below range"}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">
                      {rows.length} draw{rows.length > 1 ? "s" : ""}
                      {last.ref_low !== null || last.ref_high !== null
                        ? ` · ref ${last.ref_low ?? ""}–${last.ref_high ?? ""}`
                        : ""}
                    </p>
                  </div>
                  <Sparkline
                    values={rows.map((r) => r.value)}
                    width={90}
                    height={34}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-1">
          The baseline panel worth asking your doctor about
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          This whole list runs roughly <b>$100–250 cash</b> at Quest or Labcorp
          — versus $365–499/yr for the membership clubs. Bring it to your next
          visit and ask what fits your situation.
        </p>
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {SUGGESTED_PANEL.map(([category, tests, price]) => (
            <div key={category} className="flex items-center justify-between px-4 py-3 gap-3">
              <div>
                <p className="text-sm font-medium">{category}</p>
                <p className="text-xs text-slate-500">{tests}</p>
              </div>
              <span className="text-xs text-slate-400 whitespace-nowrap">{price}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-3">
          General wellness information, not medical advice — your doctor decides
          what testing is right for you.
        </p>
      </section>
    </div>
  );
}
