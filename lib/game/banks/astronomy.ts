import type { AdultFact, KidFact } from './types'

export const KID: KidFact[] = [
  // t1 — Sun, Moon, stars, day and night, rockets, astronauts (~age 4)
  { t: 1, q: 'What is big, hot and bright up in the daytime sky?', a: 'the Sun', m: ['a cloud', 'a bird'], why: 'The Sun is a giant ball of fire-hot gas that lights up our day.', pic: '☀️' },
  { t: 1, q: 'What do astronauts ride into space?', a: 'a rocket', m: ['a bike', 'a boat'], why: 'Rockets blast off with a huge push of fire to get all the way up to space.', pic: '🚀' },
  { t: 1, q: 'Who flies up into space to explore?', a: 'astronauts', m: ['firefighters', 'farmers'], why: 'Astronauts are space explorers — they train for years to fly in rockets.', pic: '👩‍🚀' },
  { t: 1, q: 'What twinkles in the sky at night?', a: 'stars', m: ['puddles', 'shoes'], why: 'Stars are far, far away suns — so far they look like tiny sparkles.', pic: '✨' },
  { t: 1, q: 'When the sky is dark and the stars come out, it is…', a: 'nighttime', m: ['daytime', 'lunchtime'], why: 'Night is when our side of Earth turns away from the Sun.', pic: '🌃' },
  { t: 1, q: 'Is it ever okay to stare right at the Sun?', a: 'No — never!', m: ['Yes, all day', 'Yes, up close'], why: 'The Sun is so bright it can hurt your eyes. Never look right at it!', pic: '😎' },
  { t: 1, q: 'What do astronauts wear outside in space?', a: 'a space suit', m: ['a swimsuit', 'pajamas'], why: 'A space suit gives astronauts air to breathe and keeps them safe and warm.', pic: '🧑‍🚀' },
  { t: 1, q: 'What is the name of the planet we live on?', a: 'Earth', m: ['the Moon', 'the Sun'], why: 'We live on planet Earth — the only place we know with people, puppies and pizza!', pic: '🌍' },
  { t: 1, q: 'The Moon is made of…', a: 'rock and dust', m: ['cheese', 'cotton candy'], why: 'The Moon is a big ball of rock covered in gray dust — no cheese at all!', pic: '🌕' },
  { t: 1, q: 'Rockets go up, up, up into…', a: 'space', m: ['the ocean', 'the basement'], why: 'Way above the sky is space — dark, quiet and full of stars.', pic: '🌌' },
  { t: 1, q: 'What shape is a full Moon?', a: 'a circle', m: ['a square', 'a triangle'], why: 'The Moon is a round ball, so when it is all lit up it looks like a circle.', pic: '🌕' },

  // t2 — Earth spins, phases, orbits, telescopes (~age 5)
  { t: 2, q: 'Earth keeps spinning around and around. The spinning gives us…', a: 'day and night', m: ['rain and snow', 'birthdays'], why: 'When your side of Earth faces the Sun it is day; when it turns away it is night.', pic: '🌗' },
  { t: 2, q: 'When the Moon looks like a skinny banana, that shape is called a…', a: 'crescent', m: ['square', 'circle'], why: 'A crescent Moon is when we see just a thin slice of its sunny side.', pic: '🌙' },
  { t: 2, q: 'All the planets travel in big loops around…', a: 'the Sun', m: ['the Moon', 'a cloud'], why: 'The Sun is in the middle, and the planets circle it like kids around a campfire.', pic: '🪐' },
  { t: 2, q: 'Earth is a…', a: 'planet', m: ['star', 'comet'], why: 'Earth is a planet — a big round world that goes around a star, our Sun.', pic: '🌎' },
  { t: 2, q: 'What helps you see things far away in the night sky?', a: 'a telescope', m: ['a spoon', 'a hairbrush'], why: 'A telescope gathers lots of light so faraway things look bigger and brighter.', pic: '🔭' },
  { t: 2, q: 'When it is daytime for us, the far side of Earth has…', a: 'nighttime', m: ['daytime too', 'no time'], why: 'The Sun can only light up one side of Earth at a time — the other side is having night.', pic: '🌓' },
  { t: 2, q: 'Why do stars look so tiny?', a: 'they are far away', m: ['they are bugs', 'they are sparks'], why: 'Stars are huge, but they are SO far away that they look like little dots.', pic: '⭐' },
  { t: 2, q: 'Why do stars twinkle?', a: 'moving air', m: ['they blink', 'they wave'], why: 'The air above us wiggles and bends starlight, so the stars seem to twinkle.', pic: '✨' },
  { t: 2, q: 'What does a rocket need lots of to blast off?', a: 'fuel', m: ['a sail', 'pedals'], why: 'Rockets burn tons of fuel to make the giant push that shoves them into space.', pic: '🔥' },
  { t: 2, q: 'In outer space there is no…', a: 'air to breathe', m: ['dark at all', 'room at all'], why: 'Space has no air, so astronauts bring their own inside their suits and ships.', pic: '🫧' },

  // t3 — the planets, rings, galaxy, constellations (~age 6–7)
  { t: 3, q: 'How many planets go around our Sun?', a: '8', m: ['5', '20'], why: 'There are 8 planets: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus and Neptune.', pic: '🪐' },
  { t: 3, q: 'The biggest planet of all is…', a: 'Jupiter', m: ['Mars', 'Mercury'], why: 'Jupiter is SO big that more than a thousand Earths could fit inside it.', pic: '🟠' },
  { t: 3, q: 'Which planet has big, bright rings?', a: 'Saturn', m: ['Mercury', 'Mars'], why: 'Saturn’s rings are made of billions of chunks of ice and rock, all spinning around it.', pic: '🪐' },
  { t: 3, q: 'Which planet is closest to the Sun?', a: 'Mercury', m: ['Neptune', 'Earth'], why: 'Little Mercury zips around closest to the Sun — its year is only 88 days!', pic: '☀️' },
  { t: 3, q: 'Could you breathe on the Moon without a space suit?', a: 'No — no air', m: ['Yes, easily', 'Only at night'], why: 'The Moon has no air at all, so astronauts bring their own in their suits.', pic: '🌑' },
  { t: 3, q: 'Inside the space station, astronauts and their snacks…', a: 'float', m: ['melt', 'sink'], why: 'The station is always falling around Earth, so everything inside floats along with it.', pic: '🍫' },
  { t: 3, q: 'One whole trip of Earth around the Sun takes one…', a: 'year', m: ['day', 'minute'], why: 'Every birthday, you have ridden Earth all the way around the Sun one more time!', pic: '🎂' },
  { t: 3, q: 'A star picture in the sky, like the Great Bear, is called a…', a: 'constellation', m: ['comet', 'planet'], why: 'Long ago people connected the stars like dot-to-dots and gave the pictures names.', pic: '🐻' },
  { t: 3, q: 'Our home galaxy is called the…', a: 'Milky Way', m: ['Candy Way', 'Sun Road'], why: 'The Milky Way is a giant swirl of billions of stars — and our Sun is one of them.', pic: '🌌' },
  { t: 3, q: 'The first person to walk on the Moon was…', a: 'Neil Armstrong', m: ['George Washington', 'Thomas Edison'], why: 'Neil Armstrong stepped onto the Moon in 1969 — his footprints are still there!', pic: '👣' },
  { t: 3, q: 'Counting out from the Sun, Earth is planet number…', a: '3', m: ['1', '8'], why: 'Mercury is 1, Venus is 2, and Earth is 3 — not too hot, not too cold.', pic: '🌍' },

  // t4 — stars, light, eclipses, seasons, space station, rovers (~age 8–9)
  { t: 4, q: 'Compared with other stars, our Sun is…', a: 'medium-sized', m: ['the biggest', 'the tiniest'], why: 'Some stars are way bigger than our Sun and some are smaller — ours is right in the middle.', pic: '⭐' },
  { t: 4, q: 'Sunlight takes about how long to reach Earth?', a: '8 minutes', m: ['8 seconds', '8 days'], why: 'Light is super fast, but the Sun is so far away that its light needs about 8 minutes to get here.', pic: '⏱️' },
  { t: 4, q: 'A light-year is a way to measure…', a: 'distance', m: ['time', 'weight'], why: 'A light-year is how FAR light travels in one year — trillions of miles!', pic: '📏' },
  { t: 4, q: 'A black hole pulls so hard that even the fastest thing can’t escape. What is it?', a: 'light', m: ['a rocket', 'a comet'], why: 'Light is the fastest thing there is — and a black hole’s pull traps even light.', pic: '🕳️' },
  { t: 4, q: 'A comet is a ball of ice and dust. Near the Sun it grows a long…', a: 'glowing tail', m: ['set of wings', 'pair of legs'], why: 'The Sun warms the ice, and gas and dust stream away into a long shining tail.', pic: '☄️' },
  { t: 4, q: 'A solar eclipse happens when the Moon…', a: 'blocks the Sun', m: ['lands on Earth', 'melts away'], why: 'The Moon slides right between us and the Sun, and its shadow falls on Earth.', pic: '🌘' },
  { t: 4, q: 'We have summer and winter because Earth is…', a: 'tilted', m: ['closer in summer', 'spinning faster'], why: 'Earth leans to one side, so for part of the year our half gets more direct sunlight — that’s summer.', pic: '🌐' },
  { t: 4, q: 'The International Space Station circles Earth about every…', a: '90 minutes', m: ['week', 'year'], why: 'It zooms so fast that astronauts see about 16 sunrises every day!', pic: '🛰️' },
  { t: 4, q: 'Robot cars that drive around on Mars are called…', a: 'rovers', m: ['rockets', 'jets'], why: 'Rovers like Curiosity and Perseverance roll around Mars taking pictures and testing rocks.', pic: '🤖' },
  { t: 4, q: 'Mercury is closest to the Sun, but the HOTTEST planet is…', a: 'Venus', m: ['Mars', 'Neptune'], why: 'Venus has thick clouds that trap heat like a blanket — it is hot enough to melt lead!', pic: '🔥' },
  { t: 4, q: 'Which planet spins tipped over on its side?', a: 'Uranus', m: ['Earth', 'Mercury'], why: 'Uranus is tipped so far over that it rolls around the Sun like a ball.', pic: '🎳' },

  // t5 — frontier: big ideas in kid-honest words
  { t: 5, q: 'Scientists found that the whole universe is…', a: 'getting bigger', m: ['shrinking', 'standing still'], why: 'Galaxies keep spreading apart, like raisins in bread dough that is rising.', pic: '🎈' },
  { t: 5, q: 'The universe began with the Big Bang about how long ago?', a: '13.8 billion years', m: ['500 years', '1 million years'], why: 'Scientists measured the oldest light in space and worked out about 13.8 billion years.', pic: '💥' },
  { t: 5, q: 'Count every grain of sand on every beach on Earth. The stars in the universe might be…', a: 'even more', m: ['just ten', 'only a hundred'], why: 'There are so many galaxies, each with billions of stars, that the stars may even beat all the sand!', pic: '🏖️' },
  { t: 5, q: 'A planet that goes around a DIFFERENT star is called an…', a: 'exoplanet', m: ['asteroid', 'meteor'], why: 'Scientists have found thousands of exoplanets — some might even have oceans.', pic: '🪐' },
  { t: 5, q: 'The James Webb Space Telescope sees a light our eyes can’t, called…', a: 'infrared', m: ['X-rays', 'moonlight'], why: 'Infrared is like heat light — it lets Webb see through dust and spot the very first galaxies.', pic: '🔭' },
  { t: 5, q: 'Some new rockets do something amazing after launch. They…', a: 'land themselves', m: ['turn into cars', 'grow bigger'], why: 'Reusable rockets fly back down and land standing up, so they can fly again and again.', pic: '🚀' },
  { t: 5, q: 'Which two places are people planning to live on someday?', a: 'Moon and Mars', m: ['Sun and Venus', 'Jupiter and Saturn'], why: 'The Moon and Mars have solid ground to build on — the Sun and gas giants don’t.', pic: '🏠' },
  { t: 5, q: 'The Moon spins once for every trip around Earth, so we always see…', a: 'the same side', m: ['every side', 'no side'], why: 'Its spin and its trip match perfectly, so the same face always looks at us.', pic: '🌝' },
  { t: 5, q: 'Stars like our Sun are mostly made of…', a: 'hydrogen gas', m: ['firewood', 'melted rock'], why: 'Stars squeeze hydrogen into helium deep inside, and that makes their light.', pic: '⚛️' },
  { t: 5, q: 'The spacecraft that has traveled farthest from Earth is…', a: 'Voyager 1', m: ['Apollo 11', 'the Moon'], why: 'Voyager 1 launched in 1977 and is still flying out past the edge of the Sun’s bubble.', pic: '🛰️' },
  { t: 5, q: 'When a really giant star runs out of fuel, it can collapse into a…', a: 'black hole', m: ['comet', 'moon'], why: 'Its heavy center squeezes down so tight that its gravity traps even light.', pic: '🕳️' },
]

