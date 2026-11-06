import type { AdultFact, KidFact } from './types'

export const KID: KidFact[] = [
  // t1 — crisp everyday claims (~age 4)
  { t: 1, q: 'The robot says: “Snow is hot.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only on Tuesdays'], why: 'Snow is cold! The robot made a mistake — good catch.', pic: '❄️' },
  { t: 1, q: 'The robot says: “Cows say moo.” Is the robot right?', a: 'Yes — right!', m: ['No — wrong!', 'Only on Tuesdays'], why: 'Moo! Cows really do say moo. The robot got this one right.', pic: '🐄' },
  { t: 1, q: 'The robot says: “Fish live in water.” Is the robot right?', a: 'Yes — right!', m: ['No — wrong!', 'Only at bedtime'], why: 'Fish swim and live in water — the robot is right!', pic: '🐟' },
  { t: 1, q: 'The robot says: “Dogs can fly.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only at bedtime'], why: 'Dogs run and jump, but they can’t fly. Silly robot!', pic: '🐶' },
  { t: 1, q: 'The robot says: “Ripe bananas are blue.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only in winter'], why: 'Ripe bananas are yellow. You can check by looking at one!', pic: '🍌' },
  { t: 1, q: 'The robot says: “You see with your ears.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only in winter'], why: 'You see with your eyes and hear with your ears. Oops, robot!', pic: '👀' },
  { t: 1, q: 'The robot says: “Ice is cold.” Is the robot right?', a: 'Yes — right!', m: ['No — wrong!', 'Only on Sundays'], why: 'Brrr! Ice is frozen water, and it is cold. Right, robot!', pic: '🧊' },
  { t: 1, q: 'The robot says: “Cats say woof.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only on Sundays'], why: 'Cats say meow — dogs say woof. The robot mixed them up.', pic: '🐱' },
  { t: 1, q: 'The robot says: “Birds have feathers.” Is the robot right?', a: 'Yes — right!', m: ['No — wrong!', 'Only at lunch'], why: 'Every bird has feathers. Good job, robot!', pic: '🐦' },
  { t: 1, q: 'If you are not sure something is true, you can ask…', a: 'a grown-up', m: ['a rock', 'a cookie'], why: 'Grown-ups can help you find out what is true. Asking is smart!', pic: '🙋' },

  // t2 — first checks and opinions (~age 5)
  { t: 2, q: 'The robot says: “A triangle has 4 sides.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only big ones'], why: 'Count them: a triangle has 3 sides. A square has 4.', pic: '🔺' },
  { t: 2, q: 'The robot says: “Plants need water to grow.” Is the robot right?', a: 'Yes — right!', m: ['No — wrong!', 'Only red ones'], why: 'Plants drink water through their roots. Right, robot!', pic: '🌱' },
  { t: 2, q: 'Which one is an OPINION?', a: 'Pizza is the best', m: ['Pizza is food', 'Pizza can be hot'], why: 'An opinion is what someone thinks or likes. Not everyone thinks pizza is the best!', pic: '🍕' },
  { t: 2, q: 'The robot says giraffes have long necks. How could you check?', a: 'Look in a book', m: ['Close your eyes', 'Guess loudly'], why: 'Books and grown-ups who know animals can help you check what is true.', pic: '🦒' },
  { t: 2, q: 'The robot says: “Frogs can hop.” Is the robot right?', a: 'Yes — right!', m: ['No — wrong!', 'Only on Mondays'], why: 'Frogs have strong back legs for hopping. The robot is right!', pic: '🐸' },
  { t: 2, q: 'The robot says: “2 plus 2 is 5.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only on Mondays'], why: '2 plus 2 is 4. Count it on your fingers to check the robot!', pic: '✌️' },
  { t: 2, q: 'Which one is just what someone THINKS — an opinion?', a: 'Dogs are the cutest', m: ['Dogs have 4 legs', 'Dogs can bark'], why: '“Cutest” is what someone feels. Legs and barking are facts you can check.', pic: '🐕' },
  { t: 2, q: 'The robot says: “Spiders have 8 legs.” Is the robot right?', a: 'Yes — right!', m: ['No — wrong!', 'Only baby ones'], why: 'Spiders have 8 legs. You can count them in a picture.', pic: '🕷️' },
  { t: 2, q: 'Can a robot helper ever make a mistake?', a: 'Yes, sometimes', m: ['No, never', 'Only when sleepy'], why: 'Robots and computers can be wrong, just like people. That’s why we check!', pic: '🤖' },
  { t: 2, q: 'The robot says: “The Sun comes out at night.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only on Fridays'], why: 'We see the Sun in the daytime. At night our side of Earth faces away from it.', pic: '☀️' },

  // t3 — subtler mistakes, facts vs opinions, first AI smarts (~age 6–7)
  { t: 3, q: 'The robot says: “Spiders are insects.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only big spiders'], why: 'Insects have 6 legs. Spiders have 8, so they are arachnids, not insects.', pic: '🕷️' },
  { t: 3, q: 'The robot says: “The Moon makes its own light.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only when full'], why: 'The Moon shines because sunlight bounces off it — like a giant mirror ball.', pic: '🌙' },
  { t: 3, q: 'The robot says: “Whales are mammals.” Is the robot right?', a: 'Yes — right!', m: ['No — wrong!', 'Only small whales'], why: 'Whales breathe air and feed their babies milk, so they are mammals, not fish.', pic: '🐋' },
  { t: 3, q: 'The robot says: “Bats are birds.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only at night'], why: 'Bats have fur and feed their babies milk — they are flying mammals!', pic: '🦇' },
  { t: 3, q: 'One of these is an opinion, not a fact. Which one?', a: 'Math is boring', m: ['Math uses numbers', '5 is more than 3'], why: 'Some people love math! “Boring” is a feeling, not a fact.', pic: '🔢' },
  { t: 3, q: 'Which one is a FACT?', a: 'A week has 7 days', m: ['Mondays are awful', 'Blue is the best'], why: 'You can check a calendar and count 7 days. The others are just feelings.', pic: '📅' },
  { t: 3, q: 'Where does a chatbot learn what it knows?', a: 'lots of examples', m: ['magic', 'it reads minds'], why: 'A chatbot learns from tons of writing people made — and some of that writing has mistakes.', pic: '📚' },
  { t: 3, q: 'Someone you don’t know online asks where you live. You should…', a: 'not tell them', m: ['tell them', 'send a map'], why: 'Keep your address private and tell a grown-up right away.', pic: '🔒' },
  { t: 3, q: 'The robot says: “The Earth is flat.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only on Fridays'], why: 'Earth is round like a ball — astronauts have taken pictures of it from space.', pic: '🌍' },
  { t: 3, q: 'The robot says: “A year has 12 months.” Is the robot right?', a: 'Yes — right!', m: ['No — wrong!', 'Only leap years'], why: 'January through December makes 12 months. Right, robot!', pic: '🗓️' },
  { t: 3, q: 'The robot gives an answer that sounds strange. What should you do?', a: 'check it', m: ['believe it', 'shout at it'], why: 'When something sounds odd, look it up or ask a grown-up before you believe it.', pic: '🔍' },

  // t4 — trickier claims, myths, faked pictures, privacy (~age 8–9)
  { t: 4, q: 'The robot says: “A tomato is a fruit, because it holds seeds.” Is the robot right?', a: 'Yes — right!', m: ['No — wrong!', 'Only green ones'], why: 'Scientists call any seed-holding part of a plant a fruit — so tomatoes count!', pic: '🍅' },
  { t: 4, q: 'The robot says: “Lightning never strikes the same place twice.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only in summer'], why: 'Tall buildings get hit by lightning many times every year. That saying is a myth.', pic: '⚡' },
  { t: 4, q: 'The robot says: “Penguins live at the North Pole.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only in winter'], why: 'Wild penguins live in the south, like Antarctica — none live at the North Pole. Polar bears live up north.', pic: '🐧' },
  { t: 4, q: 'The robot says: “Sound travels faster than light.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only loud sounds'], why: 'Light is way faster — that’s why you see lightning before you hear thunder.', pic: '🌩️' },
  { t: 4, q: 'The robot says: “Bats are blind.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only baby bats'], why: 'Bats can see! Many also use echoes to find bugs in the dark.', pic: '🦇' },
  { t: 4, q: 'The robot says: “An octopus has three hearts.” Is the robot right?', a: 'Yes — right!', m: ['No — wrong!', 'Only big ones'], why: 'It’s true! An octopus has three hearts — and blue blood, too.', pic: '🐙' },
  { t: 4, q: 'The robot says: “Goldfish remember things for only 3 seconds.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only orange ones'], why: 'Scientists have trained goldfish to remember things for months. That’s a myth!', pic: '🐠' },
  { t: 4, q: 'Can a computer make a fake photo that looks totally real?', a: 'Yes, it can', m: ['No, never', 'Only drawings'], why: 'Computers can make pictures and videos of things that never happened — so be a careful looker.', pic: '🖼️' },
  { t: 4, q: 'A chatbot asks for your password. You should…', a: 'never share it', m: ['type it in', 'say it twice'], why: 'Passwords are secret. Only you and your grown-ups should know them.', pic: '🔑' },
  { t: 4, q: 'Which question will get a robot to give you a BETTER answer?', a: 'a clear, exact one', m: ['a mumbly one', 'a one-word one'], why: 'The clearer your question, the better the answer. Say exactly what you want to know!', pic: '💬' },
  { t: 4, q: 'Ice cream sales and sunburns both go up in summer. Does ice cream cause sunburns?', a: 'No — the Sun does', m: ['Yes, it does', 'Only chocolate'], why: 'Two things can happen together because of a third thing — here, hot sunny days.', pic: '🍦' },

  // t5 — frontier: being the boss of your AI helper
  { t: 5, q: 'When you use an AI helper, who is in charge?', a: 'you are', m: ['the AI', 'nobody'], why: 'The AI is a helper. YOU decide what to do, and you check its work.', pic: '🧑‍✈️' },
  { t: 5, q: 'An AI says something in a very sure voice. Does that mean it’s true?', a: 'Not always', m: ['Yes, always', 'Only if loud'], why: 'An AI can sound sure and still be wrong. Sounding sure is not the same as being right.', pic: '🤔' },
  { t: 5, q: 'When an AI makes up a fact that sounds real, people call it a…', a: 'hallucination', m: ['vacation', 'celebration'], why: 'AI “hallucinations” are made-up answers that sound true — another reason to check!', pic: '🌀' },
  { t: 5, q: 'Two websites say different things. A smart fact-checker…', a: 'finds a 3rd source', m: ['picks the prettier', 'gives up'], why: 'Look for more trusted sources and see what most good ones agree on.', pic: '🕵️' },
  { t: 5, q: 'A video shows a dog talking just like a person. Most likely it was…', a: 'made by a computer', m: ['totally real', 'filmed on Mars'], why: 'Dogs can’t talk like people. Computers can make videos look real when they aren’t.', pic: '🎬' },
  { t: 5, q: 'The robot says: “People use only 10% of their brains.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only grown-ups'], why: 'Brain scans show we use all of our brain — just different parts for different jobs.', pic: '🧠' },
  { t: 5, q: 'An AI learned from pictures of ONLY black cats. Shown an orange cat, it might…', a: 'get it wrong', m: ['always be right', 'turn orange'], why: 'An AI only knows what it was shown. Missing examples means missing smarts.', pic: '🐈' },
  { t: 5, q: 'The robot says: “You can easily see the Great Wall of China from the Moon.” Is the robot right?', a: 'No — wrong!', m: ['Yes — right!', 'Only at night'], why: 'From the Moon, astronauts can’t pick out the wall with their eyes. It’s far too thin!', pic: '🧱' },
  { t: 5, q: 'The best way to test an idea is to…', a: 'do an experiment', m: ['vote on it', 'wish hard'], why: 'Scientists test ideas with experiments — what happens is the real answer.', pic: '🧪' },
  { t: 5, q: 'The robot says: “Diamonds and pencil lead are both made of carbon.” Is the robot right?', a: 'Yes — right!', m: ['No — wrong!', 'Only fake diamonds'], why: 'Both are carbon — the atoms are just stacked differently. Pencil “lead” is really graphite!', pic: '💎' },
  { t: 5, q: 'The robot says: “Some deep-sea fish make their own light.” Is the robot right?', a: 'Yes — right!', m: ['No — wrong!', 'Only on land'], why: 'Anglerfish and lanternfish glow in the dark deep sea. Nature’s flashlights!', pic: '🐡' },
]

