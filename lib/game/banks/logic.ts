import type { AdultFact, KidFact } from './types'

export const KID: KidFact[] = [
  // t1 — what comes first, sorting, big/small (~age 4)
  { t: 1, q: 'What do you put on first, your socks or your shoes?', a: 'socks', m: ['shoes', 'both at once'], why: 'Socks go on first, then shoes go over them.', pic: '🧦' },
  { t: 1, q: 'Before you walk through a door, you…', a: 'open it', m: ['paint it', 'lock it'], why: 'You have to open the door first, or you’d bump into it!', pic: '🚪' },
  { t: 1, q: 'Apple, banana, car. Which one does not belong?', a: 'car', m: ['apple', 'banana'], why: 'Apples and bananas are fruits. A car is not a fruit!', pic: '🍎' },
  { t: 1, q: 'Which one is BIGGER?', a: 'an elephant', m: ['a mouse', 'a bug'], why: 'Elephants are huge — one of the biggest animals on land.', pic: '🐘' },
  { t: 1, q: 'To make a sandwich, what do you do first?', a: 'get the bread', m: ['take a bite', 'wash the plate'], why: 'You need the bread before you can build a sandwich.', pic: '🥪' },
  { t: 1, q: 'What comes first, the seed or the flower?', a: 'the seed', m: ['the flower', 'the fruit'], why: 'A seed grows into a plant, and then the flower blooms.', pic: '🌱' },
  { t: 1, q: 'Dog, cat, chair. Which one is NOT an animal?', a: 'chair', m: ['dog', 'cat'], why: 'Dogs and cats are animals. A chair is something you sit on.', pic: '🪑' },
  { t: 1, q: 'Which one is the SMALLEST?', a: 'an ant', m: ['a dog', 'a horse'], why: 'An ant is teeny tiny — it could sit on your fingertip.', pic: '🐜' },
  { t: 1, q: 'Before you go down the slide, you…', a: 'climb up', m: ['land at the bottom', 'go home'], why: 'First you climb up, then — whee! — you slide down.', pic: '🛝' },
  { t: 1, q: 'Wake up, eat breakfast, go to school. Which comes LAST?', a: 'go to school', m: ['wake up', 'eat breakfast'], why: 'You wake up, eat, and then head off to school.', pic: '🏫' },
  { t: 1, q: 'Before you eat a banana, you…', a: 'peel it', m: ['plant it', 'bake it'], why: 'The peel comes off first, then you eat the yummy inside.', pic: '🍌' },

  // t2 — everyday steps, if-then, patterns, opposites (~age 5)
  { t: 2, q: 'You put toothpaste on your brush. What comes next?', a: 'brush your teeth', m: ['buy toothpaste', 'go to sleep'], why: 'Toothpaste on, then brush, brush, brush!', pic: '🪥' },
  { t: 2, q: 'If it is raining, you take…', a: 'an umbrella', m: ['sunglasses', 'a sled'], why: 'An umbrella keeps the rain off you.', pic: '☔' },
  { t: 2, q: 'Red, blue, red, blue, red… what comes next?', a: 'blue', m: ['red', 'green'], why: 'The pattern goes red, blue, over and over — so blue is next.', pic: '🔴' },
  { t: 2, q: 'What is the opposite of hot?', a: 'cold', m: ['loud', 'big'], why: 'Hot and cold are opposites, like fire and ice.', pic: '🔥' },
  { t: 2, q: 'If you are thirsty, you…', a: 'drink water', m: ['take a nap', 'put on a hat'], why: 'When your body needs water, it makes you feel thirsty.', pic: '💧' },
  { t: 2, q: 'Circle, square, circle, square… what comes next?', a: 'circle', m: ['square', 'star'], why: 'The shapes take turns: circle, square, circle!', pic: '⭕' },
  { t: 2, q: 'What is the opposite of up?', a: 'down', m: ['fast', 'green'], why: 'Up and down are opposites — one goes high, one goes low.', pic: '⬆️' },
  { t: 2, q: 'If the traffic light is red, cars…', a: 'stop', m: ['go fast', 'fly away'], why: 'Red means stop, green means go.', pic: '🚦' },
  { t: 2, q: 'You put soap on your hands and scrub. What comes next?', a: 'rinse them off', m: ['put on gloves', 'add some dirt'], why: 'Soap, scrub, rinse, dry — clean hands!', pic: '🧼' },
  { t: 2, q: 'If it is very cold outside, you wear…', a: 'a warm coat', m: ['a swimsuit', 'flip-flops'], why: 'A coat keeps your body warm in the cold.', pic: '🧥' },
  { t: 2, q: 'One, two, three, four… what comes next?', a: 'five', m: ['seven', 'two'], why: 'Counting goes up by one each time: four, then five.', pic: '🖐️' },

  // t3 — exact robot instructions, order bugs, if-else, loops, turns (~age 6–7)
  { t: 3, q: 'A robot does EXACTLY what you tell it. To make a sandwich, it needs…', a: 'every step', m: ['one word', 'a nap'], why: 'Robots can’t guess. You must tell them each step: get bread, add peanut butter, and so on.', pic: '🤖' },
  { t: 3, q: 'The robot put its shoes on BEFORE its socks. What went wrong?', a: 'steps out of order', m: ['shoes too big', 'socks are red'], why: 'The steps were right, but the order was wrong. Order matters!', pic: '👟' },
  { t: 3, q: 'If it’s sunny, go to the park. If not, play inside. It’s raining. What do you do?', a: 'play inside', m: ['go to the park', 'go to sleep'], why: 'It isn’t sunny, so the “if not” part tells you what to do.', pic: '🌧️' },
  { t: 3, q: '“Clap three times” means clap, clap, clap. Doing a step again and again is a…', a: 'loop', m: ['bug', 'guess'], why: 'A loop repeats a step so you don’t have to say it over and over.', pic: '👏' },
  { t: 3, q: 'A robot faces right. It turns left. Now it faces…', a: 'up', m: ['down', 'right'], why: 'Facing right, a left turn points you up. Try it with your hand!', pic: '↩️' },
  { t: 3, q: 'The cookie is two steps away. You tell the robot, “Forward one.” Where does it stop?', a: 'one step short', m: ['at the cookie', 'past the cookie'], why: 'It only did what you said — one step. You needed to say two!', pic: '🍪' },
  { t: 3, q: 'Crack the eggs, stir, bake. Which step comes FIRST?', a: 'crack the eggs', m: ['bake', 'stir'], why: 'You crack the eggs first, then stir, then bake.', pic: '🥚' },
  { t: 3, q: '“If you finish your peas, you get dessert.” You finished your peas. Do you get dessert?', a: 'yes', m: ['no', 'only more peas'], why: 'The “if” part came true, so the “then” part happens too!', pic: '🫛' },
  { t: 3, q: 'You tell a robot, “Go to the kitchen,” but it doesn’t know the way. What should you do?', a: 'give clearer steps', m: ['yell louder', 'give up'], why: 'Clear steps like “forward five, turn left” help it get there.', pic: '🗺️' },
  { t: 3, q: '“Do this two times: jump, then spin.” How many jumps is that?', a: 'two', m: ['one', 'four'], why: 'Each time through you jump once, and you go through twice.', pic: '🤸' },
  { t: 3, q: 'Hop, hop, clap. Hop, hop, clap. Hop, hop, clap… what comes next?', a: 'hop', m: ['clap', 'spin'], why: 'After clap, the pattern starts over with hop.', pic: '🐇' },

  // t4 — debugging, algorithms, logic, sorting, breaking down (~age 8–9)
  { t: 4, q: 'Finding and fixing a mistake in a list of steps is called…', a: 'debugging', m: ['drawing', 'napping'], why: 'Programmers debug all the time — hunting for the step that went wrong.', pic: '🔍' },
  { t: 4, q: 'A list of steps that solves a problem is called an…', a: 'algorithm', m: ['alligator', 'allergy'], why: 'A recipe is an algorithm! So are the steps for tying your shoes.', pic: '📋' },
  { t: 4, q: 'All cats are animals. Tom is a cat. Is Tom an animal?', a: 'yes', m: ['no', 'can’t tell'], why: 'If ALL cats are animals, then Tom the cat must be one.', pic: '🐈' },
  { t: 4, q: 'All dogs are animals. Spot is an animal. Is Spot a dog?', a: 'can’t tell', m: ['yes', 'no'], why: 'Lots of animals aren’t dogs. Spot could be a horse or a fish!', pic: '🐾' },
  { t: 4, q: 'Your job is to clean your whole messy room. What is a smart way to start?', a: 'break it into steps', m: ['give up', 'cry about it'], why: 'Big jobs get easy when you do one small part at a time — toys, then clothes, then books.', pic: '🧺' },
  { t: 4, q: 'You sort toys by color AND size. Which goes in the big red pile?', a: 'a big red truck', m: ['a small red car', 'a big blue ball'], why: 'It has to match BOTH rules: big and red.', pic: '🚒' },
  { t: 4, q: 'You ask a helper, “Get me that thing,” and it brings the wrong thing. Why?', a: 'unclear words', m: ['it was tired', 'bad luck'], why: 'Clear words get better results — from people and from computers.', pic: '❓' },
  { t: 4, q: 'Put on helmet, ride bike, get bike out. Which step is in the wrong place?', a: 'get bike out', m: ['put on helmet', 'ride bike'], why: 'You can’t ride before you get the bike out! That step belongs before riding.', pic: '🚲' },
  { t: 4, q: 'Ann is taller than Bo. Bo is taller than Cy. Who is the shortest?', a: 'Cy', m: ['Ann', 'Bo'], why: 'Ann is tallest, then Bo, then Cy at the bottom.', pic: '📏' },
  { t: 4, q: 'When you tell an AI helper exactly what you want, you usually get…', a: 'better answers', m: ['worse answers', 'no answers'], why: 'AI follows your words, so clear, detailed words help it help you.', pic: '💬' },

  // t5 — frontier: code, AI, testing, AND/OR/NOT, bugs, recursion
  { t: 5, q: 'Computer code is really a list of…', a: 'instructions', m: ['magic spells', 'pictures'], why: 'Code tells a computer exactly what to do, one step at a time.', pic: '💻' },
  { t: 5, q: 'Most AI helpers are told what to do using…', a: 'words', m: ['hugs', 'snacks'], why: 'You talk or type to an AI, so choosing clear words really matters.', pic: '🗨️' },
  { t: 5, q: 'Before trusting a new plan, smart builders…', a: 'test it', m: ['just hope', 'hide it'], why: 'Testing finds problems early, before they cause a big mess.', pic: '🧪' },
  { t: 5, q: 'You may go out if you have shoes AND a coat. You have shoes but no coat. Can you go?', a: 'no', m: ['yes', 'twice'], why: 'AND means you need BOTH things. One is not enough.', pic: '🧥' },
  { t: 5, q: 'Dessert is cake OR pie. You picked pie. Did you follow the rule?', a: 'yes', m: ['no', 'only on Sunday'], why: 'OR means either one works.', pic: '🥧' },
  { t: 5, q: 'Pick a fruit that is NOT red.', a: 'a banana', m: ['a strawberry', 'a cherry'], why: 'NOT red means anything except red — a yellow banana fits!', pic: '🍓' },
  { t: 5, q: 'In 1947, Grace Hopper’s team found a real bug stuck inside a computer. What was it?', a: 'a moth', m: ['a spider', 'a worm'], why: 'They taped the moth into their notebook — the first real computer “bug”!', pic: '🦋' },
  { t: 5, q: 'A computer can only do what…', a: 'it is told', m: ['it wishes', 'it dreams'], why: 'Computers follow instructions — people write those instructions.', pic: '🖥️' },
  { t: 5, q: 'Inside each nesting doll is a smaller doll. When do you stop opening them?', a: 'at the tiniest one', m: ['never', 'at the biggest one'], why: 'You repeat the same step on smaller and smaller dolls until one can’t open. That stopping point is the key!', pic: '🪆' },
  { t: 5, q: 'An AI helper gives you an answer that seems wrong. A smart thinker…', a: 'checks it', m: ['always believes it', 'gets mad at it'], why: 'AI can make mistakes, so good thinkers check answers before trusting them.', pic: '🕵️' },
]

