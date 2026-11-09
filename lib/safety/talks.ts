/**
 * Safety (migration 159) — pure: the toolbox-talk library, the report rules,
 * and the signature check. Shared by the /safety page, the server actions
 * and `scripts/safety-test.mjs` (run it after ANY change here).
 *
 * The talks are short on purpose — a foreman reads one at the tailgate in
 * five minutes. Points follow the OSHA standard named on each (1926 =
 * construction); they're a starting script, never a substitute for the
 * company's own program or a competent person on site.
 */

export interface TalkTopic { key: string; title: string; group: string; points: string[]; ref?: string }

export const TALK_TOPICS: TalkTopic[] = [
  // dirt & trenches
  { key: 'trench', group: 'Dirt & trenches', title: 'Trenches: protect every wall over 5 feet', ref: 'OSHA 1926.651–652', points: [
    'A trench 5 feet deep or more needs a protective system — sloping, benching, shoring or a trench box — unless it is in stable rock.',
    'A competent person inspects the trench every day before work and after rain or anything that changes it.',
    'Spoil piles and equipment stay at least 2 feet back from the edge.',
    'A ladder or ramp within 25 feet of every worker once the trench is 4 feet deep.',
    'One cubic yard of soil weighs about as much as a car. Never step in an unprotected trench, even "for a second."',
  ] },
  { key: 'utilities', group: 'Dirt & trenches', title: 'Call 811 and dig around marked utilities', ref: 'OSHA 1926.651(b)', points: [
    'Every dig starts with an 811 locate ticket — check the ticket number and that it hasn\'t expired.',
    'Know the paint colors: red electric, yellow gas/oil, orange communications, blue water, green sewer.',
    'Inside the tolerance zone around a mark, expose the line by hand or vacuum before the bucket goes near it.',
    'A strike or a gas smell: stop, get everyone upwind and away, call 911 and the utility. Don\'t try to fix it.',
  ] },
  { key: 'struck', group: 'Machines & trucks', title: 'Struck-by: stay out of the swing and the backing path', ref: 'OSHA 1926.600–602', points: [
    'Never walk behind a backing truck or inside a machine\'s swing radius.',
    'Make eye contact with the operator before you approach — no eye contact, no approach.',
    'Hi-vis on, every time you\'re on foot near equipment or traffic.',
    'Use a spotter when the operator can\'t see behind; agree on hand signals before you start.',
  ] },
  { key: 'blindspots', group: 'Machines & trucks', title: 'Blind spots around dozers, excavators and dump trucks', ref: 'OSHA 1926.601(b)(4)', points: [
    'Big machines have blind spots big enough to hide a pickup truck.',
    'If you can\'t see the operator\'s eyes in their mirror, they can\'t see you.',
    'Backup alarms only help if people respect them — stop and look when you hear one.',
    'Operators: walk around the machine before you start it.',
  ] },
  { key: 'seatbelt', group: 'Machines & trucks', title: 'Seat belts and rollover protection', ref: 'OSHA 1926.602(a)(2)', points: [
    'Wear the seat belt in any machine with a rollover structure (ROPS) — the cage only protects you if you stay in it.',
    'Never jump from a tipping machine; stay belted and hold on.',
    'Work across slopes slowly, keep the bucket low, and know the machine\'s slope limits.',
  ] },
  { key: 'mounting', group: 'Machines & trucks', title: 'Three points of contact getting on and off', points: [
    'Face the machine and keep three points of contact — two hands and a foot, or two feet and a hand.',
    'Clean mud off steps and boots; never jump down.',
    'Don\'t climb with tools or a coffee in your hand.',
  ] },
  { key: 'traffic', group: 'Machines & trucks', title: 'Working next to live traffic', ref: 'MUTCD Part 6 · OSHA 1926.201', points: [
    'Set up the work zone signs and cones per the traffic control plan before the work starts.',
    'Flaggers wear high-vis and stand where drivers can see them early, with an escape route.',
    'Never turn your back to traffic, and keep equipment inside the work zone.',
  ] },
  // body & weather
  { key: 'heat', group: 'Body & weather', title: 'Heat illness: water, rest, shade', ref: 'OSHA heat campaign', points: [
    'Drink water every 15–20 minutes, even if you\'re not thirsty.',
    'Rest in the shade when you need it — new or returning workers need time to get used to the heat.',
    'Watch each other: confusion, no sweating, or passing out is heat stroke — call 911 and cool them down now.',
    'Cramps, heavy sweating, dizziness or nausea: stop, rest in shade, drink water, tell the foreman.',
  ] },
  { key: 'cold', group: 'Body & weather', title: 'Cold stress and slick ground', points: [
    'Dress in layers and keep a dry pair of gloves and socks.',
    'Shivering, numbness or slurred speech: get warm and tell someone.',
    'Frost and mud make steps and decks slick — slow down and use three points of contact.',
  ] },
  { key: 'lightning', group: 'Body & weather', title: 'Lightning: when thunder roars, go indoors', points: [
    'If you can hear thunder, you are close enough to be struck.',
    'Get into a building or a hard-top vehicle — not under a tree, not on a machine with the door open.',
    'Stay down at least 30 minutes after the last thunder.',
    'Cranes and booms stop first — they are the tallest thing on site.',
  ] },
  { key: 'lifting', group: 'Body & weather', title: 'Lift with your legs, get help for heavy loads', points: [
    'Size up the load first. Over about 50 pounds or awkward? Get a second person or a machine.',
    'Bend your knees, keep the load close, and don\'t twist — turn with your feet.',
    'Clear the path before you pick it up.',
  ] },
  { key: 'silica', group: 'Body & weather', title: 'Silica dust when cutting concrete, block or stone', ref: 'OSHA 1926.1153', points: [
    'Cutting, grinding or drilling concrete, block, brick or stone makes silica dust that scars the lungs.',
    'Use water on the blade or a vacuum shroud — dry cutting without controls isn\'t allowed.',
    'Wear the respirator the Table 1 task calls for, and keep others out of the dust.',
  ] },
  { key: 'noise', group: 'Body & weather', title: 'Hearing protection around loud equipment', ref: 'OSHA 1926.52', points: [
    'If you have to shout to be heard an arm\'s length away, it\'s loud enough to damage hearing.',
    'Wear plugs or muffs around saws, breakers, compactors and running machines.',
    'Hearing loss is permanent and it adds up a little every day.',
  ] },
  // tools & gear
  { key: 'ppe', group: 'Tools & gear', title: 'The PPE for today\'s work', ref: 'OSHA 1926.95–102', points: [
    'Hard hat, safety glasses, hi-vis and boots are the minimum on site.',
    'Add gloves, face shields, hearing protection or a respirator for the task.',
    'Check your gear before you put it on — cracked hard hats and torn gloves get replaced.',
  ] },
  { key: 'falls', group: 'Tools & gear', title: 'Fall protection at 6 feet', ref: 'OSHA 1926.501', points: [
    'At 6 feet or more above a lower level, you need guardrails, a net or a personal fall arrest system.',
    'Cover or guard every hole and opening — and mark the cover.',
    'Inspect your harness and lanyard before each use; tie off to a rated anchor.',
  ] },
  { key: 'ladders', group: 'Tools & gear', title: 'Ladders: the 4-to-1 rule', ref: 'OSHA 1926.1053', points: [
    'Set an extension ladder 1 foot out for every 4 feet up, and extend it 3 feet past the landing.',
    'Face the ladder, keep three points of contact, and don\'t stand on the top two rungs of a step ladder.',
    'Inspect it first — bent rails or missing feet take it out of service.',
  ] },
  { key: 'lockout', group: 'Tools & gear', title: 'Lockout before you work on a machine', ref: 'OSHA 1910.147 (principles)', points: [
    'Before you reach into a machine, shut it down, take the key, and lower or block anything that can fall.',
    'Bleed off stored pressure in hydraulics.',
    'Your lock, your key — nobody starts it but you.',
  ] },
  { key: 'powertools', group: 'Tools & gear', title: 'Power tools and guards', ref: 'OSHA 1926.300', points: [
    'Guards stay on. A tool with a missing guard or damaged cord comes out of service.',
    'Unplug or pull the battery before changing a blade or bit.',
    'Use GFCI protection for corded tools outdoors.',
  ] },
  { key: 'rigging', group: 'Tools & gear', title: 'Rigging and suspended loads', ref: 'OSHA 1926.251 · 1926.1400', points: [
    'Inspect slings and hooks before every lift; know the load weight.',
    'Never stand or walk under a suspended load.',
    'Use tag lines to control the load, and one person gives the signals.',
  ] },
  // people & the site
  { key: 'housekeeping', group: 'People & the site', title: 'Housekeeping: slips, trips and stuck nails', ref: 'OSHA 1926.25', points: [
    'Keep walkways clear of cords, scrap and tools.',
    'Bend over or pull nails from scrap lumber.',
    'A tidy site is a faster site — clean as you go.',
  ] },
  { key: 'fire', group: 'People & the site', title: 'Fueling and fire extinguishers', ref: 'OSHA 1926.150–152', points: [
    'Shut the engine off and no smoking while fueling.',
    'Know where the nearest extinguisher is and check its gauge is in the green.',
    'Use approved cans for fuel and keep them away from ignition sources.',
  ] },
  { key: 'firstaid', group: 'People & the site', title: 'Where the first-aid kit is, and who to call', ref: 'OSHA 1926.50', points: [
    'Know where the first-aid kit and the nearest hospital are for this site.',
    'Report every injury, even a small cut — infections start small.',
    'For anything serious, call 911 first, then the foreman.',
  ] },
  { key: 'nearmiss', group: 'People & the site', title: 'Why we report near misses', points: [
    'A near miss is an accident that almost happened — it\'s free advice.',
    'Reporting one is never getting someone in trouble; it\'s how we fix the hazard before it hurts somebody.',
    'Use the near-miss report on your phone — it takes a minute.',
  ] },
  { key: 'stopwork', group: 'People & the site', title: 'Anyone can stop the work', points: [
    'If something looks unsafe, every person on this crew has the right and the duty to stop the work.',
    'Nobody gets in trouble for stopping a job to ask a safety question.',
    'We fix it, then we start back.',
  ] },
  { key: 'distraction', group: 'People & the site', title: 'Phones and distractions', points: [
    'No phones while running equipment or walking near it.',
    'Pull over and park before you take a call or text in a truck.',
    'If you\'re tired or not feeling right, tell the foreman before you start.',
  ] },
]

