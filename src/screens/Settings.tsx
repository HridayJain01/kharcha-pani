import { useEffect, useState, type ReactNode } from 'react';
import { PROVIDERS, SHARED, testKey } from '../ai';
import { db, DEFAULT_SETTINGS, getRepeats, useLive, getSettings, saveSettings, useCats, type Provider, type Settings as S } from '../db';
import { toast } from '../fx';
import { catOf, guessCategory, IOU, isYmd, money, today, ymd, type Category, type Entry } from '../lib';
import { loadOffline, offlineReady, OFFLINE_MB, removeOffline } from '../voice';

const PALETTE = ['#B8F135', '#FFD23F', '#9B5DE5', '#FF5A36', '#3A86FF', '#FF4FA3'];

// Phones get the share sheet ("Save to Files" on iPhone); anything else downloads.
async function saveFile(blob: Blob, name: string) {
  const file = new File([blob], name, { type: blob.type });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      return await navigator.share({ files: [file] });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card grid gap-3 p-4">
      <h2 className="font-display text-2xl">{title}</h2>
      {children}
    </section>
  );
}

// Every field saves on change, not blur: iOS doesn't always blur an input before a tab switch unmounts it.
export default function Settings({ s }: { s: S }) {
  const cats = useCats();
  const [provider, setProvider] = useState(s.provider);
  const [key, setKey] = useState(s.apiKey);
  const [model, setModel] = useState(s.model);
  const [baseUrl, setBaseUrl] = useState(s.baseUrl);
  const [test, setTest] = useState('');
  const [persisted, setPersisted] = useState<boolean>();
  const [voiceReady, setVoiceReady] = useState(offlineReady);
  const [dl, setDl] = useState<number | null>(null);
  useEffect(() => { navigator.storage?.persisted?.().then(setPersisted); }, []);
  if (!cats) return null;
  const p = PROVIDERS[provider];

  async function runTest() {
    setTest('Testing… ⏳');
    try {
      await testKey({ ...s, provider, apiKey: key.trim(), model: model.trim() || p.model, baseUrl });
      setTest('✅ Key works. AI is go!');
    } catch (e) {
      setTest(`❌ ${(e as Error).message}`);
    }
  }

  // Switching clears the key, so one company's key is never sent to another's API.
  function pickProvider(next: Provider) {
    if (next === provider) return;
    setProvider(next);
    setKey('');
    setModel(PROVIDERS[next].model);
    setBaseUrl('');
    setTest('');
    saveSettings({ provider: next, apiKey: '', model: PROVIDERS[next].model, baseUrl: '' });
  }

  async function getVoiceModel() {
    setDl(0);
    try {
      await loadOffline(setDl);
      setVoiceReady(true);
      toast('Offline voice ready 🎤');
    } catch (e) {
      toast(`Download failed: ${(e as Error).message}`);
    } finally {
      setDl(null);
    }
  }

  async function addCategory() {
    const name = prompt('Name for the new category?')?.trim();
    if (!name || !cats) return;
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category';
    let id = base;
    for (let i = 2; cats.some(c => c.id === id); i++) id = `${base}-${i}`;
    const order = Math.max(0, ...cats.filter(c => c.id !== 'misc').map(c => c.order)) + 1;
    await db.categories.add({ id, name, emoji: '✨', color: PALETTE[cats.length % PALETTE.length], hint: '', order });
  }

  async function removeCategory(c: Category) {
    const n = await db.entries.where('category').equals(c.id).count();
    if (!confirm(`Delete "${c.name}"?${n ? ` Its ${n} entries move to Oops, Misc.` : ''}`)) return;
    await db.transaction('rw', db.entries, db.categories, async () => {
      await db.entries.where('category').equals(c.id).modify({ category: 'misc' });
      await db.categories.delete(c.id);
    });
  }

  async function exportCsv() {
    const rows = await db.entries.orderBy('date').toArray();
    const csv = [['date', 'item', 'quantity', 'amount', 'category', 'udhaar', 'person'],
      ...rows.map(e => [e.date, e.item, e.quantity, e.amount, catOf(cats!, e.category).name, e.iou ? IOU[e.iou].label : '', e.person ?? ''])]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    await saveFile(new Blob(['﻿' + csv], { type: 'text/csv' }), `kharcha-pani-${today()}.csv`); // BOM so Excel reads ₹ and emoji
  }

  // ponytail: the whole zip is built in memory; fine for hundreds of photos, stream it if it ever grows to thousands.
  async function backup() {
    const { default: JSZip } = await import('jszip');
    const [entries, categories, photos, settings, repeats] =
      await Promise.all([db.entries.toArray(), db.categories.toArray(), db.photos.toArray(), getSettings(), getRepeats()]);
    const zip = new JSZip();
    zip.file('data.json', JSON.stringify({
      app: 'kharcha-pani', version: 1, exportedAt: new Date().toISOString(),
      settings: { ...settings, apiKey: undefined }, // the key never leaves the device
      categories, entries, repeats, photos: photos.map(p => ({ id: p.id, entryId: p.entryId })),
    }));
    for (const p of photos) zip.file(`photos/${p.id}.jpg`, p.blob);
    await saveFile(await zip.generateAsync({ type: 'blob' }), `kharcha-pani-backup-${today()}.zip`);
  }

  // The zip is user-supplied: validate and rebuild every record instead of trusting it.
  async function restore(file: File) {
    try {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(file);
      const data = JSON.parse((await zip.file('data.json')?.async('string')) ?? 'null');
      if (data?.app !== 'kharcha-pani' || !Array.isArray(data.entries)) throw new Error("that's not a Kharcha Pani backup");
      const entries: Entry[] = data.entries
        .filter((e: any) => Number.isInteger(e?.id) && typeof e.item === 'string' && Number(e.amount) > 0 && isYmd(e.date) && typeof e.category === 'string')
        .map((e: any) => ({ id: e.id, item: e.item.slice(0, 60), quantity: Math.max(1, Number(e.quantity) || 1), amount: Number(e.amount), category: e.category, date: e.date, emoji: String(e.emoji ?? ''), createdAt: Number(e.createdAt) || Date.now(),
          ...(Object.hasOwn(IOU, e.iou) && typeof e.person === 'string' && e.person.trim() ? { iou: e.iou, person: e.person.trim().slice(0, 40) } : {}) }));
      const categories: Category[] = (Array.isArray(data.categories) ? data.categories : [])
        .filter((c: any) => typeof c?.id === 'string' && typeof c.name === 'string')
        .map((c: any, i: number) => ({ id: c.id, name: c.name, emoji: String(c.emoji ?? '🏷️'), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : PALETTE[i % PALETTE.length], hint: String(c.hint ?? ''), order: Number(c.order) || i }));
      if (!categories.some(c => c.id === 'misc')) categories.push(catOf([], 'misc'));
      const ids = new Set(entries.map(e => e.id));
      const metas = (Array.isArray(data.photos) ? data.photos : []).filter((p: any) => ids.has(p?.entryId) && zip.file(`photos/${p.id}.jpg`));
      if (!confirm(`Replace EVERYTHING on this device with ${entries.length} entries and ${metas.length} photos from this backup?`)) return;
      const photos = await Promise.all(metas.map(async (p: any) => ({
        entryId: p.entryId as number,
        blob: new Blob([await zip.file(`photos/${p.id}.jpg`)!.async('arraybuffer')], { type: 'image/jpeg' }),
      })));
      const st = data.settings ?? {};
      await db.transaction('rw', [db.entries, db.categories, db.photos, db.kv], async () => {
        await Promise.all([db.entries.clear(), db.categories.clear(), db.photos.clear()]);
        await db.entries.bulkAdd(entries);
        await db.categories.bulkAdd(categories);
        await db.photos.bulkAdd(photos);
        // older backups have no repeats: keep whatever is set up here
        if (Array.isArray(data.repeats)) await db.kv.put({ key: 'repeats', value: data.repeats
          .filter((r: any) => r?.item && Number(r.amount) > 0 && /^\d{4}-\d{2}$/.test(r.last))
          .map((r: any) => ({ item: String(r.item).slice(0, 60), amount: Number(r.amount), category: String(r.category), emoji: String(r.emoji ?? ''), day: Math.min(31, Math.max(1, Number(r.day) || 1)), last: r.last })) });
        await saveSettings({
          ...(typeof st.currency === 'string' && st.currency ? { currency: st.currency.slice(0, 4) } : {}),
          ...(Number(st.budget) >= 0 ? { budget: Number(st.budget) } : {}),
          ...(typeof st.model === 'string' && st.model ? { model: st.model } : {}),
        });
      });
      toast('Restored ♻️');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      toast(`Restore failed: ${(e as Error).message}`);
    }
  }

  async function persist() {
    const ok = !!(await navigator.storage?.persist?.());
    setPersisted(ok);
    toast(ok ? 'Locked in 🔒' : 'Browser said not now. Installing the app usually helps.');
  }

  return (
    <div className="grid gap-5">
      <h1 className="font-display text-4xl">Settings ⚙️</h1>

      <Section title="🧠 AI (optional)">
        <p className="text-sm font-medium">
          {SHARED && !key.trim()
            ? 'AI and Whisper voice are already on for you. Add your own key only if you keep hitting the free daily limit.'
            : 'Works fully offline without it. A free key reads messier notes and unlocks ROAST ME 🔥.'}
        </p>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="AI provider">
          {(Object.keys(PROVIDERS) as Provider[]).map(id => (
            <button key={id} aria-pressed={provider === id} onClick={() => pickProvider(id)}
              className={`btn px-1 ${provider === id ? 'bg-sunny' : 'bg-white'}`}>
              {PROVIDERS[id].label}
            </button>
          ))}
        </div>
        <p className="text-sm font-medium">
          {p.blurb} {p.keyUrl && <a className="font-bold underline" href={p.keyUrl} target="_blank" rel="noreferrer">Get a free key ↗</a>}
        </p>
        {provider === 'custom' && (
          <label className="grid gap-1">
            <span className="label">Base URL</span>
            <input className="input" type="url" autoCapitalize="off" spellCheck={false} placeholder="https://openrouter.ai/api/v1" value={baseUrl}
              onChange={e => { setBaseUrl(e.target.value); saveSettings({ baseUrl: e.target.value.trim() }); }} />
          </label>
        )}
        <label className="grid gap-1">
          <span className="label">API key</span>
          <input className="input" type="password" autoComplete="off" spellCheck={false} value={key}
            onChange={e => { setKey(e.target.value); saveSettings({ apiKey: e.target.value.trim() }); }} />
        </label>
        <label className="grid gap-1">
          <span className="label">Model</span>
          <input className="input" autoCapitalize="off" spellCheck={false} value={model} placeholder="model id"
            onChange={e => { setModel(e.target.value); saveSettings({ model: e.target.value.trim() || p.model }); }}
            onBlur={() => setModel(m => m.trim() || p.model)} />
        </label>
        <button className="btn bg-sky" disabled={!key.trim()} onClick={runTest}>Test key</button>
        {test && <p className="font-bold break-words">{test}</p>}
      </Section>

      <Section title="🎤 Voice">
        <p className="text-sm font-medium">
          {(provider === 'groq' && key.trim()) || (SHARED && !key.trim())
            ? 'With Groq, voice notes use Whisper in the cloud (the most accurate). With no signal, the offline model takes over.'
            : 'Voice notes run on this phone with a small speech model: private, free, and offline after one download. A Groq key upgrades them to Whisper.'}
        </p>
        {voiceReady ? (
          <button className="btn bg-white" onClick={async () => {
            if (!confirm(`Remove the offline voice model? Frees ~${OFFLINE_MB} MB; it downloads again next time you need it.`)) return;
            await removeOffline();
            setVoiceReady(false);
            toast('Voice model removed');
          }}>
            ✅ Offline model ready · remove
          </button>
        ) : (
          <button className="btn bg-lime" disabled={dl !== null || !navigator.onLine} onClick={getVoiceModel}>
            {dl !== null ? `Downloading… ${dl}%` : `⬇️ Download offline voice (~${OFFLINE_MB} MB)`}
          </button>
        )}
      </Section>

      <Section title="💰 Money">
        <div className="flex items-end gap-3">
          <label className="grid w-24 gap-1">
            <span className="label">Currency</span>
            <input className="input text-center font-display text-xl" maxLength={4} defaultValue={s.currency}
              onChange={e => saveSettings({ currency: e.target.value.trim() || DEFAULT_SETTINGS.currency })} />
          </label>
          <label className="grid flex-1 gap-1">
            <span className="label">Monthly budget (optional)</span>
            <input className="input font-display text-xl" type="number" inputMode="numeric" min="0" placeholder="e.g. 15000"
              defaultValue={s.budget || ''} onChange={e => saveSettings({ budget: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        </div>
        <div className="flex items-end gap-3">
          <label className="grid flex-1 gap-1">
            <span className="label">🫙 Saving up for</span>
            <input className="input font-bold" maxLength={40} placeholder="Goa trip" defaultValue={s.goal}
              onChange={e => saveSettings({ goal: e.target.value.trim() })} />
          </label>
          <label className="grid w-32 gap-1">
            <span className="label">Goal</span>
            <input className="input font-display text-xl" type="number" inputMode="numeric" min="0" placeholder="15000"
              defaultValue={s.goalAmount || ''} onChange={e => saveSettings({ goalAmount: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        </div>
        <p className="text-sm font-bold">Whatever you don't spend of your budget each month drops into the jar (Overview).</p>
      </Section>

      <Section title="🔁 Recurring costs">
        <Recurring cur={s.currency} />
      </Section>

      <Section title="🏷️ Categories">
        <p className="text-sm font-medium">Keywords help the AI and the offline parser pick the right one.</p>
        {cats.map(c => (
          <div key={c.id} className="grid gap-2 border-b-3 border-dashed border-ink/25 pb-3">
            <div className="flex gap-2">
              <input type="color" aria-label={`${c.name} colour`} defaultValue={c.color} className="swatch"
                onChange={e => db.categories.update(c.id, { color: e.target.value })} />
              <input aria-label={`${c.name} emoji`} defaultValue={c.emoji} className="input w-14 shrink-0 px-0 text-center text-2xl"
                onChange={e => db.categories.update(c.id, { emoji: e.target.value.trim() || '🏷️' })} />
              <input aria-label="Category name" defaultValue={c.name} className="input min-w-0 flex-1 font-bold"
                onChange={e => db.categories.update(c.id, { name: e.target.value.trim() || c.name })} />
            </div>
            <div className="flex gap-2">
              <input aria-label={`${c.name} keywords`} defaultValue={c.hint} placeholder="keywords, like: gym, haircut" className="input min-w-0 flex-1 text-sm"
                onChange={e => db.categories.update(c.id, { hint: e.target.value.trim() })} />
              {c.id !== 'misc' && (
                <button className="btn w-12 shrink-0 bg-white px-0" aria-label={`Delete ${c.name}`} onClick={() => removeCategory(c)}>🗑️</button>
              )}
            </div>
          </div>
        ))}
        <button className="btn bg-lime" onClick={addCategory}>＋ Add category</button>
      </Section>

      <Section title="💾 Your data">
        <p className="text-sm font-medium">Everything lives only on this device. Back up now and then!</p>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn bg-sky" onClick={exportCsv}>📄 CSV</button>
          <button className="btn bg-sunny" onClick={backup}>📦 Backup</button>
          <label className="btn col-span-2 bg-pink">
            ♻️ Restore backup
            <input type="file" accept=".zip,application/zip" className="sr-only"
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) restore(f); }} />
          </label>
        </div>
        <button className="btn bg-lime" disabled={persisted} onClick={persist}>
          {persisted ? '🔒 Storage is persistent' : '🔒 Ask for persistent storage'}
        </button>
        <p className="text-sm font-medium">
          {persisted ? "The browser won't auto-clear your data." : 'Without it, the browser may clear data when the phone runs low on space.'}
        </p>
      </Section>

      <button className="btn bg-white" onClick={() => saveSettings({ toured: false })}>👀 Show me around again</button>

      <p className="pb-2 text-center text-sm font-bold">Kharcha Pani · made with chai ☕</p>
    </div>
  );
}

// Rent, Netflix…: added automatically each month on the same day. New ones start from the 🔁 box when editing an entry.
function Recurring({ cur }: { cur: string }) {
  const rs = useLive(getRepeats);
  const [draft, setDraft] = useState({ item: '', amount: '', day: '1' });
  const cats = useCats();
  const put = (value: unknown) => db.kv.put({ key: 'repeats', value });
  async function add() {
    const day = Math.min(31, Math.max(1, Number(draft.day) || 1));
    const t = today();
    // starts this month if the day hasn't passed yet, otherwise next month
    const [y, m] = t.split('-').map(Number);
    const last = day > +t.slice(8) ? ymd(new Date(y, m - 2, 1)).slice(0, 7) : t.slice(0, 7);
    const g = guessCategory(draft.item, cats ?? []);
    await put([...(rs ?? []), { item: draft.item.trim(), amount: Number(draft.amount), category: g.id, emoji: g.emoji, day, last }]);
    setDraft({ item: '', amount: '', day: '1' });
    toast('Added 🔁');
  }
  return (
    <div className="grid gap-2">
      {rs?.map((r, i) => (
        <div key={r.item} className="card flex items-center gap-2 p-2">
          <span className="text-2xl">{r.emoji}</span>
          <span className="min-w-0 flex-1 truncate font-bold">{r.item}</span>
          <span className="text-sm font-bold">{money(r.amount, cur)} · day {r.day}</span>
          <button className="btn w-12 shrink-0 bg-white px-0" aria-label={`Stop ${r.item}`} onClick={() => put(rs.filter((_, j) => j !== i))}>🗑️</button>
        </div>
      ))}
      {!rs?.length && <p className="text-sm font-bold">Nothing recurring yet.</p>}
      <div className="flex gap-2">
        <input className="input min-w-0 flex-1 font-bold" placeholder="Netflix" value={draft.item} onChange={e => setDraft({ ...draft, item: e.target.value })} />
        <input className="input w-24" type="number" inputMode="numeric" placeholder="649" aria-label="Amount" value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })} />
        <input className="input w-16" type="number" min="1" max="31" aria-label="Day of month" value={draft.day} onChange={e => setDraft({ ...draft, day: e.target.value })} />
      </div>
      <button className="btn bg-lime" disabled={!draft.item.trim() || !(Number(draft.amount) > 0)} onClick={add}>＋ Add recurring cost</button>
    </div>
  );
}
