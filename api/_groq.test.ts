// Self-check for the shared-key proxy (no real key or network: fetch is faked). Run via `npm test`.
// Leading underscore: Vercel doesn't deploy it as an endpoint.
process.env.GROQ_API_KEY = 'gsk_SECRET';
process.env.DAILY_LIMIT_PER_IP = '3';
const { POST } = await import('./groq.ts');

const calls: { url: string; auth: string | null; body: unknown }[] = [];
globalThis.fetch = (async (url: string, init: RequestInit) => {
  const body = init.body instanceof FormData ? Object.fromEntries([...init.body].map(([k, v]) => [k, typeof v === 'string' ? v : 'FILE'])) : JSON.parse(String(init.body));
  calls.push({ url, auth: new Headers(init.headers).get('authorization'), body });
  return Response.json({ ok: true });
}) as typeof fetch;

const check = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };
const req = (init: RequestInit & { origin?: string; ip?: string }) =>
  new Request('https://kp.vercel.app/api/groq', {
    method: 'POST', ...init,
    headers: { host: 'kp.vercel.app', 'x-forwarded-for': init.ip ?? '1.1.1.1', ...(init.origin !== undefined && { origin: init.origin }), ...init.headers },
  });
const chat = JSON.stringify({ model: 'expensive-model', messages: [{ role: 'user', content: 'chai 15' }], response_format: { type: 'json_object' }, tools: ['nope'] });

check((await POST(req({ body: chat }))).status === 403, 'no Origin must be refused');
check((await POST(req({ body: chat, origin: 'https://evil.example' }))).status === 403, 'other sites must be refused');

const ok = await POST(req({ body: chat, origin: 'https://kp.vercel.app', ip: '2.2.2.2', headers: { 'content-type': 'application/json' } }));
check(ok.status === 200, 'same-site chat should pass');
const sent = calls.at(-1)!;
check(sent.url.endsWith('/chat/completions') && sent.auth === 'Bearer gsk_SECRET', 'forwards to Groq with the server key');
check(JSON.stringify(Object.keys(sent.body as object)) === '["model","messages","response_format","max_completion_tokens"]' && (sent.body as { model: string }).model === 'openai/gpt-oss-20b', 'only whitelisted fields, our model');

const form = new FormData();
form.set('file', new Blob([new Uint8Array(100)], { type: 'audio/webm' }), 'voice.webm');
form.set('model', 'whisper-large-v3');
form.set('prompt', 'chai');
await POST(req({ body: form, origin: 'https://kp.vercel.app', ip: '2.2.2.2' }));
check(calls.at(-1)!.url.endsWith('/audio/transcriptions') && (calls.at(-1)!.body as { model: string }).model === 'whisper-large-v3-turbo', 'voice goes to Whisper turbo');

await POST(req({ body: chat, origin: 'https://kp.vercel.app', ip: '2.2.2.2' }));
check((await POST(req({ body: chat, origin: 'https://kp.vercel.app', ip: '2.2.2.2' }))).status === 429, '4th request of the day is limited');
check((await POST(req({ body: chat, origin: 'https://kp.vercel.app', ip: '3.3.3.3' }))).status === 200, 'other people are unaffected');

console.log('✅ proxy checks passed');
