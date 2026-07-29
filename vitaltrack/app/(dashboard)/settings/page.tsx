import { redirect } from "next/navigation";
import { getUserId } from "@/lib/supabase-server";
import { isMock } from "@/lib/supabase";
import {
  ConnectGarmin,
  DataRights,
  ImportForm,
} from "@/components/SettingsActions";

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
          Live sync runs through Junction (Vital). One-time server setup:
          set <code className="text-xs bg-slate-100 px-1 rounded">JUNCTION_API_KEY</code> and{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">JUNCTION_WEBHOOK_SECRET</code>,
          and point a Junction webhook at{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">/api/ingest/wearable</code>{" "}
          (see vitaltrack/README.md). Then connect your watch:
        </p>
        <ConnectGarmin />
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
