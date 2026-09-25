// Gloamhollow — villager dialogue.
// Tokens available: {player} {item} {qty} {season} {weather} {day} {npc} {coins}
// A line is a string; use '|' to split it into dialogue pages (each page <= 150 chars).
//
// Voices at a glance:
//   corvin  — raven merchant; courtly, formal, ledger talk; "Caw" slips out when flustered.
//   morrow  — owl archivist; pedantic, gloomy, delighted by bones; "hoo" mid-sentence; loathes bugs.
//   bramble — badger smith; terse, gruff, soft-hearted; "Hrm."; stew is the answer.
//   mothwyn — moth lamplighter; shy, poetic, trailing ellipses; loves light, fears the dark.
//   grenna  — ancient goat hedge-witch; blunt, cryptic, dry; "Baaah."; eats the notice board.
//   fennick — one-eyed fox sailor; warm rogue, tall tales, sea talk; the fish keeps getting bigger.
//
// Running threads: Corvin & Morrow bicker over the better bird; Fennick's fish changes size
// with every teller; Bramble secretly mends Mothwyn's lantern posts ("a kind spirit");
// Grenna and Solveig's cauldron feud; Morrow tries very hard not to flinch around Mothwyn;
// the ship's bell on Fennick's beached longship, the Laughing Gull, tolls at midnight.
// Game notes: gift.already lines deliberately avoid {item}; role lines avoid tokens except
// corvin.role.debt_paid_partial ({coins}) and morrow.role.donate_new / donate_dupe ({item}).

