import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { aiParse } from '../ai';
import { EntryCard, EntryFields, EntrySheet } from '../components/Entry';
import { db, saveDrafts, useCats, useLive, useToday, type Settings } from '../db';
import { clink, coinBurst, confetti, toast } from '../fx';
import { addDays, catOf, localParse, money, today, type Draft, type Entry } from '../lib';

const QUIPS = [
  'Your wallet felt that one.',
  'Chai is not an expense. It is a lifestyle.',
  'Paisa ped pe nahi ugta. Sadly.',
  'Every rupee has a story. Most are about samosas.',
  'Budget? Never heard of her.',
  'Auto bhaiya thanks you for your service.',
  'Zomato knows your address by heart.',
  'Log it before you forget it.',
  'Small kharcha, big feelings.',
  'Money comes, money goes. Mostly goes.',
];

// Web Speech API isn't in the TS DOM types (and Chrome/Safari still prefix it). No support = no mic button.
const Recognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

// Once per day: if yesterday had no entries (and you were already logging before that), celebrate.
async function cheerNoSpendYesterday() {
  const y = addDays(today(), -1);
  try {
    if (localStorage.getItem('kp-cheered') === y) return;
    localStorage.setItem('kp-cheered', y);
  } catch {
    return;
  }
  if ((await db.entries.where('date').below(y).count()) && !(await db.entries.where('date').equals(y).count())) {
    confetti();
    toast('Yesterday was a NO-SPEND DAY! 🎉');
  }
}

