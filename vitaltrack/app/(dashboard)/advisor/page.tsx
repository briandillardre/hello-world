import { redirect } from "next/navigation";
import { getUserId } from "@/lib/supabase-server";
import { AdvisorChat } from "@/components/AdvisorChat";

export const dynamic = "force-dynamic";

export default async function AdvisorPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Advisor</h1>
      <p className="text-sm text-slate-500 mb-6 max-w-2xl">
        Ask anything — the advisor sees your wearable trends, health record,
        and labs together. Wellness guidance only: it will never diagnose, and
        anything important belongs in a conversation with your doctor.
      </p>
      <AdvisorChat />
    </div>
  );
}
