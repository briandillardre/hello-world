import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserId } from "@/lib/supabase-server";
import { isMock } from "@/lib/supabase";

const NAV = [
  { href: "/dashboard", label: "Today" },
  { href: "/timeline", label: "Timeline" },
  { href: "/record", label: "Health Record" },
  { href: "/labs", label: "Labs" },
  { href: "/advisor", label: "Advisor" },
  { href: "/settings", label: "Settings" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 flex items-center gap-1 h-14 overflow-x-auto">
          <Link href="/" className="font-bold text-vital-700 mr-4 shrink-0">
            VitalTrack
          </Link>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-1.5 rounded-md text-sm text-slate-600 hover:text-vital-700 hover:bg-vital-50 whitespace-nowrap"
            >
              {item.label}
            </Link>
          ))}
          {isMock && (
            <span className="ml-auto text-xs bg-amber-100 text-amber-800 rounded-full px-3 py-1 shrink-0">
              Demo mode
            </span>
          )}
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
      <footer className="max-w-6xl mx-auto px-4 pb-10">
        <p className="text-xs text-slate-400">
          General wellness information only — not medical advice, diagnosis, or
          treatment. Talk to your doctor; call 911 in an emergency.
        </p>
      </footer>
    </div>
  );
}