export const ADULT: AdultFact[] = [
  // tier 1
  { tier: 1, q: 'Ice cream sales and drownings rise together. The most likely explanation is…', a: 'a third factor', m: ['ice cream', 'drownings'], why: 'Hot weather drives both — a confounder, not causation.' },
  { tier: 1, q: 'Seeking out only evidence that supports what you already believe is…', a: 'confirmation bias', m: ['anchoring', 'hindsight bias'], why: 'We notice, recall and favor confirming evidence while discounting the rest.' },
  { tier: 1, q: 'A language model stating a fluent but false “fact” is called a…', a: 'hallucination', m: ['jailbreak', 'overfit'], why: 'LLMs generate plausible text, not verified truth; fabricated citations are a classic case.' },
  { tier: 1, q: 'Reinforcing only the spots where returning WWII bombers had bullet holes would be…', a: 'survivorship bias', m: ['recency bias', 'base-rate neglect'], why: 'Abraham Wald’s point: the planes hit elsewhere never came back to be counted.' },
  { tier: 1, q: 'Relying too heavily on the first number you hear in a negotiation is…', a: 'anchoring', m: ['halo effect', 'sunk cost'], why: 'Initial values pull later estimates toward them, even when arbitrary.' },
  { tier: 1, q: 'Continuing a failing project because of what you already spent is the…', a: 'sunk cost fallacy', m: ['gambler’s fallacy', 'Dunning–Kruger'], why: 'Past costs are unrecoverable; only future costs and benefits should matter.' },
  { tier: 1, q: 'Believing a fair coin is “due” for heads after five tails is the…', a: 'gambler’s fallacy', m: ['sunk cost fallacy', 'straw man'], why: 'Independent trials have no memory; the next flip is still 50/50.' },

  // tier 2
  { tier: 2, q: 'A test is 99% accurate and the disease affects 1 in 10,000. A positive result most likely means…', a: 'a false positive', m: ['you have it', 'a 99% chance'], why: 'Per 10,000 people: ~1 true positive vs ~100 false positives — base rates dominate.' },
  { tier: 2, q: 'Trying analysis after analysis until one reaches p < 0.05 is called…', a: 'p-hacking', m: ['bootstrapping', 'meta-analysis'], why: 'Undisclosed forking paths inflate the false-positive rate far above 5%.' },
  { tier: 2, q: '“When a measure becomes a target, it ceases to be a good measure” is…', a: 'Goodhart’s law', m: ['Moore’s law', 'Murphy’s law'], why: 'Optimizing a proxy decouples it from the goal it stood for.' },
  { tier: 2, q: 'Hidden instructions in a web page that hijack an AI agent reading it are…', a: 'prompt injection', m: ['overfitting', 'data drift'], why: 'The model can’t reliably separate data from instructions, so untrusted content can steer it.' },
  { tier: 2, q: 'C2PA “Content Credentials” attach to a media file its…', a: 'signed provenance', m: ['watermark removal', 'faster rendering'], why: 'A cryptographically signed manifest records origin and edit history; absence proves nothing.' },
  { tier: 2, q: 'A trend that appears in every subgroup but reverses when the groups are combined is…', a: 'Simpson’s paradox', m: ['Zeno’s paradox', 'Fermi paradox'], why: 'Unequal group sizes and a lurking variable flip the aggregate (e.g. Berkeley admissions, 1973).' },
  { tier: 2, q: 'A model that memorizes its training data but fails on new data is…', a: 'overfitting', m: ['underfitting', 'regularized'], why: 'It learned the noise, not the signal; held-out validation exposes it.' },

  // tier 3
  { tier: 3, q: 'Athletes often slump after a record season mostly because of…', a: 'regression to mean', m: ['a cover jinx', 'lunar cycles'], why: 'An extreme result includes luck; the next measurement drifts back toward the average.' },
  { tier: 3, q: 'Twenty independent tests at α = 0.05, with no real effects anywhere, give how many false positives on average?', a: '1', m: ['0', '20'], why: '20 × 0.05 = 1 expected — hence corrections like Bonferroni.' },
  { tier: 3, q: 'Presenting a hypothesis formed after seeing the results as if it were planned is called…', a: 'HARKing', m: ['p-hacking', 'blinding'], why: 'Hypothesizing After the Results are Known — preregistration is the cure.' },
  { tier: 3, q: 'Generative models trained repeatedly on their own outputs tend toward…', a: 'model collapse', m: ['superintelligence', 'perfect recall'], why: 'Tails of the distribution vanish generation by generation and quality degrades.' },
  { tier: 3, q: 'Large language models read and write text as…', a: 'tokens', m: ['letters', 'pixels'], why: 'Subword tokens hide spelling from the model — why letter-counting tasks trip it up.' },
  { tier: 3, q: 'A file whose hash matches a trusted published hash has been shown to be…', a: 'unaltered', m: ['truthful', 'made by a human'], why: 'A hash proves integrity relative to the reference, not who made it or whether it’s true.' },
  { tier: 3, q: 'Among hospital patients two unrelated diseases look negatively correlated. Berkson’s paradox blames…', a: 'selection bias', m: ['reverse causation', 'placebo effect'], why: 'Conditioning on admission (having either disease) manufactures the correlation.' },
  { tier: 3, q: 'A game-playing AI rewarded for points circles forever collecting bonuses instead of finishing. This is…', a: 'reward hacking', m: ['hallucination', 'data poisoning'], why: 'The agent maximized the stated reward, not the intended goal — specification gaming (OpenAI’s CoastRunners).' },
]