export const TALK_GROUPS = Array.from(new Set(TALK_TOPICS.map((t) => t.group)))
export const topicByKey = (key: string | null | undefined) => (key ? TALK_TOPICS.find((t) => t.key === key) ?? null : null)

export const REPORT_KINDS = ['incident', 'near_miss', 'observation'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]
export const REPORT_WORDS: Record<ReportKind, { label: string; emoji: string; hint: string }> = {
  incident: { label: 'Incident', emoji: '🚑', hint: 'Someone got hurt or something got damaged' },
  near_miss: { label: 'Near miss', emoji: '⚠️', hint: 'Almost happened — nobody hurt' },
  observation: { label: 'Hazard spotted', emoji: '👀', hint: 'Something unsafe to fix' },
}
export const TREATMENTS = ['none', 'first_aid', 'medical', 'lost_time'] as const
export type Treatment = (typeof TREATMENTS)[number]
export const TREATMENT_WORDS: Record<Treatment, string> = {
  none: 'No treatment',
  first_aid: 'First aid on site',
  medical: 'Doctor / ER',
  lost_time: 'Missed work',
}
export const isReportKind = (v: unknown): v is ReportKind => typeof v === 'string' && (REPORT_KINDS as readonly string[]).includes(v)
export const isTreatment = (v: unknown): v is Treatment => typeof v === 'string' && (TREATMENTS as readonly string[]).includes(v)

