// Brain Ball — 💭 Big Think + 🚀 Big Projects (pure).
//
// Brian, Nov 9, sharing Demis Hassabis (DeepMind): rote learning belongs with
// a personalized AI at each child's own speed, and the human time should go
// to PEOPLE SKILLS, PROJECTS, ENTREPRENEURSHIP, CREATIVITY and JUDGMENT —
// "Make sure we are following the guidelines here for what we are pushing
// kids to learn."
//
// The quiz rounds are the personalized-AI half (adaptive, every answer has
// one right answer). These two are the other half, and on purpose they have
// NO right answer:
//   💭 Big Think — one open question a day (a tradeoff, a feeling, an
//      invention, a business idea). The kid picks, then has to tell a grown-up
//      WHY. Coins land when the grown-up says they talked it through — the
//      talking is the point, never the pick. Never moves a skill score.
//   🚀 Big Project — a real multi-day project (a lemonade stand, a game you
//      invent, a cardboard machine), one step a day, a grown-up confirms each
//      step, a finish bonus at the end.

import { dailyPick, isBigKid } from './missions'
import type { KidProfile } from './types'

export type ThinkKind = 'judgment' | 'people' | 'create' | 'business'

export interface Think {
  id: string
  kind: ThinkKind
  emoji: string
  /** the question, on screen and read aloud */
  ask: string
  /** two or three choices — every one is a fine answer */
  options: string[]
  /** what the grown-up asks next */
  why: string
  for: 'little' | 'big' | 'any'
}

export const THINK_KIND_WORDS: Record<ThinkKind, string> = {
  judgment: 'You decide',
  people: 'People',
  create: 'Invent it',
  business: 'Business idea',
}

export const THINK_COINS = 10
export const PROJECT_STEP_COINS = 10
export const PROJECT_FINISH_COINS = 30

