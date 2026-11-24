import Dexie, { liveQuery, type EntityTable, type Table } from 'dexie';
import { useEffect, useState } from 'react';
import { DEFAULT_CATEGORIES, ME, myShare, norm, today, ymd, type Category, type Draft, type Entry, type Trip } from './lib';

export interface Photo { id: number; entryId: number; blob: Blob }
export type Provider = 'groq' | 'gemini' | 'custom';
export interface Settings { provider: Provider; apiKey: string; model: string; baseUrl: string; currency: string; budget: number; goal: string; goalAmount: number; name: string; onboarded: boolean; toured: boolean; remindAt: string; tripId: number }
export const DEFAULT_MODELS: Record<Provider, string> = { groq: 'openai/gpt-oss-20b', gemini: 'gemini-3.5-flash-lite', custom: '' };
export const DEFAULT_SETTINGS: Settings = { provider: 'groq', apiKey: '', model: DEFAULT_MODELS.groq, baseUrl: '', currency: '₹', budget: 0, goal: '', goalAmount: 0, name: '', onboarded: false, toured: false, remindAt: '', tripId: 0 };

// Everything lives in this one on-device IndexedDB. `kv` holds settings and cached roasts.
export const db = new Dexie('kharcha-pani') as Dexie & {
  entries: EntityTable<Entry, 'id'>;
  photos: EntityTable<Photo, 'id'>;
  categories: Table<Category, string>;
  trips: EntityTable<Trip, 'id'>;
  kv: Table<{ key: string; value: unknown }, string>;
};
db.version(1).stores({ entries: '++id, date, category', photos: '++id, entryId', categories: 'id', kv: 'key' });
db.version(2).stores({ entries: '++id, date, category, trip', trips: '++id' });
db.on('populate', tx => tx.table('categories').bulkAdd(DEFAULT_CATEGORIES));

export async function getSettings(): Promise<Settings> {
  const saved = (await db.kv.get('settings'))?.value as Partial<Settings> | undefined;
  // Saved before providers existed: a key there is a Gemini key; without one, start fresh on Groq.
  const legacy = saved && !saved.provider
    ? saved.apiKey ? { provider: 'gemini' as const, model: saved.model || DEFAULT_MODELS.gemini } : { model: DEFAULT_MODELS.groq }
    : {};
  return { ...DEFAULT_SETTINGS, ...saved, ...legacy };
}
export const saveSettings = (patch: Partial<Settings>) =>
  db.transaction('rw', db.kv, async () => db.kv.put({ key: 'settings', value: { ...(await getSettings()), ...patch } }));

// Re-renders whenever the queried data changes, from any screen.
export function useLive<T>(query: () => Promise<T>, deps: unknown[] = []) {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: v => setValue(() => v), error: console.error });
    return () => sub.unsubscribe();
  }, deps);
  return value;
}

export const useSettings = () => useLive(getSettings);
export const useCats = () => useLive(() => db.categories.toArray().then(cs => cs.sort((a, b) => a.order - b.order)));

// "Today", refreshed when the app comes back to the foreground (installed PWAs stay open for days).
export function useToday() {
  const [t, setT] = useState(today);
  useEffect(() => {
    const tick = () => setT(today());
    document.addEventListener('visibilitychange', tick);
    return () => document.removeEventListener('visibilitychange', tick);
  }, []);
  return t;
}

// Undefined fields on update delete them, so switching an entry out of Udhaar or a trip cleans up.
// A trip draft's amount is the whole bill: it's saved as `total`, and `amount` becomes your share.
// Trip entries get a `uid` and an edit time `at`, so a shared trip can sync them between phones.
const fields = ({ item, quantity, amount, category, date, emoji, person, iou, trip, split, paidBy, shares, splitBy, uid }: Draft) => {
  const t = trip && !iou && split?.length;
  const w = t && splitBy && shares ? { shares: Object.fromEntries(split.map(p => [p, shares[p] ?? 0])), splitBy } : { shares: undefined, splitBy: undefined };
  return {
    item: item.trim(), quantity, amount: t ? myShare(amount ?? 0, split, w.shares) : amount ?? 0, category, date, emoji, person: iou ? person?.trim() : undefined, iou,
    trip: t ? trip : undefined, total: t ? amount ?? 0 : undefined, split: t ? split : undefined, paidBy: t ? paidBy ?? ME : undefined, ...w,
    uid: t ? uid ?? crypto.randomUUID() : undefined, at: t ? Date.now() : undefined,
  };
};

// A bill that leaves a shared trip (deleted, or moved out) leaves a tombstone, so it disappears on everyone's phone.
async function bury(e: Entry | undefined, stillIn?: number) {
  if (!e?.trip || !e.uid || e.trip === stillIn) return;
  const t = await db.trips.get(e.trip);
  if (t?.code) await db.trips.update(t.id, { dead: [...(t.dead ?? []), { uid: e.uid, at: Date.now() }] });
}

export const saveDrafts = (drafts: Draft[]) =>
  db.transaction('rw', db.entries, db.photos, async () => {
    const ids: number[] = [];
    for (const d of drafts) {
      const id = await db.entries.add({ ...fields(d), createdAt: Date.now() });
      await db.photos.bulkAdd(d.photos.map(p => ({ entryId: id, blob: p.blob })));
      ids.push(id);
    }
    return ids;
  });

