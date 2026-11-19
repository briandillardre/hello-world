/**
 * The Beta section's tools and who opens each — pure. The hub draws its
 * cards from this list and every tool page checks the same `canOpen`, so a
 * card never leads to a 404 and a typed URL never opens what the card hides.
 */
import { rankOf, RANK, type Permissions } from '@/lib/permissions'

export type ToolKey = 'survey' | 'payroll' | 'liens' | 'weather' | 'locates' | 'owning' | 'rentals' | 'haul' | 'credentials' | 'espanol' | 'dvir' | 'activation'

export interface Tool {
  key: ToolKey
  href: string
  title: string
  blurb: string
  group: 'Money & paperwork' | 'Field' | 'Machines' | 'Company'
  canOpen: (p: Pick<Permissions, 'role' | 'isMaster' | 'features' | 'canViewCosts' | 'canEdit'>, founder: boolean) => boolean
}

const has = (p: Pick<Permissions, 'features'>, k: string) => p.features.includes(k as never)

export const TOOLS: Tool[] = [
  { key: 'payroll', href: '/beta/payroll', group: 'Money & paperwork', title: 'Certified payroll', blurb: 'WH-347 for prevailing-wage jobs, straight from GPS-verified time cards — with the wage check and an LCPtracker-style spreadsheet.',
    canOpen: (p) => rankOf(p) >= RANK.manager && p.canViewCosts && has(p, 'clock') },
  { key: 'liens', href: '/beta/liens', group: 'Money & paperwork', title: 'Lien clock', blurb: 'SC notice-of-furnishing, lien and suit deadlines per job, counted from the first and last day you were on site.',
    canOpen: (p) => rankOf(p) >= RANK.manager && has(p, 'jobs') },
  { key: 'weather', href: '/beta/weather', group: 'Money & paperwork', title: 'Weather-delay packet', blurb: 'Rain, mud, freeze and wind days that actually stopped the work — one letter plus the day-by-day proof.',
    canOpen: (p) => rankOf(p) >= RANK.foreman && (has(p, 'jobs') || has(p, 'zones')) },
  { key: 'locates', href: '/beta/locates', group: 'Field', title: '811 locate tickets', blurb: 'Ticket numbers per site, when you can dig, and when to re-call before the ticket runs out.',
    canOpen: (p) => rankOf(p) >= RANK.foreman && has(p, 'zones') },
  { key: 'haul', href: '/beta/haul', group: 'Field', title: 'Haul tickets', blurb: 'Quarry, plant and dump tickets checked against your trucks’ own trips into the site — tons and yards both ways.',
    canOpen: (p) => rankOf(p) >= RANK.foreman && (has(p, 'jobs') || has(p, 'zones')) },
  { key: 'dvir', href: '/beta/dvir', group: 'Field', title: 'Truck inspections (DVIR)', blurb: 'Pre- and post-trip inspections on the phone; every defect opens a work order; out-of-service ones say do-not-operate until signed off.',
    canOpen: (p) => has(p, 'assets') || has(p, 'maintenance') },
  { key: 'credentials', href: '/beta/credentials', group: 'Field', title: 'Crew cards & certs', blurb: 'CDL medical cards, OSHA 10/30, flagger, competent person — who has what and what runs out next.',
    canOpen: () => true },
  { key: 'espanol', href: '/beta/espanol', group: 'Field', title: 'Español', blurb: 'The crew’s screens in Spanish — the bottom bar, the time clock, inspections — switched per phone.',
    canOpen: () => true },
  { key: 'survey', href: '/beta/survey', group: 'Machines', title: 'Site survey & as-built', blurb: 'Takeoff versions with their legends, drone topo on the map’s timeline, drone vs rover checks, and the stone / subgrade surfaces re-fit to the curb as built — as a LandXML file for the machines (dealer check pending).',
    canOpen: (p) => rankOf(p) >= RANK.foreman && has(p, 'plans') },
  { key: 'owning', href: '/beta/owning', group: 'Machines', title: 'What a machine really costs', blurb: 'Owning + operating cost per hour on the hours it really ran — rent-vs-own and replace-now in plain words.',
    canOpen: (p) => rankOf(p) >= RANK.manager && p.canViewCosts },
  { key: 'rentals', href: '/beta/rentals', group: 'Machines', title: 'Rentals', blurb: 'Everything on rent, what it has cost so far, and the rented machine that hasn’t moved in a week.',
    canOpen: (p) => rankOf(p) >= RANK.foreman && p.canViewCosts },
  { key: 'activation', href: '/beta/activation', group: 'Company', title: 'Activation', blurb: 'Did each new company get a tracker reporting in its first week? The founder’s funnel.',
    canOpen: (_p, founder) => founder },
]

export const toolByKey = (k: ToolKey) => TOOLS.find((t) => t.key === k)!
