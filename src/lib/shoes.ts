// ============================================================
// SHOE MILEAGE — advisory rotation tracking. PURE and read-only.
//
// Attributes each logged run's ACTUAL miles to the shoe that was "current" on
// that date, so the user can see when a pair is due to retire. This is purely
// advisory: nothing here is ever read by the long-run cap, the pain gate, the
// HR ceiling, or the speed ladder. A worn-out shoe never blocks logging.
// ============================================================

import type { RunState, Shoe } from './types';

export interface ShoeReport {
  shoe: Shoe;
  miles: number;                    // baseMiles + attributed logged miles
  status: 'ok' | 'watch' | 'retire';
  pct: number;                      // miles / retireAt (0..>1), for a progress bar
}

/**
 * The shoe considered "current" on a given date: the non-retired shoe with the
 * latest startDate at or before that date. Returns null if none qualifies (a
 * run before any shoe was added stays unattributed rather than guessed).
 */
export function activeShoeOn(shoes: Shoe[], date: string): Shoe | null {
  let best: Shoe | null = null;
  for (const s of shoes) {
    if (s.startDate > date) continue;                    // not yet in rotation
    if (s.retiredAt && date > s.retiredAt) continue;     // retired before this run
    if (!best || s.startDate > best.startDate) best = s; // most-recently-started active
  }
  return best;
}

/**
 * Miles per shoe = its baseMiles plus every logged run's actual miles attributed
 * to whichever shoe was current that day. Runs with no logged distance are
 * ignored (we count real miles, not prescriptions).
 */
export function shoeMileage(shoes: Shoe[], runState: RunState): Map<string, number> {
  const miles = new Map<string, number>();
  for (const s of shoes) miles.set(s.id, Math.max(0, s.baseMiles || 0));
  if (shoes.length === 0) return miles;
  for (const e of Object.values(runState)) {
    const m = e.miles_actual;
    if (m == null || m <= 0) continue;
    const shoe = activeShoeOn(shoes, e.date);
    if (shoe) miles.set(shoe.id, (miles.get(shoe.id) ?? 0) + m);
  }
  return miles;
}

/** Advisory status. 'watch' at 85% of the threshold, 'retire' at/over it. */
export function shoeStatus(miles: number, retireAt: number): 'ok' | 'watch' | 'retire' {
  if (retireAt <= 0) return 'ok';
  if (miles >= retireAt) return 'retire';
  if (miles >= retireAt * 0.85) return 'watch';
  return 'ok';
}

export function shoeReport(shoes: Shoe[], runState: RunState): ShoeReport[] {
  const miles = shoeMileage(shoes, runState);
  return shoes.map(s => {
    const m = Math.round((miles.get(s.id) ?? Math.max(0, s.baseMiles || 0)) * 10) / 10;
    return {
      shoe: s,
      miles: m,
      status: s.retiredAt ? 'ok' : shoeStatus(m, s.retireAt),
      pct: s.retireAt > 0 ? m / s.retireAt : 0,
    };
  });
}
