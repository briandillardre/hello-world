import type { AdultFact, KidFact } from './types'

export const KID: KidFact[] = [
  // t1 — rocks, dirt, digging (~age 4)
  { t: 1, q: 'Rocks feel…', a: 'hard', m: ['squishy', 'fluffy'], why: 'Rocks are hard all the way through — that’s why we build with them.', pic: '🪨' },
  { t: 1, q: 'Sand is made of tiny pieces of…', a: 'rock', m: ['sugar', 'paper'], why: 'Sand is rock broken into teeny tiny bits by waves and wind.', pic: '🏖️' },
  { t: 1, q: 'Dirt plus water makes…', a: 'mud', m: ['ice', 'milk'], why: 'Mix dirt and water and you get squishy, gooey mud!', pic: '🟤' },
  { t: 1, q: 'A mountain that can pour out hot lava is a…', a: 'volcano', m: ['waterfall', 'cloud'], why: 'A volcano lets super-hot melted rock out from deep inside the Earth.', pic: '🌋' },
  { t: 1, q: 'Which machine digs big holes in the dirt?', a: 'an excavator', m: ['an ambulance', 'a bike'], why: 'An excavator has a long arm and a bucket for digging — Dada’s company uses them!', pic: '🚜' },
  { t: 1, q: 'Where do worms live?', a: 'in the dirt', m: ['in clouds', 'in the sky'], why: 'Worms wiggle through the dirt and help make it good for plants.', pic: '🪱' },
  { t: 1, q: 'Drop it in a pond — which one sinks?', a: 'a rock', m: ['a leaf', 'a feather'], why: 'Rocks are heavy for their size, so they sink right to the bottom.', pic: '💦' },
  { t: 1, q: 'Plants push their roots down into the…', a: 'soil', m: ['air', 'sky'], why: 'Roots grab water and food from the soil to help the plant grow.', pic: '🌱' },
  { t: 1, q: 'A digger scoops dirt with its…', a: 'bucket', m: ['ladder', 'horn'], why: 'The bucket has teeth that bite into the dirt and scoop it up.', pic: '🏗️' },
  { t: 1, q: 'A tiny little rock is called a…', a: 'pebble', m: ['boulder', 'mountain'], why: 'A pebble is a small rock — a boulder is a giant one!', pic: '🪨' },

  // t2 — fossils, lava, quakes (~age 5)
  { t: 2, q: 'Bones from long ago that turned to stone are called…', a: 'fossils', m: ['crayons', 'shells'], why: 'Fossils show us animals that lived long ago — like dinosaurs!', pic: '🦖' },
  { t: 2, q: 'Lava is melted…', a: 'rock', m: ['chocolate', 'ice'], why: 'Deep inside Earth it is so hot that rock melts into glowing lava.', pic: '🌋' },
  { t: 2, q: 'When the ground shakes, it is an…', a: 'earthquake', m: ['eclipse', 'echo'], why: 'Earthquakes happen when giant pieces of the ground slip and shake.', pic: '🫨' },
  { t: 2, q: 'Sparkly rocks with flat, shiny sides are…', a: 'crystals', m: ['marbles', 'bubbles'], why: 'Crystals grow in neat shapes with flat sides that sparkle.', pic: '💎' },
  { t: 2, q: 'Sticky dirt you can shape into pots is…', a: 'clay', m: ['sand', 'gravel'], why: 'Clay is made of super-tiny bits that stick together when wet.', pic: '🏺' },
  { t: 2, q: 'River rocks are smooth because the water…', a: 'rubbed them', m: ['painted them', 'melted them'], why: 'Water tumbles rocks against each other for years until the sharp edges wear off.', pic: '🏞️' },
  { t: 2, q: 'A scientist who studies rocks is a…', a: 'geologist', m: ['dentist', 'baker'], why: 'Geologists study rocks to learn the story of the Earth.', pic: '🔍' },
  { t: 2, q: 'Hot water that shoots up out of the ground is a…', a: 'geyser', m: ['puddle', 'pond'], why: 'Underground heat boils the water until — WHOOSH — it blasts up!', pic: '⛲' },
  { t: 2, q: 'When rocks and dirt slide down a hill, it is a…', a: 'landslide', m: ['snowman', 'sandbox'], why: 'Lots of rain can loosen a hill until the dirt slides down.', pic: '⛰️' },
  { t: 2, q: 'Which one comes out of a hole in the ground called a mine?', a: 'gold', m: ['apples', 'bread'], why: 'Miners dig deep underground to find metals like gold.', pic: '⛏️' },

  // t3 — rock families, Earth's layers (~age 6–7)
  { t: 3, q: 'Rock made from cooled lava is…', a: 'igneous', m: ['sedimentary', 'metamorphic'], why: 'Igneous means "from fire" — it forms when melted rock cools and hardens.', pic: '🌋' },
  { t: 3, q: 'Rock made of sand and mud pressed in layers is…', a: 'sedimentary', m: ['igneous', 'metamorphic'], why: 'Sedimentary rock builds up layer on layer, like a stack of pancakes.', pic: '🥞' },
  { t: 3, q: 'Rock changed by heat and squeezing is…', a: 'metamorphic', m: ['igneous', 'sedimentary'], why: 'Metamorphic means "changed" — heat and pressure turn one rock into a new one.', pic: '🔥' },
  { t: 3, q: 'In layers of rock, the oldest layer is usually at the…', a: 'bottom', m: ['top', 'middle'], why: 'Each new layer lands on top, so the bottom one was there first.', pic: '📚' },
  { t: 3, q: 'Earth’s thin outside layer is the…', a: 'crust', m: ['core', 'mantle'], why: 'We live on the crust — it’s thin like the skin on an apple.', pic: '🍎' },
  { t: 3, q: 'The very center of the Earth is the…', a: 'core', m: ['crust', 'mantle'], why: 'The core is a giant ball of hot metal deep in the middle.', pic: '🌍' },
  { t: 3, q: 'Water and wind slowly wearing rock away is called…', a: 'erosion', m: ['eruption', 'explosion'], why: 'Erosion is slow — drip by drip and gust by gust, rock wears away.', pic: '💨' },
  { t: 3, q: 'The Grand Canyon was carved by the…', a: 'Colorado River', m: ['an earthquake', 'a giant'], why: 'Over millions of years the Colorado River cut down through the rock.', pic: '🏜️' },
  { t: 3, q: 'Precious stones like rubies are called…', a: 'gems', m: ['pebbles', 'fossils'], why: 'Gems are rare, beautiful minerals that get cut and polished.', pic: '💍' },
  { t: 3, q: 'A rock icicle hanging from a cave ceiling is a…', a: 'stalactite', m: ['stalagmite', 'snowflake'], why: 'Stalactites hold on tight to the ceiling; stalagmites grow up from the ground.', pic: '🦇' },
  { t: 3, q: 'Which of these is a mineral you eat?', a: 'salt', m: ['sugar', 'bread'], why: 'Salt is a real mineral that comes from the ground and the sea.', pic: '🧂' },

  // t4 — plates, soil, building (~age 8–9)
  { t: 4, q: 'Earth’s surface is broken into giant moving pieces called…', a: 'plates', m: ['tiles', 'bricks'], why: 'Tectonic plates slowly slide, bump and pull apart, making mountains and earthquakes.', pic: '🧩' },
  { t: 4, q: 'The Ring of Fire circles which ocean?', a: 'Pacific', m: ['Atlantic', 'Arctic'], why: 'Most of the world’s volcanoes and earthquakes are around the edge of the Pacific.', pic: '🔥' },
  { t: 4, q: 'Most fossils form when a dead animal is quickly…', a: 'buried in mud', m: ['frozen in sky', 'blown away'], why: 'Mud covers it, and over a long time minerals turn the bones to stone.', pic: '🦴' },
  { t: 4, q: 'Rocks slowly changing from one kind to another is the…', a: 'rock cycle', m: ['water slide', 'food chain'], why: 'Rocks melt, cool, break, squeeze and change — over and over.', pic: '🔄' },
  { t: 4, q: 'The dark top layer of dirt that plants love is…', a: 'topsoil', m: ['bedrock', 'lava'], why: 'Topsoil is full of old leaves and roots that feed plants.', pic: '🌿' },
  { t: 4, q: 'Builders scrape off topsoil before building because it…', a: 'squishes down', m: ['is too hard', 'is too hot'], why: 'Topsoil is soft and full of plant bits, so a building on it could sink.', pic: '🏗️' },
  { t: 4, q: 'Which lets rain drain through fastest?', a: 'sand', m: ['clay', 'concrete'], why: 'Sand has big gaps between its grains; clay grains pack tight and hold water.', pic: '💧' },
  { t: 4, q: 'Builders pack dirt down with rollers so it won’t…', a: 'sink later', m: ['grow grass', 'turn blue'], why: 'Squeezing out the air makes the ground strong enough to hold roads and buildings.', pic: '🛞' },
  { t: 4, q: 'The hardest natural mineral is…', a: 'diamond', m: ['gold', 'quartz'], why: 'Diamond is a 10 on the Mohs scale — it can scratch every other mineral.', pic: '💎' },
  { t: 4, q: 'The softest mineral on the Mohs scale is…', a: 'talc', m: ['diamond', 'quartz'], why: 'Talc is a 1 — so soft your fingernail can scratch it.', pic: '🪶' },
  { t: 4, q: 'Granite, a speckled rock found in South Carolina, formed from…', a: 'cooled magma', m: ['pressed sand', 'old shells'], why: 'Granite cooled slowly underground, which let its speckly crystals grow big.', pic: '🪨' },

  // t5 — frontier: big ideas
  { t: 5, q: 'About how old is the Earth?', a: '4.5 billion years', m: ['100 years', '45 million years'], why: 'Earth is about four and a half billion years old — scientists measure it with atoms in rocks.', pic: '🌍' },
  { t: 5, q: 'Continents move about as fast as your…', a: 'fingernails grow', m: ['bike rolls', 'car drives'], why: 'A few centimeters a year — too slow to feel, but over millions of years they cross oceans!', pic: '💅' },
  { t: 5, q: 'Geologists read rock layers like a…', a: 'history book', m: ['menu', 'joke book'], why: 'Each layer is a page telling what the Earth was like long ago.', pic: '📖' },
  { t: 5, q: 'The metals in phones and batteries come from…', a: 'mines', m: ['tree sap', 'the clouds'], why: 'Metals like copper and lithium are dug from the ground in mines.', pic: '🔋' },
  { t: 5, q: 'Geothermal energy uses heat from…', a: 'inside the Earth', m: ['the Moon', 'lightning'], why: 'Deep underground it’s hot, and that heat can warm homes and make electricity.', pic: '♨️' },
  { t: 5, q: 'Lidar measures the shape of the ground using…', a: 'laser light', m: ['sound', 'magnets'], why: 'Lidar bounces laser light off the ground to map every bump — Dada uses it to plan dirt work!', pic: '📡' },
  { t: 5, q: 'Long ago, all the continents were joined into one called…', a: 'Pangaea', m: ['Atlantis', 'Narnia'], why: 'Pangaea broke apart, and its pieces drifted into the continents we have today.', pic: '🧩' },
  { t: 5, q: 'Mount Everest grew tall because two plates…', a: 'crashed together', m: ['melted away', 'floated off'], why: 'India pushed into Asia and crumpled the land up into the Himalayas.', pic: '🏔️' },
  { t: 5, q: 'Seashell fossils on mountaintops show the rock was once…', a: 'under the sea', m: ['in space', 'on the Moon'], why: 'The rock formed on the sea floor and was later pushed way up high.', pic: '🐚' },
  { t: 5, q: 'Coal was made long ago from…', a: 'ancient plants', m: ['dinosaur bones', 'melted ice'], why: 'Swampy forests got buried and squeezed for millions of years into coal.', pic: '🌿' },
  { t: 5, q: 'Scientists tell a rock’s age using atoms that slowly…', a: 'break down', m: ['grow bigger', 'light up'], why: 'Some atoms change at a steady pace, like a ticking clock inside the rock.', pic: '⏳' },
]

