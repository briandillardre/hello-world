import { getTeam } from '@/lib/db/team'
import { TeamManager } from '@/components/team/TeamManager'

export default async function TeamPage() {
  const team = await getTeam()
  return (
    <div className="h-full overflow-auto pb-[70px] md:pb-0">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10">
        <h1 className="text-xl font-bold text-ink">Team</h1>
        <p className="text-xs text-faint mt-0.5">Invite your crew and set who can do what.</p>
      </div>
      <div className="p-4 max-w-2xl">
        <TeamManager data={team} />
      </div>
    </div>
  )
}
