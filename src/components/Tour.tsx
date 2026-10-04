import { useEffect, useLayoutEffect, useState } from 'react';
import { saveSettings } from '../db';

// First-run walkthrough: dims the app, cuts a spotlight around one thing at a time, explains it.
const STEPS = [
  { at: 'quick', title: 'Just type it 👇', body: 'Write spends like you’d text a friend: “chai 15, 2 autos 80”. Tap 🎤 to say it instead. You get to check before it saves.' },
  { at: 'today', title: 'Today’s damage 💸', body: 'Your running total for the day. Log daily to keep a streak going 🔥' },
  { at: 'tab-ledger', title: 'Ledger 📒', body: 'Every entry ever. Tap one to fix or delete it.' },
  { at: 'tab-overview', title: 'Overview 📊', body: 'Where the money went, by week, month or year. Plus a roast if you’ve earned one.' },
  { at: 'tab-settings', title: 'Settings ⚙️', body: 'Set a budget, a savings goal, your currency, or export your data.' },
];

export default function Tour() {
  const [i, setI] = useState(0);
  const [r, setR] = useState<DOMRect | null>(null);
  const step = STEPS[i];
  const done = () => saveSettings({ toured: true });

  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.at}"]`);
    if (!el) return setR(null);
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const measure = () => setR(el.getBoundingClientRect());
    measure();
    addEventListener('resize', measure);
    addEventListener('scroll', measure, true);
    return () => { removeEventListener('resize', measure); removeEventListener('scroll', measure, true); };
  }, [step.at]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && done();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  const last = i === STEPS.length - 1;
  const below = !r || r.top + r.height / 2 < innerHeight / 2; // put the card on whichever side has room
  const pad = 6;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* the giant shadow is the dim layer; the box itself is the see-through spotlight */}
      <div className="pointer-events-none fixed rounded-xl border-3 border-sunny transition-all duration-300"
        style={r ? { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2, boxShadow: '0 0 0 9999px rgb(17 17 17 / .7)' }
          : { inset: '50%', boxShadow: '0 0 0 9999px rgb(17 17 17 / .7)' }} />
      <div className="absolute inset-0" onClick={() => (last ? done() : setI(i + 1))} />
      <div className="card fixed inset-x-4 mx-auto grid max-w-sm gap-2 p-4"
        style={r ? (below ? { top: Math.min(r.bottom + 16, innerHeight - 220) } : { bottom: Math.max(innerHeight - r.top + 16, 16) }) : { top: '40%' }}>
        <p className="label">{i + 1} / {STEPS.length}</p>
        <h2 id="tour-title" className="font-display text-2xl">{step.title}</h2>
        <p className="font-medium">{step.body}</p>
        <div className="mt-1 flex gap-2">
          {!last && <button className="btn flex-1 bg-white" onClick={done}>Skip</button>}
          {i > 0 && <button className="btn bg-white px-3" aria-label="Back" onClick={() => setI(i - 1)}>◀</button>}
          <button className="btn flex-1 bg-lime" autoFocus onClick={() => (last ? done() : setI(i + 1))}>
            {last ? 'Got it 🚀' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
