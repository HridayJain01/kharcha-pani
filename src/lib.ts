// Pure logic: types, defaults, dates, the offline parser and period stats.
// No DOM and no Dexie in here, so `npm test` can run it in plain Node.

export interface Category { id: string; name: string; emoji: string; color: string; hint: string; order: number }
export interface Entry { id: number; item: string; quantity: number; amount: number; category: string; date: string; emoji: string; createdAt: number }
export interface PhotoRef { id?: number; blob: Blob }
export type Draft = Omit<Entry, 'id' | 'amount' | 'createdAt'> & { amount: number | null; photos: PhotoRef[] };

// `hint` is the user-editable description: it goes to the AI and doubles as extra offline keywords.
export const DEFAULT_CATEGORIES: Category[] = (
  [
    ['chai', 'Chai & Snacks', '☕', '#FFD23F', 'tea, coffee, snacks, drinks'],
    ['food', 'Food & Feasts', '🍛', '#FF5A36', 'meals, food delivery, groceries'],
    ['travel', 'Getting Around', '🛺', '#3A86FF', 'autos, cabs, metro, fuel, tickets'],
    ['shopping', 'Shopping Spree', '🛍️', '#FF4FA3', 'clothes, gadgets, online orders'],
    ['bills', 'Boring Bills', '🧾', '#9B5DE5', 'recharge, rent, electricity, subscriptions'],
    ['fun', 'Fun & Flex', '🎉', '#B8F135', 'movies, outings, games'],
    ['care', 'Self Care', '💆', '#2EC4B6', 'health, grooming, gym'],
    ['gifts', 'Gifts & Good Deeds', '🎁', '#FF9F1C', 'gifts, donations, charity'],
    ['misc', 'Oops, Misc', '🌀', '#A8A29E', 'anything else'],
  ] as const
).map(([id, name, emoji, color, hint], i) => ({ id, name, emoji, color, hint, order: id === 'misc' ? 99 : i }));

// Built-in offline keywords for the default categories (code, not DB, so every install gets updates).
const KEYWORDS: Record<string, string> = {
  chai: 'चाय, समोसा, कॉफी, chai, tea, coffee, cappuccino, latte, espresso, cold coffee, samosa, snack, biscuit, cookie, maggi, vada pav, pav bhaji, pakoda, pakora, bhajiya, kachori, poha, juice, lassi, chaas, cola, coke, pepsi, sprite, thums up, soft drink, cold drink, soda, bisleri, water bottle, ice cream, kulfi, chocolate, chips, namkeen, pani puri, golgappa, bhel, sev puri, dabeli, puff, cake, pastry, donut, sweets, mithai, jalebi, gulab jamun, paan, fries',
  food: 'खाना, सब्जी, दूध, राशन, sabzi, sabji, doodh, khana, ration, atta, zomato, swiggy, eatsure, food, lunch, dinner, breakfast, brunch, meal, thali, biryani, pizza, burger, dosa, idli, vada, paratha, roti, naan, rice, dal, paneer, chicken, mutton, fish, egg, noodles, momo, roll, kebab, shawarma, sandwich, pasta, restaurant, cafe, canteen, mess, tiffin, dhaba, grocery, groceries, kirana, blinkit, zepto, instamart, bigbasket, dmart, milk, bread, vegetables, sabzi, fruits, atta, oil, ghee, curd, dahi, butter, ration, onion, pyaz, tomato, potato, aloo, garlic, ginger, lemon, banana, apple, mango, sugar, salt, masala',
  travel: 'ऑटो, रिक्शा, मेट्रो, पेट्रोल, बस, auto, rickshaw, e-rickshaw, uber, ola, rapido, metro, train, local train, bus, cab, taxi, petrol, diesel, fuel, cng, parking, toll, fastag, flight, irctc, redbus, bike, scooty, puncture, namma yatri, travel',
  shopping: 'amazon, flipkart, myntra, ajio, meesho, nykaa, shopping, clothes, shoes, shirt, t-shirt, tshirt, jeans, kurta, saree, dress, bag, gadget, phone, headphones, earphones, earbuds, charger, cable, laptop, stationery, book, decathlon, ikea, furniture, utensils, lenskart',
  bills: 'बिजली, किराया, रिचार्ज, bijli, kiraya, recharge, phone recharge, rent, electricity, electricity bill, light bill, wifi, internet, broadband, jio, airtel, vi, bsnl, dth, tata play, subscription, netflix, amazon prime, hotstar, spotify, youtube premium, bill, emi, gas, cylinder, water bill, maintenance, insurance, loan, fees, society',
  fun: 'movie, movie ticket, cinema, pvr, inox, bookmyshow, outing, party, game, gaming, playstation, concert, bowling, drinks, beer, alcohol, liquor, pub, bar, club, trip, holiday, vacation, resort, arcade, match, turf, zoo, museum',
  care: 'health, medicine, medical, pharmacy, chemist, doctor, clinic, hospital, dentist, lab test, blood test, checkup, gym, yoga, haircut, salon, parlour, barber, spa, massage, grooming, skincare, shampoo, soap, toothpaste, sunscreen, cream, apollo, pharmeasy, 1mg, netmeds',
  gifts: 'उपहार, gift, present, donation, charity, birthday gift, wedding gift, shagun, temple, mandir, puja, church, gurudwara, offering, tip',
};

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