export default function Add({ s }: { s: Settings }) {
  const cats = useCats();
  const day = useToday();
  const todays = useLive(() => db.entries.where('date').equals(day).reverse().sortBy('createdAt'), [day]);
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [fresh, setFresh] = useState<number[]>([]);
  const [ouch, setOuch] = useState(false);
  const [quip, setQuip] = useState(() => Math.floor(Math.random() * QUIPS.length));
  const [editing, setEditing] = useState<Entry>();
  const rec = useRef<{ start(): void; stop(): void; abort(): void } | null>(null);

  useEffect(() => {
    cheerNoSpendYesterday();
    const timer = setInterval(() => setQuip(q => q + 1), 7000);
    return () => { clearInterval(timer); rec.current?.abort(); };
  }, []);

  async function parse(e?: FormEvent) {
    e?.preventDefault();
    const input = text.trim();
    if (!input || !cats || busy) return;
    setBusy(true);
    let out: Draft[] = [];
    let why = '';
    if (!s.apiKey) why = 'No AI key, so the quick parser did this.';
    else if (!navigator.onLine) why = "You're offline, so the quick parser did this.";
    else {
      try {
        out = await aiParse(input, cats, s.currency);
      } catch (err) {
        why = `AI hiccup (${(err as Error).message}), so the quick parser did this.`;
      }
    }
    if (!out.length) out = localParse(input, cats);
    setBusy(false);
    setNote(why && `${why} Double-check it!`);
    setDrafts(out);
    if (!out.length) toast('Found nothing to log 🤷');
  }

  async function save(e: MouseEvent<HTMLButtonElement>) {
    clink(); // before any await, or iOS keeps the audio locked
    coinBurst(e.currentTarget);
    const batch = drafts;
    setDrafts([]); // hides the button right away, so a double tap can't save twice
    try {
      const ids = await saveDrafts(batch);
      setFresh(ids);
      setTimeout(() => setFresh([]), 2200);
    } catch (err) {
      setDrafts(batch);
      toast(`Couldn't save 😵 ${(err as Error).message}`);
      return;
    }
    if (batch.some(d => (d.amount ?? 0) > 1000)) {
      setOuch(true);
      setTimeout(() => setOuch(false), 2500);
    }
    setText('');
    setNote('');
  }

  function mic() {
    if (listening) return rec.current?.stop();
    const r = new Recognition();
    r.lang = 'en-IN';
    r.interimResults = false;
    r.onresult = (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      const said = Array.from(ev.results, res => res[0].transcript).join(' ').trim();
      if (said) setText(t => (t.trim() ? `${t.trim()}, ` : '') + said);
    };
    r.onerror = (ev: { error: string }) => {
      if (ev.error !== 'aborted' && ev.error !== 'no-speech') toast(`Mic trouble: ${ev.error}`);
    };
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  }

  const ready = drafts.length > 0 && drafts.every(d => d.item.trim() && Number(d.amount) > 0);
  const total = todays?.reduce((n, e) => n + e.amount, 0) ?? 0;

  return (
    <div className="grid gap-5">
      <header className="text-center">
        <h1 className="logo text-[min(3rem,12.5vw)]">Kharcha Pani</h1>
        <p key={quip} className="quip mt-1 font-bold">{QUIPS[quip % QUIPS.length]}</p>
      </header>

      <section className="card bg-sunny p-4 text-center">
        <p className="label">Spent today</p>
        <p className="mt-1 font-display text-7xl leading-none break-all">
          {money(total, s.currency)}
          {ouch && <span className="shake ml-2" role="img" aria-label="Ouch, big spend">👛</span>}
        </p>
      </section>

      <form onSubmit={parse} className="card grid gap-3 p-3">
        <label htmlFor="quick" className="font-display text-2xl">What did you spend on?</label>
        <div className="flex gap-2">
          <textarea id="quick" rows={2} enterKeyHint="send" value={text}
            className="input field-sizing-content max-h-48 min-h-20 min-w-0 flex-1 resize-none py-2 text-lg"
            placeholder="chai 15, 2 autos 80, lunch 120"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) parse(e); }} />
          {Recognition && (
            <button type="button" onClick={mic} aria-pressed={listening} aria-label={listening ? 'Stop listening' : 'Say it'}
              className={`btn w-14 shrink-0 self-stretch px-0 text-2xl ${listening ? 'listening bg-tomato' : 'bg-pink'}`}>
              {listening ? '👂' : '🎤'}
            </button>
          )}
        </div>
        <button className="btn bg-lime text-lg" disabled={busy || !text.trim()}>
          {busy ? 'Thinking… 🤔' : 'Log it ✍️'}
        </button>
      </form>

      {drafts.length > 0 && cats && (
        <section className="grid gap-4" aria-label="Check before saving">
          {note && <p className="rounded-lg border-3 border-dashed border-ink bg-white p-2 text-sm font-bold">{note}</p>}
          {drafts.map((d, i) => (
            <div key={i} className="card relative p-3">
              <button type="button" aria-label={`Remove ${d.item}`}
                onClick={() => setDrafts(ds => ds.filter((_, j) => j !== i))}
                className="absolute -right-4 -top-4 grid size-12 place-items-center">
                <span className="grid size-9 place-items-center rounded-full border-3 border-ink bg-tomato font-bold">✕</span>
              </button>
              <EntryFields d={d} cats={cats} cur={s.currency}
                onChange={p => setDrafts(ds => ds.map((x, j) => (j === i ? { ...x, ...p } : x)))} />
            </div>
          ))}
          <button className="btn min-h-16 bg-grape font-display text-3xl font-normal" disabled={!ready} onClick={save}>
            {ready ? 'SAVE IT 💰' : 'Fill in the amounts'}
          </button>
        </section>
      )}

      <section className="grid gap-3">
        <h2 className="font-display text-3xl">Today</h2>
        {todays?.length ? (
          todays.map(e => (
            <EntryCard key={e.id} e={e} cat={catOf(cats ?? [], e.category)} cur={s.currency}
              stamp={fresh.includes(e.id)} onClick={() => setEditing(e)} />
          ))
        ) : (
          <p className="card bg-white p-4 text-center font-bold">Nothing yet. Wallet's resting. 😴</p>
        )}
      </section>

      {editing && cats && <EntrySheet entry={editing} cats={cats} cur={s.currency} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