/** an injury report pages the company now; treatment beyond first aid is OSHA-recordable territory */
export function reportUrgency(r: { kind: ReportKind; injury: boolean; treatment: Treatment }): 'page' | 'normal' {
  return r.kind === 'incident' && (r.injury || r.treatment !== 'none') ? 'page' : 'normal'
}

/** "may be OSHA-recordable" — beyond first aid or missed work. Never a legal verdict, a nudge to check. */
export function maybeRecordable(t: Treatment): boolean {
  return t === 'medical' || t === 'lost_time'
}

/**
 * A finger-drawn signature arrives as an SVG path in a 300×100 box. Keep only
 * M/L commands with numbers inside the box, round to whole units, and cap the
 * size — anything else is refused (it's rendered back into pages).
 */
export function cleanSignature(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const tokens = raw.match(/[MLml]|-?\d+(?:\.\d+)?/g)
  if (!tokens) return null
  const out: string[] = []
  let cmd: string | null = null
  let nums: number[] = []
  let points = 0
  const flush = () => {
    if (!cmd) return
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = Math.round(Math.max(0, Math.min(300, nums[i])))
      const y = Math.round(Math.max(0, Math.min(100, nums[i + 1])))
      out.push(`${i === 0 ? cmd.toUpperCase() : 'L'}${x} ${y}`)
      points++
    }
  }
  for (const t of tokens) {
    if (/^[MLml]$/.test(t)) {
      flush()
      cmd = t
      nums = []
    } else nums.push(Number(t))
  }
  flush()
  if (points < 4) return null // a dot isn't a signature
  const path = out.join('')
  return path.length <= 12000 ? path : null
}
