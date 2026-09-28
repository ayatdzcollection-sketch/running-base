// Tiny hash router: #/today, #/plan, #/history, #/you and a few full screens.
import { useEffect, useState } from 'react';

export type Route =
  | 'today' | 'plan' | 'history' | 'you'
  | 'injury' | 'watch' | 'claude' | 'seasons' | 'shoes' | 'pair';

const ROUTES: Route[] = ['today', 'plan', 'history', 'you', 'injury', 'watch', 'claude', 'seasons', 'shoes', 'pair'];

function read(): { route: Route; param: string | null } {
  const [r, param] = location.hash.replace(/^#\/?/, '').split('/');
  return { route: (ROUTES as string[]).includes(r) ? (r as Route) : 'today', param: param ?? null };
}

export function go(route: Route, param?: string) {
  location.hash = `/${route}${param ? '/' + param : ''}`;
  window.scrollTo(0, 0);
}

export function useRoute() {
  const [state, set] = useState(read);
  useEffect(() => {
    const on = () => set(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return state;
}
