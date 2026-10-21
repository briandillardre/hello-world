import { redirect } from "next/navigation";
import { getUserId } from "@/lib/supabase-server";
import { getConditions, getGoals, getMedications } from "@/lib/db";
import { RecordForm } from "@/components/RecordForm";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-amber-100 text-amber-700",
  managed: "bg-blue-100 text-blue-700",
  resolved: "bg-slate-100 text-slate-500",
  achieved: "bg-vital-100 text-vital-700",
  abandoned: "bg-slate-100 text-slate-500",
};

export default async function RecordPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");
  const [conditions, medications, goals] = await Promise.all([
    getConditions(userId),
    getMedications(userId),
    getGoals(userId),
  ]);

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold mb-1">Health Record</h1>
        <p className="text-sm text-slate-500">
          Your full story — this is the context your advisor runs on. The more
          honest and complete it is, the better the guidance.
        </p>
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">
            Conditions, injuries & family history
          </h2>
        </div>
        <div className="space-y-3">
          {conditions.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[c.status]}`}>
                  {c.status}
                </span>
                <span className="text-xs text-slate-400">{c.kind.replace("_", " ")}</span>
                {c.onset && (
                  <span className="text-xs text-slate-400">
                    {c.onset}
                    {c.resolved_at ? ` → ${c.resolved_at}` : ""}
                  </span>
                )}
              </div>
              <p className="font-medium text-sm mt-1.5">{c.name}</p>
              {c.notes && <p className="text-sm text-slate-500 mt-0.5">{c.notes}</p>}
            </div>
          ))}
          {!conditions.length && (
            <p className="text-sm text-slate-400">Nothing recorded yet.</p>
          )}
        </div>
        <div className="mt-3">
          <RecordForm table="conditions" title="condition / injury" />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Medications & supplements</h2>
        <div className="space-y-3">
          {medications.map((m) => (
            <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="font-medium text-sm">
                {m.name} {m.dose && <span className="text-slate-400 font-normal">· {m.dose}</span>}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {m.kind}
                {m.started ? ` · since ${m.started}` : ""}
                {m.stopped ? ` · stopped ${m.stopped}` : ""}
                {m.reason ? ` · ${m.reason}` : ""}
              </p>
            </div>
          ))}
          {!medications.length && (
            <p className="text-sm text-slate-400">Nothing recorded yet.</p>
          )}
        </div>
        <div className="mt-3">
          <RecordForm table="medications" title="medication / supplement" />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Goals</h2>
        <div className="space-y-3">
          {goals.map((g) => (
            <div key={g.id} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[g.status]}`}>
                  {g.status}
                </span>
                {g.deadline && (
                  <span className="text-xs text-slate-400">by {g.deadline}</span>
                )}
              </div>
              <p className="font-medium text-sm mt-1.5">{g.title}</p>
              {g.notes && <p className="text-sm text-slate-500 mt-0.5">{g.notes}</p>}
            </div>
          ))}
          {!goals.length && <p className="text-sm text-slate-400">No goals yet.</p>}
        </div>
        <div className="mt-3">
          <RecordForm table="goals" title="goal" />
        </div>
      </section>
    </div>
  );
}