export const ADULT: AdultFact[] = [
  { tier: 1, q: 'The most abundant mineral group in Earth’s crust is…', a: 'feldspar', m: ['quartz', 'mica'], why: 'Feldspars make up roughly half the crust; quartz is a distant second.' },
  { tier: 1, q: 'On the Mohs scale, quartz rates a…', a: '7', m: ['3', '10'], why: 'Quartz is 7 — harder than steel, which is why it scratches glass.' },
  { tier: 1, q: 'The boundary between the crust and the mantle is the…', a: 'Moho', m: ['Gutenberg', 'Lehmann'], why: 'The Mohorovičić discontinuity, where seismic waves abruptly speed up (1909).' },
  { tier: 1, q: 'Earth’s inner core is…', a: 'solid', m: ['liquid', 'gas'], why: 'Despite ~5,000 °C+, immense pressure keeps the iron-nickel inner core solid; the outer core is liquid.' },
  { tier: 1, q: 'The most abundant element in Earth’s crust by mass is…', a: 'oxygen', m: ['silicon', 'iron'], why: 'About 46% — bound up in silicate and oxide minerals.' },
  { tier: 1, q: 'Metamorphosed limestone becomes…', a: 'marble', m: ['slate', 'quartzite'], why: 'Heat and pressure recrystallize calcite into marble; slate comes from shale, quartzite from sandstone.' },
  { tier: 1, q: 'Basalt is the dominant rock of the…', a: 'ocean crust', m: ['continents', 'inner core'], why: 'Oceanic crust is basaltic, formed at mid-ocean ridges; continents are broadly granitic.' },

  { tier: 2, q: 'The angle of repose is the steepest slope at which a…', a: 'loose pile is stable', m: ['road is legal', 'rock will fracture'], why: 'Dry granular material slumps past it — roughly 30–40° for sand and gravel.' },
  { tier: 2, q: 'Atterberg limits describe how a fine soil behaves with changing…', a: 'water content', m: ['temperature', 'grain color'], why: 'Shrinkage, plastic and liquid limits mark the moisture contents where clay changes state.' },
  { tier: 2, q: 'A Proctor test finds the optimum moisture for maximum…', a: 'dry density', m: ['shear speed', 'pore size'], why: 'Compaction specs (e.g. 95% Standard Proctor) are written against that peak dry density.' },
  { tier: 2, q: 'Crust floating in buoyant balance on the mantle is called…', a: 'isostasy', m: ['subduction', 'diagenesis'], why: 'Thick crust rides high with deep roots; melting ice sheets let land rebound.' },
  { tier: 2, q: 'Where oceanic meets continental crust, the plate that sinks is the…', a: 'oceanic', m: ['continental', 'neither'], why: 'Denser basaltic oceanic lithosphere subducts beneath buoyant continental crust.' },
  { tier: 2, q: 'Carbon-14 can’t date dinosaur bones because they are…', a: 'too old', m: ['too hot', 'too salty'], why: 'With a ~5,730-year half-life, C-14 is gone after ~50,000 years; dinosaurs are 66+ million years old.' },
  { tier: 2, q: 'S-waves cannot pass through the outer core because it is…', a: 'liquid', m: ['too dense', 'magnetic'], why: 'Shear waves need rigidity; their shadow zone revealed the liquid outer core.' },

  { tier: 3, q: 'Plasticity index equals the liquid limit minus the…', a: 'plastic limit', m: ['shrinkage limit', 'void ratio'], why: 'PI = LL − PL, the moisture range over which the soil behaves plastically.' },
  { tier: 3, q: 'After three half-lives, what fraction of the parent isotope remains?', a: 'one eighth', m: ['one sixth', 'one third'], why: '½ × ½ × ½ = ⅛.' },
  { tier: 3, q: 'In the Unified Soil Classification System, CH means…', a: 'fat clay', m: ['clean gravel', 'silty sand'], why: 'C = clay, H = high plasticity (liquid limit 50 or more).' },
  { tier: 3, q: 'In Bowen’s reaction series, the first mineral to crystallize from mafic magma is…', a: 'olivine', m: ['quartz', 'muscovite'], why: 'Olivine forms at the highest temperatures; quartz and muscovite come last.' },
  { tier: 3, q: 'A Standard Proctor rammer drops 12 inches and weighs…', a: '5.5 lb', m: ['10 lb', '2 lb'], why: 'Standard: 5.5 lb from 12 in (ASTM D698); Modified: 10 lb from 18 in (D1557).' },
  { tier: 3, q: 'The Gutenberg discontinuity separates the mantle from the…', a: 'outer core', m: ['crust', 'inner core'], why: 'At ~2,900 km depth, P-waves slow sharply and S-waves vanish.' },
  { tier: 3, q: 'The half-life of uranium-238 is roughly…', a: '4.5 billion yrs', m: ['5,730 years', '1.3 billion yrs'], why: 'Close to Earth’s own age — about half of the planet’s original U-238 is still here.' },
  { tier: 3, q: 'The SPT N-value counts hammer blows for the last…', a: '12 inches', m: ['6 inches', '36 inches'], why: 'After a 6-inch seating drive, blows for the next two 6-inch increments are summed.' },
]
