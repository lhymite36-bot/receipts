/* Idea bank: myth-busting / "people say X but…" claims for Receipts — science, money, internet.
   Each idea suggests a format (see shortgen FORMATS) and a length. */
(function () {
  'use strict';
  const VTS = (window.VTS = window.VTS || {});
  // [idea, format, length?]  length defaults to 60 s; '30' for quick ones
  const BANK = {
    'Science myths': [
      ['People say you only use 10% of your brain. Here\'s the receipt.', 'myth-fact', '30'],
      ['Myth: cracking your knuckles causes arthritis. Fact drop.', 'myth-fact'],
      ['People say goldfish have a 3-second memory. Receipts say otherwise.', 'got-receipts', '30'],
      ['Lightning never strikes the same place twice — or does it?', 'people-say'],
      ['Myth vs fact: sugar makes kids hyper.', 'myth-fact'],
      ['Claim: "humans only have 5 senses." Skeptic vs Claim Guy.', 'skeptic-vs-claim'],
      ['People say hair and nails grow after death. Stamp this one.', 'stamp-it', '30'],
      ['3 internet "science facts" that are quietly wrong.', 'signs'],
      ['Expectation vs reality: what "detox teas" actually do.', 'expectation', '30'],
      ['Storytime: the viral "microwaved water is deadly" post I fell for.', 'storytime', '30'],
    ],
    'Money myths': [
      ['People say credit cards always ruin you. The boring receipt.', 'people-say'],
      ['Myth: you need perfect credit to get a loan.', 'myth-fact'],
      ['Claim: "renting is throwing money away." Skeptic has receipts.', 'skeptic-vs-claim'],
      ['People say rich people don\'t use coupons. Stamp check.', 'stamp-it', '30'],
      ['Myth vs fact: "I\'ll save once I earn more."', 'myth-fact'],
      ['3 money "rules" TikTok made up that banks quietly ignore.', 'signs'],
      ['Expectation vs reality: the "side hustle will pay rent" plan.', 'expectation', '30'],
      ['Rating money advice: "buy the latte", "no avocado toast", index funds.', 'rating'],
      ['Nobody: / Me: believing a "guaranteed 40% returns" ad.', 'nobody-me', '30'],
      ['POV: you thought "buy now pay later" was free money.', 'pov', '30'],
    ],
    'Internet claims': [
      ['People say "the algorithm hates me." Here\'s what it actually does.', 'people-say'],
      ['Myth: deleting your account erases everything forever.', 'myth-fact', '30'],
      ['Claim Guy: "VPN makes you completely anonymous." Skeptic: receipts.', 'skeptic-vs-claim'],
      ['3 "life hacks" that never worked (and why the thumbnail lied).', 'signs'],
      ['Stamp it: "this one weird trick doctors hate."', 'stamp-it', '30'],
      ['Expectation vs reality: going viral overnight.', 'expectation', '30'],
      ['People say AI can\'t be wrong. Drop the receipt.', 'got-receipts'],
      ['Rating viral claims: flat Earth, chemtrails, "secret menu".', 'rating'],
      ['Storytime: I fact-checked a "NASA lied" TikTok so you don\'t have to.', 'storytime'],
      ['POV: you believed the fake celebrity death post again.', 'pov', '30'],
    ],
    'Food & health claims': [
      ['People say "you need 8 glasses of water a day" — source?', 'people-say'],
      ['Myth vs fact: "breakfast is the most important meal."', 'myth-fact'],
      ['Claim: "alkaline water changes your body pH." Stamp: MYTH.', 'stamp-it', '30'],
      ['3 "superfoods" that are just… food with a PR team.', 'signs'],
      ['Skeptic vs Claim Guy: "carbs after 6pm make you fat."', 'skeptic-vs-claim'],
      ['Expectation vs reality: the 30-day juice cleanse.', 'expectation', '30'],
      ['People say MSG is poison. The science receipt.', 'got-receipts'],
      ['Myth: "natural means safe." Counterexamples, please.', 'myth-fact'],
      ['Rating wellness claims: charcoal lemonade, ice baths, raw liver.', 'rating'],
      ['Nobody: / Me: buying the supplement because the ad used the word "clinical".', 'nobody-me', '30'],
    ],
    'History & "trust me bro"': [
      ['People say Napoleon was short. Measurement receipts.', 'people-say', '30'],
      ['Myth: Vikings wore horned helmets.', 'myth-fact', '30'],
      ['Claim: "medieval people thought the Earth was flat." Skeptic enters.', 'skeptic-vs-claim'],
      ['3 "fun facts" your teacher told you that historians hate.', 'signs'],
      ['Stamp it: "Great Wall is visible from space with the naked eye."', 'stamp-it', '30'],
      ['Storytime: the viral "ancient aliens built the pyramids" reel.', 'storytime'],
      ['People say carrots give you night vision (WW2 propaganda receipt).', 'got-receipts'],
      ['Expectation vs reality: "they lived to 30 in the past."', 'expectation'],
    ],
    'Tech & gadget myths': [
      ['People say leaving your phone on charge overnight destroys the battery.', 'people-say'],
      ['Myth: closing apps saves a ton of battery.', 'myth-fact', '30'],
      ['Claim Guy: "incognito mode means nobody can track you."', 'skeptic-vs-claim'],
      ['Stamp it: "macs don\'t get viruses."', 'stamp-it', '30'],
      ['3 "hacks" that void your warranty for no reason.', 'signs'],
      ['POV: you bought the "gaming" mouse pad for +50 FPS.', 'pov', '30'],
      ['People say more megapixels = better photos. Drop the receipt.', 'got-receipts'],
      ['Rating tech claims: "5G fries your brain", "bluescreen is a virus", airplane mode myths.', 'rating'],
    ],
    'Space & nature claims': [
      ['People say there\'s no gravity in space. Physics receipt.', 'people-say'],
      ['Myth: the Great Wall is the only man-made thing visible from space.', 'myth-fact', '30'],
      ['Claim: "the moon landing was fake." Skeptic brings receipts.', 'skeptic-vs-claim'],
      ['Stamp it: "sharks can\'t get cancer."', 'stamp-it', '30'],
      ['3 nature "facts" nature documentaries quietly walked back.', 'signs'],
      ['People say a penny dropped from a skyscraper can kill you.', 'got-receipts', '30'],
      ['Expectation vs reality: "black holes suck everything forever instantly."', 'expectation'],
      ['Storytime: the viral "we only see 1% of the ocean" post.', 'storytime'],
    ],
    'Work & school myths': [
      ['People say multitasking makes you productive. Receipt: no.', 'people-say'],
      ['Myth: you have to be a morning person to succeed.', 'myth-fact'],
      ['Claim: "learning styles (visual/auditory) are science." Stamp check.', 'stamp-it'],
      ['3 "study tips" that feel smart and do almost nothing.', 'signs'],
      ['Skeptic vs Claim Guy: "cramming works if you\'re smart enough."', 'skeptic-vs-claim'],
      ['Nobody: / Me: highlighting every line and calling it studying.', 'nobody-me', '30'],
      ['POV: you believed "follow your passion and money follows."', 'pov', '30'],
      ['Rating career advice: hustle porn, "quiet quitting", LinkedIn grindset.', 'rating'],
    ],
  };
  const IDEAS = [];
  Object.entries(BANK).forEach(([cat, list]) => list.forEach(([text, format, length]) => IDEAS.push({ cat, text, format, length: length || '60' })));
  const TRENDS = [
    { id: 'myth-fact', name: 'Myth vs Fact', why: 'Stamp MYTH then FACT — built-in pattern interrupt and share bait ("send this to the friend who still believes it").', ex: 'Myth: you only use 10% of your brain' },
    { id: 'people-say', name: 'People say…', why: 'Names the viral claim in the hook, then drops the receipt. Curiosity gap in one second.', ex: 'People say MSG is poison. Receipts:' },
    { id: 'got-receipts', name: 'Got receipts', why: 'Dry smug energy: claim → source → punchline. Comment bait = "which claim should I stamp next?"', ex: 'Got receipts: goldfish memory edition' },
    { id: 'skeptic-vs-claim', name: 'Skeptic vs Claim Guy', why: 'Two-person sketch: Claim Guy oversells, Skeptic stamps it. Fast back-and-forth = rewatches.', ex: 'Claim Guy: "VPN = anonymous." Skeptic: "…"'},
    { id: 'stamp-it', name: 'Stamp it', why: 'Big red MYTH/FACT stamps on screen. Works muted; perfect for comic-ink look.', ex: 'Stamp it: alkaline water changes your pH' },
    { id: 'signs', name: '3 fake facts you still believe', why: 'List format + identity bait ("wait… I believed #2").', ex: '3 internet science facts that are quietly wrong' },
    { id: 'expectation', name: 'Expectation vs Reality', why: 'Split-screen reveal is a free pattern interrupt.', ex: 'Going viral overnight: expectation vs reality' },
    { id: 'rating', name: 'Rating viral claims', why: 'Scores create disagreement → comments.', ex: 'Flat Earth: 0/10 · Secret menu: 4/10' },
    { id: 'pov', name: 'POV:', why: 'Puts the viewer inside the moment they got fooled.', ex: 'POV: you believed the fake celebrity death post' },
    { id: 'nobody-me', name: 'Nobody: / Me:', why: 'Meme shape everyone knows; hook lands instantly.', ex: 'Nobody: / Me: buying the "clinical" supplement' },
    { id: 'storytime', name: 'Storytime', why: 'Narrative hold + twist = rewatches.', ex: 'I fact-checked a NASA-lied TikTok' },
    { id: 'classic', name: 'Hook + 3 receipts', why: 'Clear promise and 3 concrete callouts — best for saves.', ex: '3 money myths that quietly cost you' },
  ];
  function surprise(rnd) { const r = rnd || Math.random; return IDEAS[Math.floor(r() * IDEAS.length)]; }
  function byCategory() { return BANK; }
  VTS.ideas = { IDEAS, TRENDS, BANK, surprise, byCategory, COUNT: IDEAS.length };
}());
