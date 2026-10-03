// Run with `npm test` (Node strips the types). Throws on the first mismatch.
import { balances, buildMemory, pullUdhaar, DEFAULT_CATEGORIES as cats, days, equiv, streak, isYmd, localParse, period, summarize, type Entry, type Memory } from './lib.ts';

const eq = (got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`\n got: ${JSON.stringify(got)}\nwant: ${JSON.stringify(want)}`);
};
const T = '2026-09-25'; // a Friday
const Y = '2026-09-24';
const parse = (s: string, memory?: Memory) => localParse(s, cats, memory, T).map(d => [d.item, d.quantity, d.amount, d.category, d.date]);

// typed, with commas
eq(parse('chai 15, 2 autos 40 each, zomato 250 yesterday, movie 300'), [
  ['chai', 1, 15, 'chai', T], ['autos', 2, 80, 'travel', T], ['zomato', 1, 250, 'food', Y], ['movie', 1, 300, 'fun', T],
]);
// spoken: no commas, number words, "two fifty" = 250
eq(parse('chai fifteen two autos forty each zomato two fifty yesterday movie three hundred'), [
  ['chai', 1, 15, 'chai', T], ['autos', 2, 80, 'travel', T], ['zomato', 1, 250, 'food', Y], ['movie', 1, 300, 'fun', T],
]);
// what the on-device model actually heard for "chai fifteen…" (from a test clip)
eq(parse('Chai F-15, 2 autos 40 each, Zomato 250 yesterday, movie 300.'), [
  ['Chai', 1, 15, 'chai', T], ['autos', 2, 80, 'travel', T], ['Zomato', 1, 250, 'food', Y], ['movie', 1, 300, 'fun', T],
]);
// voice punctuation splitting item from price; a leading date covers everything
eq(parse('Yesterday: Two autos, 40 each. Lunch, 120 rupees.'), [['autos', 2, 80, 'travel', Y], ['Lunch', 1, 120, 'food', Y]]);
// quantities and prices every which way
eq(parse('samosa 2 @ 15, chai x3 45, 2 x 20 vada pav, samosa 2 30, do chai 30'), [
  ['samosa', 2, 30, 'chai', T], ['chai', 3, 45, 'chai', T], ['vada pav', 2, 40, 'chai', T], ['samosa', 2, 30, 'chai', T], ['chai', 2, 30, 'chai', T],
]);
eq(parse('paid 500 for electricity bill and 2 samosa for 30'), [['electricity bill', 1, 500, 'bills', T], ['samosa', 2, 30, 'chai', T]]);
eq(parse('two hundred and fifty for pizza, 1.5k rent, rs 99 socks, 1,250rs wifi, paanch sau groceries'), [
  ['pizza', 1, 250, 'food', T], ['rent', 1, 1500, 'bills', T], ['socks', 1, 99, 'misc', T], ['wifi', 1, 1250, 'bills', T], ['groceries', 1, 500, 'food', T],
]);
// weights and plates are counts; trailing "subscription"/"with friends" describe the item
eq(parse('aloo 1 kg 40, 2 kg atta 110, 2 plates momos 120, Spotify 119 subscription'), [
  ['aloo', 1, 40, 'food', T], ['atta', 2, 110, 'food', T], ['momos', 2, 120, 'food', T], ['Spotify subscription', 1, 119, 'bills', T],
]);
// amounts first, counts without prices, trailing descriptions
eq(parse('200 groceries 50 milk'), [['groceries', 1, 200, 'food', T], ['milk', 1, 50, 'food', T]]);
eq(parse('3 samosa, lunch'), [['samosa', 3, null, 'chai', T], ['lunch', 1, null, 'food', T]]);
eq(parse('lunch 120 with friends, movie 300 at pvr on monday'), [['lunch with friends', 1, 120, 'food', T], ['movie at pvr', 1, 300, 'fun', '2026-09-21']]);
eq(parse('last friday beer 400, day before yesterday metro 40'), [['beer', 1, 400, 'fun', '2026-09-18'], ['metro', 1, 40, 'travel', '2026-09-23']]);
// categories: whole words ("coca cola" isn't Ola), longest keyword wins, typos, your own history
eq(parse('coca cola 40, amazon prime 299, phone recharge 239, barber 150, zomatto 300, swigy 200'), [
  ['coca cola', 1, 40, 'chai', T], ['amazon prime', 1, 299, 'bills', T], ['phone recharge', 1, 239, 'bills', T],
  ['barber', 1, 150, 'care', T], ['zomatto', 1, 300, 'food', T], ['swigy', 1, 200, 'food', T],
]);
const e = (item: string, amount: number, date: string, quantity = 1, category = 'chai', emoji = '☕'): Entry =>
  ({ id: 0, item, amount, date, quantity, category, emoji, createdAt: 0 });
