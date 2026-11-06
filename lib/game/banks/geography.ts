import type { AdultFact, KidFact } from './types'

export const KID: KidFact[] = [
  // t1 — land, water, the shape of the world (~age 4)
  { t: 1, q: 'A map is a picture of…', a: 'a place', m: ['a song', 'a snack'], why: 'A map shows a place from way up high, like a bird looking down.', pic: '🗺️' },
  { t: 1, q: 'What shape is the Earth?', a: 'round', m: ['flat', 'square'], why: 'The Earth is round like a giant ball spinning in space.', pic: '🌍' },
  { t: 1, q: 'Where do you find sand and big waves?', a: 'the beach', m: ['a forest', 'a cave'], why: 'At the beach the ocean meets the sand, and the waves roll in.', pic: '🏖️' },
  { t: 1, q: 'Which one is very tall and rocky?', a: 'a mountain', m: ['a puddle', 'a field'], why: 'Mountains are giant piles of rock that reach up toward the clouds.', pic: '⛰️' },
  { t: 1, q: 'A river is made of moving…', a: 'water', m: ['grass', 'sand'], why: 'A river is water flowing downhill, all the way to a lake or the sea.', pic: '🏞️' },
  { t: 1, q: 'Where is it hot, dry and sandy?', a: 'a desert', m: ['a snowy hill', 'a lake'], why: 'Deserts get very little rain, so they stay dry and sandy.', pic: '🏜️' },
  { t: 1, q: 'Where is it snowy and freezing all year?', a: 'the North Pole', m: ['the beach', 'a jungle'], why: 'The North Pole is at the very top of the Earth, where it stays icy cold.', pic: '❄️' },
  { t: 1, q: 'Most of the Earth is covered with…', a: 'water', m: ['roads', 'sand'], why: 'Oceans cover most of our planet — that’s why Earth looks blue from space!', pic: '🌊' },
  { t: 1, q: 'Land with water all around it is called an…', a: 'island', m: ['ocean', 'road'], why: 'An island is land with water on every side — you need a boat or a bridge to get there.', pic: '🏝️' },
  { t: 1, q: 'Ocean water tastes…', a: 'salty', m: ['sweet', 'like juice'], why: 'The ocean is full of salt, so don’t drink it!', pic: '🧂' },

  // t2 — directions, continents, home (~age 5)
  { t: 2, q: 'How many continents are there?', a: '7', m: ['3', '12'], why: 'There are seven big pieces of land called continents.', pic: '🌏' },
  { t: 2, q: 'How many oceans are there?', a: '5', m: ['2', '9'], why: 'Five oceans — but they all connect into one giant world ocean.', pic: '🌊' },
  { t: 2, q: 'The sun comes up in the…', a: 'east', m: ['west', 'north'], why: 'Every morning the sun rises in the east.', pic: '🌅' },
  { t: 2, q: 'The sun goes down in the…', a: 'west', m: ['east', 'south'], why: 'Every evening the sun sets in the west.', pic: '🌇' },
  { t: 2, q: 'A ball-shaped model of the Earth is a…', a: 'globe', m: ['compass', 'kite'], why: 'A globe is round like the real Earth, so it shows the world the right shape.', pic: '🌐' },
  { t: 2, q: 'Our country is called…', a: 'the United States', m: ['Canada', 'Brazil'], why: 'We live in the United States of America!', pic: '🇺🇸' },
  { t: 2, q: 'We live in the state of…', a: 'South Carolina', m: ['Texas', 'Alaska'], why: 'Greenville is in South Carolina — our home state.', pic: '🌴' },
  { t: 2, q: 'A place with lots of tall buildings and people is a…', a: 'city', m: ['farm', 'forest'], why: 'Cities are packed with buildings, streets and people.', pic: '🏙️' },
  { t: 2, q: 'Where do cows live and crops grow?', a: 'a farm', m: ['a city', 'an ocean'], why: 'Farms have fields for crops and barns for animals.', pic: '🚜' },
  { t: 2, q: 'The opposite of north is…', a: 'south', m: ['east', 'up'], why: 'North and south are opposites, like east and west.', pic: '🧭' },

  // t3 — names and places (~age 6–7)
  { t: 3, q: 'What is the biggest ocean?', a: 'Pacific', m: ['Atlantic', 'Indian'], why: 'The Pacific is so big all the land on Earth could fit inside it!', pic: '🌊' },
  { t: 3, q: 'What is the biggest continent?', a: 'Asia', m: ['Europe', 'Australia'], why: 'Asia is the biggest continent, and more people live there than anywhere else.', pic: '🌏' },
  { t: 3, q: 'The capital of the United States is…', a: 'Washington, D.C.', m: ['New York City', 'Los Angeles'], why: 'Washington, D.C. is where the President lives, in the White House.', pic: '🏛️' },
  { t: 3, q: 'How many states are in the United States?', a: '50', m: ['13', '100'], why: 'Fifty states — that’s why the flag has fifty stars.', pic: '⭐' },
  { t: 3, q: 'Which country is right above the United States?', a: 'Canada', m: ['Mexico', 'Brazil'], why: 'Canada is our neighbor to the north.', pic: '🍁' },
  { t: 3, q: 'Which country is right below the United States?', a: 'Mexico', m: ['Canada', 'England'], why: 'Mexico is our neighbor to the south.', pic: '🌮' },
  { t: 3, q: 'The capital of South Carolina is…', a: 'Columbia', m: ['Charleston', 'Greenville'], why: 'Columbia, right in the middle of the state, is South Carolina’s capital.', pic: '🏛️' },
  { t: 3, q: 'Greenville sits near which mountains?', a: 'Blue Ridge', m: ['Rocky', 'Alps'], why: 'The Blue Ridge Mountains are just north of Greenville — they look blue from far away!', pic: '🏔️' },
  { t: 3, q: 'Which South Carolina city is on the ocean?', a: 'Charleston', m: ['Greenville', 'Columbia'], why: 'Charleston is on the coast, with beaches and big ships.', pic: '⚓' },
  { t: 3, q: 'The line around the middle of the Earth is the…', a: 'equator', m: ['axis', 'border'], why: 'The equator is a pretend line around Earth’s middle, like a belt.', pic: '🌍' },
  { t: 3, q: 'Places near the equator are mostly…', a: 'warm', m: ['freezing', 'snowy'], why: 'The sun shines strongest near the equator, so it stays warm.', pic: '☀️' },
  { t: 3, q: 'Which continent is at the South Pole?', a: 'Antarctica', m: ['Africa', 'Asia'], why: 'Antarctica is covered in ice, and penguins live along its edges.', pic: '🐧' },
  { t: 3, q: 'A compass rose on a map shows…', a: 'directions', m: ['the weather', 'the time'], why: 'The compass rose points to north, south, east and west.', pic: '🧭' },

  // t4 — map skills and the wide world (~age 8–9)
  { t: 4, q: 'The box that explains a map’s symbols is the…', a: 'key', m: ['title', 'compass'], why: 'The map key tells you what each little picture or color means.', pic: '🔑' },
  { t: 4, q: 'A map’s scale tells you…', a: 'how far', m: ['how hot', 'what time'], why: 'The scale shows how an inch on the map equals miles on the ground.', pic: '📏' },
  { t: 4, q: 'Lines that tell how far north or south you are are called…', a: 'latitude', m: ['longitude', 'altitude'], why: 'Latitude lines run side to side and count up from the equator.', pic: '🌐' },
  { t: 4, q: 'Which giant river flows down the middle of the United States?', a: 'the Mississippi', m: ['the Nile', 'the Thames'], why: 'The Mississippi runs from Minnesota all the way down to the sea.', pic: '🛶' },
  { t: 4, q: 'Which mountains are taller?', a: 'the Rockies', m: ['the Appalachians', 'the Ozarks'], why: 'The Rockies out west are younger and much taller than our old, worn-down Appalachians.', pic: '🏔️' },
  { t: 4, q: 'The pyramids of Egypt are on which continent?', a: 'Africa', m: ['Asia', 'Europe'], why: 'Egypt is in the top corner of Africa, along the Nile River.', pic: '🐫' },
  { t: 4, q: 'Mount Everest, the tallest mountain above the sea, is in…', a: 'Asia', m: ['Africa', 'Europe'], why: 'Everest is in the Himalayas, on the border of Nepal and China.', pic: '🏔️' },
  { t: 4, q: 'When it is noon in South Carolina, in California it is…', a: '9 in the morning', m: ['3 in the afternoon', 'midnight'], why: 'California is three time zones west, so its clocks are three hours behind ours.', pic: '🕘' },
  { t: 4, q: 'The United States is in the … hemisphere.', a: 'Northern', m: ['Southern', 'Middle'], why: 'We are north of the equator, so we live in the Northern Hemisphere.', pic: '🌎' },
  { t: 4, q: 'The Sahara, a giant hot desert, is in…', a: 'Africa', m: ['Australia', 'Europe'], why: 'The Sahara covers most of northern Africa — it’s almost as big as the whole United States.', pic: '🏜️' },

  // t5 — frontier: big ideas
  { t: 5, q: 'How does a phone know where it is?', a: 'satellites', m: ['the Moon', 'birds'], why: 'GPS satellites high above send signals, and the phone uses them to figure out its spot.', pic: '🛰️' },
  { t: 5, q: 'Dada’s trucks show on a live map because each one has a…', a: 'GPS tracker', m: ['tiny pilot', 'magic flag'], why: 'A tracker listens to satellites to learn where the truck is, then sends it to the map.', pic: '🚚' },
  { t: 5, q: 'Long ago, most big cities grew up next to…', a: 'water', m: ['volcanoes', 'deserts'], why: 'Rivers and coasts gave people water, food, and boats for trading.', pic: '⛵' },
  { t: 5, q: 'On many flat maps, Greenland looks way too…', a: 'big', m: ['small', 'hot'], why: 'Flat maps stretch places near the poles, so Greenland looks as big as Africa — but Africa is about 14 times bigger!', pic: '🗺️' },
  { t: 5, q: 'You can’t make a ball into a flat map without…', a: 'stretching it', m: ['painting it', 'freezing it'], why: 'Try flattening an orange peel — it rips and stretches. That’s why every flat map is a little wrong.', pic: '🍊' },
  { t: 5, q: 'Most things that come from faraway countries travel on…', a: 'giant ships', m: ['hot air balloons', 'bicycles'], why: 'Huge cargo ships carry boxes full of toys, shoes and food across the oceans.', pic: '🚢' },
  { t: 5, q: 'The internet crosses the ocean mostly through…', a: 'undersea cables', m: ['clouds', 'kites'], why: 'Long cables lie on the ocean floor and carry messages with light.', pic: '🌐' },
  { t: 5, q: 'When it is summer in South Carolina, in Australia it is…', a: 'winter', m: ['summer', 'spring'], why: 'Australia is in the other half of the world, so its seasons are flipped from ours.', pic: '🦘' },
  { t: 5, q: 'The equator is hot because the sun shines there…', a: 'straight down', m: ['only at night', 'sideways'], why: 'Sunlight hits the middle of Earth straight on, so it heats it the most.', pic: '☀️' },
  { t: 5, q: 'The Earth spins all the way around once every…', a: 'day', m: ['year', 'week'], why: 'One spin gives us one daytime and one nighttime.', pic: '🌍' },
]

