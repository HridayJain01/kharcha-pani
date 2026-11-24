// Self-check for shared trips (Redis is faked). Run via `npm test`.
process.env.KV_REST_API_URL = 'https://redis.test';
const { POST } = await import('./trip.ts');

const store = new Map<string, Map<string, string>>();
globalThis.fetch = (async (_: string, init: RequestInit) => {
  const [cmd, key, ...rest] = JSON.parse(String(init.body));
  const h = store.get(key) ?? store.set(key, new Map()).get(key)!;
  if (cmd === 'HSET') for (let i = 0; i < rest.length; i += 2) h.set(rest[i], rest[i + 1]);
  return Response.json({ result: cmd === 'HGETALL' ? [...h].flat() : 1 });
}) as typeof fetch;

const check = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };
const post = async (body: object, origin = 'https://kp.app') => {
  const r = await POST(new Request('https://kp.app/api/trip', { method: 'POST', headers: { host: 'kp.app', origin }, body: JSON.stringify(body) }));
  return { status: r.status, json: r.status === 200 ? await r.json() : null };
};
const code = 'abcdef123456';
const NOW = Date.now(); // real edit times are milliseconds
const bill = (uid: string, at: number, item = 'dinner') =>
  ({ kind: 'e', uid, at: NOW + at, item, quantity: 1, category: 'food', emoji: '🍛', date: '2026-11-24', total: 900, paidBy: 'Hriday', split: ['Hriday', 'Rahul'] });

check((await post({ code, items: [] }, 'https://evil.example')).status === 403, 'other sites refused');
check((await post({ code: 'nope', items: [] })).status === 400, 'bad code refused');
check((await post({ code, items: [] })).status === 404, 'unknown trip without meta is 404');
await post({ code, meta: { name: 'Goa', emoji: '🏖️', members: ['Hriday', 'Rahul'] }, items: [bill('uid-aaaa-1', 10)] });
let r = await post({ code, meta: { name: 'x', emoji: '🏖️', members: ['rahul', 'Amit'] }, items: [bill('uid-aaaa-1', 5, 'stale'), bill('uid-bbbb-2', 20), { uid: 'evil', at: 1, item: 'x' }] });
check(r.json.meta.name === 'Goa' && r.json.meta.members.join() === 'Hriday,Rahul,Amit', 'meta kept, members merged case-insensitively');
check(r.json.items.length === 2 && r.json.items.find((i: any) => i.uid === 'uid-aaaa-1').item === 'dinner', 'older edit loses, junk dropped');
r = await post({ code, items: [{ uid: 'uid-aaaa-1', at: NOW + 30, del: 1 }, { ...bill('uid-cccc-3', 1), total: 'lots' }] });
check(r.json.items.find((i: any) => i.uid === 'uid-aaaa-1').del === 1 && r.json.items.length === 2, 'tombstone wins, bad total dropped');
console.log('✅ trip checks passed');
