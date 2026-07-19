// ============================================================
// DERIVED METRICS — everything here is recomputed live from the
// run log, never stored as source of truth. That keeps the values
// correct across devices and makes every rule idempotent.
// ============================================================

import type { RunState, Season } from './types';
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

// ── Coach-led season windows ─────────────────────────────────
// The season used to be a ONE-WAY DOOR (`date >= xcStartDate`), so once it
// opened the plan maintained forever and never resumed building. It is now a
// LIST of windows (XC in autumn, track in spring, …). Every consumer — the
// settings-driven plan (isMaintenanceIdx), the speed layer (inSeason), the
// tier-8 season gate, and the feasibility deadline — resolves seasons through
// these helpers, so no two layers can ever disagree about what a season is.

/** Shape every season helper accepts: either the new `seasons` list or the
 *  legacy single xcStartDate/xcEndDate pair (RawSettings and GlobalState's
 *  settings both satisfy it). */
export interface SeasonSource {
  seasons?: Season[] | null;
  xcStartDate?: string | null;
  xcEndDate?: string | null;
}

/**
 * The seasons list, cleaned up and sorted ascending by start date, with each
 * window's EFFECTIVE end resolved. Rules (all missing-data-safe):
 *  • `seasons` present and non-empty → that list wins.
 *  • otherwise the legacy xcStartDate/xcEndDate pair is migrated into a single
 *    entry, so every pre-existing blob behaves exactly as it did before.
 *  • no start date anywhere → no seasons at all (pure base), unchanged.
 *  • an end BEFORE its own start is treated as absent rather than cancelling the
 *    season. A mistyped end must never hand the athlete app-scheduled hard work
 *    in the middle of team practice — the exact failure the overlay prevents.
 *  • an OPEN-ENDED season implicitly closes the day before the next one starts,
 *    so ["XC (no end)", "Track Mar 2"] does not let XC swallow track forever.
 *  • an explicit end that overruns the next start is clamped for the same reason.
 */
export function normalizedSeasons(s: SeasonSource | null | undefined): Season[] {
  const raw: Season[] = s?.seasons?.length
    ? s.seasons
    : s?.xcStartDate
      ? [{ id: 'legacy', label: 'XC', startDate: s.xcStartDate, endDate: s.xcEndDate ?? null }]
      : [];

  const sorted = raw
    .filter(x => !!x && typeof x.startDate === 'string' && !!x.startDate)
    .map(x => ({ ...x, endDate: x.endDate && x.endDate >= x.startDate ? x.endDate : null }))
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));

  return sorted.map((sea, i) => {
    const next = sorted[i + 1];
    const implicitEnd = next ? addDaysStr(next.startDate, -1) : null;
    const end = sea.endDate ?? implicitEnd;
    const clamped = end && implicitEnd && end > implicitEnd ? implicitEnd : end;
    return { ...sea, endDate: clamped };
  });
}

/** The season containing `date`, or null when between seasons (building). */
export function currentSeason(s: SeasonSource | null | undefined, date: string): Season | null {
  for (const sea of normalizedSeasons(s)) {
    if (date < sea.startDate) continue;
    if (!sea.endDate || date <= sea.endDate) return sea;
  }
  return null;
}

/** Is `date` inside any coach-led season window? Inclusive of both ends. */
export function isSeasonDate(s: SeasonSource | null | undefined, date: string): boolean {
  return currentSeason(s, date) !== null;
}

/** Start of the next season beginning strictly after `date` — the DEADLINE the
 *  between-seasons build has to be in shape for. null = nothing scheduled, so
 *  the rolling plan simply keeps building (no boundary). */
export function nextSeasonStart(s: SeasonSource | null | undefined, date: string): string | null {
  for (const sea of normalizedSeasons(s)) if (sea.startDate > date) return sea.startDate;
  return null;
}

/** The most recent season that has already FINISHED before `date` — drives the
 *  post-season break recommendation. null = none has ended yet. */
export function lastEndedSeason(s: SeasonSource | null | undefined, date: string): Season | null {
  let best: Season | null = null;
  for (const sea of normalizedSeasons(s)) {
    if (sea.endDate && sea.endDate < date) best = sea;   // ascending → last wins
  }
  return best;
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
 * Unlogged pain counts as pain-free — "nothing to report = pain-free" is the
 * intended low-burden semantics for runs logged WHILE tracking. But runs dated
 * before `since` (the day pain tracking began) are excluded: we can't treat a
 * run that predates the pain feature as proven pain-free evidence for unlocking
 * speed. Any logged breach resets the streak to 0 naturally.
 */
/** The later (max) of two optional YYYY-MM-DD dates; null only when both are
 *  absent. ISO date strings compare lexically == chronologically. Used to gate
 *  the readiness streak on the LATER of pain-tracking start and state entry. */
export function laterDate(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a >= b ? a : b;
}

export function painFreeStreak(runState: RunState, painCap: number, since?: string | null): number {
  const runs = Object.values(runState)
    .filter(e => (e.done || e.miles_actual != null) && (!since || e.date >= since))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  let streak = 0;
  for (const e of runs) {
    if (breachesCap(e, painCap)) break;
    streak++;
  }
  return streak;
}

/**
 * The most recent prior day (within 3 days) that logged pain during the run
 * but has no next-morning value yet. Drives the one-tap "did it settle?"
 * prompt so painNextAM is answered the morning after — accurately — instead
 * of being predicted at log time. Returns null when nothing is pending.
 */
export function pendingMorningCheck(runState: RunState, today: string): string | null {
  const from = addDaysStr(today, -3);
  let best: string | null = null;
  for (const e of Object.values(runState)) {
    if (e.date >= today || e.date < from) continue;
    if ((e.painDuring ?? 0) > 0 && e.painNextAM == null) {
      if (!best || e.date > best) best = e.date;
    }
  }
  return best;
}

// ── Weekly actuals (calendar weeks Mon–Sun) ──────────────────

export interface WeekActual {
  weekStart: string; // Monday
  miles: number;
  runCount: number;
}

/**
 * Does a completed week read as a planned absorption (down) week relative to
 * the week immediately before it? True when the drop is at least the scheduled
 * ~15% cut (SCHEDULED_DOWN_CUT), with half-step rounding slack. Only
 * consecutive calendar weeks compare meaningfully — a gap is not a down week.
 *
 * This is the ONE detector for "that was a down week" in actuals: the
 * generator's cadence counter and the load-spike guard both use it, so the
 * rolling plan's own scheduled down weeks are recognized everywhere (the old
 * per-site ~20% thresholds could not see the 15% cut, which made a real down
 * week read as a build and its resume read as a jump).
 */
export function isReducedWeek(week: WeekActual, prevWeek: WeekActual | null | undefined): boolean {
  if (!prevWeek || prevWeek.miles <= 0) return false;
  if (addDaysStr(prevWeek.weekStart, 7) !== week.weekStart) return false;
  return week.miles <= prevWeek.miles * (1 - TUNABLES.SCHEDULED_DOWN_CUT) + TUNABLES.HALF_STEP + 1e-9;
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
