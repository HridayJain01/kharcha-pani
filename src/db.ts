import Dexie, { liveQuery, type EntityTable, type Table } from 'dexie';
import { useEffect, useState } from 'react';
import { DEFAULT_CATEGORIES, today, type Category, type Draft, type Entry } from './lib';

export interface Photo { id: number; entryId: number; blob: Blob }
export interface Settings { apiKey: string; model: string; currency: string; budget: number; onboarded: boolean }
export const DEFAULT_SETTINGS: Settings = { apiKey: '', model: 'gemini-2.5-flash-lite', currency: '₹', budget: 0, onboarded: false };

// Everything lives in this one on-device IndexedDB. `kv` holds settings and cached roasts.
export const db = new Dexie('kharcha-pani') as Dexie & {
  entries: EntityTable<Entry, 'id'>;
  photos: EntityTable<Photo, 'id'>;
  categories: Table<Category, string>;
  kv: Table<{ key: string; value: unknown }, string>;
};
db.version(1).stores({ entries: '++id, date, category', photos: '++id, entryId', categories: 'id', kv: 'key' });
db.on('populate', tx => tx.table('categories').bulkAdd(DEFAULT_CATEGORIES));

export const getSettings = async (): Promise<Settings> => ({
  ...DEFAULT_SETTINGS,
  ...((await db.kv.get('settings'))?.value as Partial<Settings> | undefined),
});
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