export const THINKS: Think[] = [
  // 🧭 judgment — real tradeoffs
  { id: 'save-bike', kind: 'judgment', emoji: '🚲', ask: 'You have 5 dollars. Buy a small toy today, or save it to help buy a bike later?', options: ['Toy today', 'Save for the bike'], why: 'Why? What would you give up with each choice?', for: 'any' },
  { id: 'rain-game', kind: 'judgment', emoji: '🌧️', ask: 'Your team has a game, but it is starting to rain and thunder. Play anyway, or wait?', options: ['Play anyway', 'Wait it out', 'Go home'], why: 'What could go wrong? What matters most here?', for: 'any' },
  { id: 'cookie-now', kind: 'judgment', emoji: '🍪', ask: 'You can have one cookie now, or two cookies after dinner. Which do you pick?', options: ['One now', 'Two later'], why: 'Why? Is waiting hard? What helps you wait?', for: 'any' },
  { id: 'robot-says', kind: 'judgment', emoji: '🤖', ask: 'A robot tells you sharks live in your bathtub. What do you do?', options: ['Believe it', 'Check for myself', 'Ask a grown-up'], why: 'How can you tell if something is true?', for: 'any' },
  { id: 'two-friends', kind: 'judgment', emoji: '👫', ask: 'Two friends both want you to play a different game at recess. What do you do?', options: ['Pick one', 'Take turns', 'Find a game for all three'], why: 'Which way is fair? How would each friend feel?', for: 'big' },
  { id: 'broke-it', kind: 'judgment', emoji: '🏺', ask: 'You broke something by accident and nobody saw. What do you do?', options: ['Tell a grown-up', 'Try to fix it', 'Hide it'], why: 'What happens next with each choice? Which one would you want a friend to pick?', for: 'any' },
  { id: 'hard-puzzle', kind: 'judgment', emoji: '🧩', ask: 'A puzzle is really hard. Keep trying, ask for help, or take a break and come back?', options: ['Keep trying', 'Ask for help', 'Break, then back'], why: 'When is each one the smart choice?', for: 'any' },
  { id: 'team-pick', kind: 'judgment', emoji: '⚽', ask: 'You are picking a team. Pick your best friend, or the fastest runner?', options: ['Best friend', 'Fastest runner'], why: 'What makes a good team? Is it only speed?', for: 'big' },
  { id: 'gift-money', kind: 'judgment', emoji: '🎁', ask: 'Grandma gives you 10 dollars. Spend it, save it, or give some to someone who needs it?', options: ['Spend', 'Save', 'Give some'], why: 'Could you do a little of each? Which feels best?', for: 'big' },
  { id: 'map-lost', kind: 'judgment', emoji: '🗺️', ask: 'You are lost in a big store. What is the smartest thing to do?', options: ['Look for a worker', 'Stay where you are', 'Run and look'], why: 'Why is that the safest choice?', for: 'any' },
  { id: 'two-jobs', kind: 'judgment', emoji: '⏰', ask: 'You have time for only one: finish your Lego build, or help Dada fix the fence?', options: ['Finish the Lego', 'Help with the fence'], why: 'How do you decide what comes first?', for: 'big' },
  // ❤️ people — reading others, being a good teammate
  { id: 'sad-brother', kind: 'people', emoji: '😢', ask: 'Your brother is crying because his tower fell. What do you do?', options: ['Give him a hug', 'Help rebuild it', 'Give him space'], why: 'How can you tell what he needs?', for: 'any' },
  { id: 'new-kid', kind: 'people', emoji: '🙋', ask: 'There is a new kid sitting alone at lunch. What could you do?', options: ['Sit with them', 'Invite them to play', 'Say hi'], why: 'How would YOU feel on your first day?', for: 'any' },
  { id: 'lost-game', kind: 'people', emoji: '🏆', ask: 'Your team lost the game. What do you say to the other team?', options: ['Good game!', 'Nothing', 'We will beat you next time'], why: 'What does a good sport do? Why does it matter?', for: 'any' },
  { id: 'friend-wrong', kind: 'people', emoji: '🙊', ask: 'Your friend says something that is not true about another kid. What do you do?', options: ['Say that is not true', 'Tell a grown-up', 'Walk away'], why: 'Is it hard to stand up for someone? Why do it?', for: 'big' },
  { id: 'share-toy', kind: 'people', emoji: '🧸', ask: 'Your brother wants the toy you are playing with. What do you do?', options: ['Share now', 'Use a timer and take turns', 'Find him another toy'], why: 'Which way makes both of you happy?', for: 'any' },
  { id: 'say-sorry', kind: 'people', emoji: '🙏', ask: 'You were grumpy and yelled at someone. What do you do after?', options: ['Say sorry', 'Do something nice', 'Both'], why: 'What makes a sorry a real sorry?', for: 'any' },
  { id: 'lead-team', kind: 'people', emoji: '🧑‍✈️', ask: 'You are the captain and your team keeps arguing. What do you do?', options: ['Let everyone talk', 'Make a fair rule', 'Pick a plan and go'], why: 'What does a good leader do when people disagree?', for: 'big' },
  { id: 'thank-who', kind: 'people', emoji: '💌', ask: 'Who helped you today that you have not thanked yet?', options: ['Mom', 'Dada', 'My brother', 'A teacher'], why: 'What did they do? Go tell them thank you!', for: 'any' },
  // 🎨 create — invent something new
  { id: 'new-animal', kind: 'create', emoji: '🦄', ask: 'Invent a brand new animal! What does it look like most?', options: ['Wings and fur', 'Scales and stripes', 'Something totally different'], why: 'What does it eat? Where does it live? Draw it!', for: 'any' },
  { id: 'new-machine', kind: 'create', emoji: '🛠️', ask: 'Invent a machine to help Dada at work. What should it do?', options: ['Dig faster', 'Carry heavy things', 'Something new'], why: 'How would it work? What would you call it?', for: 'any' },
  { id: 'new-sport', kind: 'create', emoji: '🏅', ask: 'Make up a new sport! What is it like?', options: ['Ball game', 'Racing game', 'Something wild'], why: 'What are the rules? How do you win? Teach it to someone!', for: 'any' },
  { id: 'new-ending', kind: 'create', emoji: '📚', ask: 'Change the ending of your favorite story. What happens instead?', options: ['A happy surprise', 'A big twist', 'A funny ending'], why: 'Tell the new ending out loud!', for: 'big' },
  { id: 'fix-problem', kind: 'create', emoji: '💡', ask: 'Toys keep ending up all over the floor. Invent a way to fix that!', options: ['A toy-catching machine', 'A clean-up game', 'A new box idea'], why: 'How would it work? Could you build a small one?', for: 'any' },
  { id: 'new-planet', kind: 'create', emoji: '🪐', ask: 'You found a new planet! What is it like?', options: ['Made of candy', 'All water', 'Something else'], why: 'Who lives there? What is the weather like?', for: 'any' },
  { id: 'new-word', kind: 'create', emoji: '🗣️', ask: 'Make up a brand new word! What does it mean?', options: ['A feeling', 'A food', 'A thing that does not exist yet'], why: 'Say your word and use it in a sentence!', for: 'big' },
  { id: 'build-what', kind: 'create', emoji: '🏗️', ask: 'If you could build anything with a giant excavator, what would it be?', options: ['A giant pool', 'A secret tunnel', 'A whole new park'], why: 'What would you need? Draw the plan!', for: 'any' },
  // 💼 business — earning, customers, building something people want
  { id: 'lemonade-price', kind: 'business', emoji: '🍋', ask: 'You are selling lemonade. Charge 25 cents or 1 dollar a cup?', options: ['25 cents', '1 dollar'], why: 'Which sells more cups? Which makes more money? Can you figure it out?', for: 'big' },
  { id: 'what-sell', kind: 'business', emoji: '🏪', ask: 'If you started a business, what would you sell?', options: ['Something you make', 'Something you fix', 'A job you do for people'], why: 'Who would buy it? Why would they want it?', for: 'any' },
  { id: 'customer-mad', kind: 'business', emoji: '😠', ask: 'A customer says your cookie was burnt. What do you do?', options: ['Give a new cookie', 'Give their money back', 'Say sorry and fix the oven'], why: 'Why do happy customers matter?', for: 'big' },
  { id: 'need-help', kind: 'business', emoji: '🤝', ask: 'Your car-wash business has too many cars! What do you do?', options: ['Work faster', 'Hire your brother', 'Say no to some'], why: 'If you hire your brother, how do you pay him fairly?', for: 'big' },
  { id: 'make-better', kind: 'business', emoji: '⭐', ask: 'Nobody is buying your drawings. What do you try next?', options: ['Make them better', 'Lower the price', 'Find new people to show'], why: 'What would you test first? Why?', for: 'big' },
  { id: 'help-job', kind: 'business', emoji: '🧹', ask: 'What job could you do around the house to earn a coin?', options: ['Sweep', 'Feed the dog', 'Pick up sticks'], why: 'Ask a grown-up if they will hire you!', for: 'any' },
  { id: 'dada-business', kind: 'business', emoji: '🚜', ask: 'Dada runs a business. What do you think is the hardest part?', options: ['Finding customers', 'Doing the work', 'Paying everybody'], why: 'Ask Dada — what IS the hardest part?', for: 'any' },
]

