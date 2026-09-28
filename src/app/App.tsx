import { useState } from 'react';
import { useStore } from '../data/store.tsx';
import { useRoute } from './router.ts';
import { TabBar } from '../ui/kit.tsx';
import { RedeemInvite, SignIn } from '../screens/SignIn.tsx';
import { Onboarding } from '../screens/Onboarding.tsx';
import { Today } from '../screens/Today.tsx';
import { Plan } from '../screens/Plan.tsx';
import { History } from '../screens/History.tsx';
import { You } from '../screens/You.tsx';
import { InjuryCheck } from '../screens/Injury.tsx';
import { ConnectClaude, ConnectWatch } from '../screens/Connect.tsx';
import { Seasons } from '../screens/Seasons.tsx';
import { AddRunSheet } from '../screens/AddRun.tsx';

function Splash() {
  return <main className="page center" style={{ minHeight: '100dvh' }}><span className="small">Loading…</span></main>;
}

export default function App() {
  const { authReady, session, loaded, loading } = useStore();
  const { route } = useRoute();
  const [adding, setAdding] = useState<{ date?: string } | null>(null);

  if (!authReady) return <Splash />;
  if (!session) return <SignIn />;
  if (!loaded) return loading ? <Splash /> : <RedeemInvite />;
  if (!loaded.profile.onboarded) return <Onboarding />;

  const add = (date?: string) => setAdding({ date });
  const tabs = route === 'today' || route === 'plan' || route === 'history' || route === 'you';
  return (
    <>
      {route === 'today' && <Today onAdd={add} />}
      {route === 'plan' && <Plan />}
      {route === 'history' && <History onAdd={add} />}
      {route === 'you' && <You />}
      {route === 'injury' && <InjuryCheck />}
      {route === 'watch' && <ConnectWatch />}
      {route === 'claude' && <ConnectClaude />}
      {route === 'seasons' && <Seasons />}
      {tabs && <TabBar active={route} onAdd={() => add()} />}
      {adding && <AddRunSheet date={adding.date} onClose={() => setAdding(null)} />}
    </>
  );
}
