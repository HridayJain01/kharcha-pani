import { useState } from 'react';
import { EntryCard, EntrySheet, who } from '../components/Entry';
import { db, saveDrafts, saveSettings, useCats, useLive, type Settings } from '../db';
import { confetti, toast } from '../fx';
import { catOf, IOU, ME, money, norm, settleUp, today, tripNet, UDHAAR, type Entry, type Trip } from '../lib';

const EMOJIS = ['🏖️', '⛰️', '🏕️', '✈️', '🚗', '🎉', '🏠', '🍻'];
const names = (s: string) => [...new Map(s.split(/[,\n]/).map(n => n.trim()).filter(n => n && norm(n) !== ME).map(n => [norm(n), n])).values()];

async function share(text: string) {
  try {
    if (navigator.share) await navigator.share({ text });
    else await navigator.clipboard.writeText(text).then(() => toast('Copied, go paste it 📋'));
  } catch {
    // share sheet dismissed
  }
}

export default function Trips({ s }: { s: Settings }) {
  const trips = useLive(() => db.trips.reverse().toArray());
  const [open, setOpen] = useState<number>();
  const [adding, setAdding] = useState(false);
  if (!trips) return null;
  const trip = trips.find(t => t.id === open);
  if (trip) return <TripView trip={trip} s={s} onBack={() => setOpen(undefined)} />;

  return (
    <div className="grid gap-4">
      <h1 className="font-display text-4xl">Trips 🧳</h1>
      {!trips.length && !adding && (
        <section className="card bg-sky/25 p-4">
          <p className="font-display text-2xl">Going somewhere with the gang?</p>
          <p className="mt-1 font-bold">Start a trip and everything you log gets split, Splitwise-style. Who paid, who owes, and the fewest payments to settle up. Your share still counts as your spending.</p>
        </section>
      )}
      {adding ? <NewTrip onDone={id => { setAdding(false); if (id) setOpen(id); }} /> : (
        <button className="btn bg-lime text-lg" onClick={() => setAdding(true)}>➕ New trip</button>
      )}
      {trips.map(t => (
        <button key={t.id} onClick={() => setOpen(t.id)} className={`card flex items-center gap-3 p-3 text-left ${t.id === s.tripId ? 'bg-sunny' : ''}`}>
          <span className="text-4xl" aria-hidden>{t.emoji}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-2xl">{t.name}</span>
            <span className="block truncate text-sm font-bold">You, {t.members.join(', ')}</span>
          </span>
          {t.id === s.tripId && <span className="rounded-full border-3 border-ink bg-lime px-2 text-xs font-bold">LIVE</span>}
        </button>
      ))}
    </div>
  );
}

function NewTrip({ onDone }: { onDone: (id?: number) => void }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [members, setMembers] = useState('');
  async function create() {
    const id = await db.trips.add({ name: name.trim(), emoji, members: names(members), start: today(), budget: 0, settles: [] } as Omit<Trip, 'id'> as Trip);
    await saveSettings({ tripId: id });
    confetti();
    toast('Trip mode ON 🧳 Everything you log now gets split');
    onDone(id);
  }
  return (
    <form className="card grid gap-3 p-3" onSubmit={e => { e.preventDefault(); create(); }}>
      <p className="font-display text-2xl">New trip</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Emoji">
        {EMOJIS.map(e => <button key={e} type="button" aria-pressed={emoji === e} onClick={() => setEmoji(e)}
          className={`btn size-12 px-0 text-2xl ${emoji === e ? 'bg-sunny' : 'bg-white'}`}>{e}</button>)}
      </div>
      <input className="input text-lg font-bold" placeholder="Goa 2026" value={name} onChange={e => setName(e.target.value)} aria-label="Trip name" required />
      <input className="input" placeholder="Who's coming? Rahul, Amit, Neha" value={members} onChange={e => setMembers(e.target.value)} aria-label="Friends, comma separated" />
      <div className="flex gap-2">
        <button type="button" className="btn bg-white" onClick={() => onDone()}>Cancel</button>
        <button className="btn flex-1 bg-lime" disabled={!name.trim() || !names(members).length}>Start trip 🚀</button>
      </div>
    </form>
  );
}

