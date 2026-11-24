// Shared trips: bills sync through api/trip.ts, so everyone in the group sees the same trip on their own phone.
// On the wire people are names; on this phone you are ME and `trip.meName` is what the group calls you.
import { db, saveSettings } from './db';
import { ME, myShare, norm, today, type Entry, type Trip } from './lib';

interface Meta { name: string; emoji: string; members: string[] }
type Wire = { uid: string; at: number; del?: 1; kind?: 'e' | 's' } & Record<string, any>;

const ABC = 'abcdefghijklmnopqrstuvwxyz0123456789';
const newCode = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => ABC[b % 36]).join('');
export const tripLink = (t: Trip) => `${location.origin}/?trip=${t.code}`;

async function call(code: string, meta: Meta | undefined, items: Wire[]): Promise<{ meta: Meta; items: Wire[] }> {
  const res = await fetch('/api/trip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, meta, items }) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `server said ${res.status}`);
  return res.json();
}

export const peekTrip = (code: string) => call(code, undefined, []).then(r => r.meta);

const mapKeys = (o: Record<string, number> | undefined, f: (k: string) => string) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [f(k), v]));

// One sync at a time, in order, so two quick saves can't race each other.
let queue = Promise.resolve();
export const syncTrip = (id: number) => (queue = queue.catch(() => {}).then(() => sync(id)));
export const syncQuiet = (id?: number) => { if (id) syncTrip(id).catch(console.warn); };

async function sync(id: number) {
  const t = await db.trips.get(id);
  if (!t?.code || !t.meName) return;
  const me = t.meName;
  const out = (p: string) => (p === ME ? me : p);
  const inn = (p: string) => (norm(p) === norm(me) ? ME : p);
  const mine = await db.entries.where('trip').equals(id).toArray();
  const items: Wire[] = [
    ...mine.filter(e => e.uid).map(e => ({
      kind: 'e' as const, uid: e.uid!, at: e.at ?? 0, item: e.item, quantity: e.quantity, category: e.category, emoji: e.emoji, date: e.date,
      total: e.total, paidBy: out(e.paidBy ?? ME), split: e.split!.map(out), shares: mapKeys(e.shares, out), splitBy: e.splitBy,
    })),
    ...t.settles.filter(s => s.uid).map(s => ({ kind: 's' as const, uid: s.uid!, at: s.at ?? 0, from: out(s.from), to: out(s.to), amount: s.amount, date: s.date })),
    ...(t.dead ?? []).map(d => ({ uid: d.uid, at: d.at, del: 1 as const })),
  ];
  const res = await call(t.code, { name: t.name, emoji: t.emoji, members: [me, ...t.members] }, items);
  const cats = new Set((await db.categories.toArray()).map(c => c.id));

  await db.transaction('rw', db.entries, db.photos, db.trips, async () => {
    const fresh = (await db.trips.get(id))!;
    const byUid = new Map((await db.entries.where('trip').equals(id).toArray()).map(e => [e.uid, e]));
    const settles = [...fresh.settles];
    const dead = new Map((fresh.dead ?? []).map(d => [d.uid, d]));
    for (const i of res.items) {
      const e = byUid.get(i.uid);
      if (i.del) {
        if (e && (e.at ?? 0) <= i.at) await Promise.all([db.entries.delete(e.id), db.photos.where('entryId').equals(e.id).delete()]);
        dead.set(i.uid, { uid: i.uid, at: i.at });
      } else if (i.kind === 's') {
        if (!settles.some(s => s.uid === i.uid)) settles.push({ uid: i.uid, at: i.at, from: inn(i.from), to: inn(i.to), amount: i.amount, date: i.date });
      } else if (!dead.has(i.uid) && (!e || (e.at ?? 0) < i.at)) {
        const split = (i.split as string[]).map(inn), shares = mapKeys(i.shares, inn);
        const row: Omit<Entry, 'id' | 'createdAt'> = {
          item: i.item, quantity: i.quantity, category: cats.has(i.category) ? i.category : 'misc', emoji: i.emoji, date: i.date,
          trip: id, total: i.total, paidBy: inn(i.paidBy), split, shares, splitBy: i.splitBy, uid: i.uid, at: i.at, amount: myShare(i.total, split, shares),
        };
        if (e) await db.entries.update(e.id, row);
        else await db.entries.add({ ...row, createdAt: i.at } as Entry);
      }
    }
    const members = [...fresh.members];
    for (const m of res.meta.members) if (norm(m) !== norm(me) && !members.some(x => norm(x) === norm(m))) members.push(m);
    await db.trips.update(id, { members, settles, dead: [...dead.values()] });
  });
}

// Turns a phone-only trip into a shared one. Older bills and payments get ids so they sync too.
export async function startSharing(id: number, meName: string) {
  const code = newCode();
  await db.transaction('rw', db.entries, db.trips, async () => {
    const t = (await db.trips.get(id))!;
    await db.entries.where('trip').equals(id).modify(e => { e.uid ??= crypto.randomUUID(); e.at ??= Date.now(); });
    await db.trips.update(id, { code, meName, dead: [], settles: t.settles.map(s => ({ ...s, uid: s.uid ?? crypto.randomUUID(), at: s.at ?? Date.now() })) });
  });
  try {
    await syncTrip(id);
  } catch (e) {
    await db.trips.update(id, { code: undefined, meName: undefined }); // the server isn't there: stay a phone-only trip
    throw e;
  }
}

export async function joinTrip(code: string, meName: string, meta: Meta) {
  const have = (await db.trips.toArray()).find(t => t.code === code);
  const id = have?.id ?? await db.trips.add({
    name: meta.name, emoji: meta.emoji, members: meta.members.filter(m => norm(m) !== norm(meName)), start: today(), budget: 0, settles: [], code, meName, dead: [],
  } as Omit<Trip, 'id'> as Trip);
  await saveSettings({ tripId: id });
  await syncTrip(id);
  return id;
}
