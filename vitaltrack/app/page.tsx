import Link from "next/link";
import { isMock } from "@/lib/supabase";

const FEATURES = [
  {
    title: "Your watch, decoded",
    body: "Sleep, resting heart rate, HRV, stress, steps — synced automatically from your Garmin and turned into trends you can actually read.",
  },
  {
    title: "Your whole story",
    body: "Injuries, surgeries, conditions, meds, goals. The context every other health app throws away is the context that makes your data mean something.",
  },
  {
    title: "Your bloodwork, connected",
    body: "Upload any lab PDF. We extract every biomarker, trend it across draws, and connect it to what your watch already sees.",
  },
  {
    title: "An advisor that knows all of it",
    body: "Ask why your sleep slipped. Get bloodwork worth discussing with your doctor. Preventative guidance from your full picture — not generic tips.",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-20">
        <p className="text-vital-600 font-semibold tracking-wide text-sm uppercase">
          VitalTrack
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold mt-3 leading-tight">
          Your watch already knows.
          <br />
          <span className="text-vital-600">Now you will too.</span>
        </h1>
        <p className="text-lg text-slate-600 mt-5 max-w-2xl">
          Your $400 watch collects the data. Nobody shows you what it means.
          VitalTrack unifies your wearable trends, health history, and
          bloodwork into one preventative picture — for the price of a
          streaming subscription, not a $500/yr longevity club.
        </p>
        <div className="mt-8 flex gap-3">
          <Link
            href="/dashboard"
            className="bg-vital-600 hover:bg-vital-700 text-white rounded-lg px-6 py-3 font-medium"
          >
            {isMock ? "Explore the live demo" : "Open your dashboard"}
          </Link>
          {!isMock && (
            <Link
              href="/login"
              className="border border-slate-300 hover:border-vital-500 rounded-lg px-6 py-3 font-medium"
            >
              Sign in
            </Link>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-6 mt-16">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900">{f.title}</h3>
              <p className="text-sm text-slate-600 mt-2">{f.body}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-16 max-w-2xl">
          VitalTrack provides general wellness information only — not medical
          advice, diagnosis, or treatment. Always talk to your doctor.
        </p>
      </div>
    </main>
  );
}