function TripView({ trip, s, onBack }: { trip: Trip; s: Settings; onBack: () => void }) {
  const cats = useCats();
  const es = useLive(() => db.entries.where('trip').equals(trip.id).toArray().then(l => l.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)), [trip.id]);
  const [editing, setEditing] = useState<Entry>();
  const [newMember, setNewMember] = useState('');
  const $ = (n: number) => money(n, s.currency);
  if (!es || !cats) return null;

  const live = s.tripId === trip.id;
  const net = tripNet(es, trip.settles);
  const plan = settleUp(net);
  const group = es.reduce((n, e) => n + (e.total ?? 0), 0);
  const mine = es.reduce((n, e) => n + e.amount, 0);
  const used = new Set([...es.flatMap(e => [e.paidBy ?? ME, ...(e.split ?? [])]), ...trip.settles.flatMap(x => [x.from, x.to])]);
  const set = (patch: Partial<Trip>) => db.trips.update(trip.id, patch);
  const settle = (p: { from: string; to: string; amount: number }) => set({ settles: [...trip.settles, { ...p, date: today() }] });

  // Your part of the plan moves into the all-time Udhaar ledger, and the trip records it as settled.
  async function toUdhaar() {
    const mineOnly = plan.filter(p => p.from === ME || p.to === ME);
    if (!confirm(`Move ${mineOnly.length} balance${mineOnly.length > 1 ? 's' : ''} to Udhaar and mark them settled here?`)) return;
    await db.transaction('rw', db.entries, db.photos, db.trips, async () => {
      await saveDrafts(mineOnly.map(p => {
        const iou = p.to === ME ? 'lent' as const : 'borrowed' as const;
        return { item: `${trip.name} trip`, quantity: 1, amount: p.amount, category: UDHAAR.id, date: today(), emoji: IOU[iou].emoji, photos: [], person: p.to === ME ? p.from : p.to, iou };
      }));
      await set({ settles: [...trip.settles, ...mineOnly.map(p => ({ ...p, date: today() }))] });
    });
    toast('Moved to Udhaar 🤝');
  }

  async function remove() {
    if (!confirm(`Delete "${trip.name}"? Its ${es!.length} expenses stay in your ledger as your own spending (your share only).`)) return;
    await db.transaction('rw', db.entries, db.trips, db.kv, async () => {
      await db.entries.where('trip').equals(trip.id).modify(e => { delete e.trip; delete e.total; delete e.paidBy; delete e.split; });
      await db.trips.delete(trip.id);
      if (live) await saveSettings({ tripId: 0 });
    });
    onBack();
  }

  const summary = [`${trip.emoji} ${trip.name} on Kharcha Pani`, `Group spent ${$(group)} (${es.length} bills)`,
    ...(plan.length ? plan.map(p => `${who(p.from)} → ${who(p.to)}: ${$(p.amount)}`) : ['All settled ✅'])].join('\n');

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <button className="btn w-12 shrink-0 bg-white px-0" onClick={onBack} aria-label="All trips">◀</button>
        <h1 className="min-w-0 flex-1 truncate font-display text-4xl">{trip.emoji} {trip.name}</h1>
      </div>
      <button className={`btn text-lg ${live ? 'bg-sunny' : 'bg-lime'}`} onClick={() => saveSettings({ tripId: live ? 0 : trip.id })}>
        {live ? '⏸ Pause trip mode' : '▶️ Turn on trip mode'}
      </button>
      {live && <p className="-mt-2 text-center text-sm font-bold">Everything you log on Add is split with this group.</p>}

      <section className="grid grid-cols-2 gap-2">
        <div className="card bg-sunny p-3"><p className="label">Group spent</p><p className="font-display text-3xl break-all">{$(group)}</p></div>
        <div className="card p-3"><p className="label">Your share</p><p className="font-display text-3xl break-all">{$(mine)}</p></div>
      </section>
      {trip.budget > 0 && (
        <section className="card p-3">
          <p className="flex justify-between text-sm font-bold"><span>Group budget</span><span>{$(group)} / {$(trip.budget)}</span></p>
          <div className="mt-2 h-6 overflow-hidden rounded-full border-3 border-ink bg-white" role="meter" aria-label="Trip budget used" aria-valuemin={0} aria-valuemax={trip.budget} aria-valuenow={group}>
            <div className={`h-full ${group > trip.budget * 0.8 ? 'bg-tomato' : 'bg-lime'}`} style={{ width: `${Math.min(100, (group / trip.budget) * 100)}%` }} />
          </div>
        </section>
      )}

      <section className="card grid gap-2 p-3">
        <h2 className="font-display text-2xl">Balances ⚖️</h2>
        {[ME, ...trip.members].map(p => {
          const v = net[p] ?? 0;
          return (
            <p key={p} className="flex justify-between gap-2 font-bold">
              <span className="truncate">{who(p)}</span>
              <span className={v > 0 ? 'text-green-700' : v < 0 ? 'text-tomato' : ''}>{v > 0 ? `gets ${$(v)}` : v < 0 ? `owes ${$(-v)}` : 'settled ✔'}</span>
            </p>
          );
        })}
      </section>

      <section className="card grid gap-2 bg-lime/30 p-3">
        <h2 className="font-display text-2xl">Settle up 🤝</h2>
        {plan.length ? plan.map(p => (
          <div key={`${p.from}-${p.to}`} className="flex items-center gap-2">
            <p className="min-w-0 flex-1 font-bold">{who(p.from)} → {who(p.to)} <span className="font-display text-xl">{$(p.amount)}</span></p>
            <button className="btn bg-white text-sm" onClick={() => settle(p).then(() => toast('Settled ✅'))}>Paid ✅</button>
          </div>
        )) : <p className="font-bold">{es.length ? 'All square. Friendship intact 🫶' : 'No bills yet. Log one on Add while trip mode is on.'}</p>}
        <div className="flex flex-wrap gap-2">
          {plan.some(p => p.from === ME || p.to === ME) && <button className="btn bg-white text-sm" onClick={toUdhaar}>Move my part to Udhaar</button>}
          {es.length > 0 && <button className="btn bg-white text-sm" onClick={() => share(summary)}>Share in group 📤</button>}
        </div>
      </section>

      <section className="grid gap-2">
        <h2 className="font-display text-3xl">Bills</h2>
        {es.map(e => <EntryCard key={e.id} e={e} cat={catOf(cats, e.category)} cur={s.currency} onClick={() => setEditing(e)} />)}
      </section>

      <details className="card p-3">
        <summary className="min-h-12 cursor-pointer content-center font-display text-2xl">Trip settings ⚙️</summary>
        <div className="grid gap-3 pt-2">
          <label className="grid gap-1 font-bold">Name
            <input className="input" defaultValue={trip.name} onBlur={e => e.target.value.trim() && set({ name: e.target.value.trim() })} />
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Emoji">
            {EMOJIS.map(x => <button key={x} aria-pressed={trip.emoji === x} onClick={() => set({ emoji: x })}
              className={`btn size-12 px-0 text-2xl ${trip.emoji === x ? 'bg-sunny' : 'bg-white'}`}>{x}</button>)}
          </div>
          <label className="grid gap-1 font-bold">Group budget (0 = none)
            <input type="number" inputMode="decimal" min="0" className="input" defaultValue={trip.budget || ''}
              onBlur={e => set({ budget: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          <p className="font-bold">People</p>
          {trip.members.map(m => (
            <div key={m} className="flex items-center justify-between gap-2">
              <span className="font-bold">{m}</span>
              {used.has(m) ? <span className="text-xs font-bold">in bills</span> : (
                <button className="btn bg-white text-sm" onClick={() => set({ members: trip.members.filter(x => x !== m) })}>Remove</button>
              )}
            </div>
          ))}
          <form className="flex gap-2" onSubmit={e => {
            e.preventDefault();
            const add = names(newMember).filter(n => !trip.members.some(m => norm(m) === norm(n)));
            if (add.length) set({ members: [...trip.members, ...add] });
            setNewMember('');
          }}>
            <input className="input min-w-0 flex-1" placeholder="Add someone" value={newMember} onChange={e => setNewMember(e.target.value)} aria-label="Add someone" />
            <button className="btn bg-lime" disabled={!newMember.trim()}>Add</button>
          </form>
          <p className="text-xs font-bold">New people join future bills. Older bills keep their split unless you edit them.</p>
          <button className="btn bg-tomato" onClick={remove}>🗑️ Delete trip</button>
        </div>
      </details>

      {editing && <EntrySheet entry={editing} cats={cats} cur={s.currency} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
