// Run with `npm test` (Node strips the types). Throws on the first mismatch.
import { DEFAULT_CATEGORIES as cats, days, isYmd, localParse, period, summarize, type Entry } from './lib.ts';

const eq = (got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`\n got: ${JSON.stringify(got)}\nwant: ${JSON.stringify(want)}`);
};
const T = '2026-09-25'; // a Friday
const parse = (s: string) => localParse(s, cats, T).map(d => [d.item, d.quantity, d.amount, d.category, d.date]);

eq(parse('chai 15, 2 autos 40 each, zomato 250 yesterday, movie 300'), [
  ['chai', 1, 15, 'chai', T],
  ['autos', 2, 80, 'travel', T],
  ['zomato', 1, 250, 'food', '2026-09-24'],
  ['movie', 1, 300, 'fun', T],
]);
eq(parse('2 autos 40\nrent 1.5k and samosa ₹20 & electricity 1,250rs'), [
  ['autos', 2, 40, 'travel', T],
  ['rent', 1, 1500, 'bills', T],
  ['samosa', 1, 20, 'chai', T],
  ['electricity', 1, 1250, 'bills', T],
]);
eq(parse('lunch'), [['lunch', 1, null, 'food', T]]);
eq(parse('coca cola 40, rs 99 socks'), [['coca cola', 1, 40, 'chai', T], ['socks', 1, 99, 'misc', T]]);

eq(period('week', 0, T), { start: '2026-09-21', end: '2026-09-27' });
eq(period('week', 1, '2026-09-21'), { start: '2026-09-14', end: '2026-09-20' });
eq(period('month', 1, '2026-03-31'), { start: '2026-02-01', end: '2026-02-28' });
eq(period('day', 1, '2026-03-01'), { start: '2026-02-28', end: '2026-02-28' });
eq([isYmd('2026-02-30'), isYmd('2026-02-28'), isYmd('28-02-2026')], [false, true, false]);

const e = (item: string, amount: number, date: string, quantity = 1): Entry =>
  ({ id: 0, item, amount, date, quantity, category: 'chai', emoji: '☕', createdAt: 0 });
const s = summarize([e('Chai', 30, '2026-09-21', 2), e('chai ', 15, '2026-09-23'), e('Shoes', 2499, '2026-09-23')], days('2026-09-21', T));
eq([s.total, s.items[0], s.biggest?.item, s.topDay, s.noSpend], [2544, { item: 'Chai', qty: 3, total: 45 }, 'Shoes', { date: '2026-09-23', total: 2514 }, 3]);

console.log('✅ lib checks passed');
