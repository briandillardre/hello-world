import { redirect } from "next/navigation";
import { getUserId } from "@/lib/supabase-server";
import { getEvents } from "@/lib/db";

export const dynamic = "force-dynamic";

const KIND_STYLE: Record<string, string> = {
  injury: "bg-red-100 text-red-700",
  surgery: "bg-red-100 text-red-700",
  condition: "bg-amber-100 text-amber-700",
  lab_draw: "bg-vital-100 text-vital-700",
  medication: "bg-blue-100 text-blue-700",
  goal: "bg-purple-100 text-purple-700",
  activity: "bg-slate-100 text-slate-600",
  illness: "bg-amber-100 text-amber-700",
  note: "bg-slate-100 text-slate-600",
};

export default async function TimelinePage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");
  const events = await getEvents(userId);

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">Timeline</h1>
      <p className="text-sm text-slate-500 mb-6">
        Everything that happened, in one stream — the &quot;what changed and
        when&quot; view.
      </p>
      {events.length === 0 && (
        <p className="text-sm text-slate-500">
          Nothing yet. Events appear as you add record items and upload labs.
        </p>
      )}
      <ol className="relative border-l border-slate-200 ml-3 space-y-6">
        {events.map((e) => (
          <li key={e.id} className="ml-6">
            <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-vital-500" />
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${KIND_STYLE[e.kind] ?? KIND_STYLE.note}`}
                >
                  {e.kind.replace("_", " ")}
                </span>
                <time className="text-xs text-slate-400">
                  {new Date(e.ts).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              </div>
              <p className="font-medium mt-1.5 text-sm">{e.title}</p>
              {e.detail && (
                <p className="text-sm text-slate-500 mt-0.5">{e.detail}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