// Photos the draft still references (by id) stay put; only removed ones are deleted and new ones added.
export const updateEntry = (id: number, d: Draft) =>
  db.transaction('rw', db.entries, db.photos, db.trips, async () => {
    await bury(await db.entries.get(id), d.iou ? undefined : d.trip);
    const keep = new Set(d.photos.map(p => p.id));
    await db.entries.update(id, fields(d));
    await db.photos.where('entryId').equals(id).filter(p => !keep.has(p.id)).delete();
    await db.photos.bulkAdd(d.photos.filter(p => !p.id).map(p => ({ entryId: id, blob: p.blob })));
  });

export const deleteEntry = (id: number) =>
  db.transaction('rw', db.entries, db.photos, db.trips, async () => {
    await bury(await db.entries.get(id));
    await Promise.all([db.entries.delete(id), db.photos.where('entryId').equals(id).delete()]);
  });

// Monthly repeats (rent, Netflix…), matched by item name. `last` = the latest "YYYY-MM" already added.
export interface Repeat { item: string; amount: number; category: string; emoji: string; day: number; last: string }
export const getRepeats = async () => ((await db.kv.get('repeats'))?.value ?? []) as Repeat[];
export const isRepeat = (rs: Repeat[] | undefined, item: string) => !!rs?.some(r => norm(r.item) === norm(item));

export const toggleRepeat = (e: Entry) =>
  db.transaction('rw', db.kv, async () => {
    const rs = await getRepeats();
    const next = isRepeat(rs, e.item)
      ? rs.filter(r => norm(r.item) !== norm(e.item))
      : [...rs, { item: e.item, amount: e.amount, category: e.category, emoji: e.emoji, day: +e.date.slice(8), last: e.date.slice(0, 7) }];
    await db.kv.put({ key: 'repeats', value: next });
    return next.length > rs.length;
  });

// Called on launch: adds every month's repeat that has come due since it was last added.
export const addDueRepeats = () =>
  db.transaction('rw', db.kv, db.entries, async () => {
    const rs = await getRepeats();
    const t = today();
    let added = 0;
    for (const r of rs)
      for (;;) {
        const [y, m] = r.last.split('-').map(Number); // m is 1-based, so Date(y, m) is the next month
        const date = ymd(new Date(y, m, Math.min(r.day, new Date(y, m + 1, 0).getDate())));
        if (date > t) break;
        await db.entries.add({ item: r.item, quantity: 1, amount: r.amount, category: r.category, emoji: r.emoji, date, createdAt: Date.now() });
        r.last = date.slice(0, 7);
        added++;
      }
    if (added) await db.kv.put({ key: 'repeats', value: rs });
    return added;
  });

// Nightly nudge at "HH:MM" if nothing was logged today. Returns a cancel fn.
// With VITE_VAPID_PUBLIC_KEY set, the server (api/push.ts) sends it even when the app is closed.
// Without it, a timer that only fires while the app is open or backgrounded.
const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
const postPush = (body: object) =>
  fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(console.error);

export function scheduleReminder(at: string) {
  if (VAPID && 'PushManager' in window) {
    navigator.serviceWorker.ready.then(async reg => {
      const sub = await reg.pushManager.getSubscription();
      if (!at || Notification.permission !== 'granted') return sub && postPush({ endpoint: sub.endpoint, at: '' });
      postPush({ sub: sub ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID }), at, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
    }).catch(console.error);
    return () => {};
  }
  if (!at || Notification.permission !== 'granted') return () => {};
  const [h, m] = at.split(':').map(Number);
  const next = new Date();
  next.setHours(h, m, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  let cancel = () => {};
  const timer = setTimeout(async () => {
    if (!(await db.entries.where('date').equals(today()).count()) && !(await getNoSpend()).includes(today()))
      (await navigator.serviceWorker.ready).showNotification('Kharcha Pani 🪙', { body: `${(await getSettings()).name || 'Oye'}, log today's kharcha before you forget!`, icon: '/pwa-192.png', tag: 'remind' });
    cancel = scheduleReminder(at);
  }, next.getTime() - Date.now());
  return () => { clearTimeout(timer); cancel(); };
}

// Logging something today tells the server to skip tonight's push. Once per day per device.
function pingLogged(date: string) {
  if (!VAPID || date !== today() || localStorage.getItem('pushLogged') === date) return;
  localStorage.setItem('pushLogged', date);
  navigator.serviceWorker?.ready.then(r => r.pushManager.getSubscription()).then(sub => sub && postPush({ endpoint: sub.endpoint, logged: date }));
}
db.entries.hook('creating', (_, e) => pingLogged(e.date));

// "Spent nothing today" counts as logging: keeps the streak alive and silences tonight's reminder.
export const getNoSpend = async () => ((await db.kv.get('nospend'))?.value ?? []) as string[];
export const markNoSpend = (date = today()) =>
  db.transaction('rw', db.kv, async () => {
    const ds = await getNoSpend();
    if (!ds.includes(date)) await db.kv.put({ key: 'nospend', value: [...ds, date] });
    pingLogged(date);
  });
