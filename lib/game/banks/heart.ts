import type { AdultFact, KidFact } from './types'

export const KID: KidFact[] = [
  // t1 — naming feelings, manners, sharing (~age 4)
  { t: 1, q: 'Your tower fell down. You might feel…', a: 'sad', m: ['sleepy', 'hungry'], why: 'It’s okay to feel sad when something you made falls down. You can build it again!', pic: '🧱' },
  { t: 1, q: 'Your friend gives you a big hug. You might feel…', a: 'happy', m: ['angry', 'itchy'], why: 'Hugs from friends make us feel happy and loved.', pic: '🤗' },
  { t: 1, q: 'Thunder goes BOOM in the night. You might feel…', a: 'scared', m: ['bored', 'full'], why: 'Loud noises can feel scary. A grown-up can help you feel safe.', pic: '⛈️' },
  { t: 1, q: 'Someone grabs your toy without asking. You might feel…', a: 'mad', m: ['silly', 'cold'], why: 'Feeling mad is okay. Use your words: “Please give it back.”', pic: '😠' },
  { t: 1, q: 'What do you say when someone gives you a gift?', a: 'thank you', m: ['go away', 'oops'], why: 'Saying thank you shows you are happy they thought of you.', pic: '🎁' },
  { t: 1, q: 'What magic word do you say when you ask for something?', a: 'please', m: ['mine', 'no'], why: 'Please is a magic word — it makes asking kind.', pic: '✨' },
  { t: 1, q: 'You bumped your brother by accident. What do you say?', a: 'I’m sorry', m: ['you did it', 'nothing'], why: 'Saying sorry helps someone feel better, even when it was an accident.', pic: '🤕' },
  { t: 1, q: 'Your friend has no crayons. What can you do?', a: 'share yours', m: ['hide yours', 'laugh'], why: 'Sharing means you both get to color — that’s more fun!', pic: '🖍️' },
  { t: 1, q: 'Mom is carrying lots of bags. How can you help?', a: 'hold the door', m: ['run away', 'shout'], why: 'Helpers look for little ways to make a job easier.', pic: '🛍️' },
  { t: 1, q: 'Which face shows HAPPY?', a: 'a smile', m: ['a frown', 'a cry'], why: 'When we are happy, our mouth curls up into a smile.', pic: '😊' },
  { t: 1, q: 'Your friend is crying. How does your friend feel?', a: 'sad', m: ['silly', 'excited'], why: 'Tears often mean someone feels sad. You could ask, “Are you okay?”', pic: '😢' },

  // t2 — big feelings, friends, turns, truth (~age 5)
  { t: 2, q: 'You feel really mad. What is a good thing to do first?', a: 'take deep breaths', m: ['hit something', 'yell at someone'], why: 'Slow, deep breaths help your body calm down so you can think.', pic: '🌬️' },
  { t: 2, q: 'You are so upset you want to yell. What can help you calm down?', a: 'count to five', m: ['stomp on toys', 'slam a door'], why: 'Counting slowly gives your big feeling time to get smaller.', pic: '🖐️' },
  { t: 2, q: 'You feel upset. What helps people understand you?', a: 'use your words', m: ['hide forever', 'throw things'], why: 'When you say how you feel, people can help you.', pic: '🗣️' },
  { t: 2, q: 'Two kids both want the swing. What is fair?', a: 'take turns', m: ['push them off', 'cry loudly'], why: 'Taking turns means everyone gets to swing.', pic: '🛝' },
  { t: 2, q: 'You broke Mom’s cup by accident. What should you do?', a: 'tell the truth', m: ['hide it', 'blame the dog'], why: 'Telling the truth is brave, and grown-ups trust you more when you do.', pic: '☕' },
  { t: 2, q: 'Your friend falls and scrapes a knee. What do you do?', a: 'help them up', m: ['laugh at them', 'keep running'], why: 'A good friend stops to help when someone gets hurt.', pic: '🩹' },
  { t: 2, q: 'A good friend is someone who…', a: 'is kind to you', m: ['takes your toys', 'never shares'], why: 'Good friends are kind, share and play fair.', pic: '🧑‍🤝‍🧑' },
  { t: 2, q: 'Your little brother has waited a long time for the game. You can…', a: 'give him a turn', m: ['play all day', 'hide the game'], why: 'Giving someone a turn shows you care about them too.', pic: '🎮' },
  { t: 2, q: 'Someone helped you clean up. How can you show you are thankful?', a: 'say thank you', m: ['walk away', 'make a mess'], why: 'A thank-you tells people their help mattered.', pic: '🧹' },
  { t: 2, q: 'You feel nervous on the first day of school. What can help?', a: 'tell a grown-up', m: ['hide in a box', 'run outside'], why: 'Talking about a worried feeling makes it smaller, and grown-ups can help.', pic: '🏫' },
  { t: 2, q: 'Whalehogs never quit! When something is hard, you…', a: 'keep trying', m: ['quit', 'cry and stop'], why: 'Hard things get easier each time you try again.', pic: '🐋' },

  // t3 — kindness, promises, gratitude, grit, good sport (~age 6–7)
  { t: 3, q: 'A new kid is sitting alone at lunch. What is kind to do?', a: 'invite them over', m: ['point and stare', 'ignore them'], why: 'Being left out feels lonely. One invite can make someone’s whole day.', pic: '🍎' },
  { t: 3, q: 'You promised to play with your friend after school. You should…', a: 'keep your promise', m: ['pretend you forgot', 'say you never did'], why: 'Keeping promises is how friends learn they can count on you.', pic: '🤞' },
  { t: 3, q: 'You are stuck on a hard puzzle. What do Whalehogs say?', a: 'I’ll try again!', m: ['I can’t do it', 'puzzles are dumb'], why: 'We don’t say can’t! Every try teaches your brain something new.', pic: '🧩' },
  { t: 3, q: 'You lost the board game. What does a good sport do?', a: 'say “good game!”', m: ['throw the pieces', 'stomp off'], why: 'Good sports are fun to play with, whether they win or lose.', pic: '🎲' },
  { t: 3, q: 'Kids are teasing your friend. What can you do?', a: 'tell a grown-up', m: ['tease too', 'laugh along'], why: 'Standing up for a friend and getting a grown-up’s help is brave.', pic: '🛡️' },
  { t: 3, q: 'Gratitude means feeling…', a: 'thankful', m: ['grumpy', 'sleepy'], why: 'Gratitude is noticing the good things and people in your life.', pic: '🙏' },
  { t: 3, q: 'You have to wait in a long line. What helps most?', a: 'be patient', m: ['push ahead', 'whine loudly'], why: 'Patience means waiting calmly — your turn will come.', pic: '⏳' },
  { t: 3, q: 'You made a mistake on your drawing. What can you do?', a: 'fix it or try again', m: ['rip it up mad', 'never draw again'], why: 'Mistakes are part of making things. Artists fix and try again all the time.', pic: '🎨' },
  { t: 3, q: 'Your friend’s block tower fell. What could you say?', a: 'Let’s build again!', m: ['Ha ha!', 'Too bad for you'], why: 'Kind words help a friend bounce back from a bad moment.', pic: '🏗️' },
  { t: 3, q: 'You said something unkind. What makes it better?', a: 'say sorry', m: ['say it louder', 'pretend it’s fine'], why: 'A real sorry helps fix hurt feelings and shows you care.', pic: '💬' },

  // t4 — empathy, honesty, responsibility, teamwork, leading (~age 8–9)
  { t: 4, q: 'Imagining how someone else feels is called…', a: 'empathy', m: ['bragging', 'boredom'], why: 'Empathy means stepping into someone else’s shoes to feel what they feel.', pic: '💞' },
  { t: 4, q: 'You find a dollar a classmate dropped, and nobody saw. What is honest?', a: 'give it back', m: ['keep it', 'hide it'], why: 'Honest people do the right thing even when no one would ever know.', pic: '💵' },
  { t: 4, q: 'You forgot to feed the dog. What does a responsible kid say?', a: 'it was my fault', m: ['the dog ate fast', 'blame my brother'], why: 'Owning a mistake and fixing it is what responsible people do.', pic: '🐕' },
  { t: 4, q: 'Your team is building a fort. What makes the best team?', a: 'everyone helps', m: ['one kid does all', 'everyone argues'], why: 'Teams win when everyone pitches in and listens.', pic: '🏰' },
  { t: 4, q: 'You are the team leader. A good leader…', a: 'helps the team', m: ['bosses everyone', 'does nothing'], why: 'Great leaders listen, help and make everyone better — not just give orders.', pic: '🧭' },
  { t: 4, q: 'You say, “I’m bored!” What is a great idea?', a: 'make something', m: ['whine all day', 'bug your brother'], why: 'Boredom is a chance to invent, build or create something new.', pic: '🛠️' },
  { t: 4, q: 'Ava practices piano every day. Ben is talented but never practices. In a year, who likely plays better?', a: 'Ava', m: ['Ben', 'nobody'], why: 'Practice beats talent over time — every day of practice adds up.', pic: '🎹' },
  { t: 4, q: 'Friends dare you to climb onto the roof. What do you do?', a: 'say no thanks', m: ['climb anyway', 'go even higher'], why: 'Saying no to something unsafe is brave, even if friends are doing it.', pic: '🏠' },
  { t: 4, q: 'A teammate drops the ball and the team loses a point. What helps?', a: 'cheer them on', m: ['yell at them', 'quit the team'], why: 'Everyone makes mistakes. Encouragement helps a teammate do better next time.', pic: '⚽' },
  { t: 4, q: 'When someone is talking to you, a good listener…', a: 'lets them finish', m: ['talks over them', 'looks away'], why: 'Letting people finish shows you care about what they say.', pic: '👂' },

  // t5 — frontier: happiness, gratitude, growth, character, serving
  { t: 5, q: 'Scientists followed people for their whole lives. What made them happiest?', a: 'good friendships', m: ['lots of toys', 'being famous'], why: 'A study that ran over 80 years found close relationships matter most for a happy life.', pic: '👫' },
  { t: 5, q: 'Saying what you are thankful for each day tends to make you…', a: 'happier', m: ['grumpier', 'lonelier'], why: 'Noticing good things trains your brain to see more of them.', pic: '📓' },
  { t: 5, q: 'When you work hard on something hard, your brain…', a: 'gets stronger', m: ['gets weaker', 'shrinks'], why: 'Like a muscle, your brain grows stronger when you work on tough things.', pic: '🧠' },
  { t: 5, q: 'You can have one cookie now, or two if you wait. Waiting for the better thing takes…', a: 'self-control', m: ['luck', 'speed'], why: 'Waiting now for something better later is a superpower you can practice.', pic: '🍪' },
  { t: 5, q: 'The Golden Rule says: treat others the way you want to be…', a: 'treated', m: ['ignored', 'tickled'], why: 'If you want kindness, give kindness first.', pic: '⭐' },
  { t: 5, q: 'Your character shows most in what you do when…', a: 'no one is watching', m: ['you get a prize', 'it’s your birthday'], why: 'Character is doing the right thing even when nobody would know.', pic: '🦸' },
  { t: 5, q: 'Great leaders spend most of their time…', a: 'serving their team', m: ['being served', 'giving orders'], why: 'The best leaders help their team grow and succeed.', pic: '👑' },
  { t: 5, q: 'When you help someone, you usually feel…', a: 'happier too', m: ['grumpy', 'empty'], why: 'Helping others gives the helper a warm, happy feeling too.', pic: '🤝' },
  { t: 5, q: 'You get a new toy. After a few weeks, the excited feeling usually…', a: 'fades away', m: ['lasts forever', 'gets bigger'], why: 'New stuff feels exciting for a while, then it feels normal. Friends and fun times last longer.', pic: '🧸' },
  { t: 5, q: 'A mistake is really a chance to…', a: 'learn something', m: ['give up', 'hide'], why: 'Every mistake shows you something to do better next time.', pic: '💡' },
]

