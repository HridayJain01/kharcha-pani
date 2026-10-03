import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { aiParse, hasAI } from '../ai';
import { EntryCard, EntryFields, EntrySheet } from '../components/Entry';
import { db, saveDrafts, useCats, useLive, useToday, type Settings } from '../db';
import { clink, coinBurst, confetti, toast } from '../fx';
import { addDays, buildMemory, catOf, localParse, money, okDraft, period, pullUdhaar, streak, today, type Draft, type Entry } from '../lib';
import { cloudVoice, loadOffline, offlineReady, OFFLINE_MB, record, transcribe } from '../voice';

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

// Needs a secure context (https or localhost); over plain http the mic button just hides.
const canRecord = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices;

// Once per day: celebrate a no-spend yesterday, and on Mondays a week under budget.
async function cheerNoSpendYesterday(budget: number) {
  const y = addDays(today(), -1);
  try {
    if (localStorage.getItem('kp-cheered') === y) return;
    localStorage.setItem('kp-cheered', y);
  } catch {
    return;
  }
  if ((await db.entries.where('date').below(y).count()) && !(await db.entries.where('date').equals(y).filter(e => !e.iou).count())) {
    confetti();
    toast('Yesterday was a NO-SPEND DAY! 🎉');
  }
  const w = period('week', 1);
  if (budget && new Date().getDay() === 1 && (await db.entries.where('date').below(w.start).count())) {
    const spent = (await db.entries.where('date').between(w.start, w.end, true, true).filter(e => !e.iou).toArray()).reduce((n, e) => n + e.amount, 0);
    if (spent < (budget * 12) / 52) {
      confetti();
      toast('Last week came in UNDER BUDGET! 🥳');
    }
  }
}

export default function Add({ s }: { s: Settings }) {
  const cats = useCats();
  const day = useToday();
  const todays = useLive(() => db.entries.where('date').equals(day).reverse().sortBy('createdAt'), [day]);
  const logged = useLive(() => db.entries.orderBy('date').uniqueKeys().then(k => new Set(k as string[])));
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState<'idle' | 'rec' | 'busy'>('idle');
  const [dl, setDl] = useState<number | null>(null); // voice model download %
  const [fresh, setFresh] = useState<number[]>([]);
  const [ouch, setOuch] = useState(false);
  const [quip, setQuip] = useState(() => Math.floor(Math.random() * QUIPS.length));
  const [editing, setEditing] = useState<Entry>();
  const stopRec = useRef<(() => Promise<Blob>) | null>(null);
  const autoStop = useRef<number>(undefined);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    cheerNoSpendYesterday(s.budget);
    const timer = setInterval(() => setQuip(q => q + 1), 7000);
    return () => {
      clearInterval(timer);
      clearTimeout(autoStop.current);
      stopRec.current?.(); // release the mic if you switch tabs mid-recording
    };
  }, []);

  async function parse(input: string) {
    input = input.trim();
    if (!input || !cats || busy) return;
    setBusy(true);
    const memory = buildMemory(await db.entries.toArray()); // learns from everything you've saved
    const { rest, drafts: udhaar } = pullUdhaar(input, cats, memory); // "gave rahul 500" etc., always offline
    let out: Draft[] = [];
    let why = '';
    if (!/[\p{L}\p{N}]/u.test(rest)) {
      // nothing left but udhaar
    } else if (hasAI(s)) {
      if (!navigator.onLine) why = "You're offline, so the offline parser read this.";
      else {
        try {
          out = await aiParse(rest, cats, memory);
        } catch (err) {
          why = `AI hiccup (${(err as Error).message}), so the offline parser read this.`;
        }
      }
    }
    if (!out.length) out = localParse(rest, cats, memory);
    out = [...out, ...udhaar];
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

  // Tap to record, tap again to stop: Whisper (Groq key + signal) or the on-device model writes it down,
  // then it's parsed like typed text.
  async function mic() {
    if (voice === 'rec') return finishVoice();
    if (voice !== 'idle') return;
    const cloud = cloudVoice(s);
    if (!cloud && !offlineReady()) {
      if (!navigator.onLine) return toast('Voice needs a one-time download. Get online and tap 🎤 again.');
      if (!confirm(`Voice runs right on your phone with a small speech model.\n\nDownload it once (~${OFFLINE_MB} MB)? After that it works offline.\n\n(Or add a free Groq key in Settings to use Whisper in the cloud.)`)) return;
    }
    try {
      stopRec.current = await record();
    } catch {
      return toast('🙉 Mic blocked. Allow microphone access for this app.');
    }
    setVoice('rec');
    autoStop.current = window.setTimeout(finishVoice, 30_000);
    if (!cloud) loadOffline(setDl).catch(() => {}).finally(() => setDl(null)); // downloads/warms up while you talk
  }

  async function finishVoice() {
    clearTimeout(autoStop.current);
    const stop = stopRec.current;
    stopRec.current = null;
    if (!stop) return;
    setVoice('busy');
    try {
      const said = await transcribe(await stop(), s, setDl);
      if (!said) throw new Error("didn't catch that, try again");
      const next = [box.current?.value.trim(), said].filter(Boolean).join(', ');
      setText(next);
      setVoice('idle');
      await parse(next);
    } catch (e) {
      toast(`🙉 ${(e as Error).message}`);
    } finally {
      setVoice('idle');
      setDl(null);
    }
  }

  const ready = drafts.length > 0 && drafts.every(okDraft);
  const getting = dl !== null && dl < 100 ? ` (voice model ${dl}%)` : '';
  const total = todays?.reduce((n, e) => (e.iou ? n : n + e.amount), 0) ?? 0;

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
        {logged && streak(logged, day) > 1 && (
          <p className="mt-3 inline-block rounded-full border-3 border-ink bg-white px-3 py-1 text-sm font-bold">🔥 {streak(logged, day)}-day logging streak</p>
        )}
      </section>

      <form onSubmit={e => { e.preventDefault(); parse(text); }} className="card grid gap-3 p-3">
        <label htmlFor="quick" className="font-display text-2xl">What did you spend on?</label>
        <div className="flex gap-2">
          <textarea id="quick" ref={box} rows={2} enterKeyHint="send" value={text}
            className="input field-sizing-content max-h-48 min-h-20 min-w-0 flex-1 resize-none py-2 text-lg"
            placeholder="chai 15, 2 autos 80, gave rahul 500"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); parse(text); } }} />
          {canRecord && (
            <button type="button" onClick={mic} disabled={voice === 'busy'} aria-pressed={voice === 'rec'}
              aria-label={voice === 'rec' ? 'Stop and write it down' : 'Record a voice note'}
              className={`btn w-14 shrink-0 self-stretch px-0 text-2xl ${voice === 'rec' ? 'listening bg-tomato' : 'bg-pink'}`}>
              {voice === 'rec' ? '⏹' : voice === 'busy' ? '⏳' : '🎤'}
            </button>
          )}
        </div>
        {voice !== 'idle' && (
          <p className="text-sm font-bold" aria-live="polite">
            {voice === 'rec' ? `🔴 Listening… tap ⏹ when done${getting}` : `✍️ Writing it down…${getting}`}
          </p>
        )}
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
