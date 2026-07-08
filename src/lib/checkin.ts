// ============================================================
// WEEKLY CHECK-IN — subjective load monitoring. PURE, display-only.
//
// Summarizes recent weekly check-ins (sleep / soreness / energy / stress) into
// a plain trend and an ADVISORY suggestion. Rising soreness with poor recovery
// is a classic early-overload signal, so the copy may suggest holding or an
// easy week — but nothing here ever advances a speed state, relaxes the pain
// cap, or changes any gate. Upward progression stays behind the checklist in
// lib/speed.ts. This module is not imported by any engine path.
// ============================================================

import type { WeeklyCheckin } from './types';

export type Trend = 'up' | 'flat' | 'down';

export interface CheckinSummary {
  latest: WeeklyCheckin | null;
  previous: WeeklyCheckin | null;
  /** Soreness direction, latest vs previous. 'up' = getting MORE sore (worse). */
  sorenessTrend: Trend | null;
  /** A simple 0–100 readiness read from the latest week (higher = fresher).
   *  Display only — never gates anything. */
  freshness: number | null;
  /** Advisory copy, or null when things look fine. Never an instruction. */
  suggestion: string | null;
}

/** Higher = fresher/better. Soreness and stress are inverted (5 = worst). */
export function freshnessScore(c: WeeklyCheckin): number {
  const good = c.sleep + c.energy;               // 2..10
  const bad = c.soreness + c.stress;             // 2..10
  // Map (good - bad) from [-8, 8] onto [0, 100].
  return Math.round(((good - bad + 8) / 16) * 100);
}

function sortedByWeek(checkins: Record<string, WeeklyCheckin>): WeeklyCheckin[] {
  return Object.values(checkins).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)); // newest first
}

export function summarizeCheckins(checkins: Record<string, WeeklyCheckin>): CheckinSummary {
  const all = sortedByWeek(checkins);
  const latest = all[0] ?? null;
  const previous = all[1] ?? null;

  if (!latest) {
    return { latest: null, previous: null, sorenessTrend: null, freshness: null, suggestion: null };
  }

  const sorenessTrend: Trend | null = previous
    ? latest.soreness > previous.soreness ? 'up'
      : latest.soreness < previous.soreness ? 'down'
      : 'flat'
    : null;

  const freshness = freshnessScore(latest);

  // Advisory only. Trigger gently on genuinely rough signals.
  let suggestion: string | null = null;
  if (latest.soreness >= 4 && sorenessTrend === 'up') {
    suggestion = 'Soreness is up two weeks running. Worth an easier week or an extra rest day — and mention it to your PT. (This is only a suggestion; it changes nothing in your plan.)';
  } else if (freshness <= 30) {
    suggestion = 'Recovery looks low this week. Consider keeping runs easy and protecting sleep. (Advisory only — your plan and gates are unchanged.)';
  } else if (latest.soreness >= 4) {
    suggestion = 'Soreness is on the higher side. Keep the easy days truly easy this week. (Advisory only.)';
  }

  return { latest, previous, sorenessTrend, freshness, suggestion };
}
