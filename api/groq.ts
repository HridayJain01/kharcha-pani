// Shared-key proxy: people with no key of their own get Whisper voice + AI parsing on YOUR Groq key.
// Vercel → Project → Settings → Environment Variables: GROQ_API_KEY=gsk_… and VITE_SHARED_AI=1, then redeploy.
// The key never reaches the browser. The browser posts here; this adds the key and forwards to Groq.
const GROQ = 'https://api.groq.com/openai/v1';
const CHAT_MODEL = 'openai/gpt-oss-20b';
const VOICE_MODEL = 'whisper-large-v3-turbo';
const DAILY_PER_IP = Number(process.env.DAILY_LIMIT_PER_IP ?? 150);

// ponytail: per-instance memory, so the limit resets on cold starts and isn't shared between instances.
// Good enough to stop casual abuse; move to Upstash/Vercel KV if someone hammers it.
const hits = new Map<string, number>();

const fail = (message: string, status: number) => Response.json({ error: { message } }, { status });

export async function POST(req: Request) {
  if (!process.env.GROQ_API_KEY) return fail('shared AI is not configured', 503);

  // Only pages served from this same site (browsers always send Origin on POST).
  const origin = req.headers.get('origin');
  if (!origin || new URL(origin).host !== req.headers.get('host')) return fail('forbidden', 403);

  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  const bucket = `${new Date().toISOString().slice(0, 10)}|${ip}`;
  if (hits.size > 50_000) hits.clear();
  const used = (hits.get(bucket) ?? 0) + 1;
  hits.set(bucket, used);
  if (used > DAILY_PER_IP) return fail('free daily limit reached, try tomorrow or add your own key in Settings', 429);

  const voice = req.headers.get('content-type')?.startsWith('multipart/form-data');
  let body: BodyInit;
  let type: Record<string, string> = {};
  if (voice) {
    // Rebuild the form from known fields only; the model is always ours.
    const inForm = await req.formData();
    const file = inForm.get('file');
    if (!(file instanceof Blob) || file.size > 3_000_000) return fail('recording too long', 413);
    const form = new FormData();
    form.set('file', file, (file as File).name || 'voice.webm');
    form.set('model', VOICE_MODEL);
    for (const k of ['language', 'prompt', 'temperature']) {
      const v = inForm.get(k);
      if (typeof v === 'string') form.set(k, v.slice(0, 500));
    }
    body = form;
  } else {
    const text = await req.text();
    if (text.length > 30_000) return fail('note too long', 413);
    const { messages, response_format } = JSON.parse(text);
    // Only what the app sends; the model and output size are ours, so the key can't be used for anything else.
    body = JSON.stringify({ model: CHAT_MODEL, messages, response_format, max_completion_tokens: 4000 });
    type = { 'content-type': 'application/json' };
  }

  const res = await fetch(`${GROQ}/${voice ? 'audio/transcriptions' : 'chat/completions'}`, {
    method: 'POST',
    headers: { ...type, authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body,
  });
  return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
}
