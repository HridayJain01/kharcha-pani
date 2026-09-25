// Pure logic: types, defaults, dates, the offline parser and period stats.
// No DOM and no Dexie in here, so `npm test` can run it in plain Node.

export interface Category { id: string; name: string; emoji: string; color: string; hint: string; order: number }
export interface Entry { id: number; item: string; quantity: number; amount: number; category: string; date: string; emoji: string; createdAt: number }
export interface PhotoRef { id?: number; blob: Blob }
export type Draft = Omit<Entry, 'id' | 'amount' | 'createdAt'> & { amount: number | null; photos: PhotoRef[] };

// `hint` does double duty: it describes the category to Gemini and feeds the offline keyword match.
export const DEFAULT_CATEGORIES: Category[] = (
  [
    ['chai', 'Chai & Snacks', '☕', '#FFD23F', 'chai, tea, coffee, samosa, snacks, biscuit, maggi, vada pav, pakoda, juice, lassi, cola, cold drink, ice cream'],
    ['food', 'Food & Feasts', '🍛', '#FF5A36', 'zomato, swiggy, lunch, dinner, breakfast, meal, thali, biryani, pizza, burger, dosa, restaurant, groceries, blinkit, zepto, milk, vegetables, fruits'],
    ['travel', 'Getting Around', '🛺', '#3A86FF', 'auto, uber, ola, rapido, metro, train, bus, cab, taxi, petrol, fuel, parking, toll, flight'],
    ['shopping', 'Shopping Spree', '🛍️', '#FF4FA3', 'amazon, flipkart, myntra, clothes, shoes, shirt, jeans, gadget, headphones, stationery'],
    ['bills', 'Boring Bills', '🧾', '#9B5DE5', 'recharge, rent, electricity, wifi, internet, broadband, subscription, netflix, spotify, hotstar, bill, emi'],
    ['fun', 'Fun & Flex', '🎉', '#B8F135', 'movie, outing, party, game, concert, bowling, drinks, beer, pub, trip'],
    ['care', 'Self Care', '💆', '#2EC4B6', 'health, medicine, doctor, pharmacy, gym, haircut, salon, spa, grooming, skincare'],
    ['gifts', 'Gifts & Good Deeds', '🎁', '#FF9F1C', 'gift, present, donation, charity, birthday'],
    ['misc', 'Oops, Misc', '🌀', '#A8A29E', 'anything else'],
  ] as const
).map(([id, name, emoji, color, hint], i) => ({ id, name, emoji, color, hint, order: id === 'misc' ? 99 : i }));

export const catOf = (cats: Category[], id: string) =>
  cats.find(c => c.id === id) ?? cats.find(c => c.id === 'misc') ?? DEFAULT_CATEGORIES.find(c => c.id === 'misc')!;

// Dates are local "YYYY-MM-DD" strings. Never toISOString(): that's UTC and flips the day before 5:30am IST.
export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const toDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const today = () => ymd(new Date());
export const addDays = (s: string, n: number) => {
  const d = toDate(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(toDate(s)) === s;
export const days = (start: string, end: string) => {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
};

export const money = (n: number, cur = '₹') =>
  cur + n.toLocaleString(cur === '₹' ? 'en-IN' : undefined, { maximumFractionDigits: 2 });

export const dayLabel = (s: string, t = today()) =>
  s === t ? 'Today'
  : s === addDays(t, -1) ? 'Yesterday'
  : toDate(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: s.slice(0, 4) === t.slice(0, 4) ? undefined : 'numeric' });

// Keyword match on word starts: "autos" hits "auto", but "coca cola" doesn't hit "ola".
export function guessCategory(text: string, cats: Category[]) {
  const hay = ' ' + text.toLowerCase();
  return cats.find(c => [c.id, ...c.hint.split(',')].some(k => (k = k.trim().toLowerCase()) && hay.includes(' ' + k))) ?? catOf(cats, 'misc');
}

// Offline fallback for when there's no key, no network, or Gemini flops.
export function localParse(text: string, cats: Category[], t = today()): Draft[] {
  return text
    .replace(/(\d),(?=\d)/g, '$1') // 1,500 -> 1500, so the comma split below doesn't cut it
    .split(/[,;\n]|\band\b|&/i)
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .map(chunk => {
      const date = /\byesterday\b/i.test(chunk) ? addDays(t, -1) : t;
      const s = chunk
        .replace(/(\d)\s*(rs|rupees?|inr)\b\.?/gi, '$1 ')
        .replace(/\b(yesterday|today|rs|rupees?|inr)\b\.?|₹|\/-/gi, ' ');
      const nums = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(k\b)?/gi)].map(m => Number(m[1]) * (m[2] ? 1000 : 1));
      const quantity = nums.length > 1 ? Math.max(1, Math.round(nums[0])) : 1;
      let amount = nums.length ? nums[nums.length - 1] : null;
      if (amount !== null && /\b(each|per)\b/i.test(s)) amount *= quantity;
      const item = s.replace(/\d+(?:\.\d+)?\s*(k\b)?|\b(each|per|for|x)\b/gi, ' ').replace(/\s+/g, ' ').trim() || 'something';
      const cat = guessCategory(item, cats);
      return { item, quantity, amount, category: cat.id, date, emoji: cat.emoji, photos: [] };
    });
}

export type Unit = 'day' | 'week' | 'month';

// Weeks start on Monday. offset 0 = the period containing t, 1 = the one before, ...
export function period(unit: Unit, offset: number, t = today()) {
  const d = toDate(t);
  if (unit === 'day') {
    const s = addDays(t, -offset);
    return { start: s, end: s };
  }
  if (unit === 'week') {
    const start = addDays(t, -((d.getDay() + 6) % 7) - 7 * offset);
    return { start, end: addDays(start, 6) };
  }
  return {
    start: ymd(new Date(d.getFullYear(), d.getMonth() - offset, 1)),
    end: ymd(new Date(d.getFullYear(), d.getMonth() - offset + 1, 0)),
  };
}

const sum = (es: Entry[]) => es.reduce((n, e) => n + e.amount, 0);

// dayList = the days that count for "no-spend days" (already clipped to today and to the first ever entry).
export function summarize(entries: Entry[], dayList: string[]) {
  const group = (key: (e: Entry) => string) => Object.entries(Object.groupBy(entries, key)) as [string, Entry[]][];
  const byDay = Object.fromEntries(group(e => e.date).map(([d, es]) => [d, sum(es)]));
  const topDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
  return {
    total: sum(entries),
    count: entries.length,
    byCat: group(e => e.category)
      .map(([id, es]) => ({ id, total: sum(es), count: es.length }))
      .sort((a, b) => b.total - a.total),
    items: group(e => e.item.trim().toLowerCase())
      .map(([, es]) => ({ item: es[0].item.trim(), qty: es.reduce((n, e) => n + e.quantity, 0), total: sum(es) }))
      .sort((a, b) => b.qty - a.qty || b.total - a.total),
    biggest: entries.reduce<Entry | undefined>((m, e) => (m && m.amount >= e.amount ? m : e), undefined),
    topDay: topDay && { date: topDay[0], total: topDay[1] },
    noSpend: dayList.filter(d => !byDay[d]).length,
  };
}