export const ADULT: AdultFact[] = [
  // tier 1
  { tier: 1, q: 'The Chandrasekhar limit, about 1.4 solar masses, is the maximum mass of a stable…', a: 'white dwarf', m: ['red giant', 'brown dwarf'], why: 'Above ~1.4 M☉ electron degeneracy pressure can no longer hold a white dwarf up.' },
  { tier: 1, q: 'The Kuiper belt lies beyond the orbit of…', a: 'Neptune', m: ['Mars', 'Jupiter'], why: 'It stretches from about 30 to 50 AU — home to Pluto and many icy bodies.' },
  { tier: 1, q: 'The main asteroid belt sits between Mars and…', a: 'Jupiter', m: ['Saturn', 'Earth'], why: 'Jupiter’s gravity kept that material from ever forming a planet.' },
  { tier: 1, q: 'One astronomical unit is roughly…', a: '150 million km', m: ['150,000 km', '1.5 billion km'], why: 'The mean Earth–Sun distance: about 149.6 million km, or 93 million miles.' },
  { tier: 1, q: 'Tidal locking is the reason the Moon…', a: 'shows one face', m: ['has no atmosphere', 'causes eclipses'], why: 'Its rotation period equals its orbital period, so one hemisphere always faces Earth.' },
  { tier: 1, q: 'Redshift in the light of distant galaxies shows they are…', a: 'receding', m: ['approaching', 'cooling'], why: 'Expansion stretches the light to longer wavelengths as it travels to us.' },
  { tier: 1, q: 'The nearest star system to the Sun is…', a: 'Alpha Centauri', m: ['Sirius', 'Betelgeuse'], why: 'About 4.2–4.4 light-years away; Proxima Centauri is its closest member.' },
  { tier: 1, q: 'Which planet has the shortest day?', a: 'Jupiter', m: ['Mercury', 'Earth'], why: 'Jupiter spins once in just under 10 hours despite its enormous size.' },

  // tier 2
  { tier: 2, q: 'Cepheid variables work as standard candles because their pulsation period reveals their…', a: 'luminosity', m: ['mass', 'age'], why: 'Leavitt’s period–luminosity relation gives true brightness; compare to apparent brightness for distance.' },
  { tier: 2, q: 'The James Webb Space Telescope orbits near which Lagrange point?', a: 'Sun–Earth L2', m: ['Earth–Moon L1', 'Sun–Earth L4'], why: 'L2, ~1.5 million km anti-sunward, keeps Sun, Earth and Moon behind its sunshield.' },
  { tier: 2, q: 'A Hertzsprung–Russell diagram plots luminosity against…', a: 'temperature', m: ['mass', 'distance'], why: 'Surface temperature (or color/spectral class) on the x-axis, reversed so hot stars sit left.' },
  { tier: 2, q: 'Kessler syndrome describes…', a: 'debris cascades', m: ['bone loss in orbit', 'solar flares'], why: 'Collisions create debris that causes more collisions, potentially making orbits unusable.' },
  { tier: 2, q: 'Hubble’s law says a galaxy’s recession speed is proportional to its…', a: 'distance', m: ['luminosity', 'metallicity'], why: 'v = H₀·d — twice as far, receding twice as fast.' },
  { tier: 2, q: 'One parsec is about…', a: '3.26 light-years', m: ['1 light-year', '1 AU'], why: 'The distance at which 1 AU subtends one arcsecond of parallax.' },
  { tier: 2, q: 'The cosmic microwave background was released about how long after the Big Bang?', a: '~380,000 years', m: ['~3 minutes', '~1 billion years'], why: 'At recombination neutral atoms formed and light could travel freely; minutes is nucleosynthesis.' },
  { tier: 2, q: 'Compared with the Sun, a much more massive main-sequence star lives…', a: 'a far shorter life', m: ['a far longer life', 'about as long'], why: 'Luminosity rises steeply with mass, so big stars burn their fuel in millions, not billions, of years.' },

  // tier 3
  { tier: 3, q: 'The Schwarzschild radius of a one-solar-mass black hole is about…', a: '3 km', m: ['3 m', '3,000 km'], why: 'r = 2GM/c² ≈ 2.95 km per solar mass.' },
  { tier: 3, q: 'Type Ia supernova surveys in 1998 showed that cosmic expansion is…', a: 'accelerating', m: ['decelerating', 'reversing'], why: 'Distant supernovae were fainter than expected — the evidence for dark energy (2011 Nobel).' },
  { tier: 3, q: 'Inside the Roche limit, a fluid-bodied moon is…', a: 'torn apart by tides', m: ['captured', 'ejected'], why: 'Tidal forces exceed the body’s self-gravity — a likely origin for ring systems.' },
  { tier: 3, q: 'The hydrogen 21-centimeter line comes from a…', a: 'spin-flip transition', m: ['n=2 to 1 jump', 'molecular rotation'], why: 'The electron and proton spins flip from parallel to antiparallel; n=2→1 is Lyman-alpha.' },
  { tier: 3, q: 'Puzzlingly, the Sun’s corona is far hotter than its…', a: 'photosphere', m: ['core', 'fusion zone'], why: 'The corona is over a million kelvin versus ~5,800 K at the surface — the coronal heating problem.' },
  { tier: 3, q: 'A neutron star is held up against collapse mainly by…', a: 'neutron degeneracy', m: ['radiation pressure', 'thermal pressure'], why: 'Pauli exclusion among neutrons (plus nuclear forces) resists gravity, up to the TOV limit.' },
  { tier: 3, q: 'Mercury’s extra perihelion precession of 43 arcseconds per century was explained by…', a: 'general relativity', m: ['planet Vulcan', 'solar oblateness'], why: 'Einstein’s 1915 calculation matched it exactly — an early triumph of GR.' },
  { tier: 3, q: 'The “Hubble tension” is a disagreement over…', a: 'the expansion rate', m: ['the Sun’s age', 'Pluto’s status'], why: 'Early-universe (CMB) and local distance-ladder measurements of H₀ differ by ~5σ.' },
]
