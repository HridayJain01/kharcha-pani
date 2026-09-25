import { useState, type FormEvent } from 'react';
import { testKey } from '../ai';
import { DEFAULT_SETTINGS, saveSettings } from '../db';

export default function Onboarding() {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await testKey(key.trim(), DEFAULT_SETTINGS.model);
      await saveSettings({ apiKey: key.trim(), onboarded: true });
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
      <form onSubmit={go} className="card grid gap-3 p-4">
        <p className="font-display text-2xl">1. Grab a free Gemini key</p>
        <a className="btn bg-sky" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Open AI Studio ↗</a>
        <label htmlFor="key" className="mt-2 font-display text-2xl">2. Paste it here</label>
        <input id="key" className="input" type="password" autoComplete="off" spellCheck={false} placeholder="AIza…"
          value={key} onChange={e => setKey(e.target.value)} />
        {err && <p className="rounded-lg border-3 border-ink bg-tomato/30 p-2 text-sm font-bold break-words">❌ {err}</p>}
        <button className="btn bg-lime text-lg" disabled={busy || !key.trim()}>{busy ? 'Checking… ⏳' : "Let's go 🚀"}</button>
      </form>
      <button className="min-h-12 font-bold underline" onClick={() => saveSettings({ onboarded: true })}>
        Skip. I'll use the basic parser for now
      </button>
      <p className="text-center text-sm font-bold">🔒 The key stays on this device. No login, no server.</p>
    </main>
  );
}
