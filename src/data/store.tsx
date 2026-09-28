import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { snapshot, type Snapshot } from '../engine/index.ts';
import { db, loadAll, localToday, type Loaded } from './api.ts';
import { HealthSync, isNative } from '../native/health.ts';

interface Store {
  session: Session | null;
  authReady: boolean;
  loaded: Loaded | null;       // null = signed in but no profile yet (needs invite)
  loading: boolean;
  snap: Snapshot | null;
  today: string;
  uid: string;
  refresh: () => Promise<void>;
  toast: (msg: string) => void;
  /** Run a write, refresh, and show errors as a toast. Returns success. */
  act: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
};

const CACHE = 'bb-cache-v2';

export function StoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(() => {
    try { const c = localStorage.getItem(CACHE); return c ? JSON.parse(c) : null; } catch { return null; }
  });
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState(localToday);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    db.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data } = db.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // The date rolls over at midnight and when the app comes back to the front.
  useEffect(() => {
    const tick = () => setToday(localToday());
    const id = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, []);

  const uid = session?.user.id ?? '';
  const refresh = useCallback(async () => {
    if (!uid) { setLoading(false); return; }
    setLoading(true);
    try {
      const l = await loadAll(uid, localToday());
      setLoaded(l);
      try { if (l) localStorage.setItem(CACHE, JSON.stringify(l)); else localStorage.removeItem(CACHE); } catch { /* storage full or private mode */ }
    } catch (e) {
      setMsg(navigator.onLine ? `Couldn't load: ${(e as Error).message}` : 'Offline. Showing what was saved on this phone.');
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { if (authReady) void refresh(); }, [authReady, refresh]);
  // In the iPhone app, pull any new runs from Apple Health when it opens.
  useEffect(() => {
    if (!uid || !isNative()) return;
    const catchUp = () => HealthSync.status().then(st => st.connected ? HealthSync.syncNow().then(r => { if (r.sent) void refresh(); }) : undefined).catch(() => {});
    void catchUp();
    const on = () => { if (document.visibilityState === 'visible') void catchUp(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [uid, refresh]);
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [refresh]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3200); return () => clearTimeout(t); }, [msg]);

  const snap = useMemo(() => (loaded && loaded.profile.user_id === uid ? snapshot(loaded.runner, today) : null), [loaded, today, uid]);

  const act = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await refresh();
      if (ok) setMsg(ok);
      return true;
    } catch (e) {
      setMsg((e as Error).message || 'Something went wrong. Try again.');
      return false;
    }
  }, [refresh]);

  const value: Store = { session, authReady, loaded: loaded && loaded.profile.user_id === uid ? loaded : null, loading, snap, today, uid, refresh, toast: setMsg, act };
  return (
    <Ctx.Provider value={value}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </Ctx.Provider>
  );
}