// ---------- offline parser: no AI, no network ----------

// Lowercase words with a trailing plural "s" dropped, so "Autos" and "auto" compare equal.
export const norm = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim().split(' ')
    .map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');

const BUILTIN = Object.fromEntries(Object.entries(KEYWORDS).map(([id, list]) => [id, list.split(',').map(norm)]));

// What you saved before is the best predictor: item → the category you used most (and its emoji).
export type Memory = Map<string, { category: string; emoji: string; n: number }>;
export function buildMemory(entries: Entry[]): Memory {
  const seen = new Map<string, Map<string, number>>();
  const emoji = new Map<string, string>();
  for (const e of entries) {
    const k = norm(e.item);
    const counts = seen.get(k) ?? seen.set(k, new Map()).get(k)!;
    counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    if (e.emoji) emoji.set(k, e.emoji);
  }
  return new Map([...seen].map(([k, counts]) => {
    const [category, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
    return [k, { category, emoji: emoji.get(k) ?? '', n }];
  }));
}

// Levenshtein distance ≤ max, for typos and voice slips ("zomatto", "samose").
function near(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...row) > max) return false;
    prev = row;
  }
  return prev[b.length] <= max;
}

// Your history first, then whole-word keywords (longest wins: "amazon prime" beats "amazon"), then fuzzy, then Misc.
export function guessCategory(item: string, cats: Category[], memory: Memory = new Map()) {
  const key = norm(item);
  const has = (id: string) => cats.some(c => c.id === id);
  const known = memory.get(key);
  if (known && has(known.category)) return { id: known.category, emoji: known.emoji || catOf(cats, known.category).emoji };
  const lists = cats.map(c => ({ c, words: [c.id, ...c.hint.split(',').map(norm), ...(BUILTIN[c.id] ?? [])].filter(Boolean) }));
  let best: { c: Category; len: number } | undefined;
  for (const { c, words } of lists)
    for (const k of words) if (` ${key} `.includes(` ${k} `) && k.length > (best?.len ?? 0)) best = { c, len: k.length };
  if (best) return { id: best.c.id, emoji: best.c.emoji };
  for (const w of key.split(' ').filter(w => w.length >= 4)) {
    const max = w.length >= 7 ? 2 : 1;
    for (const [k, m] of memory) if (!k.includes(' ') && has(m.category) && near(w, k, max)) return { id: m.category, emoji: m.emoji || catOf(cats, m.category).emoji };
    const hit = lists.find(({ words }) => words.some(k => k.length >= 4 && !k.includes(' ') && near(w, k, max)));
    if (hit) return { id: hit.c.id, emoji: hit.c.emoji };
  }
  const misc = catOf(cats, 'misc');
  return { id: misc.id, emoji: misc.emoji };
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10, bees: 20, pachas: 50, pachaas: 50,
  gyarah: 11, barah: 12, pandrah: 15, pachees: 25, tees: 30, chalis: 40, chaalis: 40, sattar: 70, assi: 80, nabbe: 90, dedh: 1.5, derh: 1.5, dhai: 2.5, adhai: 2.5,
  एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, पाँच: 5, छह: 6, सात: 7, आठ: 8, नौ: 9, दस: 10, बीस: 20, पच्चीस: 25, तीस: 30, चालीस: 40, पचास: 50, साठ: 60, सत्तर: 70, अस्सी: 80, नब्बे: 90, डेढ़: 1.5, ढाई: 2.5,
};
const SCALES: Record<string, number> = { hundred: 100, sau: 100, thousand: 1000, hazar: 1000, hazaar: 1000, k: 1000, lakh: 100000, lac: 100000, सौ: 100, हज़ार: 1000, हजार: 1000, लाख: 100000 };
const CURRENCY = new Set(['rs', 'inr', 'rupee', 'rupees', 'rupaye', 'rupay', 'rupiya', 'bucks', 'रुपये', 'रुपए', 'रुपया', 'रु', '₹', '$']);
const SPLIT = new Set([',', ';', '\n', '.', '&', '+', 'and', 'aur', 'then', 'plus', 'also', 'और']);
const CONNECT = new Set(['for', 'on', 'at', 'with', 'from', 'near', 'in', 'to']);
const MEASURE = new Set('kg kgs g gm gms gram grams l ltr litre litres liter liters ml dozen pc pcs piece pieces plate plates packet packets pkt pack packs cup cups glass glasses bottle bottles box boxes'.split(' '));
const DESCRIBE = new Set('subscription ticket tickets order fare charge charges fee fees refill'.split(' '));
const FILLER = new Set('spent spend paid pay bought buy got get gave give took the a an of some my i me was were is it had have total only around about approx worth last ways way ka ki ke ko mein liye wala wali का की के को में लिए वाला'.split(' '));
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAYS_BACK: Record<string, number> = { today: 0, aaj: 0, yesterday: 1, kal: 1, parso: 2, parson: 2, आज: 0, कल: 1, परसों: 2 };

