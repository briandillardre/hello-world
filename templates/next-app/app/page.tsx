import { isSupabaseConfigured } from '@/lib/supabase'

export default function HomePage() {
  return (
    <main className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-slate-50 to-slate-100 text-slate-800 px-6 text-center">
      <div className="text-6xl">🚀</div>
      <h1 className="text-4xl font-black">PROJECT_NAME</h1>
      <p className="text-slate-500 font-semibold max-w-md">
        Deployed and working. Tell Claude what this app should become.
      </p>
      <span className="text-xs font-bold rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-500">
        {isSupabaseConfigured ? '☁️ Cloud connected' : '🧪 Demo mode — no setup needed'}
      </span>
    </main>
  )
}
