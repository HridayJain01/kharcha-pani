// Self-check for the reminder cron (Redis and web-push are faked). Run via `npm test`.
import webpush from 'web-push';
process.env.KV_REST_API_URL = 'https://redis.test';
process.env.CRON_SECRET = 'cron';
process.env.VAPID_PUBLIC_KEY = 'BIBpOIUC8_4ZqXyXYl7gGoz0wSN_6yI2O4aimmb3XnbP3D-T7KvsyXtsvhxxFS0p0lIgjWOVPj0vT_2V0AIWqFE';
process.env.VAPID_PRIVATE_KEY = 'MQAaD0IPDvTHmTTV8Ap2_s9FwHn0hvcbFJN0SG8ZAhY';
const { GET, POST } = await import('./push.ts');

const store = new Map<string, string>();
globalThis.fetch = (async (_: string, init: RequestInit) => {
  const [cmd, , k, v] = JSON.parse(String(init.body));
  const result = cmd === 'HSET' ? store.set(k, v) && 1 : cmd === 'HGET' ? store.get(k) ?? null : cmd === 'HDEL' ? +store.delete(k) : [...store].flat();
  return Response.json({ result });
}) as typeof fetch;
const pushed: string[] = [];
webpush.sendNotification = (async (s: webpush.PushSubscription) => {
  if (s.endpoint.includes('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
  pushed.push(s.endpoint);
}) as typeof webpush.sendNotification;

const check = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };
const post = (body: object, origin = 'https://kp.app') =>
  POST(new Request('https://kp.app/api/push', { method: 'POST', headers: { host: 'kp.app', origin }, body: JSON.stringify(body) }));
const cron = (auth = 'Bearer cron') => GET(new Request('https://kp.app/api/push', { headers: { authorization: auth } }));
const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'x', auth: 'y' } });
const todayIn = (tz: string) => new Date().toLocaleString('sv-SE', { timeZone: tz }).slice(0, 10);

check((await post({ sub: sub('https://p/a'), at: '00:00', tz: 'UTC' }, 'https://evil.example')).status === 403, 'other sites refused');
check((await post({ sub: sub('https://p/a'), at: '9pm', tz: 'UTC' })).status === 400, 'bad time refused');
check((await post({ sub: sub('https://p/a'), at: '00:00', tz: 'Mars/Base' })).status === 400, 'bad tz refused');
await post({ sub: sub('https://p/due'), at: '00:00', tz: 'UTC' });
await post({ sub: sub('https://p/logged'), at: '00:00', tz: 'Asia/Kolkata' });
await post({ endpoint: 'https://p/logged', logged: todayIn('Asia/Kolkata') });
await post({ sub: sub('https://p/gone'), at: '00:00', tz: 'UTC' });
await post({ sub: sub('https://p/off'), at: '00:00', tz: 'UTC' });
await post({ endpoint: 'https://p/off', at: '' });

check((await cron('Bearer nope')).status === 403, 'cron needs the secret');
check((await (await cron()).json()).sent === 1 && pushed.join() === 'https://p/due', 'only the due, unlogged sub gets pushed');
check(!store.has('https://p/gone') && !store.has('https://p/off'), 'expired and turned-off subs are removed');
await cron();
check(pushed.length === 1, 'at most one push per day');
console.log('✅ push checks passed');
