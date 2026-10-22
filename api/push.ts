// Nightly reminders that reach a closed app. Phones register here (POST); a cron calls GET every ~15 min
// and pushes to anyone whose reminder time has passed in their own timezone and who hasn't logged today.
// Vercel env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VITE_VAPID_PUBLIC_KEY (same as public), CRON_SECRET,
// plus Upstash Redis (KV_REST_API_URL + KV_REST_API_TOKEN, set by Vercel's Upstash integration).
import webpush from 'web-push';

interface Sub { sub: webpush.PushSubscription; at: string; tz: string; logged?: string; sent?: string }

const fail = (message: string, status: number) => Response.json({ error: { message } }, { status });

async function redis(...cmd: string[]) {
  const res = await fetch(process.env.KV_REST_API_URL!, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  return (await res.json()).result;
}

// "YYYY-MM-DD HH:MM" in that timezone; throws RangeError on a bad tz.
const localNow = (tz: string) => new Date().toLocaleString('sv-SE', { timeZone: tz }).slice(0, 16);

// Register / update: { sub, at, tz }. Mark logged: { endpoint, logged }. Remove: { endpoint, at: '' }.
export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin || new URL(origin).host !== req.headers.get('host')) return fail('forbidden', 403);
  const text = await req.text();
  if (text.length > 5_000) return fail('too big', 413);
  const body = JSON.parse(text);
  const endpoint: string = body.sub?.endpoint ?? body.endpoint;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) return fail('bad endpoint', 400);

  if (body.at === '') return await redis('HDEL', 'subs', endpoint), new Response(null, { status: 204 });

  const old: Sub | null = JSON.parse((await redis('HGET', 'subs', endpoint)) ?? 'null');
  if (body.sub) {
    if (!/^\d\d:\d\d$/.test(body.at)) return fail('bad time', 400);
    try { localNow(body.tz); } catch { return fail('bad timezone', 400); }
    const next: Sub = { sub: body.sub, at: body.at, tz: body.tz, logged: old?.logged, sent: old?.sent };
    await redis('HSET', 'subs', endpoint, JSON.stringify(next));
  } else if (old && /^\d{4}-\d\d-\d\d$/.test(body.logged)) {
    await redis('HSET', 'subs', endpoint, JSON.stringify({ ...old, logged: body.logged }));
  }
  return new Response(null, { status: 204 });
}

// Cron. Vercel crons send `Authorization: Bearer $CRON_SECRET`; external crons (cron-job.org) send the same header.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return fail('forbidden', 403);
  webpush.setVapidDetails('mailto:noreply@kharcha-pani.app', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

  // ponytail: reads every subscription each run; fine for thousands, bucket by time slot if it grows past that.
  const flat: string[] = (await redis('HGETALL', 'subs')) ?? [];
  let sent = 0;
  for (let i = 0; i < flat.length; i += 2) {
    const endpoint = flat[i];
    const s: Sub = JSON.parse(flat[i + 1]);
    const [date, time] = localNow(s.tz).split(' ');
    if (time < s.at || s.sent === date || s.logged === date) continue;
    try {
      await webpush.sendNotification(s.sub, JSON.stringify({ title: 'Kharcha Pani 🪙', body: "Log today's kharcha before you forget!" }));
      sent++;
    } catch (e) {
      // 404/410: the phone unsubscribed or the app was removed.
      if ([404, 410].includes((e as webpush.WebPushError).statusCode)) { await redis('HDEL', 'subs', endpoint); continue; }
      console.error(e);
    }
    await redis('HSET', 'subs', endpoint, JSON.stringify({ ...s, sent: date }));
  }
  return Response.json({ sent });
}
