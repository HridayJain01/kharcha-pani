import { useState } from 'react';
import { Bar, BarChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { roast } from '../ai';
import { EntryCard, EntrySheet } from '../components/Entry';
import { db, useCats, useLive, useToday, type Settings } from '../db';
import { reducedMotion, toast } from '../fx';
import { catOf, dayLabel, days, money, period, summarize, toDate, type Entry, type Unit } from '../lib';

const UNITS = [['day', 'Today'], ['week', 'Week'], ['month', 'Month']] as const;
const WORD = { day: 'daily', week: 'weekly', month: 'monthly' } as const;
const INK = '#111111';
const TIP = { border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `4px 4px 0 ${INK}`, fontWeight: 700 };

interface Roast { total: number; count: number; roast: string; tip: string }

const short = (s: string) => toDate(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function title(unit: Unit, offset: number, start: string, end: string) {
  if (unit === 'day') return dayLabel(start);
  if (unit === 'month') return toDate(start).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  return offset === 0 ? 'This week' : offset === 1 ? 'Last week' : `${short(start)} – ${short(end)}`;
}

export default function Overview({ s }: { s: Settings }) {
  const cats = useCats();
  const t = useToday();
  const [unit, setUnit] = useState<Unit>('week');
  const [offset, setOffset] = useState(0);
  const [sel, setSel] = useState<string>();
  const [roasting, setRoasting] = useState(false);
  const [editing, setEditing] = useState<Entry>();

  const p = period(unit, offset, t);
  const prev = period(unit, offset + 1, t);
  const m = period('month', 0, p.end);
  const roastKey = `roast:${unit}:${p.start}`;
  const range = useLive(() => db.entries.where('date').between(prev.start, p.end, true, true).toArray(), [prev.start, p.end]);
  const month = useLive(() => db.entries.where('date').between(m.start, m.end, true, true).toArray(), [m.start]);
  const first = useLive(() => db.entries.orderBy('date').first());
  const cached = useLive(() => db.kv.get(roastKey), [roastKey]);
  if (!range || !cats) return null;

  const $ = (n: number) => money(n, s.currency);
  const entries = range.filter(e => e.date >= p.start);
  const prevTotal = range.reduce((n, e) => (e.date < p.start ? n + e.amount : n), 0);
  // No-spend days only count from your first ever entry up to today.
  const S = summarize(entries, first ? days(first.date > p.start ? first.date : p.start, p.end < t ? p.end : t) : []);
  const pct = prevTotal ? Math.round(((S.total - prevTotal) / prevTotal) * 100) : null;
  const vs = offset ? `the ${unit} before` : { day: 'yesterday', week: 'last week', month: 'last month' }[unit];
  const monthTotal = month?.reduce((n, e) => n + e.amount, 0) ?? 0;
  const fill = s.budget ? (monthTotal / s.budget) * 100 : 0;
  const selCat = sel ? catOf(cats, sel) : undefined;
  const top = S.items[0];
  const saved = cached?.value as Roast | undefined;
  const roasted = saved && saved.total === S.total && saved.count === S.count ? saved : undefined; // re-roast once the numbers change

  const pie = S.byCat.map(c => {
    const k = catOf(cats, c.id);
    return { cat: c.id, name: `${k.emoji} ${k.name}`, value: c.total, fill: k.color, fillOpacity: sel && sel !== c.id ? 0.25 : 1 };
  });
  const rows = days(p.start, p.end).map(d => {
    const row: Record<string, number | string> = {
      label: unit === 'week' ? toDate(d).toLocaleDateString('en-IN', { weekday: 'short' }) : String(toDate(d).getDate()),
      full: dayLabel(d, t),
    };
    for (const e of entries) if (e.date === d) row[`c:${e.category}`] = Number(row[`c:${e.category}`] ?? 0) + e.amount;
    return row;
  });
  const pick = (id: string) => setSel(sel === id ? undefined : id);
  const go = (patch: () => void) => { patch(); setSel(undefined); };

  const doRoast = async () => {
    setRoasting(true);
    try {
      const r = await roast(WORD[unit], {
        period: `${title(unit, offset, p.start, p.end)} (${p.start} to ${p.end})`,
        currency: s.currency,
        total: S.total,
        entries: S.count,
        previousPeriodTotal: prevTotal,
        byCategory: S.byCat.map(c => ({ category: catOf(cats, c.id).name, total: c.total, count: c.count })),
        topItems: S.items.slice(0, 5).map(i => ({ item: i.item, times: i.qty, total: i.total })),
        biggestSpend: S.biggest && { item: S.biggest.item, amount: S.biggest.amount },
        priciestDay: S.topDay,
        noSpendDays: S.noSpend,
        ...(s.budget ? { monthlyBudget: s.budget, spentThisMonth: monthTotal } : {}),
      });
      await db.kv.put({ key: roastKey, value: { total: S.total, count: S.count, ...r } });
    } catch (e) {
      toast(`Roast failed: ${(e as Error).message}`);
    } finally {
      setRoasting(false);
    }
  };

  return (
    <div className="grid gap-4">
      <h1 className="font-display text-4xl">Overview 📊</h1>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Period">
        {UNITS.map(([u, label]) => (
          <button key={u} aria-pressed={unit === u} className={`btn ${unit === u ? 'bg-grape' : 'bg-white'}`}
            onClick={() => go(() => { setUnit(u); setOffset(0); })}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button className="btn w-12 shrink-0 bg-white px-0" aria-label="Earlier" onClick={() => go(() => setOffset(o => o + 1))}>◀</button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate font-display text-2xl leading-tight">{title(unit, offset, p.start, p.end)}</p>
          {unit === 'week' && offset < 2 && <p className="text-sm font-bold">{short(p.start)} – {short(p.end)}</p>}
        </div>
        <button className="btn w-12 shrink-0 bg-white px-0" aria-label="Later" disabled={!offset} onClick={() => go(() => setOffset(o => o - 1))}>▶</button>
      </div>

      <section className="card bg-sunny p-4 text-center">
        <p className="label">Total spent</p>
        <p className="mt-1 font-display text-6xl leading-none break-all">{$(S.total)}</p>
        {pct !== null && (
          <p className={`mt-3 inline-block rounded-full border-3 border-ink px-3 py-1 text-sm font-bold ${pct > 0 ? 'bg-tomato' : 'bg-lime'}`}>
            {pct > 0 ? '↑' : pct < 0 ? '↓' : '='} {Math.abs(pct)}% vs {vs}
          </p>
        )}
      </section>

      {s.budget > 0 && (
        <section className="card p-3">
          <p className="flex justify-between gap-2 text-sm font-bold">
            <span>{toDate(m.start).toLocaleDateString('en-IN', { month: 'long' })} budget</span>
            <span>{$(monthTotal)} / {$(s.budget)}</span>
          </p>
          <div className="mt-2 h-6 overflow-hidden rounded-full border-3 border-ink bg-white"
            role="meter" aria-label="Monthly budget used" aria-valuemin={0} aria-valuemax={s.budget} aria-valuenow={monthTotal}>
            {fill > 0 && <div className={`h-full border-r-3 border-ink ${fill > 80 ? 'bg-tomato' : 'bg-lime'}`} style={{ width: `${Math.min(100, fill)}%` }} />}
          </div>
          <p className="mt-1 text-sm font-bold">
            {fill > 100 ? `Over by ${$(monthTotal - s.budget)} 😬` : fill > 80 ? 'Careful, nearly there 🫣' : `${$(s.budget - monthTotal)} left 👍`}
          </p>
        </section>
      )}

      {S.count === 0 ? (
        <p className="card bg-white p-6 text-center font-bold">Nothing logged here. Either a saint or forgetful. 😇</p>
      ) : (
        <>
          <section className="card grid gap-3 p-3">
            <h2 className="font-display text-2xl">Where it went</h2>
            <div className="relative h-60">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="92%" stroke={INK} strokeWidth={3}
                    className="cursor-pointer" isAnimationActive={!reducedMotion()} onClick={(_, i) => pick(pie[i].cat)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <div className="max-w-28">
                  <div className="text-3xl">{selCat?.emoji ?? '💸'}</div>
                  <div className="font-display text-2xl">{$(sel ? S.byCat.find(c => c.id === sel)?.total ?? 0 : S.total)}</div>
                  <div className="text-xs font-bold leading-tight">{selCat ? selCat.name : 'tap a slice'}</div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {pie.map(c => (
                <button key={c.cat} aria-pressed={sel === c.cat} aria-label={c.name} onClick={() => pick(c.cat)}
                  className={`flex min-h-12 items-center gap-1.5 rounded-full border-3 border-ink px-3 text-sm font-bold ${sel === c.cat ? 'bg-sunny' : 'bg-white'}`}>
                  <span className="size-4 shrink-0 rounded-full border-2 border-ink" style={{ background: c.fill }} />
                  {catOf(cats, c.cat).emoji} {Math.round((c.value / S.total) * 100)}%
                </button>
              ))}
            </div>
            {selCat && (
              <div className="grid gap-2">
                {entries.filter(e => e.category === sel).sort((a, b) => b.date.localeCompare(a.date)).map(e => (
                  <EntryCard key={e.id} e={e} cat={selCat} cur={s.currency} onClick={() => setEditing(e)} />
                ))}
              </div>
            )}
          </section>

          {unit !== 'day' && (
            <section className="card p-3">
              <h2 className="font-display text-2xl">Day by day</h2>
              <div className="mt-2 h-52">
                <ResponsiveContainer>
                  <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: INK, strokeWidth: 2 }}
                      tick={{ fill: INK, fontSize: 12, fontWeight: 700 }} interval="preserveStartEnd" minTickGap={6} />
                    <YAxis width={40} axisLine={false} tickLine={false} tick={{ fill: INK, fontSize: 11, fontWeight: 700 }}
                      tickFormatter={v => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : v)} />
                    <Tooltip cursor={{ fill: 'rgb(17 17 17 / 0.08)' }} contentStyle={TIP}
                      formatter={v => $(Number(v))} labelFormatter={(_, payload) => payload?.[0]?.payload?.full} />
                    {S.byCat.map(({ id }) => {
                      const k = catOf(cats, id);
                      return (
                        <Bar key={id} dataKey={`c:${id}`} name={`${k.emoji} ${k.name}`} stackId="day" fill={k.color}
                          fillOpacity={sel && sel !== id ? 0.25 : 1} stroke={INK} strokeWidth={1.5} isAnimationActive={!reducedMotion()} />
                      );
                    })}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          <section className="grid grid-cols-3 gap-2" aria-label="Top categories">
            {S.byCat.slice(0, 3).map((c, i) => {
              const k = catOf(cats, c.id);
              return (
                <button key={c.id} onClick={() => pick(c.id)} className="card flex flex-col items-center gap-1 p-2 text-center" style={{ background: k.color }}>
                  <span className="text-xs font-bold">#{i + 1}</span>
                  <span className="text-3xl" aria-hidden>{k.emoji}</span>
                  <span className="line-clamp-2 text-xs font-bold leading-tight">{k.name}</span>
                  <span className="font-display text-lg break-all">{$(c.total)}</span>
                </button>
              );
            })}
          </section>

          <section className="grid grid-cols-2 gap-2" aria-label="Fun stats">
            <Stat icon="🔁" title="On repeat" value={top && top.qty > 1 ? `${cap(top.item)} × ${top.qty}` : '—'}
              sub={top && top.qty > 1 ? `= ${$(top.total)}` : 'Nothing repeated yet'} />
            <Stat icon="💥" title="Biggest hit" value={S.biggest ? $(S.biggest.amount) : '—'} sub={S.biggest && cap(S.biggest.item)} />
            <Stat icon="📅" title="Priciest day" value={S.topDay ? $(S.topDay.total) : '—'} sub={S.topDay && dayLabel(S.topDay.date, t)} />
            <Stat icon="🧘" title="No-spend days" value={String(S.noSpend)} sub={S.noSpend ? 'Legend behaviour' : 'Not a single one'} />
          </section>

          <section className="grid gap-6 pb-2">
            <button className="btn min-h-16 bg-tomato font-display text-3xl font-normal" disabled={roasting || !s.apiKey || !!roasted} onClick={doRoast}>
              {roasting ? 'Heating up… 🔥' : roasted ? 'ROASTED ✔' : 'ROAST ME 🔥'}
            </button>
            {!s.apiKey && <p className="-mt-3 text-center text-sm font-bold">Add a free AI key (Groq or Gemini) in Settings to get roasted.</p>}
            {roasted && (
              <div className="bubble card p-4" aria-live="polite">
                <p className="text-lg font-bold">{roasted.roast}</p>
                <p className="mt-3 rounded-lg border-3 border-ink bg-lime p-2 text-sm font-bold">💡 {roasted.tip}</p>
              </div>
            )}
          </section>
        </>
      )}

      {editing && <EntrySheet entry={editing} cats={cats} cur={s.currency} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

function Stat({ icon, title, value, sub }: { icon: string; title: string; value: string; sub?: string }) {
  return (
    <div className="card p-3">
      <p className="label">{icon} {title}</p>
      <p className="mt-1 font-display text-2xl leading-tight break-words">{value}</p>
      {sub && <p className="truncate text-sm font-bold">{sub}</p>}
    </div>
  );
}
