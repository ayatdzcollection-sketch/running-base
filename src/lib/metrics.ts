// ============================================================
// DERIVED METRICS — everything here is recomputed live from the
// run log, never stored as source of truth. That keeps the values
// correct across devices and makes every rule idempotent.
// ============================================================

import type { RunState } from './types';
import { TUNABLES } from '../config/tunables';

// ── Date helpers (YYYY-MM-DD strings compare lexicographically) ──

export function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Next Monday strictly after `today`. */
export function nextMonday(today: string): string {
  const d = new Date(today + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0 Sun … 6 Sat
  const delta = dow === 0 ? 1 : 8 - dow;
  return addDaysStr(today, delta);
}

/** Monday of the week containing `date`. */
export function mondayOf(date: string): string {
  const d = new Date(date + 'T12:00:00Z');
  const dow = d.getUTCDay();
  return addDaysStr(date, dow === 0 ? -6 : 1 - dow);
}

// ── Trailing-30-day longest & the long-run cap ───────────────

/**
 * Longest single logged run in the trailing window (by actual miles).
 * Fallback when nothing is logged: TRAILING_FALLBACK (4.5).
 *
 * `includeEnd: false` excludes runs dated `today` itself — the ceiling for a
 * run comes from the 30 days BEFORE it (Frandsen), so today's own log must
 * not raise today's cap (otherwise an over-cap run could never be flagged).
 */
export function trailing30Longest(
  runState: RunState,
  today: string,
  includeEnd = true,
): number {
  const windowStart = addDaysStr(today, -TUNABLES.TRAILING_WINDOW_DAYS);
  let longest = 0;
  for (const e of Object.values(runState)) {
    if (e.miles_actual == null) continue;
    if (includeEnd ? e.date > today : e.date >= today) continue;
    if (e.date <= windowStart) continue;
    if (e.miles_actual > longest) longest = e.miles_actual;
  }
  return longest > 0 ? longest : TUNABLES.TRAILING_FALLBACK;
}

/** Largest HALF_STEP multiple at or below x. */
export function floorToHalf(x: number): number {
  return Math.floor(x / TUNABLES.HALF_STEP + 1e-9) * TUNABLES.HALF_STEP;
}

/**
 * Next long-run ceiling, in natural half-mile steps.
 *
 *   raw    = 1.1 × trailing-30-day longest      (Frandsen 2025, MODERATE)
 *   capped = largest 0.5 step at or below raw
 *   if capped ≤ longest: capped = longest + 0.5 (guarantee a sensible min step)
 *
 * Intended edge: at low mileage the minimum half-mile step can sit slightly
 * above a strict 110% (a 0.5-mi bump on a 4-mile run is 12.5%) — a trivial
 * absolute spike. At higher mileage the 0.5 step is well under 110%, so the
 * 110% cap binds. 110% is the ceiling, not a mandate; the half-mile step
 * keeps the numbers usable. Reproduces the ladder 4.5→5.0→5.5→6.0→6.5 and
 * clamps down automatically after missed volume.
 */
export function nextLongFrom(trailingLongest: number): number {
  const raw = TUNABLES.CAP_FACTOR * trailingLongest;
  let capped = floorToHalf(raw);
  if (capped <= trailingLongest) capped = trailingLongest + TUNABLES.HALF_STEP;
  return capped;
}

export function nextLong(runState: RunState, today: string): number {
  return nextLongFrom(trailing30Longest(runState, today));
}

// ── Pain governor ────────────────────────────────────────────

function breachesCap(e: { painDuring?: number | null; painNextAM?: number | null }, painCap: number): boolean {
  return (e.painDuring != null && e.painDuring > painCap)
      || (e.painNextAM != null && e.painNextAM > painCap);
}

/** Dates (sorted asc) whose logged pain exceeds the cap. */
export function painBreachDates(runState: RunState, painCap: number): string[] {
  return Object.values(runState)
    .filter(e => breachesCap(e, painCap))
    .map(e => e.date)
    .sort();
}

/** Any pain-cap breach inside the trailing flare window → show the hold banner. */
export function recentBreach(runState: RunState, today: string, painCap: number): boolean {
  const from = addDaysStr(today, -TUNABLES.FLARE_WINDOW_DAYS);
  return painBreachDates(runState, painCap).some(d => d > from && d <= today);
}

/** FLARE_COUNT breach days inside the trailing window → forced deload (state 8). */
export function flareActive(runState: RunState, today: string, painCap: number): boolean {
  const from = addDaysStr(today, -TUNABLES.FLARE_WINDOW_DAYS);
  const n = painBreachDates(runState, painCap).filter(d => d > from && d <= today).length;
  return n >= TUNABLES.FLARE_COUNT;
}

/**
 * Consecutive completed runs (newest first) with no pain-cap breach.
 * Unlogged pain counts as pain-free — the fields are optional and the
 * pre-v2 history has none. Any breach resets the streak to 0 naturally.
 */
export function painFreeStreak(runState: RunState, painCap: number): number {
  const runs = Object.values(runState)
    .filter(e => e.done || e.miles_actual != null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  let streak = 0;
  for (const e of runs) {
    if (breachesCap(e, painCap)) break;
    streak++;
  }
  return streak;
}

// ── Weekly actuals (calendar weeks Mon–Sun) ──────────────────

export interface WeekActual {
  weekStart: string; // Monday
  miles: number;
  runCount: number;
}

/** Actual miles per calendar week, ascending by week. Done-without-miles days count 0 here (actuals only). */
export function weeklyActuals(runState: RunState, upTo: string): WeekActual[] {
  const byWeek = new Map<string, WeekActual>();
  for (const e of Object.values(runState)) {
    if (e.miles_actual == null || e.date > upTo) continue;
    const ws = mondayOf(e.date);
    const w = byWeek.get(ws) ?? { weekStart: ws, miles: 0, runCount: 0 };
    w.miles += e.miles_actual;
    w.runCount++;
    byWeek.set(ws, w);
  }
  return [...byWeek.values()].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
}