export const ADULT: AdultFact[] = [
  { tier: 1, q: 'By De Morgan’s laws, NOT (A AND B) is equivalent to…', a: 'NOT A OR NOT B', m: ['NOT A AND NOT B', 'A OR B'], why: 'Negating a conjunction flips it into a disjunction of negations.' },
  { tier: 1, q: 'In the Monty Hall problem, switching doors wins with probability…', a: '2/3', m: ['1/2', '1/3'], why: 'Your first pick is right 1/3 of the time; the host’s informed reveal concentrates the other 2/3 on the remaining door.' },
  { tier: 1, q: 'Binary search on a sorted list of n items runs in…', a: 'O(log n)', m: ['O(n)', 'O(n log n)'], why: 'Each comparison halves the remaining range.' },
  { tier: 1, q: '“If P then Q. Not Q. Therefore not P.” This valid form is called…', a: 'modus tollens', m: ['modus ponens', 'denying antecedent'], why: 'Modus tollens denies the consequent; modus ponens affirms the antecedent.' },
  { tier: 1, q: 'In a recursive function, the condition that stops further calls is the…', a: 'base case', m: ['edge case', 'test case'], why: 'Without a reachable base case, recursion never terminates and overflows the stack.' },
  { tier: 1, q: 'The contrapositive of “If P then Q” is…', a: 'if not Q, not P', m: ['if Q then P', 'if not P, not Q'], why: 'The contrapositive is logically equivalent; the converse and inverse are not.' },
  { tier: 1, q: 'A propositional statement true under every assignment of truth values is a…', a: 'tautology', m: ['contradiction', 'contingency'], why: 'E.g. “P or not P.” A contradiction is false under every assignment.' },

  { tier: 2, q: 'Cards show E, K, 4, 7. Rule: “If a vowel, then an even number on the back.” Which must you flip?', a: 'E and 7', m: ['E and 4', 'E only'], why: 'Wason’s task: only E and 7 can falsify the rule. Most people wrongly pick 4.' },
  { tier: 2, q: 'Who proved in 1936 that the halting problem is undecidable?', a: 'Alan Turing', m: ['Kurt Gödel', 'John von Neumann'], why: 'Turing’s diagonal argument shows no general program can decide whether any program halts.' },
  { tier: 2, q: 'An operation that has the same effect whether applied once or many times is…', a: 'idempotent', m: ['commutative', 'associative'], why: 'HTTP PUT and DELETE are meant to be idempotent, so safe retries don’t double the effect.' },
  { tier: 2, q: '“If P then Q. Q. Therefore P.” This invalid argument is called…', a: 'affirming consequent', m: ['modus tollens', 'begging the question'], why: 'Q could be true for other reasons; wet streets don’t prove it rained.' },
  { tier: 2, q: 'Quicksort’s average-case running time is…', a: 'O(n log n)', m: ['O(n)', 'O(n²)'], why: 'O(n²) is its worst case, e.g. with consistently bad pivots.' },
  { tier: 2, q: 'How many people are needed for a better-than-even chance two share a birthday?', a: '23', m: ['183', '57'], why: '23 people make 253 pairs; the probability crosses 50%. At 57 it is about 99%.' },
  { tier: 2, q: 'A well-sized hash table’s average lookup time is…', a: 'O(1)', m: ['O(log n)', 'O(n)'], why: 'Hashing jumps straight to a bucket; collisions degrade the worst case to O(n).' },

  { tier: 3, q: 'Gödel’s first incompleteness theorem says any consistent system capable of arithmetic contains…', a: 'unprovable truths', m: ['contradictions', 'no axioms'], why: 'Some true statements in such a system can never be proven within it.' },
  { tier: 3, q: 'Who first proved Boolean satisfiability NP-complete, in 1971?', a: 'Stephen Cook', m: ['Richard Karp', 'Donald Knuth'], why: 'Cook’s theorem (independently Levin); Karp then showed 21 more problems NP-complete in 1972.' },
  { tier: 3, q: 'The lower bound on comparisons for any comparison-based sort is…', a: 'Ω(n log n)', m: ['Ω(n)', 'Ω(n²)'], why: 'A decision tree must distinguish n! orderings, needing log₂(n!) ≈ n log n comparisons.' },
  { tier: 3, q: 'In Simpson’s paradox, a trend in every subgroup reverses when the…', a: 'groups are combined', m: ['sample is doubled', 'data is sorted'], why: 'A lurking variable unevenly distributed across groups flips the aggregate, as in the Berkeley admissions data.' },
  { tier: 3, q: 'A disease affects 1 in 1,000. A test catches 99% of cases with a 5% false-positive rate. A positive result means roughly…', a: 'a 2% chance', m: ['a 95% chance', 'a 50% chance'], why: 'About 1 true positive per ~51 positives: 0.00099 ÷ 0.051 ≈ 2%. Base rates dominate.' },
  { tier: 3, q: 'Russell’s paradox concerns the set of all sets that…', a: 'exclude themselves', m: ['contain everything', 'are empty'], why: 'If that set contains itself it shouldn’t, and if it doesn’t it should — breaking naive set theory.' },
  { tier: 3, q: 'Worst case, how many yes/no guesses find a number from 1 to 1,000,000 by halving?', a: '20', m: ['100', '1,000'], why: '2²⁰ = 1,048,576, so 20 halvings always suffice.' },
]
