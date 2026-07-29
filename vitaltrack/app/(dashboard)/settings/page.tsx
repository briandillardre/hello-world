import { redirect } from "next/navigation";
import { getUserId } from "@/lib/supabase-server";
import { isMock } from "@/lib/supabase";
import { DataRights, ImportForm } from "@/components/SettingsActions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold mb-1">Settings</h1>
        {isMock && (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-2">
            Demo mode — connect Supabase env vars to enable real data,
            integrations, and imports.
          </p>
        )}
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-1">Garmin connection</h2>
        <p className="text-sm text-slate-500 mb-3 max-w-2xl">
          Live sync runs through Junction (Vital) — create a Junction account,
          add your webhook URL (<code className="text-xs bg-slate-100 px-1 rounded">/api/ingest/wearable</code>),
          set <code className="text-xs bg-slate-100 px-1 rounded">JUNCTION_WEBHOOK_SECRET</code>,
          and use Junction Link to connect your Garmin. Then map the Junction
          user id in the <code className="text-xs bg-slate-100 px-1 rounded">integrations</code> table
          (see vitaltrack/README.md, step 4).
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-1">Backfill from Garmin export</h2>
        <p className="text-sm text-slate-500 mb-3 max-w-2xl">
          Request your archive in Garmin Connect (Account Settings → Account
          Management → Export Your Data), then upload daily-summary CSVs and
          activity .fit files here. Years of history, no API needed.
        </p>
        <ImportForm />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-1">Your data, your rules</h2>
        <p className="text-sm text-slate-500 mb-3 max-w-2xl">
          Everything VitalTrack stores about you is yours. Export it all as
          JSON, or erase it permanently — no questions, no retention.
        </p>
        <DataRights />
      </section>
    </div>
  );
}