export const ADULT: AdultFact[] = [
  { tier: 1, q: 'The Harvard Study of Adult Development found the strongest predictor of happy, healthy aging was…', a: 'close relationships', m: ['income', 'IQ'], why: 'Relationship satisfaction at 50 predicted health at 80 better than cholesterol did, per director Robert Waldinger.' },
  { tier: 1, q: 'Self-determination theory’s three basic needs are autonomy, competence and…', a: 'relatedness', m: ['achievement', 'security'], why: 'Deci and Ryan argue intrinsic motivation thrives when people feel self-directed, capable and connected.' },
  { tier: 1, q: 'Carol Dweck contrasts a growth mindset with a…', a: 'fixed mindset', m: ['open mindset', 'closed loop'], why: 'A fixed mindset treats ability as innate; a growth mindset treats it as developable through effort and strategy.' },
  { tier: 1, q: 'Returning to a baseline level of happiness after big gains or losses is called…', a: 'hedonic adaptation', m: ['loss aversion', 'cognitive dissonance'], why: 'People adjust to new circumstances, so the joy of a raise or new house fades toward baseline.' },
  { tier: 1, q: 'In Martin Seligman’s PERMA model of well-being, the M stands for…', a: 'meaning', m: ['mindfulness', 'motivation'], why: 'PERMA: Positive emotion, Engagement, Relationships, Meaning, Accomplishment.' },
  { tier: 1, q: 'Angela Duckworth defines grit as passion combined with…', a: 'perseverance', m: ['talent', 'intelligence'], why: 'Grit is sustained passion and perseverance toward long-term goals.' },
  { tier: 1, q: 'Csikszentmihalyi’s term for total absorption in a challenging task is…', a: 'flow', m: ['arousal', 'mindfulness'], why: 'Flow emerges when challenge and skill are both high and well-matched.' },

  { tier: 2, q: 'Amy Edmondson’s term for a team belief that it is safe to take interpersonal risks is…', a: 'psychological safety', m: ['team cohesion', 'groupthink'], why: 'Edmondson found better hospital teams reported MORE errors — because people felt safe admitting them.' },
  { tier: 2, q: 'Who coined the term “servant leadership” in a 1970 essay?', a: 'Robert Greenleaf', m: ['Peter Drucker', 'Jim Collins'], why: 'Greenleaf’s “The Servant as Leader” argued the great leader is servant first.' },
  { tier: 2, q: 'Dunbar’s number, the rough limit of stable social relationships, is about…', a: '150', m: ['50', '500'], why: 'Robin Dunbar linked primate neocortex size to group size, predicting roughly 150 for humans.' },
  { tier: 2, q: 'A 2018 replication of the marshmallow test found its link to later achievement was…', a: 'much smaller', m: ['twice as large', 'exactly the same'], why: 'Watts, Duncan and Quan found a far weaker link, largely explained by family background and early ability.' },
  { tier: 2, q: 'John Gottman’s ratio of positive to negative interactions during conflict in stable couples is about…', a: '5 to 1', m: ['1 to 1', '20 to 1'], why: 'Stable couples showed about five positive interactions for each negative one, even while arguing.' },
  { tier: 2, q: 'Darley and Latané found that as the number of bystanders rises, each one’s chance of helping…', a: 'goes down', m: ['goes up', 'stays flat'], why: 'Diffusion of responsibility: everyone assumes someone else will act.' },
  { tier: 2, q: 'The Easterlin paradox concerns the weak long-run link between national happiness and…', a: 'income growth', m: ['population age', 'climate'], why: 'Easterlin found that as countries got richer over decades, average reported happiness often barely rose.' },

  { tier: 3, q: 'The Harvard Study of Adult Development began in what year?', a: '1938', m: ['1958', '1978'], why: 'It began with Harvard sophomores (the Grant Study) and later merged with the Glueck study of Boston youth.' },
  { tier: 3, q: 'Kahneman’s peak–end rule says we judge an experience mostly by…', a: 'its peak and end', m: ['its average moment', 'its total length'], why: 'In the cold-water studies, people preferred a longer trial that ended slightly less painfully — duration neglect.' },
  { tier: 3, q: 'Brickman and Campbell introduced the idea of the hedonic treadmill in…', a: '1971', m: ['1951', '1991'], why: 'Their 1971 essay argued improvements in circumstance are quickly absorbed into a new baseline.' },
  { tier: 3, q: 'In Festinger and Carlsmith’s 1959 study, subjects paid $1 to praise a dull task later rated it…', a: 'more enjoyable', m: ['less enjoyable', 'the same'], why: 'With too little reward to justify the lie, they reduced dissonance by changing their attitude.' },
  { tier: 3, q: 'Rewarding children for drawing, which they already enjoyed, tended to…', a: 'lower interest', m: ['higher interest', 'no change at all'], why: 'Lepper, Greene and Nisbett’s 1973 study showed the overjustification effect on intrinsic motivation.' },
  { tier: 3, q: 'A 2023 Killingsworth–Kahneman study found that, for most people, happiness above $100k…', a: 'keeps rising', m: ['plateaus', 'falls'], why: 'The adversarial collaboration found a plateau only among the least happy; for most, well-being kept rising with income.' },
  { tier: 3, q: 'In Google’s Project Aristotle, the factor that mattered most for team effectiveness was…', a: 'psychological safety', m: ['average IQ', 'team size'], why: 'Who was on the team mattered less than how members interacted — safety to speak up topped the list.' },
]
