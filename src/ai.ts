import { DEFAULT_MODELS, getSettings, type Provider, type Settings } from './db';
import { catOf, isYmd, norm, today, type Category, type Draft, type Memory } from './lib';

// Optional AI. The app works without it; with a key it reads messier notes, roasts, and (Groq) transcribes voice.
export const PROVIDERS: Record<Provider, { label: string; model: string; base: string; keyUrl: string; blurb: string }> = {
  groq: {
    label: 'Groq', model: DEFAULT_MODELS.groq, base: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys',
    blurb: 'Free and super fast. Also gives voice notes Whisper, the most accurate option.',
  },
  gemini: {
    label: 'Gemini', model: DEFAULT_MODELS.gemini, base: 'https://generativelanguage.googleapis.com/v1beta', keyUrl: 'https://aistudio.google.com/apikey',
    blurb: "Google's free tier, via AI Studio.",
  },
  custom: {
    label: 'Other', model: DEFAULT_MODELS.custom, base: '', keyUrl: '',
    blurb: 'Any OpenAI-compatible API: OpenRouter, Mistral, Cerebras, Ollama… The model must support JSON schema output.',
  },
};

// Schemas are written once as JSON Schema; Gemini wants its OpenAPI flavour (upper-case types, `nullable`).
type Schema = { type: string | string[]; properties?: Record<string, Schema>; items?: Schema; required?: string[]; enum?: string[]; description?: string; additionalProperties?: boolean };
const forGemini = (s: Schema): object => ({
  type: [s.type].flat().find(t => t !== 'null')!.toUpperCase(),
  ...([s.type].flat().includes('null') && { nullable: true }),
  ...(s.enum && { enum: s.enum }),
  ...(s.description && { description: s.description }),
  ...(s.properties && { properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, forGemini(v)])), required: s.required }),
  ...(s.items && { items: forGemini(s.items) }),
});

async function reply(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message ?? `AI said ${res.status}`);
  return data;
}

// Built with VITE_SHARED_AI=1 (plus GROQ_API_KEY on Vercel), people with no key of their own use the
// owner's Groq key through api/groq.ts. Their own key, if they add one, always wins.
export const SHARED = import.meta.env.VITE_SHARED_AI === '1';
const SHARED_URL = '/api/groq';
export const hasAI = (s: Settings) => !!s.apiKey || SHARED;

