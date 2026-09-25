import { getSettings } from './db';
import { catOf, isYmd, today, type Category, type Draft } from './lib';

// Gemini REST, straight from the browser. The key comes from IndexedDB and goes in a header, never the URL.
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

async function gemini(prompt: string, schema: object, system?: string) {
  const { apiKey, model } = await getSettings();
  if (!apiKey) throw new Error('no Gemini key yet');
  const res = await fetch(`${BASE}${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      ...(system && { systemInstruction: { parts: [{ text: system }] } }),
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message ?? `Gemini said ${res.status}`);
  const text = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('');
  if (!text) throw new Error('Gemini sent back nothing');
  return JSON.parse(text);
}

// Cheap check: fetching the model's metadata validates both the key and the model name without using generate quota.
export async function testKey(apiKey: string, model: string) {
  const res = await fetch(BASE + encodeURIComponent(model), { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message ?? `Gemini said ${res.status}`);
}

const firstGrapheme = (s: unknown) =>
  typeof s === 'string' ? ([...new Intl.Segmenter().segment(s.trim())][0]?.segment ?? '') : '';

export async function aiParse(input: string, cats: Category[], currency: string): Promise<Draft[]> {
  const t = today();
  const system = `You turn casual spending notes into expense entries. Today's date is ${t} (${new Date().toLocaleDateString('en-IN', { weekday: 'long' })}). Currency is ${currency === '₹' ? 'rupees' : currency}. Allowed categories: ${cats.map(c => `${c.id} (${c.name}${c.hint ? `: ${c.hint}` : ''})`).join('; ')}.
Rules:
- One entry per thing bought. Keep item names short (e.g. 'chai', 'auto', 'zomato order').
- amount is the TOTAL paid for that line. '2 autos 40 each' = 80. '2 autos 40' = 40 (treat the number as the total unless it says 'each' or 'per').
- '1.5k' = 1500. Ignore 'rs', 'rupees' or '₹'.
- Input may come from voice dictation, so fix obvious mishearings: 'free chai' likely means 'three chai', 'to autos' means 'two autos', 'for' may mean 'four'.
- Understand relative dates like 'yesterday' or 'last friday'; default to today.
- If a line has no amount, set amount to null so the user can fill it in.
- Pick the single best category; use 'misc' if nothing fits.
Return JSON only.`;
  const raw = await gemini(input, {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        item: { type: 'STRING' },
        quantity: { type: 'NUMBER' },
        amount: { type: 'NUMBER', nullable: true },
        category: { type: 'STRING', enum: cats.map(c => c.id) },
        date: { type: 'STRING', description: 'YYYY-MM-DD' },
        emoji: { type: 'STRING' },
      },
      required: ['item', 'quantity', 'amount', 'category', 'date', 'emoji'],
    },
  }, system);
  if (!Array.isArray(raw)) throw new Error('Gemini got confused');
  // Model output is untrusted: coerce every field before it reaches the UI or the DB.
  return raw.slice(0, 50).map((r): Draft => {
    const cat = catOf(cats, String(r?.category));
    return {
      item: String(r?.item ?? '').trim().slice(0, 60) || 'something',
      quantity: Math.max(1, Math.round(Number(r?.quantity)) || 1),
      amount: Number(r?.amount) > 0 ? Math.round(Number(r.amount) * 100) / 100 : null,
      category: cat.id,
      date: isYmd(r?.date) ? r.date : t,
      emoji: firstGrapheme(r?.emoji) || cat.emoji,
      photos: [],
    };
  });
}

// Only aggregates go out (totals, counts, item names). Never photos.
export async function roast(periodWord: string, summary: object) {
  const r = await gemini(
    `You're a witty friend roasting someone's spending. Here is their ${periodWord} summary: ${JSON.stringify(summary)}. Write a 2-3 line roast that's funny and teasing but never mean, then one short, practical money tip based on the data. Casual Indian English. Return JSON { roast: string, tip: string }.`,
    { type: 'OBJECT', properties: { roast: { type: 'STRING' }, tip: { type: 'STRING' } }, required: ['roast', 'tip'] },
  );
  return { roast: String(r?.roast ?? '').slice(0, 600), tip: String(r?.tip ?? '').slice(0, 300) };
}
