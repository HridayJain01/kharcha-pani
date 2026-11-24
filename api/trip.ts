// Shared trips: everyone who opens the trip's link syncs the same bills. No accounts: the random 12-character
// code in the link is the key, so treat the link like the trip's password. Needs Upstash Redis
// (KV_REST_API_URL + KV_REST_API_TOKEN), the same setup as reminders in push.ts.
// POST { code, meta?, items } → { meta, items }: newer items win (by `at`), members are merged.
interface Meta { name: string; emoji: string; members: string[] }
type Item = { uid: string; at: number; del?: 1 } & Record<string, unknown>;

const MAX_ITEMS = 3000;
const YEAR = 60 * 60 * 24 * 365;
const fail = (message: string, status: number) => Response.json({ error: { message } }, { status });

// ponytail: copied from push.ts, since importing between api files is fragile in Vercel's bundler.
async function redis(...cmd: (string | number)[]) {
  const res = await fetch(process.env.KV_REST_API_URL!, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  return (await res.json()).result;
}

const str = (v: unknown, max = 60): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e10;
const ymd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v);

// The body comes from anyone with the link: rebuild every item from known fields only.
function clean(i: any): Item | null {
  if (typeof i?.uid !== 'string' || !/^[\w-]{8,40}$/.test(i.uid) || !Number.isSafeInteger(i.at) || i.at < 0) return null;
  if (i.del) return { uid: i.uid, at: i.at, del: 1 };
  if (i.kind === 's') {
    return str(i.from) && str(i.to) && num(i.amount) && i.amount > 0 && ymd(i.date)
      ? { kind: 's', uid: i.uid, at: i.at, from: i.from, to: i.to, amount: i.amount, date: i.date } : null;
  }
  const split = Array.isArray(i.split) && i.split.length <= 50 && i.split.every((p: unknown) => str(p)) ? i.split as string[] : null;
  const shares = i.shares && typeof i.shares === 'object' && Object.entries(i.shares).length <= 50 && Object.entries(i.shares).every(([k, v]) => str(k) && num(v))
    ? i.shares as Record<string, number> : undefined;
  if (i.kind !== 'e' || typeof i.item !== 'string' || i.item.length > 60 || !split?.length || !str(i.paidBy) || !num(i.total) || !i.total
    || !ymd(i.date) || !str(i.category, 40) || !num(i.quantity) || typeof i.emoji !== 'string' || i.emoji.length > 16) return null;
  return {
    kind: 'e', uid: i.uid, at: i.at, item: i.item, quantity: i.quantity, category: i.category, emoji: i.emoji, date: i.date,
    total: i.total, paidBy: i.paidBy, split, ...(shares && ['exact', 'percent', 'shares'].includes(i.splitBy) ? { shares, splitBy: i.splitBy } : {}),
  };
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin || new URL(origin).host !== req.headers.get('host')) return fail('forbidden', 403);
  if (!process.env.KV_REST_API_URL) return fail('sharing is not set up on this server', 503);
  const text = await req.text();
  if (text.length > 2_000_000) return fail('too big', 413);
  const body = JSON.parse(text);
  if (typeof body.code !== 'string' || !/^[a-z0-9]{12}$/.test(body.code)) return fail('bad trip code', 400);
  const key = `trip:${body.code}`;

  const flat: string[] = (await redis('HGETALL', key)) ?? [];
  const stored = new Map<string, string>();
  for (let i = 0; i < flat.length; i += 2) stored.set(flat[i], flat[i + 1]);
  const m = body.meta;
  const incoming = m && str(m.name) && Array.isArray(m.members) ? { name: m.name, emoji: str(m.emoji, 16) ? m.emoji : '🧳', members: m.members.filter((x: unknown) => str(x)) } : null;
  let meta: Meta | null = JSON.parse(stored.get('meta') ?? 'null');
  if (!meta && !incoming) return fail('trip not found', 404);
  meta ??= incoming!;
  for (const x of incoming?.members ?? []) if (!meta.members.some(y => y.toLowerCase() === x.toLowerCase())) meta.members.push(x);
  meta.members = meta.members.slice(0, 50);

  const writes: string[] = ['meta', JSON.stringify(meta)];
  for (const raw of Array.isArray(body.items) ? body.items : []) {
    const it = clean(raw);
    if (!it) continue;
    const old = stored.get(`i:${it.uid}`);
    if (old && (JSON.parse(old) as Item).at >= it.at) continue;
    stored.set(`i:${it.uid}`, JSON.stringify(it));
    writes.push(`i:${it.uid}`, JSON.stringify(it));
  }
  if (stored.size > MAX_ITEMS) return fail('this trip is full', 413);
  await redis('HSET', key, ...writes);
  await redis('EXPIRE', key, YEAR); // a trip nobody opens for a year is gone
  return Response.json({ meta, items: [...stored].filter(([k]) => k.startsWith('i:')).map(([, v]) => JSON.parse(v)) });
}
