import { useEffect, useRef, useState } from 'react';
import { db, deleteEntry, getRepeats, isRepeat, toggleRepeat, updateEntry, useLive } from '../db';
import { toast } from '../fx';
import { money, today, type Category, type Draft, type Entry, type PhotoRef } from '../lib';

export function EntryCard({ e, cat, cur, stamp, photo, onClick }: {
  e: Entry; cat: Category; cur: string; stamp?: boolean; photo?: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="card relative flex w-full items-center gap-3 p-2 pr-3 text-left">
      <span className="grid size-12 shrink-0 place-items-center rounded-lg border-3 border-ink text-2xl" style={{ background: cat.color }} aria-hidden>
        {e.emoji || cat.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-lg font-bold leading-tight">
          {e.quantity > 1 && `${e.quantity}× `}{e.item}{photo && ' 📷'}
        </span>
        <span className="block truncate text-xs font-medium">{cat.name}</span>
      </span>
      <span className="shrink-0 font-display text-2xl">{money(e.amount, cur)}</span>
      {stamp && <span className="stamp">LOGGED!</span>}
    </button>
  );
}

// Editable item / amount / category / date / photos. Used by the preview cards and the edit sheet.
export function EntryFields({ d, cats, cur, onChange }: {
  d: Draft; cats: Category[]; cur: string; onChange: (patch: Partial<Draft>) => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <input className="input w-14 shrink-0 px-0 text-center text-2xl" value={d.emoji} aria-label="Emoji"
          onChange={e => onChange({ emoji: [...new Intl.Segmenter().segment(e.target.value.trim())].at(-1)?.segment ?? '' })} />
        <input className="input min-w-0 flex-1 text-lg font-bold" value={d.item} aria-label="Item" placeholder="What?"
          onChange={e => onChange({ item: e.target.value })} />
        <label className={`input flex w-36 shrink-0 items-center gap-1 ${d.amount ? '' : 'bg-tomato/25'}`}>
          <span className="font-display text-xl">{cur}</span>
          <input type="number" inputMode="decimal" min="0" step="any" placeholder="?" aria-label="Amount"
            className="w-full min-w-0 bg-transparent font-display text-2xl outline-none" value={d.amount ?? ''}
            onChange={e => onChange({ amount: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
      </div>
      <select className="input font-bold" value={d.category} aria-label="Category"
        onChange={e => onChange({ category: e.target.value })}>
        {cats.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
      </select>
      <div className="flex flex-wrap items-center gap-3">
        <input type="date" className="input w-40 font-bold" value={d.date} aria-label="Date"
          onChange={e => onChange({ date: e.target.value || today() })} />
        <Photos photos={d.photos} onChange={photos => onChange({ photos })} />
      </div>
    </div>
  );
}

export function EntrySheet({ entry, cats, cur, onClose }: { entry: Entry; cats: Category[]; cur: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [d, setD] = useState<Draft>({ ...entry, photos: [] });
  const [ready, setReady] = useState(false);
  const repeats = useLive(getRepeats);

  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
    db.photos.where('entryId').equals(entry.id).toArray().then(photos => {
      setD(d => ({ ...d, photos }));
      setReady(true);
    });
  }, [entry.id]);

  async function save() {
    setReady(false); // disables the button, so a double tap can't add the new photos twice
    try {
      await updateEntry(entry.id, d);
      onClose();
      toast('Updated ✏️');
    } catch (e) {
      setReady(true);
      toast(`Couldn't save 😵 ${(e as Error).message}`);
    }
  }
  async function remove() {
    if (!confirm(`Delete "${entry.item}" (${money(entry.amount, cur)})?`)) return;
    await deleteEntry(entry.id);
    onClose();
    toast('Deleted 🗑️');
  }

  return (
    <dialog ref={ref} onClose={onClose} className="sheet" aria-label="Edit entry">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-3xl">Edit {entry.emoji}</h2>
        <button className="btn size-12 bg-white px-0" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <EntryFields d={d} cats={cats} cur={cur} onChange={p => setD(d => ({ ...d, ...p }))} />
      <label className="mt-3 flex min-h-12 items-center gap-2 font-bold">
        <input type="checkbox" className="size-6 accent-ink" checked={isRepeat(repeats, entry.item)}
          onChange={async () => toast((await toggleRepeat({ ...entry, ...d, amount: d.amount ?? entry.amount })) ? 'Added every month 🔁' : 'Stopped repeating')} />
        🔁 Repeat every month (rent, Netflix…)
      </label>
      <div className="mt-4 flex gap-3">
        <button className="btn bg-tomato" onClick={remove}>🗑️ Delete</button>
        <button className="btn flex-1 bg-lime text-lg" disabled={!ready || !d.item.trim() || !(Number(d.amount) > 0)} onClick={save}>
          Save it
        </button>
      </div>
    </dialog>
  );
}

function Photos({ photos, onChange }: { photos: PhotoRef[]; onChange: (p: PhotoRef[]) => void }) {
  const [busy, setBusy] = useState(false);

  async function add(files: File[]) {
    setBusy(true);
    try {
      const blobs = await Promise.all(files.slice(0, 3 - photos.length).map(compress));
      onChange([...photos, ...blobs.map(blob => ({ blob }))]);
    } catch {
      toast("Couldn't read that photo 😵");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {photos.map((p, i) => (
        <span key={p.id ?? `new-${i}`} className="relative">
          <Thumb blob={p.blob} />
          <button aria-label="Remove photo" onClick={() => onChange(photos.filter((_, j) => j !== i))}
            className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full border-2 border-ink bg-tomato text-xs font-bold after:absolute after:-inset-2.5">
            ✕
          </button>
        </span>
      ))}
      {photos.length < 3 && (
        <>
          {/* Android hides the camera when `multiple` is set, so the camera gets its own button */}
          <label className="btn bg-white text-sm">
            {busy ? '⏳' : '📸'} Camera
            <input type="file" accept="image/*" capture="environment" className="sr-only"
              onChange={e => { add([...(e.target.files ?? [])]); e.target.value = ''; }} />
          </label>
          <label className="btn bg-white text-sm">
            {busy ? '⏳' : '🖼️'} Gallery
            <input type="file" accept="image/*" multiple className="sr-only"
              onChange={e => { add([...(e.target.files ?? [])]); e.target.value = ''; }} />
          </label>
        </>
      )}
    </>
  );
}

function Thumb({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string>();
  const [big, setBig] = useState(false);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  if (!url) return null;
  return (
    <>
      <button onClick={() => setBig(true)} aria-label="View photo" className="block">
        <img src={url} alt="" className="size-16 rounded-lg border-3 border-ink object-cover" />
      </button>
      {big && (
        <button onClick={() => setBig(false)} aria-label="Close photo" className="fixed inset-0 z-50 grid place-items-center bg-ink/90 p-4">
          <img src={url} alt="" className="max-h-full max-w-full rounded-lg border-3 border-paper" />
        </button>
      )}
    </>
  );
}

// Longest side ≤1200px, JPEG. Drawing via <img> keeps the phone camera's EXIF rotation.
async function compress(file: Blob) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = Object.assign(document.createElement('canvas'), {
      width: Math.round(img.naturalWidth * k),
      height: Math.round(img.naturalHeight * k),
    });
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#fff'; // transparent PNGs would turn black in JPEG
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((ok, fail) =>
      canvas.toBlob(b => (b ? ok(b) : fail(new Error('compress failed'))), 'image/jpeg', 0.8));
  } finally {
    URL.revokeObjectURL(url);
  }
}
