import { useState } from 'react';
import { EntryCard, EntrySheet } from '../components/Entry';
import { db, useCats, useLive, type Settings } from '../db';
import { catOf, dayLabel, money, toDate, type Entry } from '../lib';

const PAGE = 30; // days rendered per "show older" tap

export default function Ledger({ s }: { s: Settings }) {
  const cats = useCats();
  const all = useLive(() => db.entries.orderBy('date').reverse().toArray());
  const withPhotos = useLive(() => db.photos.orderBy('entryId').uniqueKeys().then(keys => new Set(keys)));
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [editing, setEditing] = useState<Entry>();
  if (!all || !cats) return null;

  const needle = q.trim().toLowerCase();
  const list = all.filter(e => (!cat || e.category === cat) && (!needle || e.item.toLowerCase().includes(needle)));
  const groups = Object.entries(Object.groupBy(list, e => e.date)) as [string, Entry[]][];

  return (
    <div className="grid gap-4">
      <h1 className="font-display text-4xl">Ledger 📒</h1>
      <input type="search" className="input" placeholder="🔍 Search items" value={q} onChange={e => setQ(e.target.value)} aria-label="Search items" />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none]" role="group" aria-label="Filter by category">
        <button className={`btn shrink-0 text-sm ${cat ? 'bg-white' : 'bg-sunny'}`} aria-pressed={!cat} onClick={() => setCat('')}>All</button>
        {cats.map(c => (
          <button key={c.id} aria-pressed={cat === c.id} onClick={() => setCat(cat === c.id ? '' : c.id)}
            className="btn shrink-0 text-sm normal-case" style={{ background: cat === c.id ? c.color : '#fff' }}>
            {c.emoji} {c.name}
          </button>
        ))}
      </div>

      {groups.slice(0, shown).map(([date, es], i) => (
        <section key={date} className="grid gap-2">
          <h2 className="flex items-baseline justify-between border-b-3 border-ink pb-1">
            <span className="font-display text-2xl">{dayLabel(date)}</span>
            <span className="font-display text-2xl">{money(es.reduce((n, e) => n + e.amount, 0), s.currency)}</span>
          </h2>
          {es.map(e => (
            <EntryCard key={e.id} e={e} cat={catOf(cats, e.category)} cur={s.currency} photo={withPhotos?.has(e.id)} onClick={() => setEditing(e)} />
          ))}
          {!cat && !needle && <NoSpend days={groups[i + 1] ? Math.round((+toDate(date) - +toDate(groups[i + 1][0])) / 864e5) - 1 : 0} />}
        </section>
      ))}
      {groups.length > shown && <button className="btn bg-white" onClick={() => setShown(n => n + PAGE)}>Show older ⏬</button>}
      {!list.length && (
        <p className="card bg-white p-6 text-center font-bold">
          {all.length ? 'Nothing matches. Try another search. 🕵️' : 'No entries yet. Go log a chai! ☕'}
        </p>
      )}

      {editing && <EntrySheet entry={editing} cats={cats} cur={s.currency} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

const NoSpend = ({ days }: { days: number }) =>
  days > 0 && <p className="mt-2 rounded-full border-3 border-dashed border-ink bg-lime py-1 text-center text-sm font-bold">🏆 {days} no-spend day{days > 1 ? 's' : ''}</p>;