export interface ProjectStep { title: string; say: string }
export interface Project {
  id: string
  emoji: string
  title: string
  /** what it trains, in a parent's words */
  builds: string
  steps: ProjectStep[]
  for: 'little' | 'big' | 'any'
}

export const PROJECTS: Project[] = [
  {
    id: 'lemonade', emoji: '🍋', title: 'Run a lemonade stand', builds: 'business · money · talking to customers', for: 'big',
    steps: [
      { title: 'Plan it: what, where, how much', say: 'Plan your lemonade stand! What will you sell, where will you set up, and how much will a cup cost?' },
      { title: 'Make a sign with the price', say: 'Make a big sign with your stand name and the price, so people can see it from far away.' },
      { title: 'Count what it costs to make', say: 'With a grown-up, figure out what the lemons, sugar and cups cost. That is your cost.' },
      { title: 'Open the stand and sell', say: 'Open your stand! Say hi to every customer and say thank you every time.' },
      { title: 'Count the money: did you make a profit?', say: 'Count the money. Take away what it cost. What is left is your profit! What would you do better next time?' },
    ],
  },
  {
    id: 'invent-game', emoji: '🎲', title: 'Invent a board game', builds: 'creativity · rules · teaching others', for: 'big',
    steps: [
      { title: 'Pick what your game is about', say: 'Pick what your game is about — racing, treasure, dinosaurs, anything!' },
      { title: 'Draw the board', say: 'Draw your game board on paper. Where do you start and where do you finish?' },
      { title: 'Write 3 rules', say: 'Make three rules. How do you move? How do you win? What happens if you land on a special space?' },
      { title: 'Play it with your family', say: 'Play your game with your family. Was anything unfair or confusing?' },
      { title: 'Fix one rule to make it better', say: 'Change one rule to make your game more fun. Real game makers test and fix, again and again!' },
    ],
  },
  {
    id: 'cardboard-truck', emoji: '🚚', title: 'Build a cardboard dump truck', builds: 'building · planning · fixing what breaks', for: 'any',
    steps: [
      { title: 'Draw your truck plan', say: 'Draw a plan of your dump truck. Where does the dirt go? Where are the wheels?' },
      { title: 'Find your materials', say: 'Find boxes, tape, cups and caps — those are your building materials.' },
      { title: 'Build the body and the bed', say: 'Build the truck body, then the bed that holds the dirt.' },
      { title: 'Make the bed dump', say: 'Make the bed tip up so it can dump! What can be the hinge?' },
      { title: 'Test it with a real load', say: 'Load it with rice or blocks and dump it! Did it work? What would you fix?' },
    ],
  },
  {
    id: 'bean-grow', emoji: '🌱', title: 'Grow a bean and track it', builds: 'science · patience · keeping records', for: 'any',
    steps: [
      { title: 'Plant a bean in a cup', say: 'Plant a bean in a cup with dirt or a wet paper towel. Put it by a window.' },
      { title: 'Guess how many days to sprout', say: 'Guess how many days until it sprouts. Write your guess down!' },
      { title: 'Water it and check it', say: 'Water it a little and look closely. Any changes?' },
      { title: 'Measure it with blocks or a ruler', say: 'Measure how tall it is. Use a ruler or count blocks!' },
      { title: 'Show your family what happened', say: 'Show your family your bean and tell them everything that happened. Was your guess right?' },
    ],
  },
  {
    id: 'family-news', emoji: '📰', title: 'Make a family newspaper', builds: 'interviewing · writing · telling a story', for: 'big',
    steps: [
      { title: 'Interview someone in the family', say: 'Interview someone! Ask them three questions about their day or when they were little.' },
      { title: 'Draw the front-page picture', say: 'Draw the big picture for your front page.' },
      { title: 'Write or tell the big story', say: 'Write the story, or tell it to a grown-up who writes it down for you.' },
      { title: 'Add a weather report', say: 'Look outside and add a weather report. Sunny? Rainy? What will tomorrow be?' },
      { title: 'Read it to the family at dinner', say: 'Read your newspaper to everyone at dinner!' },
    ],
  },
  {
    id: 'show', emoji: '🎭', title: 'Put on a show', builds: 'creativity · courage · working as a team', for: 'any',
    steps: [
      { title: 'Pick a story for your show', say: 'Pick a story for your show — a real one, or one you make up.' },
      { title: 'Pick who plays who', say: 'Pick who plays each part. Your brother? Stuffed animals?' },
      { title: 'Make a costume or a prop', say: 'Make one costume or one prop for the show.' },
      { title: 'Practice it once', say: 'Practice the show one time from start to end.' },
      { title: 'Put on the show for the family', say: 'Show time! Do your show for the family, and take a big bow!' },
    ],
  },
  {
    id: 'help-neighbor', emoji: '🏡', title: 'Help a neighbor', builds: 'people skills · service · following through', for: 'any',
    steps: [
      { title: 'Pick who to help and how', say: 'With a grown-up, pick a neighbor or friend to help, and decide how — a card, picking up sticks, a treat.' },
      { title: 'Make or get ready what you need', say: 'Get ready! Make the card, bake the treat, or find the tools.' },
      { title: 'Go help them', say: 'Go help! Look them in the eye and say hello.' },
      { title: 'Tell how it felt', say: 'Tell your family how it felt to help. How do you think they felt?' },
    ],
  },
  {
    id: 'tower-challenge', emoji: '🗼', title: 'Tallest tower engineering challenge', builds: 'engineering · testing · not giving up', for: 'little',
    steps: [
      { title: 'Build a tower with cups or blocks', say: 'Build the tallest tower you can with cups or blocks!' },
      { title: 'Measure it against you', say: 'Stand next to it. Is it taller than your knee? Your belly?' },
      { title: 'Try a wider bottom', say: 'Build it again with a wider bottom. Does it go higher?' },
      { title: 'Beat your best tower', say: 'Try to beat your tallest tower! Engineers try again and again.' },
    ],
  },
]