export const DIALOGUE = {
  // ───────────────────────────────────────── CORVIN — raven, merchant & moneylender
  corvin: {
    intro: "Ah. You are awake. Splendid. For a moment I feared the sea had returned you as damaged goods.|Corvin, proprietor of Corvin's Curios. Merchant, moneylender and, as of your voyage here, your creditor. Welcome to Gloamhollow, {player}.|Your grandmother's croft lies to the south-west. Solveig kept it well. The weeds have since kept it better.|Now, a small matter of accounts. Your passage north, and your grandmother's unpaid dues... I took the liberty of settling both.|The sum is 3,000 coins, payable at my stall at your leisure. My leisure is considerable. It is not infinite.|Oh, do not look at me like that. I charge no interest. I am a merchant, not a monster. Caw— ahem. The sea air.|One more thing, {player}. After dark, stay near the fires. The mist here is not polite, and it does not pay its debts.",
    greet: {
      morning: [
        "Good morning, {player}. The fog has not yet finished its breakfast. I suggest we finish ours first.",
        "Ah, an early riser. Excellent. Early risers make prompt payers.",
        "Morning. I have been awake since the first gull. Commerce, like the dew, favours the punctual.",
        "The sun is attempting to rise again. Admirable persistence. I respect a creditor who never gives up.",
      ],
      day: [
        "{player}! Do come in. Metaphorically. It is a stall. There is no 'in.'",
        "Good day. Browsing, buying, or merely admiring my plumage? All three are welcome.",
        "Ah, my favourite debtor. Also my only debtor, but the title stands.",
        "Good afternoon. The light is thin today, but my prices are thinner.",
      ],
      evening: [
        "Evening, {player}. The lanterns are coming on. Mothwyn is as punctual as a tax.",
        "Ah, dusk. The hour when honest merchants close and dishonest ones open. I am closing, you will note.",
        "Good evening. Keep near the Hearth tonight. I should hate to lose a client to the fog.",
        "The day's ledger is nearly balanced. Unlike, forgive me, yours.",
      ],
      night: [
        "{player}. It is late. Even ravens roost, and we are notorious for bad habits.",
        "You should not wander at this hour. The Gloam never purchases anything. It merely takes.",
        "Listen. Hear how the mist hushes the waves? I dislike being hushed. Go home, dear {player}.",
        "Caw—! Ah. It is only you. Forgive me. I thought you were... never mind. Get inside.",
      ],
    },
    chat: [
      "Morrow insists owls are the wiser bird. Wisdom, {player}, is simply what you call staring until everyone else leaves.",
      "An owl keeps a museum. A raven keeps accounts. One of us, you will notice, can afford candles.",
      "Bramble once paid me in stew. I accepted. I am still not certain whether the debt was settled or deepened.",
      "Fennick says he lost his eye to a fish the size of a longship. Last month it was the size of a barn.|By winter it will be the size of an island, and he will claim to have farmed it.",
      "Mothwyn lights every lantern in the village at dusk. I offered her cheaper oil. She said the good oil 'burns kinder.'|Ruinous economics. Utterly charming. I sell it to her at cost. Do not repeat that.",
      "Grenna ate my price list again. I have begun writing them on slate.|She licked the slate, thoughtfully, while holding my gaze. I have never felt so threatened in my life.",
      "Shiny things are not a weakness, {player}. They are a philosophy. The world is dark; one collects what glints.",
      "I have traded on seven islands. Only this one ever kept me. I blame the damp. It gets into the feathers. And elsewhere.",
      "Your grandmother haggled like a storm. Once she talked me down to nothing, then paid me double.|I never understood her. I find I miss not understanding her.",
      "The tithe crate is a marvel of trust. You leave goods in a box, and in the night a raven leaves you coin. Do not think too hard about it.",
      "Mist is bad for business. Nobody browses when they cannot see the merchandise. Or their own feet.",
      "Amber, {player}. Sunlight that fell asleep in a tree and never woke. I find it reassuring, on grey days. Which is all of them.",
      "Morrow says he 'curates.' I say I 'curate for profit.' We have argued the distinction for twelve years. I am winning.",
      "Have you seen the notice board? Someone keeps eating it. I have my suspicions. They have horns.",
      "Why do ravens talk, {player}? Because someone must. Owls merely hoot and let you draw your own conclusions.",
      "I once sold Fennick a map to a sea-serpent's hoard. He found it: a drowned boot full of eels. He paid me in eels. Fair.",
      "Bramble grunts at me. Grenna glares. Morrow lectures. Mothwyn apologises, for reasons unknown. I adore this village.",
      "The Gloam? Mere weather with teeth. Do not trouble yourself. Buy a torch. Buy two. I have a sale on.",
      "I no longer fly over the Mistwood. The trees are too tall. That is the only reason. Caw. Moving on.",
      "A coin is only metal that agreed to mean something. A promise is much the same. I keep both. Scrupulously.",
      "A merchant must never love his stock. Which is why I do not love the brass lantern on the second shelf. At all.|It is for sale. Theoretically. Morrow has tried to buy it four times. The timing is never right.",
      "On clear nights, one used to see the fires of other isles across the water. Fewer each year.|Do not ask me why. I do not know. Caw. I do not.",
    ],
    weather: {
      clear: [
        "Clear skies! Shoppers love clear skies. They can see exactly how little they can afford.",
        "A rare, bright day. Enjoy it, {player}. Light, like credit, is not given freely here.",
      ],
      overcast: [
        "Overcast. The sky has drawn its curtains. How very discreet of it.",
        "Grey again. On Gloamhollow, grey is not a colour. It is a lifestyle.",
      ],
      fog: [
        "Fog. The Gloam grows bold in this soup. Stay in the light, {player}. I mean it. Truly. Caw.",
        "I cannot see my own stall. Should you find any goods wandering loose, they are mine. And overpriced.",
      ],
      rain: [
        "Rain. Excellent for your crops, ruinous for my feathers. Somewhere, a scale balances.",
        "The rain waters every field on the island for free. A shocking business model. I cannot compete.",
      ],
      storm: [
        "A storm! Hold onto your hat. And your coins. And, if at all possible, me.",
        "The sea is shouting again. Fennick calls it 'a bit of a squall.' Fennick also says fish grow to the size of longships.",
      ],
      snow: [
        "Snow. It covers everything in white and hides every flaw. A most honest liar.",
        "My talons are frozen to the counter. No, do not help. A merchant never admits to being stuck.",
      ],
    },
    season: {
      spring: [
        "The Thaw, at last. Seeds are selling well. Hope is the best-selling item of spring, and I stock it in bulk.",
        "Spring on Gloamhollow: the snow melts, the mud rises, and everyone suddenly remembers they owe me money.",
        "Plant turnips, {player}. They grow swiftly, sell steadily, and even Grenna cannot eat them all. She tries.",
      ],
      summer: [
        "Brightwane. The sun climbs almost to the treetops before it loses heart. We applaud its effort.",
        "Summer evenings linger a little. Mothwyn becomes almost cheerful. It is unsettling.",
        "Flax sells well in Brightwane. So does fish. So, if I may say, does charm. I have a warehouse of it.",
      ],
      autumn: [
        "Rotfall. The leaves rust and fall. A melancholy season. Excellent for pumpkin prices.",
        "Nightshade ripens in Rotfall. Poisonous and profitable. Grenna and I agree on very little, but we agree on that.",
        "The nights grow long in Rotfall. Buy torches. I say this as a friend, and also as a torch merchant.",
      ],
      winter: [
        "Deepfrost. Only frostroot dares to grow now. I admire its stubbornness. It reminds me of your grandmother.",
        "The longest nights of the year. The Hearth works hard in Deepfrost. So should we all.",
        "Fennick haunts the dock at midnight again, muttering about crowns. Winter makes fools of fishermen. Usually.",
      ],
    },
    hearts: {
      2: [
        "Most folk visit my stall only when they need something. You visit when you do not. I find it... unprofitable. And pleasant.",
      ],
      4: [
        "My family were couriers once. Ravens who carried news between the hearths of the northern isles.|Every island had a fire, {player}. Every fire had a raven. Now there are so few of either.",
      ],
      6: [
        "I lied, when I called the Gloam weather. I have watched hearths go out. Island after island.|I flew away each time. I did not fly away from this one. I am still deciding whether that was courage.",
      ],
      8: [
        "Your grandmother caught me once, a young fool with a broken wing, stealing from her garden.|She splinted the wing and charged me one turnip a week. I paid it for forty years. I cannot abide turnips. I never missed a week.",
        "The brass lantern on my second shelf was Solveig's. The stag broke it at the altar, long ago. I mended it.|It is not for sale, {player}. It was never for sale. I simply could not bear to say so to Morrow.",
      ],
      10: [
        "The dues I covered were never owed to me. They were the Hearth's old tithe. I paid so the rites would not lapse.|And I brought you here because Solveig asked me, the winter she died. 'Bring the child home, Corvin.'|I have never been good with things I cannot put a price on. You are one of them. Welcome home. ...Caw. Forgive me.",
      ],
    },
    gift: {
      loved: [
        "Oh. Oh my. {item}! {player}, this is exquisite. Caw— forgive me. I am rarely surprised by generosity.",
        "{item}... It glints just so. I shall not sell it. I shall not even appraise it. That is how you know it is love.",
        "For me? {item}? I— ahem. Your account is credited with my eternal regard. It is worth more than coin. Barely.",
      ],
      liked: [
        "{item}. A tasteful choice. You have an eye for quality, {player}. Two, in fact. Unlike Fennick.",
        "Ah, {item}! Very kind. I shall enter it in the ledger under 'gifts, cherished.'",
        "{item}? Thank you, {player}. I shall find it a place of honour, well away from the merchandise.",
      ],
      neutral: [
        "{item}. How... practical. Thank you, {player}.",
        "Ah. {item}. I shall find a use for it. A merchant always does.",
        "{item}? Thank you. It will sit on my shelf and think about what it has done.",
      ],
      disliked: [
        "{item}. How very... dull. Caw. I shall pretend to treasure it.",
        "Ah. {item}. You know, {player}, some things are priced low for a reason.",
        "{item}? I am a raven of refinement, {player}. Still, it is the thought that counts, and I have counted it.",
      ],
      already: [
        "Another gift? You will spoil me, {player}, and I am already quite spoiled. Tomorrow, perhaps.",
        "One gift a day is generous. Two is a bribe. I am, regrettably, above bribes. Today.",
        "I have already accepted your kindness today. A respectable raven keeps a respectable ledger.",
      ],
    },
    request: {
      ask: [
        "A small commission, {player}: could you fetch me {qty} {item}? I pay promptly. Mostly.",
        "A buyer on the mainland wants {qty} {item}. Bring them to me, and there is something in it for you.",
        "Would you find me {qty} {item}? Discreetly, if possible. Morrow must not learn I am diversifying.",
      ],
      thanks: [
        "Splendid! {item}, exactly as ordered. You are a far better supplier than my last one. He was a crab.",
        "The {item}! Marvellous. Consider this a transaction of mutual delight.",
        "Perfect. I shall remember this, {player}. Ravens always remember. It is our charm and our curse.",
      ],
      pending: [
        "Ah, {player}. Any luck with the {item}? I still need {qty}. No pressure. A little pressure.",
        "The {item}, {player}. {qty} of them. My buyer grows restless. I grow... patient-ish.",
        "I have cleared a space on the shelf for {qty} {item}. It looks terribly lonely.",
      ],
    },
    hearth: {
      1: ["The Hearth burns brighter tonight. I closed my stall early to look at it. Do not tell anyone. Bad for my reputation."],
      2: ["Two runes lit. The fog keeps its distance from my stall now. Business has never been so visible."],
      3: ["Halfway, {player}. I have watched many hearths die. I have never seen one come back. I find I cannot stop watching."],
      4: ["Four runes. The islands used to sing about fires like this. I had forgotten the tune. I remember it now."],
      5: ["Five. One more, {player}, and the Mistwood will stir. I have prepared a discount on torches. For courage."],
      6: [
        "All six runes burn. The altar is awake. I felt it from here, in my feathers. Caw.|Please come back, {player}. You still owe me a conversation.",
      ],
      dawn: [
        "The sun. The actual sun, {player}. I have not seen it rise over this island since I was a fledgling. I have nothing to sell you. Only thanks.",
        "Look at the light on the water. Like coins, only better. I never thought I would say anything was better than coins.",
      ],
    },
    role: {
      shop_open: [
        "Welcome to Corvin's Curios! Fine goods, fair prices, and a proprietor of impeccable plumage. Browse at your leisure.",
        "Ah, a customer! Seeds, supplies, curiosities. Everything a croft needs, and several things it does not.",
        "Step up, step up. Today's wares have been polished, appraised, and only slightly overpriced.",
      ],
      shop_closed: [
        "The stall is closed. Even merchants must roost. Return between eight in the morning and eight at night.",
        "Closed, I am afraid. Come back in the morning. Bring coin. Bring stories. Mostly coin.",
      ],
      debt_explain: [
        "Your account covers your passage north and your grandmother's old dues. Pay any amount, any day, here at my stall.|No interest. No deadline. Only my gentle, patient, ever-present presence. I will be right here. Always. Right here.",
      ],
      debt_paid_partial: [
        "Received with gratitude. Your balance now stands at {coins} coins. We are making progress, you and I.",
        "Payment noted, in my best ink. {coins} coins remain. I shall almost miss our arrangement when it ends.",
        "Splendid. {coins} coins to go. Solveig would be proud. She also paid in instalments. Very small ones.",
      ],
      debt_paid_full: [
        "And... that is the last coin. Your debt is paid in full, {player}. Caw! Forgive me. I am rarely moved by arithmetic.|The croft is yours, free and clear. Solveig would be... well. Never mind what she would be. I know what I am. Proud.",
      ],
      longhouse_offer: [
        "Now that your account is clear, might I propose a new venture? A longhouse. Proper timber, a proper hearth, room to breathe.|I have the plans, the builders and a very reasonable price. Your grandmother always wanted one. Shall we?",
      ],
      longhouse_built: [
        "Your longhouse stands! Oak beams, a turf roof and a hearth of your very own. It suits you. It suits Solveig's land.",
        "A longhouse at last. Your grandmother called the old hut 'cosy.' She meant 'draughty.' Enjoy the warmth, {player}.",
      ],
      tithe_crate: [
        "The crate by your door is the tithe crate. Leave anything you wish to sell inside before you sleep.|Overnight, I collect it and leave fair coin in its place. How, you ask? Trade secret. It mostly involves flying.",
      ],
      buy_thanks: [
        "A pleasure doing business. Do come again.",
        "Wrapped in the finest nothing. Enjoy your purchase, {player}.",
        "Sold! The coin is mine, the goods are yours, and the world is a little more balanced.",
      ],
      broke: [
        "Ah. Your purse is lighter than your ambitions, {player}. Come back when the two are better acquainted.",
        "That is beyond your means today, I am afraid. I do not extend credit. Well. Once. To you. It was a special occasion.",
        "Insufficient coin. Do not despair. The tithe crate awaits, and turnips never go out of fashion.",
      ],
      decor_unlocked: [
        "The Tithe is paid, and the Hearth took it gladly. In thanks, my decor catalogue is now open to you.|Banners, barrels, benches, beehives. A croft should look like someone loves it. Browse with abandon.",
      ],
    },
  },

  // ───────────────────────────────────────── MORROW — owl, Keeper of the Barrow
  morrow: {
    intro: "Hm? Oh. A visitor. Alive, by the look of you. How, hoo, refreshing. Most of my company has been dead for centuries.|I am Morrow: Keeper of the Barrow, Warden of the Graves, and Honorary Correspondent of the Northern Antiquarian Society.|I also chair its Gloamhollow chapter. Membership: one. The chapter treasury is a button.|You must be Solveig's grandchild. {player}, is it? You have her chin. I would know. I sketched it once, for posterity.|Forgive my manner. I spend my days with bones. They do not interrupt, they do not chew, and they never, hoo, flutter.",
    greet: {
      morning: [
        "Morning, {player}. I have not slept. Owls rarely do, and archivists never.",
        "Ah. Dawn, or what passes for it here. The light is, hoo, thin as vellum today.",
        "Good morning. I have been cataloguing dew. Do not ask. It was a long night.",
      ],
      day: [
        "Good day, {player}. Have you brought me anything ancient? Or, failing that, interesting?",
        "Ah, {player}. Mind the step. It is, hoo, older than the village and twice as crumbly.",
        "Afternoon. I was composing a monograph on the gradual decline of everything. It is going well.",
      ],
      evening: [
        "Evening. The hour of long shadows. My favourite, if I were permitted favourites.",
        "Good evening, {player}. The graves are especially quiet tonight. They are always especially quiet.",
        "Dusk. Mothwyn will be along with her lanterns soon. I shall try not to, hoo, flinch. For her sake.",
      ],
      night: [
        "Ah, {player}. Night is when I am at my best. The rest of you are merely, hoo, visiting it.",
        "Out late? Keep near the braziers. The dead of the Barrow are restful. The Gloam is not.",
        "Good night. Well, good night for me. For you it is probably a poor decision.",
      ],
    },
    chat: [
      "Corvin claims ravens are the cleverer bird. Ravens collect buttons, {player}. I collect civilisations.",
      "A raven is merely a crow who has hired a tailor. You may quote me. Corvin certainly will, hoo, furiously.",
      "Bones are marvellous. Honest, orderly, and they never, ever skitter. Unlike certain six-legged abominations.",
      "Bugs. Do not speak to me of bugs. Too many legs, too many, hoo, intentions. I accept them for science. Science owes me.",
      "Mothwyn is NOT a bug. She is a lepidopteran of letters. A colleague. I simply prefer to converse from a, hoo, generous distance.",
      "Bramble once offered me a bowl of stew. I asked what was in it. He said 'stew.' We have not spoken of it since.",
      "Fennick claims a fish the size of a longship took his eye. The largest fish on record is a pike of five feet.|I told him so. He winked at me. With the remaining eye. I found it deeply unscholarly.",
      "Grenna is older than several of my exhibits. I once asked her age. She told me 'yes.' I have been annotating it ever since.",
      "The graveyard is not frightening, {player}. It is a library in which every book has closed. Very, hoo, restful.",
      "I have catalogued every standing stone on the island. Twice. The second time, three of them had moved. I do not wish to discuss it.",
      "Runestones speak, if you let them. Most folk only walk past. Do stop and read them. The dead carved them for you.",
      "The Gloam dims more than light, you know. It dims memory. That is why I keep the Barrow. Someone must remember.",
      "I am often told I am 'gloomy.' I prefer 'appropriately informed about the inevitable.'",
      "Have you noticed the glinting cracks in the earth? Relics, {player}! History, rising like bubbles through a very slow bog.",
      "Every relic has a story. Most of them end with 'and then they died.' Still. The middles are lovely.",
      "Your grandmother donated a spoon to the Barrow once. Then she borrowed it back for her porridge. Then donated it again.|Eleven times. The card still reads 'Spoon (Solveig's, currently).' I find I cannot bring myself to change it.",
      "I do not own a single candle. Owls see perfectly well in the dark. I borrow one of Mothwyn's, some nights. For the company.",
      "The Northern Antiquarian Society has not written back in nine years. I assume their letters are, hoo, merely very thorough.",
      "Porridge is the perfect food. Grey, warm, uncomplicated. Like a good footnote.",
      "Mothwyn once wrote me a poem about a skull. It was very beautiful. I wept. I have not told her. Do not tell her.",
      "Corvin keeps a brass lantern he claims is for sale. I have tried to buy it four times. He always finds a reason not to sell. Curious.",
      "When I was an owlet, a beetle crawled into my ear during a lecture. I have not forgiven the entire order Coleoptera.",
      "The sea keeps things, {player}. Crowns, bells, ships, sailors. One day I shall catalogue it all. The sea will not cooperate.",
    ],
    weather: {
      clear: [
        "Clear skies. Dreadful. Everything is so, hoo, visible.",
        "A bright day. Excellent for reading runestones, if one can bear the glare.",
      ],
      overcast: [
        "Overcast. Ideal. The light is soft, the shadows are modest, and the insects are, hoo, sluggish.",
        "Grey skies are the scholar's friend. No glare on the page. No temptation to go outside.",
      ],
      fog: [
        "Fog. The Gloam is bolder in fog, {player}. So are the dead, in the old stories. Keep to the paths.",
        "I cannot see the graves in this fog. I know they are there. I count them anyway. It is soothing.",
      ],
      rain: [
        "Rain. It brings the worms up. And the beetles. And the, hoo, other beetles. I shall stay under the lintel.",
        "The rain washes the runes clean. They are grateful. It is the only cleaning they receive.",
      ],
      storm: [
        "A storm. The barrow-mound has survived eight hundred of them. I have survived, hoo, rather fewer. Indoors, I think.",
        "Thunder! Our ancestors believed it was a god hitting things with a hammer. Bramble believes the same of himself.",
      ],
      snow: [
        "Snow on the barrow-mound. It looks almost... tidy. I approve.",
        "Snow preserves, {player}. It keeps things. Like a museum, only colder and far less organised.",
      ],
    },
    season: {
      spring: [
        "The Thaw. The earth softens and gives up its secrets. Also its beetles. I have mixed feelings.",
        "Spring is excellent for digging. The ground is soft and the relics are, hoo, practically volunteering.",
        "I pressed a Thaw flower once, between the pages of a book on grave-goods. It seemed fitting.",
      ],
      summer: [
        "Brightwane. The worst season. Bright, loud, and positively writhing with dragonflies.",
        "Summer nights are so brief. I barely have time to brood before the sky turns pale again. Hoo. Unfair.",
        "The Fen Dragonfly is abroad in summer. Four wings. Who needs four wings? It is, hoo, showing off.",
      ],
      autumn: [
        "Rotfall. Now THIS is a season. Everything decays with such dignity.",
        "The leaves fall, the days shorten, the fog thickens. I feel, hoo, alive. Relatively speaking.",
        "Autumn nights bring the Ghost Carp to Blackwater, they say. Pale as a lost thought. I should like one for the collection.",
      ],
      winter: [
        "Deepfrost. The long dark. The Barrow has seen many winters. It tells me this one, too, will, hoo, pass.",
        "Frost on the runestones makes the carving stand out like silver. The dead, it seems, wished to be read in winter.",
        "Winter is the season of stories. Fennick tells worse ones in the cold. I did not think it was possible.",
      ],
    },
    hearts: {
      2: [
        "You listen when I speak, {player}. Genuinely listen. Most folk glaze over at the, hoo, second footnote. I am touched.",
      ],
      4: [
        "I came to the Barrow as an apprentice, very young. The old keeper was a heron named Isolde.|She taught me that bones are simply stories that have stopped talking. So someone must talk for them.",
      ],
      6: [
        "I am afraid of being forgotten, {player}. That is all a museum really is. A great, hoo, stubborn refusal to forget.",
      ],
      8: [
        "As the Hearth dimmed these last years, I noticed folk forgetting small things. The words to songs. Where the old path went.|So I wrote everything down. Every name. It is foolish. But if the Gloam takes our memories, I shall hold them for us.",
      ],
      10: [
        "I have added a new entry to the Barrow's registry: 'Exhibit the Last. {player}, who came home, and made the island remember itself.'|Do not worry. One need not be, hoo, dead to be on display. I checked the bylaws. Thank you, my friend.",
      ],
    },
    gift: {
      loved: [
        "{item}! Oh, {player}. This is, hoo, magnificent. I must sit down. I am sitting down. I am overcome.",
        "{item}... Do you know what this means to a scholar? Everything. Also footnotes. Many, many footnotes.",
        "For me? {item}? I shall treasure it longer than I shall live, which, in my line of work, is the whole point.",
      ],
      liked: [
        "Ah, {item}. How thoughtful. It shall sit beside the jawbone of a very distinguished sheep.",
        "{item}. Excellent. You have been, hoo, paying attention to my interests. So few people do.",
        "{item}? Thank you, {player}. It shall be catalogued, cross-referenced and admired.",
      ],
      neutral: [
        "{item}. Thank you. I shall file it under 'miscellaneous kindnesses.'",
        "Ah. {item}. Hoo. It is... an object. I do appreciate objects.",
        "{item}? How kind. I shall find it a shelf. I have many shelves. Most of them are sad.",
      ],
      disliked: [
        "{item}. Hoo. No. Thank you, but no. I shall place it somewhere very far from my books.",
        "{item}?! {player}, please keep that at arm's length. Your arm. Not mine.",
        "Ah. {item}. I accept it in the spirit it was given, and shall bury it in the spirit it deserves.",
      ],
      already: [
        "You have already been generous today, {player}. Tomorrow. I have not the shelf space for two kindnesses.",
        "Another? Hoo, no, no. One gift a day. I did not make the rule. I merely, hoo, endorse it.",
        "I have already accepted a gift today. Please. My heart is not built for this much excitement.",
      ],
    },
    request: {
      ask: [
        "I require {qty} {item} for a study I am conducting. Very important. Hoo, fairly important. Would you?",
        "Might I trouble you for {qty} {item}? For the archives. Everything ends up in the archives eventually.",
        "{player}, would you bring me {qty} {item}? I would go myself, but it is, hoo, outside.",
      ],
      thanks: [
        "{item}! Splendid. The study may proceed. I shall credit you in the footnotes. Large footnotes.",
        "Ah, the {item}. Thank you, {player}. You have advanced the cause of knowledge by a small but real amount.",
        "Wonderful. You are a far better assistant than my last one. He was a skull. Very quiet. Terrible at fetching.",
      ],
      pending: [
        "Any sign of the {item}? I still require {qty}. The study has, hoo, stalled. Tragically.",
        "The {item}, {player}. {qty}, if you please. I have already written the conclusion. I merely need the evidence.",
        "I await the {item} with scholarly patience. Which is to say I think of very little else.",
      ],
    },
    hearth: {
      1: ["The Hearth is brighter. I could read by it last night from the Barrow door. I did. An entire chapter. Hoo."],
      2: ["Two runes burn. The graveyard feels, hoo, less restless. Or perhaps I do."],
      3: ["Three runes. I have entered the rekindling in the Barrow's chronicle. You are history now, {player}. It is permanent."],
      4: ["Four. Folk are remembering things they had forgotten. Old songs. Grenna hummed one yesterday. It was, hoo, alarming."],
      5: ["Five runes. The fog has pulled back from the graves. I can read names I have not seen in years. Thank you."],
      6: ["All six. The runestones say the stag will wake now. I have read those words a hundred times. I never believed I would, hoo, live to see them."],
      dawn: [
        "Dawn. True dawn. I have written the word a thousand times, {player}. I never knew it looked like this.",
        "The light is dreadful. It is everywhere. It is, hoo, perfect. I shall write about it for the rest of my life.",
      ],
    },
    role: {
      barrow_intro: [
        "This, {player}, is the Barrow: burial mound of the first settlers, and now the island's museum. My museum.|The Gloam dims memory as well as light. So we keep what we can: fish, relics and, hoo, even... bugs. For completeness.|Bring me what you catch or dig up. Fish from lake and sea, relics from the glinting cracks and, if you must, insects.|Do not let the insects out. Ever. That is the only rule of the Barrow. Hoo. Please.",
      ],
      donate_prompt: [
        "Have you brought something for the collection? Do show me. Slowly, if it has legs.",
        "Ah, {player}. A donation? The Barrow is, hoo, always hungry for history.",
      ],
      donate_new: [
        "{item}! A new specimen for the Barrow. Magnificent. I shall label it at once, in my very best hand.",
        "Oh, {item}! We have never had one. Hoo! Thank you, {player}. History thanks you, and so do I.",
        "{item}, donated by {player}. That is what the card shall say. It has a lovely ring. Scholarly. Permanent.",
      ],
      donate_dupe: [
        "Ah. We already have {item}. A fine specimen, but one is, hoo, sufficient. Keep it. Sell it. Admire it.",
        "{item}? Already catalogued, I am afraid. The Barrow values rarity. And shelf space.",
      ],
      nothing_to_donate: [
        "You have nothing new for me today. That is quite all right. History is patient. I am less so.",
        "Nothing? Hoo. Well. Come back when the earth coughs something up. Or the lake does.",
      ],
      bug_shudder: [
        "Oh. Oh no. It is... it is a bug. Hoo. Hold still. Both of you. I shall fetch the, hoo, long tongs.",
        "A... specimen. Yes. Wonderful. For science. I am being brave. Do not look at me. I am being brave.",
        "Into the jar. Into the jar! Lid on. Lid ON. Hoo. Thank you. I shall need a moment. And a chair.",
      ],
      collection_fish_done: [
        "Every fish in the waters of Gloamhollow now rests in the Barrow. From the humble perch to the Drowned Sovereign itself!|Fennick wept when he saw the Sovereign. Then he said the one that took his eye was bigger. Naturally.",
      ],
      collection_bugs_done: [
        "The insect collection is... complete. Every one. Hoo. I have not slept. I shall not sleep. They are all in there.|Thank you, {player}. Truly. A triumph of science. Please never bring me another bug again.",
      ],
      collection_relics_done: [
        "Every relic. Every single one. The coin, the comb, the crown... {player}, the Barrow is whole for the first time in centuries.|The first settlers would be proud. I am proud. Hoo. I may need a small cry, conducted in a dignified manner.",
      ],
    },
  },

  // ───────────────────────────────────────── BRAMBLE — badger, smith
  bramble: {
    intro: "Hrm. New face.|Bramble. Smith. The forge is mine. Don't touch the anvil. It bites.|Solveig's kin, eh. {player}. She had good hands. Strong. Made a fine stew.|Tools go dull. Bring 'em here. Bring ore. Bring coin. I'll make 'em better.|That's all. Got work. ...Hrm. Welcome.",
    greet: {
      morning: [
        "Hrm. Morning.",
        "Up early. Good. Work's better early. Stew's better late.",
        "Morning, {player}. Forge is warm. Stand by it if you're cold. Don't touch it.",
      ],
      day: [
        "Hrm. {player}.",
        "Busy. Talk while I hammer.",
        "Need something mended? Bent back? Hit?",
      ],
      evening: [
        "Evening. Done hammering. Now stew.",
        "Hrm. Sit by the Hearth. Warm your bones.",
        "Lanterns are lit. ...Nice lanterns. Hrm. Didn't say anything.",
      ],
      night: [
        "Late. Go home, {player}.",
        "Hrm. Dark out. Stay in the light. Mist's got teeth.",
        "Can't sleep either? Hrm. Sit a while. Fire's still warm.",
      ],
    },
    chat: [
      "Hrm.",
      "Stew's simple. Meat, roots, time. Nothing else. Grenna puts herbs in hers. Wrong.",
      "Iron's honest. Hit it right, it listens. Folk should be more like iron. Hrm.",
      "Corvin tried to sell me a hat. Said I've got a head. He said 'precisely.' Still don't know what he meant.",
      "Fennick's fish? Saw it. Cod. Big cod. Not a longship. Don't tell him I told you.",
      "Owl talks a lot. Raven talks more. Me, I hammer. Hammer says what it means.",
      "Somebody straightened the lantern post by the well last night. Don't know who. Good job, whoever. Hrm.",
      "Mothwyn's lanterns. Every dusk. Never misses one. ...Good lanterns. That's all. Hrm.",
      "Forged the grate on the Great Hearth. Long time back. Should've held forever. Hrm.",
      "Mead's for after work. Work's never done. So. Hrm. Mead's rare.",
      "Copper's soft. Iron's hard. Coal makes it hot. That's the whole trade. Rest is sweat.",
      "Don't need thanks. Need ore. Bring ore.",
      "Draugr in the Mistwood carry iron. Old iron. Good iron. Fight 'em careful. Bring it here.",
      "Grenna gave me a tea once. For my back. Back's fine now. Can hear colours, though. Hrm.",
      "Morrow asked what's in my stew. Told him 'stew.' True answer.",
      "Hard work. Hot food. Long sleep. That's the good life. Don't need more. ...Maybe a dog.",
      "Your grandmother mended her own hoe. Bent it straight on a rock. Tough woman. Hrm. Forge is quieter without her.",
      "Flowers. Don't see the point. Can't eat 'em. Can't forge 'em. Mothwyn likes 'em. ...Hrm. Some point, then.",
      "Sparks look like fireflies. Or fireflies look like sparks. Never decided.",
      "When the forge rings right, the whole village hears it. Keeps the dark back, a little. Hammer and fire. Only magic I trust.",
      "Stamina's like iron. Work it hard, rest it by a fire, it comes back stronger. Hrm. Or you fall over.",
      "Fennick's fish was a longship last week. Next week it'll be the island. Then he'll say he's standing on it.",
    ],
    weather: {
      clear: [
        "Clear. Good day for work. Every day's a good day for work.",
        "Sun's out. Sort of. Hrm. Enjoy it.",
      ],
      overcast: [
        "Grey. Same as always. Hammer doesn't care.",
        "Clouds. Good. Sun gets in my eyes at the anvil.",
      ],
      fog: [
        "Fog. Keep a torch lit. Gloam likes the fog. I don't.",
        "Can't see the forge from the Hearth in this. Hrm. Don't like it.",
      ],
      rain: [
        "Rain. Good for crops. Bad for iron. Rust. Hrm.",
        "Wet out. Forge keeps me dry. Come stand by it.",
      ],
      storm: [
        "Storm. Stay inside. Or stand by the forge. Same thing.",
        "Thunder. Hrm. Some giant hitting an anvil. Bad technique.",
      ],
      snow: [
        "Snow. Cold hands, hot forge. Good balance.",
        "Hrm. Snow on the anvil. Brush it off. Keep working.",
      ],
    },
    season: {
      spring: [
        "Thaw. Mud season. Lots of broken hoes. Good for business.",
        "Spring. Ground's soft. You'll be tilling. Keep that hoe sharp.",
        "Hrm. Flowers coming up. Mothwyn'll be happy. ...Good.",
      ],
      summer: [
        "Brightwane. Forge is too hot. Work anyway.",
        "Summer. Long days. More hammering. Hrm. Good.",
        "Folk say it's too warm for stew. Wrong. Never too warm for stew.",
      ],
      autumn: [
        "Rotfall. Leaves go the colour of hot iron. Best season.",
        "Autumn. Nights get long. Mist gets bold. Keep your sword sharp.",
        "Pumpkin stew. Rotfall's only gift. Hrm. Good gift.",
      ],
      winter: [
        "Deepfrost. Folk crowd round the forge for warmth. Don't talk to 'em. Don't mind 'em, either.",
        "Winter. Iron cracks in the cold. So do folk. Keep warm, {player}.",
        "Hrm. Long nights. Hearth needs you. So do we.",
      ],
    },
    hearts: {
      2: ["You work hard. I see it. Hrm. That's all. ...Good."],
      4: ["Learned smithing from my ma. Her hammer's the one I use. Handle's been replaced four times. Head, twice. Still her hammer."],
      6: ["Forged the grate on the Great Hearth, thirty winters back. It's dimming anyway. Keep thinking I did it wrong. Hrm."],
      8: ["Ma's forge had a lamp in the window. Always lit, so I'd find my way home. Mothwyn's lanterns... look like that.|That's why I mend the posts. At night. Don't tell her. Hrm."],
      10: ["Don't talk much. You know that. But you're good folk, {player}. Like family. Better. Family eats more stew.|Forge door's open to you. Any hour. Always. Hrm. That's all. Go on, then."],
    },
    gift: {
      loved: [
        "{item}. Hrm. ...Hrm! Good. Very good. Thanks.",
        "{item}? For me? ...Hrm. Don't know what to say. So I won't. Thanks, {player}.",
        "{item}! That's the good stuff. Hrm. You're alright, {player}.",
      ],
      liked: [
        "{item}. Useful. Thanks.",
        "Hrm. {item}. Good. I'll use it.",
        "{item}? Good choice. Hrm.",
      ],
      neutral: [
        "{item}. Hrm. Thanks.",
        "Hrm. {item}. Alright.",
        "{item}. ...Sure.",
      ],
      disliked: [
        "{item}. Hrm. Don't need that.",
        "{item}? What'm I s'posed to do with this. Hrm.",
        "Hrm. {item}. ...Give it to Mothwyn. She likes... things.",
      ],
      already: [
        "Already got one today. Hrm. Tomorrow.",
        "One's enough. Save it.",
        "Hrm. Spoiling me. Stop.",
      ],
    },
    request: {
      ask: [
        "Need {qty} {item}. Can you get 'em? Hrm.",
        "Short on {item}. {qty}. Bring 'em by the forge.",
        "{player}. Job for you. {qty} {item}. Pays.",
      ],
      thanks: [
        "{item}. Good. Thanks.",
        "Hrm. Right amount. Good work, {player}.",
        "That's the {item}. You're quick. Good.",
      ],
      pending: [
        "Still need {qty} {item}. Hrm.",
        "The {item}? No rush. ...Bit of a rush.",
        "Waiting on that {item}. {qty}. Hrm.",
      ],
    },
    hearth: {
      1: ["Hearth's burning. Grate held. Hrm. ...Good grate."],
      2: ["Two runes. Warmer, walking home. Hrm. Good."],
      3: ["Halfway. Keep at it. Hard work pays."],
      4: ["Four. Could see the forge from the Hearth last night. Clear as day. Hrm."],
      5: ["Five. One more. Then the stag. Sharpen your sword. Better: bring it here first."],
      6: ["All six. Stag's awake. Hrm. Take my best work with you. And come home."],
      dawn: [
        "Sun. Hrm. ...Hrm. Don't look at me. Something in my eye.",
        "Dawn. Never thought. Hrm. Stew tonight. Everyone. My forge.",
      ],
    },
    role: {
      upgrade_offer: [
        "Tool's worn. I can make it better. Bring the ore and the coin. Leave it with me. Hrm.",
        "Want an upgrade? Copper first. Then iron. Better tool, less sweat.",
      ],
      upgrade_done: [
        "Done. Harder. Sharper. Try not to break it. Hrm.",
        "Here. Best work I've done this week. Only work I've done this week. Still good.",
      ],
      upgrade_cant_afford: [
        "Not enough. Need the ore and the coin. Come back.",
        "Hrm. Short. Iron doesn't work on promises.",
      ],
      upgrade_max: [
        "Can't make it better. That's iron, done right. Only thing better's magic. Don't do magic.",
        "It's perfect. Hrm. Don't argue.",
      ],
      forge_closed: [
        "Forge's shut. Come back in the morning. Eight. Hrm.",
        "Closed. Even the anvil needs rest. ...Not really. I do.",
      ],
    },
  },

  // ───────────────────────────────────────── MOTHWYN — moth, lamplighter
  mothwyn: {
    intro: "Oh...! I'm sorry... I didn't hear you... you walk so quietly... like fog...|I'm Mothwyn... I light the lanterns here... all of them... every dusk... before the dark can...|You're {player}... Solveig's... She used to leave a candle in her window for me... so I'd never walk home in the dark...|I'm glad someone's in her croft again... I'll light the lantern on your path tonight... the first one... always...|Oh... I'm talking too much... I'll stop now... thank you for listening...",
    greet: {
      morning: [
        "Oh... good morning, {player}... The sun came back... it always does... I worry anyway...",
        "Morning... I was watching the dew catch the light... every drop is a tiny lantern...",
        "Hello... I'm a little sleepy... I stayed up with the last lantern... I always do...",
      ],
      day: [
        "Oh... hello, {player}... isn't the light lovely today... even the grey kind...",
        "Hi... I was just... writing something... it isn't finished... it's never finished...",
        "Oh! {player}... sorry... I startle easily... it's the wings...",
      ],
      evening: [
        "It's nearly dusk... I have to light them all before the dark comes... would you hold my wick...?",
        "Evening... this is my favourite hour, and my worst... the light is so golden... and so short...",
        "The first lantern's lit... listen... it hums... they hum, you know... if you're very quiet...",
      ],
      night: [
        "Oh... you're out in the dark... please stay near a lantern... please...",
        "I don't like the night... it's so... big... but the lanterns make little rooms in it...",
        "{player}... could you walk me to the next light? Just... just to the next one...",
      ],
    },
    chat: [
      "Every lantern has a name... that one's Little Sun... that one's Old Wick... the crooked one is Hester... she tries her best...",
      "Someone mends my lantern posts at night... I never see who... I think it must be a kind spirit... with very big paws...",
      "Light is a kind of promise... isn't it... it says, 'I'm here'... 'you can find me'...",
      "I know it's silly... a moth who's afraid of the dark... but the dark here is so... hungry...",
      "Morrow is always very polite to me... from very far away... I think he must be shy too...",
      "Bramble gave me a lantern hook once... he said it 'fell off something'... it was brand new... and still warm...",
      "Corvin always gives me the last candle for free... he says it's 'damaged'... it never is...",
      "Fennick says the sea glows at night, far out... like a field of lanterns underwater... I want to believe him...",
      "Grenna says I have 'the old light' in me... I don't know what that means... she won't say... she just chews...",
      "I write poems... small ones... here's one...|'Wick and flame... hold back the grey... one more night... one more day...'|...It's short... like the days...",
      "Fireflies are lanterns that learned how to fly... I think that's the loveliest thing in the world...",
      "Please don't bring me moths in jars... they're... they're somebody's cousins... maybe mine...",
      "Embers are the best thing... a whole sunset... that fits in your palm...",
      "Dandelions are little suns that grew up too fast... and then they turn into wishes... and fly away...",
      "The Hearth used to be so bright you could read by it from the meadow... I remember... I think I remember...",
      "I talk to the lanterns sometimes... they're good listeners... the dark only pretends to listen...",
      "Flax makes wicks... wicks make light... and light makes... courage? ...I think so...",
      "Berry pie is warm... and pink inside... like a sunset you can eat...",
      "I counted my lanterns twice this morning... they were all still there... I counted a third time... just in case...",
      "Do you ever look at a flame and feel like it's looking back? ...Kindly? ...No? ...Just me...",
      "I'm sorry... I'm always apologising... I'm sorry about that too...",
      "When the Hearth is bright again... I'd like to walk in the dark... just once... to see what it's like... not being afraid...",
      "Glowing mushrooms grow where the dark is deepest... like the forest leaves little lights... for anyone lost...",
    ],
    weather: {
      clear: [
        "It's clear... the sky is so pale and wide... like a lantern with no glass...",
        "Sunlight on the water... it sparkles... I could watch it forever... or at least until dusk...",
      ],
      overcast: [
        "The clouds are so low... like a grey blanket... the lanterns look brighter against it...",
        "Overcast... soft light... I don't mind it... it's kind to tired eyes...",
      ],
      fog: [
        "The fog... I can't see the lanterns from here... are they still lit? ...They're still lit... they have to be...",
        "Please be careful in the fog, {player}... the Gloam wears it like a cloak...",
      ],
      rain: [
        "Rain on the lantern glass... it sounds like tiny applause...",
        "I built the wicks little roofs against the rain... and the roofs have little roofs...",
      ],
      storm: [
        "The wind keeps pushing the flames sideways... hold on, little ones... please hold on...",
        "Storms frighten me... everything gets so loud... and the light gets so small...",
      ],
      snow: [
        "Snow... every flake catches the lantern light... like falling sparks that don't burn...",
        "I wrapped the lanterns in wool... Bramble says that's 'a fire hazard'... I know... but they looked so cold...",
      ],
    },
    season: {
      spring: [
        "The Thaw... the meadow wakes up... dandelions everywhere... little yellow lanterns...",
        "Spring nights are still so long... but they're shrinking... a little every day... I count...",
        "The first moths of spring are out... I wave to them... they never wave back...",
      ],
      summer: [
        "Brightwane... the light stays so late... I almost don't need to light the lanterns... almost...",
        "Fireflies in the meadow at night... it's like the stars came down to visit...",
        "I grow flax in summer for the wicks... it has little blue flowers... like pieces of sky...",
      ],
      autumn: [
        "Rotfall... the leaves turn fire-coloured... the whole forest looks like it's glowing... it isn't...",
        "The nights grow long... I need more oil... and more courage... Corvin only sells one of those...",
        "The autumn fog comes in so fast... one moment the lanterns... the next, only their haloes...",
      ],
      winter: [
        "Deepfrost... the longest nights... I light the lanterns so early... and they burn so long...",
        "The snow makes the whole island a little brighter... like the ground remembers the sun...",
        "I'm cold... and scared... but the lanterns are warm... so I stay close to them... like a moth...",
      ],
    },
    hearts: {
      2: ["You're... easy to talk to, {player}... like sitting beside a candle... I hope that's a compliment... it's meant as one..."],
      4: ["I was born the winter the Hearth nearly went out... Grenna says that's why I love the light so much...|She says I was born missing something... and I've been looking for it ever since..."],
      6: ["My mother followed a light into the Mistwood when I was small... it wasn't a lantern... it was the Gloam... pretending...|She didn't come back... That's why I light them all... every night... so no one follows the wrong light... ever again..."],
      8: ["I found out who mends my lantern posts... it's Bramble... I saw him... he was humming...|I didn't tell him I saw... I don't want him to stop... please don't tell him either..."],
      10: ["I wrote you a poem, {player}... it's short...|'You came in from the grey... with salt in your hair... and the dark was not so dark... with you there...'|...I'm sorry... it's silly... Do you like it? ...Really? ...I'm so glad..."],
    },
    gift: {
      loved: [
        "{item}...! For me? Oh... it's beautiful... I'm going to cry... I'm crying... it's fine...",
        "{item}... it's like holding a little piece of dawn... thank you... thank you...",
        "Oh... {item}... I'll keep it by my window... so the dark can see I'm not alone...",
      ],
      liked: [
        "{item}... that's so sweet... thank you, {player}...",
        "Oh... {item}... I love it... I'll put it with my other favourite things...",
        "{item}? ...That's lovely... you're lovely... oh... I said that out loud...",
      ],
      neutral: [
        "{item}... oh... thank you... that's kind...",
        "{item}... I'll find a place for it... somewhere with good light...",
        "Oh... {item}... thank you... I'll... I'll think of something...",
      ],
      disliked: [
        "{item}... oh... oh no... I... thank you... I'll just... put it... far away...",
        "{item}...? It makes me feel... small and cold... I'd rather not... I'm sorry...",
        "Oh... {item}... that's... could we pretend this didn't happen...?",
      ],
      already: [
        "Oh... you already gave me something today... I can't take more... my heart's too full...",
        "Another...? No, no... one's plenty... more than plenty...",
        "You're too kind... but let's save it for tomorrow... tomorrow needs nice things too...",
      ],
    },
    request: {
      ask: [
        "Could you... maybe... find me {qty} {item}? Only if it's no trouble... it's probably trouble...",
        "{player}... I need {qty} {item}... for the lanterns... well, sort of... everything's sort of for the lanterns...",
        "Would you bring me {qty} {item}...? I'd go myself... but it's far... and the dark is also far...",
      ],
      thanks: [
        "{item}...! You found them... thank you, thank you... you're a light, {player}...",
        "Oh... the {item}... it's perfect... you're perfect... I mean... thank you...",
        "Thank you... I'll write a little poem about the {item}... and about you... about everything...",
      ],
      pending: [
        "The {item}...? It's alright... no hurry... I still need {qty}... only when you can...",
        "Um... about the {item}... I'm not rushing you... I'm just... hoping... quietly...",
        "{qty} {item}... I've been waiting by the window... not in a strange way... in a hopeful way...",
      ],
    },
    hearth: {
      1: ["The Hearth... it's brighter... I stood by it so long last night... I think I fell asleep standing up..."],
      2: ["Two runes... the lanterns don't have to work so hard now... they seem... relieved..."],
      3: ["Halfway... I walked from my cottage to the well last night without a lantern... only a little way... but I did it..."],
      4: ["Four runes... the light reaches the meadow now... the fireflies came closer to look at it..."],
      5: ["Five... I've been counting... I always count... one more... one more, and then..."],
      6: ["All six... Grenna says the stag is waking... please take a lantern... take Little Sun... she's the brightest..."],
      dawn: [
        "It's... the sun... the whole sky is a lantern... I never knew it could be so big...",
        "I'm not afraid, {player}... I'm not afraid... I think I'll keep lighting the lanterns anyway... just to say thank you...",
      ],
    },
    role: {
      give_net: [
        "Oh... you'll want this... it's a bug net... I made it from old lantern gauze... it's very gentle...|Be gentle with whatever you catch... and take them to Morrow, at the Barrow... he'll... he'll be very brave about it...|And if you catch a moth... be gentle... it might be a cousin... tell it Mothwyn says hello...",
      ],
      lanterns: [
        "There you go... little light... keep watch for me...",
        "One more lit... and one more... and one more... that's how you hold back the night...",
        "Hello, Old Wick... you're flickering... are you tired too? ...Just until dawn... I promise...",
      ],
      afraid: [
        "Oh... oh no... it's dark here... it's so dark... where's the nearest lantern...?",
        "Please don't leave me in the dark... please... just until the next light...",
        "The shadows are moving... they're moving, aren't they... {player}...?",
      ],
    },
  },

  // ───────────────────────────────────────── GRENNA — goat, herbalist & keeper of the rites
  grenna: {
    intro: "Baaah. So the sea spat you up at last. Took its time. The sea always does.|Grenna. Herb-wife, hedge-witch, keeper of the old rites. Older than your grandmother's grandmother. Don't ask how much.|You've Solveig's look. Stubborn about the eyes. She and I didn't speak for eleven years. Over a cauldron. Best years of my life.|...I miss her terribly. Don't repeat that. Baaah.|Go on, then. Look about. When you're ready to hear about the Hearth, find me. You'll be ready sooner than you'd like.",
    greet: {
      morning: [
        "Morning. The dew's still wet. So are you, behind the ears.",
        "Baaah. Early. Good. The forest edge gives up its best herbs before the rest of you wake.",
        "You're up. So am I. I'm always up. Sleep is for those with time to spare.",
      ],
      day: [
        "Hm. {player}. Come to learn something, or come to be told?",
        "Baaah. Mind the drying herbs. Mind the cauldron. Mind yourself, mostly.",
        "You again. Good. The others bore me.",
      ],
      evening: [
        "Evening. The Hearth needs watching. So do you.",
        "Sit. The fire's warm and my stories are long. You'll like one of them.",
        "The light's going. It always goes. The trick is getting it back.",
      ],
      night: [
        "Out in the dark? You've got your grandmother's sense. That's not a compliment.",
        "Baaah. The Gloam walks tonight. Walk quicker.",
        "Night, child. The stars remember when this island was warm. So do I.",
      ],
    },
    chat: [
      "I ate the notice board again. Corvin's handwriting has a bitter finish. Mothwyn's is sweet. Bramble just draws hammers.",
      "Fennick's fish? It was a gull. I was there. I'm always there. Baaah.",
      "Morrow asked my age. I told him 'yes.' He's been writing it down ever since. Pages of it.",
      "Corvin knows more than he says. Ravens always do. They sat on the shoulders of gods, once. Now they sit behind market stalls.",
      "Bramble's back pained him, so I gave him a tea. He's been hearing colours since. Side effect. Harmless. Mostly.",
      "The girl, Mothwyn. She's got the old light in her. Don't tell her. She'll only fret about it.",
      "Thistle is the proper flower. Prickly outside, soft within, and it grows where nothing else dares. Like me. Baaah.",
      "Nightshade. Lovely stuff. Don't eat it. Fennick ate some once and saw his old ship sailing across the ceiling for a week. He enjoyed it.",
      "Every root in this island's soil has a name. I know them all. Most of them are rude.",
      "Solveig borrowed my best cauldron sixty years ago. Never gave it back. I've decided to call it a long loan. A very long loan.",
      "The rites aren't magic, child. They're manners. You give to the fire, the fire gives back. Folk forgot their manners.",
      "Mist isn't the enemy. Mist is the island breathing. It's what hides in the breath you should mind.",
      "Frostroot grows in the dead of winter under a foot of snow. Stubborn. Bitter. Delicious. My sort of vegetable.",
      "Yellow mushrooms are for luck. Red are for regret. The glowing ones are for finding your way home. Don't mix them up.",
      "The world-tree's roots run under this whole island. Put your ear to the ground in the Mistwood. You'll hear it thinking.",
      "Cooked meat? Keep it away from me. I'm a goat of principle. The principle is 'no.'",
      "I've buried three keepers of this Hearth. I don't intend to bury a fourth. Eat something. Keep warm.",
      "Baaah.|...That's all. Go on.",
      "The old songs say the stag was a guardian once. Drank the dew from the world-tree's leaves. Something changed its thirst.",
      "Onions make the stew. Turnips make the winter. Beets make the blood strong. Everything else is decoration.",
      "Don't whistle in the Mistwood. The wraiths think you're calling them. They're lonely. Doesn't make them kind.",
      "I don't give advice. I give instructions, and folk ignore them. Saves time.",
    ],
    weather: {
      clear: [
        "Clear. Don't trust it. A clear sky is only a grey one holding its breath.",
        "Sun's out. Go and dry your socks. You look damp in the soul.",
      ],
      overcast: [
        "Grey. Good weather for thinking. Poor weather for thinkers.",
        "Overcast. The sky's in a mood. I sympathise.",
      ],
      fog: [
        "Fog. The Gloam's own weather. Keep a fire at your back and your wits in front.",
        "Mist thick as porridge, and half as nourishing. Stay in the light.",
      ],
      rain: [
        "Rain. Your crops will thank the sky. Nobody thanks the sky. Rude.",
        "Rain on the herb-roof. Best sound there is. Next to silence.",
      ],
      storm: [
        "Storm. The sea wants something back. It always does. Stay off the dock.",
        "Thunder. Old gods moving furniture. Let them.",
      ],
      snow: [
        "Snow. Frostroot weather. Deepfrost's only kindness.",
        "Baaah. My beard's frozen. Don't laugh. It's happened to better goats.",
      ],
    },
    season: {
      spring: [
        "The Thaw. Everything wakes up hungry. Mind the dandelions. They're bolder than they look.",
        "Spring. Plant turnips. Plant carrots. Plant onions. Plant yourself, while you're at it.",
        "The Thaw's a liar. It promises warmth and gives you mud.",
      ],
      summer: [
        "Brightwane. The sun makes an effort. Poor thing.",
        "Summer herbs are strongest. Summer tempers are shortest. Mine never changes.",
        "Fireflies in the meadow. The dead like them, they say. So do I.",
      ],
      autumn: [
        "Rotfall. Things die beautifully in autumn. Take notes.",
        "Nightshade season. My favourite. Don't make that face.",
        "Autumn fog comes early and leaves late. Like Fennick at the Hearth.",
      ],
      winter: [
        "Deepfrost. The long dark. This is when the Hearth earns its name.",
        "Winter. Frostroot's the only thing growing. Frostroot and my patience. One of those is a lie.",
        "The Drowned King wakes in winter, the old ones say. Fennick will tell you more. Mostly lies. Not all.",
      ],
    },
    hearts: {
      2: ["You keep coming back. Most don't, after the first time I'm rude. Baaah. Good."],
      4: ["I was keeper of the rites before Solveig was born. I taught her. She was terrible.|Then she was better than me. Never forgave her for it."],
      6: ["Solveig went to the altar once. Alone. Before the runes were lit.|The stag sent her home with a broken lantern and a white streak in her hair. She never spoke of what she saw."],
      8: ["The cauldron wasn't why we stopped speaking. I told her not to go to the altar. She went anyway.|I was right. She never let me say it. Eleven years. Baaah. Stubborn old woman. Both of us."],
      10: ["I'm old, child. Older than I let on, and I let on a great deal. I've watched keepers come and go.|You're the first in a long while who made me curious what comes next. Don't let it go to your head. ...Thank you."],
    },
    gift: {
      loved: [
        "{item}. Well, well. You've been paying attention. Baaah. Don't stop.",
        "{item}! Hmph. I won't say I'm pleased. I'll just chew it very slowly and let you guess.",
        "{item}. That's a proper gift. Solveig used to bring me these. ...Thank you, child.",
      ],
      liked: [
        "{item}. Useful. I'll dry it, boil it or eat it. Possibly all three.",
        "{item}. Hmph. Better than most folk manage.",
        "{item}? Good. You're learning.",
      ],
      neutral: [
        "{item}. Hm. It'll do.",
        "{item}. I'll find a use. I always find a use.",
        "Baaah. {item}. Very well.",
      ],
      disliked: [
        "{item}. Take that away. I don't want it near the herbs.",
        "{item}?! Child. Look at me. Look at my face. Is this the face of someone who wants that?",
        "Baaah! {item}. No. Absolutely not. Sit down and think about what you've done.",
      ],
      already: [
        "One gift a day. Greed is unbecoming, even in generosity.",
        "You've given enough today. Go give something to Bramble. He's always hungry.",
        "Baaah. Tomorrow. My shelves are full and my patience is thin.",
      ],
    },
    request: {
      ask: [
        "I need {qty} {item}. For a remedy. Or a curse. Depends how the week goes.",
        "Fetch me {qty} {item}, would you? My knees are older than your village.",
        "{qty} {item}. Don't ask what for. You don't want to know. ...It's soup.",
      ],
      thanks: [
        "{item}. Good. Now I can finish the remedy. Or the soup. Same pot.",
        "Hm. You found the {item}. Maybe you're worth the salt the sea left on you.",
        "Good child. Now shoo, and don't tell anyone I was nice to you.",
      ],
      pending: [
        "The {item}. {qty}. I'm not getting any younger. Or older. But still.",
        "Still waiting on the {item}. The pot's boiling. The pot is always boiling.",
        "{qty} {item}, child. Did the sea wash it out of your ears?",
      ],
    },
    hearth: {
      1: ["One rune lit. The fire remembers its name. Good. Keep going."],
      2: ["Two. The fog's stepped back from my hut. I'll miss it. Not much."],
      3: ["Three. Half the rite. The island's listening now. Don't stop halfway. That's worse than never starting."],
      4: ["Four. I heard the old song on the wind last night. Haven't heard it since Solveig was young."],
      5: ["Five. One more, and the stag wakes. Eat well. Sleep well. Say your goodbyes, just in case. Baaah. Only in case."],
      6: ["Six. It's done. The rite's awake, and so is the thing in the Mistwood. Go on. Your grandmother would already be there."],
      dawn: [
        "Dawn. Hmph. About time. ...Don't look at me like that. Goats can have wet eyes. It's the smoke.",
        "The sun's up. The Hearth's roaring. The island's breathing clean. Solveig, you stubborn old woman. We did it.",
      ],
    },
    role: {
      offerings_intro: [
        "Look at the Hearth, child. Look properly. See how low it burns? It's dying. When it dies, the mist takes the rest.|Six runes are carved on its stones. Six offerings: Kindling, Soil, the Deep, the Wild, the Dark and the Tithe.|Give the fire what the island gives you, and each rune will wake. I'm keeper of the rites. I'll know when it's done.|Your grandmother fed that fire every day for fifty years. Now it's your turn. Don't dawdle. Baaah.",
      ],
      offering_done: [
        "Another rune wakes. Feel that? The fire's breathing easier. So am I.",
        "Good. The Hearth took it gladly. Keep going. The mist doesn't rest. Well. You may rest a little.",
        "Baaah. Well done. Don't let it go to your head. There's more to do.",
      ],
      cooking_hint: [
        "Raw food's for fools and gloamlings. Cook it at a fire. Your belly will thank you, and your bones will stay put.",
        "Eat before you go into the dark. A full belly's harder to frighten. That's not a saying. It's a fact.",
        "Stand by a fire a while before you wander. Rested bones work harder. Cooked food keeps you standing.",
      ],
      cauldron_gift: [
        "The Wild is given, so you've earned the cauldron's secrets. Build one, and cook proper food: stew, bread, pie, porridge.|My mother taught me. I taught Solveig. She never gave my cauldron back, so you'll build your own. And never lend it. Ever.",
      ],
      final_rite: [
        "Six runes burn. The rite is whole, and the old altar in the Mistwood has woken. You'll feel it pulling at the fog.|Ashhorn waits there. The Mist-Stag. It drank the light from this island, sip by sip, for longer than I care to count.|Bring torches and food. When it charges, roll aside. When it sweeps those antlers, don't be there. When it calls gloamlings, keep to the light.|Bring back its antler and lay it on the Hearth. Then we'll see what dawn looks like. Go on, child. ...Come back.",
      ],
    },
  },

  // ───────────────────────────────────────── FENNICK — fox, ex-sailor & fisherman
  fennick: {
    intro: "Ahoy there! Look at you, washed up with the kelp. Salt in your hair, sand in your boots. You'll fit right in.|Fennick's the name. Sailor, fisherman, teller of true stories. Mostly true. Truer than anything Corvin sells.|See this patch? Lost the eye to a fish the size of a longship. Bigger, maybe. It was dark. I was very brave.|You're Solveig's sprat, aren't you? {player}. She used to bring me hot bread on the dock. Said I looked 'underfed and overconfident.'|Welcome to Greyshore, shipmate. The sea's grey, the sky's grey, the herring's grey. But the company? Pure gold.",
    greet: {
      morning: [
        "Ahoy, {player}! Fish bite best in the morning. So do I, before breakfast.",
        "Morning, shipmate! Smell that? Salt, peat smoke and ambition. Mostly salt.",
        "Up with the gulls, eh, sprat? The sea rewards early risers. Sometimes with fish. Mostly with cold.",
      ],
      day: [
        "Ahoy! Fine day for it. For what? For anything, shipmate. That's the beauty of it.",
        "{player}! Pull up a barrel. I've a story that'll curl your whiskers. No whiskers? It'll grow some.",
        "Afternoon, matey. Sea's calm as a sleeping whale. Let's not wake it.",
      ],
      evening: [
        "Evening, shipmate. Hear that? Tide's turning. So's the light. Best head in soon.",
        "Ahoy! Coming by the Hearth? I've a new story. Well. An old story with a bigger fish.",
        "Dusk on the water. Prettiest thing in the world. Second prettiest. First is a full net.",
      ],
      night: [
        "Out late, sprat? Stay near a fire. The Gloam doesn't care how brave you are. Believe me, I've tried.",
        "Hear the bell? I ring it at midnight. Calls the lost ones home. ...Old sailor's habit.",
        "Night, {player}. There are lights out on the water, if you squint. Don't swim to them.",
      ],
    },
    chat: [
      "Did I tell you about the fish that took my eye? Size of a longship. Teeth like oars. I punched it. It's still out there, embarrassed.",
      "I once arm-wrestled a walrus off the coast of Frostmere. Won, too. He cheated. He had tusks.",
      "Bramble says my fish was a cod. Grenna says it was a gull, and that she was there. She wasn't there. ...Was she there?",
      "Sailed to the edge of the world once. The sea just pours off into the stars. Lovely view. Terrible fishing.",
      "The longship on the beach? That's the Laughing Gull. My old girl. Took us through storms that would've drowned a god.|Then one day she got tired. So did I. So here we both are. Resting. Mostly.",
      "Corvin sold me a map to a sea-serpent's hoard once. Found a boot full of eels. Paid him in eels. Fair's fair.",
      "Mothwyn asked me if the sea really glows far out at night. It does, shipmate. Little lights, deep down. I don't lie about that one.",
      "Morrow won't set foot on the dock. Says the sea is 'undocumented.' I offered to document it. He said that's what he's afraid of.",
      "Grilled fish, a mug of mead and a fire. That's all a sailor wants. That, and a fish the size of a longship. Mounted.",
      "The trick to a good story, sprat, is to believe it first. Then the fish grows on its own.",
      "Know why the patch is on the left? Keeps the good eye on the sea. The patch watches the land. Fair trade.",
      "Morrow wants a fish for every tank in that Barrow. I offered him a whale. He said he hasn't the shelf.",
      "Gulls are thieves, crabs are liars, and herring are the most honest fish in the sea. Plain, grey and always there.",
      "When I was a pup, I wanted to see every sea there was. Now I just want to see this one clear. Just once.",
      "I've a lucky hook. Never caught a fish with it. Lucky for the fish.",
      "Mead is sailing without the boat. Stew is sailing without the sea. Bramble disagrees. Bramble has never sailed.",
      "Storms? Just the sea saying hello. Loudly. With its whole chest.",
      "I've a scar for every sea I've sailed. Want to see the one from the kraken? ...It's under the other scar. Sorry.",
      "Your grandmother fished off this very dock. Out-caught me most days. Never let me forget it. I miss the ribbing.",
      "The Gull's bell rings at midnight. I ring it. Or the wind does. Some nights I'm not there, and it rings anyway. Funny, that.",
      "Ever seen a Lantern-Angler? Little light on its head, bobbing in the black. Like a ghost, fishing for ghosts.",
      "Mothwyn's lanterns look grand from the water. Like the village is waving you home. Every sailor needs that.",
    ],
    weather: {
      clear: [
        "Clear skies, calm seas! Perfect day to fish, sprat. Or to lie on the dock and pretend to.",
        "Sun on the water! You can see all the way to the horizon. Nothing there. Glorious, though.",
      ],
      overcast: [
        "Grey sky, grey sea, grey herring. Everything matches. Very fashionable.",
        "Overcast. Good fishing. Fish don't like the glare either.",
      ],
      fog: [
        "Pea-soup fog. Can't see bow from stern. Keep a torch lit and a hand on something solid.",
        "In fog like this, sailors lose their way home. That's why I ring the bell. ...Stay near it, eh?",
      ],
      rain: [
        "Rain! Mire Eels love the rain. Get to Blackwater and you'll catch yourself a slithery supper.",
        "Rain on the water. Every drop's a fish kissing the surface. That's not science. That's poetry.",
      ],
      storm: [
        "Storm's up! Batten the hatches! I haven't got hatches. I'll batten my hat.",
        "The sea's in a rage today. Stay off the dock, shipmate. Even I don't fish in this. ...Much.",
      ],
      snow: [
        "Snow on the dock. Slippery as an eel's apology. Mind your step.",
        "Winter sea's cold enough to stop your heart. And somewhere down there, the Sovereign's stirring.",
      ],
    },
    season: {
      spring: [
        "The Thaw! Tide Mackerel run in spring. Fast, striped and cheeky. Like me in my youth.",
        "Spring tides run high. Good time to mend nets. Bad time to mend my reputation.",
        "Grey Herring by day, sprat. Easy and honest, and they don't bite back. Much.",
      ],
      summer: [
        "Brightwane! Long days on the water. The mackerel are still running, and so's my mouth.",
        "Summer's the best season for fishing. And for tall tales. The fish grow in the heat.",
        "The sea's almost blue in Brightwane. Almost. Squint and you'll see it.",
      ],
      autumn: [
        "Rotfall. The Rimecod come in when the water chills. Fat, white and grumpy. Delicious.",
        "The Ghost Carp rise in Blackwater on autumn nights. Late. Pale. Rare as a true word from my mouth.",
        "Autumn storms roll in fast. Keep an eye on the sky. Keep two, if you've got 'em.",
      ],
      winter: [
        "Deepfrost. Cold water, strange fish. The Rimecod are still biting, if your fingers are.",
        "Winter nights on the dock... the bell tolls midnight, and the water goes very, very still.",
        "Deepfrost's when the Sovereign walks. Swims. Reigns. Whatever it is a drowned king does.",
      ],
    },
    hearts: {
      2: ["You're good company, sprat. You laugh in the right places. And you don't check my facts. That's rare."],
      4: ["I sailed with a crew of nine on the Laughing Gull. Best crew on the northern sea.|We sang so loud the whales complained. Formally. In writing."],
      6: ["The storm that beached the Gull... it took the crew. All but me. I swam.|I still don't know why the sea let me go. I've been trying to earn it ever since."],
      8: ["The fish is real, mind. But the eye... I lost it pulling my mate Tollak out of the water.|I couldn't hold on to him. The fish story's easier to tell. You understand."],
      10: ["I ring that bell every midnight for my crew. I think I've been waiting for someone to come home.|Then you washed up. Salt in your hair, sand in your boots. Somebody came home, shipmate. That'll do. That'll more than do."],
    },
    gift: {
      loved: [
        "{item}! By salt and stars! You've made an old fox very happy, shipmate. I'm telling everyone. Twice.",
        "{item}?! For me? I'll tell this story till I'm grey. Greyer. It'll get bigger every time.",
        "Oh, {item}... now that's a gift fit for a sea-king. I'll never forget this, sprat.",
      ],
      liked: [
        "{item}! Now you're speaking my language. Salty, fishy and generous.",
        "Ahoy, {item}! That'll do nicely. You've a good eye. Better than mine, anyway. Ha!",
        "{item}. You know the way to a sailor's heart. It's through the stomach. Or the tackle box.",
      ],
      neutral: [
        "{item}? Ha! Thanks, shipmate. Can't fish with it, but I'll find a use.",
        "{item}. Well, it's not a fish, but it's a kindness. I'll take a kindness.",
        "{item}! Aye, thank you. I'll keep it aboard the Gull. She likes presents.",
      ],
      disliked: [
        "{item}? Ah... shipmate... that's the kind of thing you throw overboard. Politely.",
        "{item}. Hm. Did you lose a bet? It's alright. We've all lost bets.",
        "{item}... I'll use it as ballast. That's a sailor's compliment. Sort of.",
      ],
      already: [
        "Another? You'll sink me, sprat! One gift a day, or I'll run aground.",
        "Ha! Already had my treasure for the day. Save it for tomorrow's tide.",
        "Easy, shipmate. A sailor can only take so much kindness before he starts crying on the dock.",
      ],
    },
    request: {
      ask: [
        "Could you fetch me {qty} {item}, shipmate? For a project. A very secret, very nautical project.",
        "Ahoy, {player}! I need {qty} {item}. Don't ask why. Well, ask. I'll lie. It'll be a great story.",
        "Bring me {qty} {item} and I'll tell you the true story of my eye. The truest one yet.",
      ],
      thanks: [
        "{item}! Just what I needed! You're a better mate than any I've sailed with. Don't tell them.",
        "Ha! The {item}! Knew I could count on you. I'd count higher, but I ran out of fingers.",
        "That's the stuff, sprat. You've earned a story and a seat by my fire. Both free. The story's worth more.",
      ],
      pending: [
        "Any luck with the {item}? I need {qty}. The project's waiting. Patiently. Like a crab.",
        "The {item}, shipmate! {qty} of 'em! My secret project won't finish itself. It's barely started.",
        "Still hunting for {item}? No rush. The tide waits for no fox, but I'll wait for you.",
      ],
    },
    hearth: {
      1: ["The Hearth's brighter! I could see it from the dock last night. Like a lighthouse. For all of us."],
      2: ["Two runes! Folk are singing at the Hearth again. Badly. Gloriously badly."],
      3: ["Halfway, shipmate! That's more than any captain I sailed under ever managed. Proud of you."],
      4: ["Four! The fog lifted off the bay long enough to see the next isle over. Never knew it was so close."],
      5: ["Five runes. One more, and then... then the big fish. Big stag. Same thing, really. More antlers."],
      6: ["Six. The altar's awake. I'll ring the bell for you, sprat, so you can find your way back. Every hour, if I have to."],
      dawn: [
        "Look at that! The sea's gold! It's GOLD, shipmate! And I'm not exaggerating! For once in my life, I'm not!",
        "Sunrise over the water. I promised the lads I'd see one here someday. ...They'd have liked you.",
      ],
    },
    role: {
      give_rod: [
        "Living on an island, you'll need one of these. A fishing rod! She's old, but she's got heart.|Cast out, wait for the bite, and when the fish fights, you fight back. Gently. Like dancing with a very wet partner.|Blackwater's east, and the sea's all around. Different fish, different moods. Tell me what you catch. Mine was bigger.",
      ],
      fishing_tips: [
        "Blackwater's got Bog Perch by day, and Old Pike from dawn till midnight, save in high summer. Older than me, those pike. Twice as grumpy.",
        "Mire Eels come out in fresh water at night, and more of 'em when it rains. Slippery devils. Keep a firm grip.",
        "The Ghost Carp only rise in Blackwater late at night, in autumn and winter. Rare. Pale. Like a thought you almost had.",
        "Out at sea it's Grey Herring by day and Hagfish by night. Hagfish are... well. You'll see. Wash your hands after.",
        "Tide Mackerel run in spring and summer. Rimecod come in autumn and winter, when the water's cold enough to bite.",
        "Deep in the night, far out on the grey sea, look for a little light in the water. That's a Lantern-Angler. Rare. Don't follow it home.",
      ],
      sovereign_legend: [
        "There's a king under this dock, shipmate. Drowned with his crown on. The sea kept him, and the crown keeps the sea.|In the dead of winter, once the bell tolls midnight, cast off the very end of the dock. If he rises, hold on.",
        "The Drowned Sovereign. Saw him once. Deepfrost, past midnight, before the fourth bell. Crown of barnacles, eyes like cold coins.|Only at the dock's end. Only in winter. Catch him, sprat, and I'll believe every story you ever tell.",
      ],
    },
  },
};
