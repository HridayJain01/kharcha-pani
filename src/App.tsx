import { lazy, Suspense, useEffect, useState } from 'react';
import { addDueRepeats, useSettings } from './db';
import { toast } from './fx';
import Add from './screens/Add';
import Ledger from './screens/Ledger';
import Onboarding from './screens/Onboarding';
import Settings from './screens/Settings';

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
  useEffect(() => { window.scrollTo(0, 0); }, [tab]);
  useEffect(() => { addDueRepeats().then(n => n && toast(`Added ${n} monthly repeat${n > 1 ? 's' : ''} 🔁`)); }, []);
  if (!s) return null;
  if (!s.onboarded) return <Onboarding />;

  return (
    <>
      <main className="mx-auto max-w-md px-4 pb-32 pt-[max(1rem,env(safe-area-inset-top))]">
        {tab === 'add' && <Add s={s} />}
        {tab === 'ledger' && <Ledger s={s} />}
        {tab === 'overview' && (
          <Suspense fallback={<p className="p-10 text-center font-display text-3xl">Crunching… 🧮</p>}>
            <Overview s={s} />
          </Suspense>
        )}
        {tab === 'settings' && <Settings s={s} />}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t-3 border-ink bg-paper pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-md grid-cols-4 gap-2 p-2">
          {TABS.map(([id, icon, label]) => (
            <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}
              className={`flex min-h-14 flex-col items-center justify-center rounded-xl border-3 text-xs font-bold ${tab === id ? 'border-ink bg-sunny shadow-brut-sm' : 'border-transparent'}`}>
              <span className="text-2xl leading-none" aria-hidden>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
