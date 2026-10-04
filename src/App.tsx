import { lazy, Suspense, useEffect, useState } from 'react';
import { addDueRepeats, useSettings } from './db';
import { toast } from './fx';
import Add from './screens/Add';
import Ledger from './screens/Ledger';
import Onboarding from './screens/Onboarding';
import Settings from './screens/Settings';
import Tour from './components/Tour';

const Overview = lazy(() => import('./screens/Overview')); // keeps Recharts out of the first load

const TABS = [
  ['add', '➕', 'Add'],
  ['ledger', '📒', 'Ledger'],
  ['overview', '📊', 'Overview'],
  ['settings', '⚙️', 'Settings'],
] as const;
type Tab = (typeof TABS)[number][0];

export default function App() {
  const s = useSettings();
  const [tab, setTab] = useState<Tab>('add');
  const [seen, setSeen] = useState(new Set<Tab>(['add'])); // screens stay mounted once visited, so forms survive tab switches
  useEffect(() => { setSeen(v => v.has(tab) ? v : new Set(v).add(tab)); }, [tab]);
  useEffect(() => { window.scrollTo(0, 0); }, [tab]);
  useEffect(() => { addDueRepeats().then(n => n && toast(`Added ${n} monthly repeat${n > 1 ? 's' : ''} 🔁`)); }, []);
  useEffect(() => { if (s?.toured === false) setTab('add'); }, [s?.toured]); // replaying the tour from Settings starts on Add
  if (!s) return null;
  if (!s.onboarded) return <Onboarding />;

  return (
    <>
      <main className="mx-auto max-w-md px-4 pb-32 pt-[max(1rem,env(safe-area-inset-top))]">
        <div hidden={tab !== 'add'}><Add s={s} /></div>
        {seen.has('ledger') && <div hidden={tab !== 'ledger'}><Ledger s={s} /></div>}
        {seen.has('overview') && (
          <div hidden={tab !== 'overview'}>
            <Suspense fallback={<p className="p-10 text-center font-display text-3xl">Crunching… 🧮</p>}>
              <Overview s={s} />
            </Suspense>
          </div>
        )}
        {seen.has('settings') && <div hidden={tab !== 'settings'}><Settings s={s} /></div>}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t-3 border-ink bg-paper pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-md grid-cols-4 gap-2 p-2">
          {TABS.map(([id, icon, label]) => (
            <button key={id} data-tour={`tab-${id}`} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}
              className={`flex min-h-14 flex-col items-center justify-center rounded-xl border-3 text-xs font-bold ${tab === id ? 'border-ink bg-sunny shadow-brut-sm' : 'border-transparent'}`}>
              <span className="text-2xl leading-none" aria-hidden>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </nav>
      {!s.toured && tab === 'add' && <Tour />}
    </>
  );
}
