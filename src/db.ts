import Dexie, { liveQuery, type EntityTable, type Table } from 'dexie';
import { useEffect, useState } from 'react';
import { DEFAULT_CATEGORIES, norm, today, ymd, type Category, type Draft, type Entry } from './lib';

export interface Photo { id: number; entryId: number; blob: Blob }
export type Provider = 'groq' | 'gemini' | 'custom';
export interface Settings { provider: Provider; apiKey: string; model: string; baseUrl: string; currency: string; budget: number; goal: string; goalAmount: number; onboarded: boolean }
export const DEFAULT_MODELS: Record<Provider, string> = { groq: 'openai/gpt-oss-20b', gemini: 'gemini-3.5-flash-lite', custom: '' };
export const DEFAULT_SETTINGS: Settings = { provider: 'groq', apiKey: '', model: DEFAULT_MODELS.groq, baseUrl: '', currency: '₹', budget: 0, goal: '', goalAmount: 0, onboarded: false };

// Everything lives in this one on-device IndexedDB. `kv` holds settings and cached roasts.
export const db = new Dexie('kharcha-pani') as Dexie & {
  entries: EntityTable<Entry, 'id'>;
  photos: EntityTable<Photo, 'id'>;
  categories: Table<Category, string>;
  kv: Table<{ key: string; value: unknown }, string>;
};
db.version(1).stores({ entries: '++id, date, category', photos: '++id, entryId', categories: 'id', kv: 'key' });
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

const fields = ({ item, quantity, amount, category, date, emoji }: Draft) =>
  ({ item: item.trim(), quantity, amount: amount ?? 0, category, date, emoji });

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
  db.transaction('rw', db.entries, db.photos, async () => {
    const keep = new Set(d.photos.map(p => p.id));
    await db.entries.update(id, fields(d));
    await db.photos.where('entryId').equals(id).filter(p => !keep.has(p.id)).delete();
    await db.photos.bulkAdd(d.photos.filter(p => !p.id).map(p => ({ entryId: id, blob: p.blob })));
  });

export const deleteEntry = (id: number) =>
  db.transaction('rw', db.entries, db.photos, () =>
    Promise.all([db.entries.delete(id), db.photos.where('entryId').equals(id).delete()]));

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