type Tok = { w: string; raw: string } | { n: number };
const wordAt = (toks: Tok[], i: number) => (toks[i] && 'w' in toks[i] ? (toks[i] as { w: string }).w : '');

// Words and numbers, with spoken numbers merged: "1.5k" = 1500, "two hundred and fifty" = 250,
// "two fifty" = 250 (how prices are said out loud), "paanch sau" = 500.
function tokenize(text: string): Tok[] {
  const raw = text.replace(/[०-९]/g, d => String(d.charCodeAt(0) - 0x966)).replace(/(\d),(?=\d)/g, '$1').match(/\d+(?:\.\d+)?|[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*|[,;\n&+@×₹$]|\.(?!\d)/gu) ?? [];
  const low = raw.map(r => r.toLowerCase());
  const out: Tok[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (/^\d/.test(raw[i])) {
      const scale = SCALES[low[i + 1]];
      out.push({ n: Number(raw[i]) * (scale ?? 1) });
      if (scale) i++;
      continue;
    }
    let total = 0, cur = 0, j = i;
    for (; j < raw.length; j++) {
      const w = low[j], unit = UNITS[w], scale = SCALES[w];
      if (unit !== undefined) {
        if (cur > 0 && cur < 10 && unit >= 10) cur = cur * 100 + unit; // "two fifty"
        else if (!cur || (cur >= 20 && cur % 10 === 0 && unit < 10) || (cur >= 100 && cur % 100 === 0 && unit < 100)) cur += unit;
        else break; // "fifteen two" is two numbers
      } else if (scale && (j > i || w !== 'k')) {
        if (scale === 100) cur = (cur || 1) * 100;
        else [total, cur] = [total + (cur || 1) * scale, 0];
      } else if ((w === 'and' && total + cur >= 100 && cur % 100 === 0 && UNITS[low[j + 1]] !== undefined) || (w === 'a' && SCALES[low[j + 1]])) continue;
      else break;
    }
    if (j > i) {
      out.push({ n: total + cur });
      i = j - 1;
    } else out.push({ w: low[i], raw: raw[i] });
  }
  return out;
}

type Num = { v: number; after: boolean; qty: boolean; unit: boolean; money: boolean };
type Seg = { words: string[]; nums: Num[]; date?: string; tail?: boolean; split?: number };

// A chunk is complete once it has an item and a price: "chai 15", "200 groceries".
const done = (s: Seg) => s.words.length > 0 && s.nums.some(n => !n.qty && (n.after || n.money || n.v > 20));

// The offline parser: splits even comma-less voice text ("chai 15 two autos 40 each"), reads quantities
// ("2 @ 15", "x3", "2 for 30", "40 each"), dates (yesterday, kal, last friday) and guesses categories.
export function localParse(text: string, cats: Category[], memory: Memory = new Map(), t = today()): Draft[] {
  const toks = tokenize(text);
  const segs: Seg[] = [];
  let cur: Seg = { words: [], nums: [] };
  let everyDate: string | undefined; // a date said before anything else covers every entry
  let mark: 'qty' | 'unit' | 'money' | 'split' | undefined; // how to read the next number
  let joiner = ''; // "for"/"with"… kept only if another item word follows

  const flush = () => {
    const prev = segs.at(-1);
    // "Two autos, 40 each": a price that voice punctuation split off rejoins its item.
    if (!cur.words.length && cur.nums.length && prev && !done(prev)) prev.nums.push(...cur.nums.map(n => ({ ...n, after: true })));
    else if (cur.words.length || cur.nums.length) segs.push(cur);
    cur = { words: [], nums: [] };
    joiner = '';
  };

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    const prevNum = i > 0 && 'n' in toks[i - 1];
    const nextNum = i + 1 < toks.length && 'n' in toks[i + 1];
    const last = cur.nums.at(-1);
    if ('n' in tok) {
      if (mark === 'split') { // "dinner 1200 split 4": you pay your share
        [cur.split, mark] = [tok.n, undefined];
        continue;
      }
      // "samosa 2 30": a small count right before a bigger number is a quantity, not a price.
      if (prevNum && last?.after && cur.nums.length === 1 && !last.money && Number.isInteger(last.v) && last.v <= 10 && tok.n > last.v) last.qty = true;
      else if (done(cur)) flush();
      cur.nums.push({ v: tok.n, after: cur.words.length > 0, qty: mark === 'qty', unit: mark === 'unit', money: mark === 'money' });
      mark = undefined;
      joiner = '';
      continue;
    }
    const w = tok.w;
    const weekday = WEEKDAYS.indexOf(w);
    if (w === 'split' || w === 'divided' || w === 'baant') mark = 'split';
    else if (SPLIT.has(w)) flush();
    else if (CURRENCY.has(w)) {
      if (prevNum && last) last.money = true;
      else mark = 'money';
    } else if (w === 'each' || w === 'per' || w === 'ea') {
      if (last) last.unit = true;
      else mark = 'unit';
    } else if (w === 'x' || w === '×') {
      if (prevNum && last) {
        last.qty = true;
        if (nextNum) mark = 'unit'; // "2 x 15"
      } else if (nextNum) mark = 'qty'; // "chai x3"
    } else if (MEASURE.has(w)) {
      if (prevNum && last) last.qty = true; // "2 kg atta 110", "2 plates momos 120"
    } else if (DESCRIBE.has(w) && done(cur) && !nextNum) {
      cur.words.push(tok.raw); // "Spotify 119 subscription"
    } else if (w === '@' || (w === 'at' && nextNum)) {
      if (prevNum && last) last.qty = true;
      mark = 'unit';
    } else if (CONNECT.has(w)) {
      if (nextNum && prevNum && last) last.qty = true; // "2 for 30"
      else if (prevNum && last && !last.after) last.money = true; // "500 for groceries"
      else if (done(cur) && !nextNum) cur.tail = true; // "lunch 120 with friends"
      joiner = w;
    } else if (w in DAYS_BACK || weekday >= 0 || (w === 'day' && wordAt(toks, i + 1) === 'before' && wordAt(toks, i + 2) === 'yesterday')) {
      const back = weekday >= 0
        ? (toDate(t).getDay() - weekday + 7) % 7 || (wordAt(toks, i - 1) === 'last' ? 7 : 0)
        : DAYS_BACK[w] ?? 2; // "day before yesterday"
      if (w === 'day') i += 2;
      if (!segs.length && !cur.words.length && !cur.nums.length) everyDate = addDays(t, -back);
      else cur.date = addDays(t, -back);
    } else if (!FILLER.has(w) && !/^[a-z]$/.test(w)) { // stray letters are speech-to-text noise ("Chai F-15")
      // a new word starts the next entry only after "item price"; after "500 for" it's still naming the item
      if (cur.words.length && cur.nums.some(n => n.after && !n.qty) && !cur.tail) flush();
      if (joiner && cur.words.length) cur.words.push(joiner);
      cur.words.push(tok.raw);
      joiner = '';
    }
  }
  flush();

  return segs.map(s => {
    const firstIsCount = s.nums.length > 1 && !s.nums[0].money && Number.isInteger(s.nums[0].v);
    const qtyN = s.nums.find(n => n.qty) ?? (firstIsCount ? s.nums[0] : undefined);
    const rest = s.nums.filter(n => n !== qtyN);
    let price = rest.findLast(n => n.money) ?? rest.at(-1);
    let quantity = qtyN ? Math.max(1, Math.round(qtyN.v)) : 1;
    // "3 samosa": a lone small number before the item is a count; the card then asks for the price.
    if (!qtyN && price && s.nums.length === 1 && !price.after && !price.money && Number.isInteger(price.v) && price.v <= 10 && s.words.length) {
      quantity = price.v;
      price = undefined;
    }
    const item = s.words.join(' ') || 'something';
    const cat = guessCategory(item, cats, memory);
    const parts = s.split && s.split > 1 ? s.split : 1;
    const amount = price ? Math.round(((price.unit ? price.v * quantity : price.v) / parts) * 100) / 100 : null;
    return { item: parts > 1 ? `${item} (1/${parts})` : item, quantity, amount, category: cat.id, date: s.date ?? everyDate ?? t, emoji: cat.emoji, photos: [] };
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
    weekday: (group(e => String(toDate(e.date).getDay())).map(([d, es]) => [WEEKDAYS[+d], sum(es)] as const).sort((a, b) => b[1] - a[1])[0] ?? [])[0],
  };
}

// Days in a row with at least one entry, ending today (or yesterday, so the streak survives until you log today).
export function streak(dates: Set<string>, t = today()) {
  let d = dates.has(t) ? t : addDays(t, -1), n = 0;
  for (; dates.has(d); d = addDays(d, -1)) n++;
  return n;
}

// "₹1,200 = 80 chais = 4 movie tickets". ponytail: prices are rough Indian city averages, fixed.
const THINGS = [['chais', 15, '☕'], ['samosas', 20, '🥟'], ['auto rides', 60, '🛺'], ['biryanis', 250, '🍛'], ['movie tickets', 300, '🎬'], ['iPhones', 80000, '📱']] as const;
export const equiv = (n: number) =>
  THINGS.filter(([, p]) => n >= p).slice(-2).map(([what, p, e]) => `${Math.floor(n / p).toLocaleString('en-IN')} ${what} ${e}`);

// The guilt face: budget used (%) when there is a budget, else % change vs the last period.
export const guilt = (budgetPct: number | null, changePct: number | null) => {
  const v = budgetPct ?? (changePct === null ? 0 : 50 + changePct);
  return v < 50 ? '😇' : v < 80 ? '😅' : v < 100 ? '😱' : '💀';
};