export const ADULT: AdultFact[] = [
  { tier: 1, q: 'Which country is completely surrounded by South Africa?', a: 'Lesotho', m: ['Eswatini', 'Botswana'], why: 'Lesotho is an enclave; Eswatini also borders Mozambique.' },
  { tier: 1, q: 'The largest country by area is…', a: 'Russia', m: ['Canada', 'China'], why: 'Russia covers about 17 million km² — nearly twice Canada.' },
  { tier: 1, q: 'The line of 0° longitude is the…', a: 'Prime Meridian', m: ['Equator', 'Date Line'], why: 'It runs through Greenwich, England, by international agreement since 1884.' },
  { tier: 1, q: 'The largest island that is not a continent is…', a: 'Greenland', m: ['New Guinea', 'Borneo'], why: 'Greenland is about 2.17 million km²; New Guinea is second.' },
  { tier: 1, q: 'The capital of Australia is…', a: 'Canberra', m: ['Sydney', 'Melbourne'], why: 'Canberra was purpose-built as a compromise between Sydney and Melbourne.' },
  { tier: 1, q: 'The capital of Canada is…', a: 'Ottawa', m: ['Toronto', 'Montreal'], why: 'Queen Victoria chose Ottawa in 1857, partly as a compromise between English and French Canada.' },
  { tier: 1, q: 'The smallest country in the world by area is…', a: 'Vatican City', m: ['Monaco', 'San Marino'], why: 'Vatican City is about 0.44 km²; Monaco is roughly five times larger.' },

  { tier: 2, q: 'The shipping chokepoint between Malaysia and Sumatra is the Strait of…', a: 'Malacca', m: ['Hormuz', 'Gibraltar'], why: 'Malacca links the Indian Ocean to the South China Sea and carries a large share of world trade.' },
  { tier: 2, q: 'The largest lake on Earth by surface area is the…', a: 'Caspian Sea', m: ['Lake Superior', 'Lake Victoria'], why: 'The endorheic, brackish Caspian is about 370,000 km² — larger than Superior by a factor of four.' },
  { tier: 2, q: 'The Mercator projection preserves…', a: 'angles', m: ['areas', 'distances'], why: 'It is conformal — local shapes and bearings are true — at the cost of exploding area toward the poles.' },
  { tier: 2, q: 'The deepest known point in the ocean lies in the…', a: 'Mariana Trench', m: ['Puerto Rico Trench', 'Java Trench'], why: 'Challenger Deep is roughly 10,900 m down.' },
  { tier: 2, q: 'Counting overseas territories, the country spanning the most time zones is…', a: 'France', m: ['Russia', 'United States'], why: 'Territories from French Polynesia to Réunion give France 12 time zones; Russia has 11.' },
  { tier: 2, q: 'The lowest exposed land on Earth is the shore of the…', a: 'Dead Sea', m: ['Death Valley', 'Caspian Sea'], why: 'It sits more than 400 m below sea level, and is still dropping.' },
  { tier: 2, q: 'Which country is doubly landlocked?', a: 'Uzbekistan', m: ['Kazakhstan', 'Mongolia'], why: 'Every neighbor of Uzbekistan is itself landlocked; Liechtenstein is the only other one.' },

  { tier: 3, q: 'An endorheic basin is one whose water…', a: 'never reaches sea', m: ['flows uphill', 'is all frozen'], why: 'It drains internally to lakes or evaporation pans — the Great Basin, the Caspian, the Dead Sea.' },
  { tier: 3, q: 'Brazil borders every South American country except Chile and…', a: 'Ecuador', m: ['Peru', 'Bolivia'], why: 'Brazil touches nine countries plus French Guiana; only Chile and Ecuador are left out.' },
  { tier: 3, q: 'The Darién Gap breaks the Pan-American Highway between Panama and…', a: 'Colombia', m: ['Costa Rica', 'Venezuela'], why: 'Roughly 100 km of roadless rainforest and swamp separate the two continents’ road networks.' },
  { tier: 3, q: 'Which of these countries is NOT on the Pacific Ring of Fire?', a: 'Brazil', m: ['Chile', 'Indonesia'], why: 'Brazil sits on the stable interior of the South American Plate; Chile and Indonesia ride active subduction margins.' },
  { tier: 3, q: 'The Strait of Hormuz links the Persian Gulf to the…', a: 'Gulf of Oman', m: ['Red Sea', 'Caspian Sea'], why: 'From the Gulf of Oman tankers reach the Arabian Sea; the Red Sea is reached via Bab-el-Mandeb.' },
  { tier: 3, q: 'The southernmost national capital is…', a: 'Wellington', m: ['Canberra', 'Buenos Aires'], why: 'Wellington sits near 41°S, south of Canberra (~35°S) and Buenos Aires (~35°S).' },
  { tier: 3, q: 'The world’s deepest lake is…', a: 'Lake Baikal', m: ['Lake Tanganyika', 'Crater Lake'], why: 'Baikal reaches about 1,640 m and holds roughly a fifth of Earth’s unfrozen surface fresh water.' },
]