// The key goes in a header, never the URL, and only to the provider it belongs to.
async function ask(s: Settings, prompt: string, schema: Schema, system?: string) {
  if (!hasAI(s)) throw new Error('no AI key yet');
  let text: string | undefined;
  if (s.apiKey && s.provider === 'gemini') {
    const data = await reply(await fetch(`${PROVIDERS.gemini.base}/models/${encodeURIComponent(s.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': s.apiKey },
      body: JSON.stringify({
        ...(system && { systemInstruction: { parts: [{ text: system }] } }),
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: forGemini(schema) },
      }),
      signal: AbortSignal.timeout(30_000),
    }));
    text = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('');
  } else {
    const base = s.provider === 'groq' ? PROVIDERS.groq.base : s.baseUrl.trim().replace(/\/+$/, '');
    if (s.apiKey && !base) throw new Error('add the base URL in Settings');
    const data = await reply(await fetch(s.apiKey ? `${base}/chat/completions` : SHARED_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(s.apiKey && { authorization: `Bearer ${s.apiKey}` }) },
      body: JSON.stringify({
        model: s.model,
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
        response_format: { type: 'json_schema', json_schema: { name: 'reply', schema } },
      }),
      signal: AbortSignal.timeout(30_000),
    }));
    text = data.choices?.[0]?.message?.content;
  }
  // tolerate models that wrap the JSON in prose or ``` fences
  const json = text?.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  if (!json) throw new Error('AI sent back nothing');
  return JSON.parse(json);
}

// One tiny structured call: proves the key, the model name and JSON output all work.
export async function testKey(s: Settings) {
  const r = await ask(s, 'Reply with {"ok": true}', { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false });
  if (!r?.ok) throw new Error('the model answered, but not in JSON');
}

const firstGrapheme = (s: unknown) =>
  typeof s === 'string' ? ([...new Intl.Segmenter().segment(s.trim())][0]?.segment ?? '') : '';

export async function aiParse(input: string, cats: Category[], memory: Memory): Promise<Draft[]> {
  const s = await getSettings();
  const t = today();
  const system = `You turn casual spending notes into expense entries. Today's date is ${t} (${new Date().toLocaleDateString('en-IN', { weekday: 'long' })}). Currency is ${s.currency === '₹' ? 'rupees' : s.currency}. Allowed categories: ${cats.map(c => `${c.id} (${c.name}${c.hint ? `: ${c.hint}` : ''})`).join('; ')}.
Rules:
- One entry per thing bought. Keep item names short (e.g. 'chai', 'auto', 'zomato order').
- amount is the TOTAL paid for that line. '2 autos 40 each' = 80. '2 autos 40' = 40 (treat the number as the total unless it says 'each' or 'per').
- '1.5k' = 1500. Ignore 'rs', 'rupees' or '₹'.
- Input may come from voice dictation, so fix obvious mishearings: 'free chai' likely means 'three chai', 'to autos' means 'two autos', 'for' may mean 'four'.
- Understand relative dates like 'yesterday' or 'last friday'; default to today.
- If a line has no amount, set amount to null so the user can fill it in.
- Pick the single best category; use 'misc' if nothing fits.
Return JSON only.`;
  const raw = await ask(s, input, {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            item: { type: 'string' },
            quantity: { type: 'number' },
            amount: { type: ['number', 'null'] },
            category: { type: 'string', enum: cats.map(c => c.id) },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            emoji: { type: 'string' },
          },
          required: ['item', 'quantity', 'amount', 'category', 'date', 'emoji'],
          additionalProperties: false,
        },
      },
    },
    required: ['entries'],
    additionalProperties: false,
  }, system);
  if (!Array.isArray(raw?.entries)) throw new Error('AI got confused');
  // Model output is untrusted: coerce every field before it reaches the UI or the DB.
  return raw.entries.slice(0, 50).map((r: Record<string, unknown>): Draft => {
    const item = String(r?.item ?? '').trim().slice(0, 60) || 'something';
    // Where you've filed this item the same way twice or more, your habit beats the model's guess.
    const habit = memory.get(norm(item));
    const cat = catOf(cats, habit && habit.n >= 2 ? habit.category : String(r?.category));
    const date = r?.date;
    return {
      item,
      quantity: Math.max(1, Math.round(Number(r?.quantity)) || 1),
      amount: Number(r?.amount) > 0 ? Math.round(Number(r.amount) * 100) / 100 : null,
      category: cat.id,
      date: isYmd(date) ? date : t,
      emoji: firstGrapheme(r?.emoji) || cat.emoji,
      photos: [],
    };
  });
}

// Only aggregates go out (totals, counts, item names). Never photos.
export async function roast(periodWord: string, summary: object) {
  const r = await ask(
    await getSettings(),
    `You're a witty friend roasting someone's spending. Here is their ${periodWord} summary: ${JSON.stringify(summary)}. Write a 2-3 line roast that's funny and teasing but never mean, then one short, practical money tip based on the data. Casual Indian English. Return JSON { roast: string, tip: string }.`,
    { type: 'object', properties: { roast: { type: 'string' }, tip: { type: 'string' } }, required: ['roast', 'tip'], additionalProperties: false },
  );
  return { roast: String(r?.roast ?? '').slice(0, 600), tip: String(r?.tip ?? '').slice(0, 300) };
}

// Groq's hosted Whisper large-v3-turbo: free tier, ~1 s, and the vocabulary hint helps with Zomato & co.
export async function whisper(s: Settings, audio: Blob) {
  const form = new FormData();
  form.append('file', audio, `voice.${audio.type.split(/[/;]/)[1] || 'webm'}`);
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'en');
  form.append('temperature', '0');
  form.append('prompt', 'Spends in rupees, like: chai 15, 2 autos 80, Zomato 250 yesterday, Swiggy, Blinkit, Rapido, samosa, metro, recharge.');
  const data = await reply(await fetch(s.apiKey ? `${PROVIDERS.groq.base}/audio/transcriptions` : SHARED_URL, {
    method: 'POST', headers: s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {}, body: form, signal: AbortSignal.timeout(30_000),
  }));
  return String(data.text ?? '').trim();
}