export function thinkPool(kid: Pick<KidProfile, 'birthdate' | 'isTester'>, now = new Date()): Think[] {
  const big = isBigKid(kid, now)
  return THINKS.filter((t) => t.for === 'any' || t.for === (big ? 'big' : 'little'))
}

/** today's Big Think — the same all day, each kid on their own cycle */
export function thinkFor(kid: Pick<KidProfile, 'id' | 'birthdate' | 'isTester'>, now = new Date()): Think {
  return dailyPick(kid.id, 'think', thinkPool(kid, now), now)
}

export function projectPool(kid: Pick<KidProfile, 'birthdate' | 'isTester'>, now = new Date()): Project[] {
  const big = isBigKid(kid, now)
  return PROJECTS.filter((p) => p.for === 'any' || p.for === (big ? 'big' : 'little'))
}

/**
 * The kid's current project: the one they are in the middle of, else the
 * next one in their pool they have not finished (round again once every
 * project is done).
 */
export function currentProject(kid: Pick<KidProfile, 'id' | 'birthdate' | 'isTester' | 'project' | 'projectsDone'>, now = new Date()): Project {
  const pool = projectPool(kid, now)
  const mid = kid.project ? PROJECTS.find((p) => p.id === kid.project!.id) : undefined
  if (mid && kid.project!.step < mid.steps.length) return mid
  const done = new Set(kid.projectsDone ?? [])
  const fresh = pool.filter((p) => !done.has(p.id))
  const list = fresh.length ? fresh : pool
  // the next one after the last finished, in a stable per-kid order
  return dailyPick(kid.id, `project:${(kid.projectsDone ?? []).length}`, list, new Date(0))
}

/** a project step confirmed: the new project state, coins and whether it finished. A day takes one step. */
export function advanceProject(
  kid: Pick<KidProfile, 'id' | 'birthdate' | 'isTester' | 'project' | 'projectsDone'>,
  day: string,
  now = new Date()
): { project: NonNullable<KidProfile['project']>; projectsDone: string[]; coins: number; finished: boolean; stepTitle: string; projectTitle: string } | null {
  // one step a day, whichever project it was on (finishing one doesn't open the next today)
  if (kid.project?.lastDay === day) return null
  const p = currentProject(kid, now)
  const st = kid.project && kid.project.id === p.id ? kid.project : { id: p.id, step: 0, lastDay: '' }
  if (st.lastDay === day || st.step >= p.steps.length) return null
  const step = st.step + 1
  const finished = step >= p.steps.length
  return {
    project: { id: p.id, step, lastDay: day },
    projectsDone: finished ? [...(kid.projectsDone ?? []).filter((x) => x !== p.id), p.id] : (kid.projectsDone ?? []),
    coins: PROJECT_STEP_COINS + (finished ? PROJECT_FINISH_COINS : 0),
    finished,
    stepTitle: p.steps[st.step].title,
    projectTitle: p.title,
  }
}
