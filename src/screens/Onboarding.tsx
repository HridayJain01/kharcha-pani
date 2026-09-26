import { useState, type FormEvent } from 'react';
import { PROVIDERS, testKey } from '../ai';
import { DEFAULT_SETTINGS, saveSettings, type Provider } from '../db';

export default function Onboarding() {
  const [provider, setProvider] = useState<Provider>('groq');
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const p = PROVIDERS[provider];

  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const s = { ...DEFAULT_SETTINGS, provider, apiKey: key.trim(), model: p.model };
    try {
      await testKey(s);
      await saveSettings({ provider, apiKey: s.apiKey, model: s.model, onboarded: true });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-6 p-4">
      <h1 className="logo text-center text-6xl leading-none">Kharcha<br />Pani</h1>
      <p className="text-center text-lg font-bold">
        Log spends the lazy way.<br />“chai 15, 2 autos 80” → done. 💸
      </p>
      <button className="btn min-h-16 bg-lime text-lg" onClick={() => saveSettings({ onboarded: true })}>
        Start logging 🚀
      </button>
      <form onSubmit={go} className="card grid gap-3 p-4">
        <p className="font-display text-2xl">Optional: add a free AI key</p>
        <p className="text-sm font-medium">Everything works offline without it. A key reads messier notes and unlocks ROAST ME 🔥.</p>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="AI provider">
          {(['groq', 'gemini'] as const).map(id => (
            <button key={id} type="button" aria-pressed={provider === id} onClick={() => { setProvider(id); setErr(''); }}
              className={`btn ${provider === id ? 'bg-sunny' : 'bg-white'}`}>
              {PROVIDERS[id].label}{id === 'groq' && ' ⚡'}
            </button>
          ))}
        </div>
        <p className="text-sm font-medium">{p.blurb}</p>
        <a className="btn bg-sky" href={p.keyUrl} target="_blank" rel="noreferrer">Get a free {p.label} key ↗</a>
        <input className="input" type="password" autoComplete="off" spellCheck={false} aria-label={`${p.label} API key`}
          placeholder={provider === 'groq' ? 'gsk_…' : 'AIza…'} value={key} onChange={e => setKey(e.target.value)} />
        {err && <p className="rounded-lg border-3 border-ink bg-tomato/30 p-2 text-sm font-bold break-words">❌ {err}</p>}
        <button className="btn bg-white" disabled={busy || !key.trim()}>{busy ? 'Checking… ⏳' : 'Use this key'}</button>
      </form>
      <p className="text-center text-sm font-bold">🔒 Everything stays on this device. No login, no server.</p>
    </main>
  );
}