// your history wins by majority, and typos of things you've logged still land right
const memory = buildMemory([e('Momos', 80, T, 1, 'food', '🥟'), e('whiskas', 120, T, 1, 'gifts'), e('Whiskas', 90, T, 1, 'gifts'), e('whiskas', 90, T, 1, 'misc')]);
eq(parse('momo 60, whiskas 99, whiskaz 70', memory), [['momo', 1, 60, 'food', T], ['whiskas', 1, 99, 'gifts', T], ['whiskaz', 1, 70, 'gifts', T]]);
eq(localParse('momos 60', cats, memory, T)[0].emoji, '🥟');

eq(period('week', 0, T), { start: '2026-09-21', end: '2026-09-27' });
eq(period('week', 1, '2026-09-21'), { start: '2026-09-14', end: '2026-09-20' });
eq(period('month', 1, '2026-03-31'), { start: '2026-02-01', end: '2026-02-28' });
eq(period('day', 1, '2026-03-01'), { start: '2026-02-28', end: '2026-02-28' });
eq([isYmd('2026-02-30'), isYmd('2026-02-28'), isYmd('28-02-2026')], [false, true, false]);

const s = summarize([e('Chai', 30, '2026-09-21', 2), e('chai ', 15, '2026-09-23'), e('Shoes', 2499, '2026-09-23')], days('2026-09-21', T));
eq([s.total, s.items[0], s.biggest?.item, s.topDay, s.noSpend], [2544, { item: 'Chai', qty: 3, total: 45 }, 'Shoes', { date: '2026-09-23', total: 2514 }, 3]);

console.log('✅ lib checks passed');

// Hindi / Hinglish, split bills, streaks
eq(parse('dedh sau ki sabzi, paanch sau ka petrol'), [['sabzi', 1, 150, 'food', T], ['petrol', 1, 500, 'travel', T]]);
eq(parse('कल चाय १५ और ऑटो पचास'), [['चाय', 1, 15, 'chai', Y], ['ऑटो', 1, 50, 'travel', Y]]);
eq(parse('dinner 1200 split 4'), [['dinner (1/4)', 1, 300, 'food', T]]);
eq(parse('pizza 900 split in 3 ways, chai 20'), [['pizza (1/3)', 1, 300, 'food', T], ['chai', 1, 20, 'chai', T]]);
eq(streak(new Set([Y, '2026-09-23', '2026-09-21']), T), 2);
eq(equiv(1200), ['4 biryanis 🍛', '4 movie tickets 🎬']);
console.log('extras ok');

// udhaar: pulled out before the normal parser, reason optional, split-with names owe you their share
const u = (s: string) => {
  const r = pullUdhaar(s, cats, undefined, T);
  return [parse(r.rest), r.drafts.map(d => [d.iou ?? d.category, d.person ?? '', d.item, d.amount, d.date])];
};
eq(u('chai 15, gave rahul 500 for books, amit se 200 liye'), [[['chai', 1, 15, 'chai', T]], [['lent', 'Rahul', 'books', 500, T], ['borrowed', 'Amit', '', 200, T]]]);
eq(u('Rahul paid back 300 yesterday. returned 200 to amit; rahul ko paanch sau diye'), [[], [
  ['got', 'Rahul', '', 300, Y], ['repaid', 'Amit', '', 200, T], ['lent', 'Rahul', '', 500, T],
]]);
eq(u('took 1,500 from papa for rent, paid amit back 50, got 100 back from neha'), [[], [
  ['borrowed', 'Papa', 'rent', 1500, T], ['repaid', 'Amit', '', 50, T], ['got', 'Neha', '', 100, T],
]]);
eq(u('dinner 1200 split with rahul, amit, chai 15'), [[['chai', 1, 15, 'chai', T]], [
  ['food', '', 'dinner (1/3)', 400, T], ['lent', 'Rahul', 'dinner', 400, T], ['lent', 'Amit', 'dinner', 400, T],
]]);
// not udhaar: plain payments and "took a cab from…" stay spending
eq(u('took cab from station 200, paid 500 for electricity bill')[1], []);
const ious = pullUdhaar('gave rahul 500, Rahul paid back 200, amit se 300 liye, neha ko 100 diye, neha returned 100', cats, undefined, T).drafts
  .map((d, i) => ({ ...d, id: i, amount: d.amount!, createdAt: 0 }));
eq(balances(ious).map(b => [b.name, b.net]), [['Rahul', 300], ['Amit', -300], ['Neha', 0]]);
console.log('udhaar ok');
