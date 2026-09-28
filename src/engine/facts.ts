// What actually happened, week by week. The one rule that matters most:
// a day with no data is UNKNOWN, never zero. Only facts move the plan.
import { addDays, daysBetween, inRange, round1, weekStart } from './dates.ts';
import { RULES } from './rules.ts';
import type { Activity, ISODate, RunnerData } from './types.ts';

export type Reliability = 'full' | 'partial' | 'none';

export interface WeekFacts {
  start: ISODate;
  end: ISODate;
  miles: number;            // every run, including checked-off days at plan miles
  estimatedMiles: number;   // the checked-off part
  runs: number;
  knownDays: number;        // days with a run or an explicit rest/skip mark
  longest: number;
  reliability: Reliability; // only for finished weeks; the current week is 'partial' or 'none'
  finished: boolean;
}

const isRun = (a: Activity) => a.kind !== 'cross' && a.distanceMi > 0;

export function byDate(data: RunnerData): Map<ISODate, Activity[]> {
  const m = new Map<ISODate, Activity[]>();
  for (const a of data.activities) {
    const list = m.get(a.date) ?? [];
    list.push(a);
    m.set(a.date, list);
  }
  return m;
}

export function weekFacts(data: RunnerData, start: ISODate, today: ISODate, runsByDate = byDate(data)): WeekFacts {
  const end = addDays(start, 6);
  const marks = new Set(data.days.map(d => d.date));
  let miles = 0, est = 0, runs = 0, known = 0, longest = 0;
  const lastDay = end < today ? end : addDays(today, -1);
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const acts = (runsByDate.get(d) ?? []).filter(isRun);
    for (const a of acts) {
      miles += a.distanceMi;
      if (a.distanceEstimated) est += a.distanceMi;
      longest = Math.max(longest, a.distanceMi);
    }
    runs += acts.length;
    if (d <= lastDay && (acts.length > 0 || marks.has(d))) known++;
  }
  const finished = end < today;
  const needed = Math.max(1, data.profile.daysPerWeek - RULES.KNOWN_SLACK_DAYS);
  let reliability: Reliability;
  // A connected watch does NOT make silent days known: a Shortcut can fail
  // quietly, or a run can happen without the watch. Silence stays unknown.
  if (known === 0) reliability = 'none';
  else if (known >= needed) reliability = finished ? 'full' : 'partial';
  else reliability = 'partial';
  return { start, end, miles: round1(miles), estimatedMiles: round1(est), runs, knownDays: known, longest, reliability, finished };
}

/** Longest single run in the 30 days before `asOf` (not counting asOf). */
export function trailingLongest(data: RunnerData, asOf: ISODate): number | null {
  const from = addDays(asOf, -30), to = addDays(asOf, -1);
  let best = 0;
  for (const a of data.activities) if (isRun(a) && inRange(a.date, from, to)) best = Math.max(best, a.distanceMi);
  return best > 0 ? best : null;
}

/** The long-run base: the 30-day longest, or, when there's no data in the
 *  last 30 days, the 30-day longest as of the last day we heard anything.
 *  (No data is not evidence of a shorter long run.) Near the plan start,
 *  the longest run the runner reported at setup also counts. */
export function longRunBase(data: RunnerData, asOf: ISODate): number | null {
  let best = trailingLongest(data, asOf);
  if (best == null) {
    const last = data.activities.filter(a => isRun(a) && a.date < asOf).map(a => a.date).sort().pop();
    if (last) best = trailingLongest(data, addDays(last, 1));
  }
  if (asOf <= addDays(data.profile.planStart, 30)) best = Math.max(best ?? 0, data.profile.startLongest) || null;
  return best;
}

/** Finished, fully known weeks before `beforeWeek`, newest first. */
export function knownWeeks(data: RunnerData, beforeWeek: ISODate, today: ISODate, lookback: number = RULES.LOOKBACK_WEEKS): WeekFacts[] {
  const runsByDate = byDate(data);
  const out: WeekFacts[] = [];
  for (let i = 1; i <= lookback; i++) {
    const w = weekFacts(data, addDays(beforeWeek, -7 * i), today, runsByDate);
    if (w.finished && w.reliability === 'full') out.push(w);
  }
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The runner's usual week right now: the median of their last few fully
 *  known weeks. A partly known week can only raise it (it's a lower bound). */
export function usualWeek(data: RunnerData, beforeWeek: ISODate, today: ISODate): { mpw: number | null; basis: ISODate[] } {
  // Look back far enough that a stretch with no data can't slide the known
  // weeks out of view: the usual week changes only when new facts arrive.
  const known = knownWeeks(data, beforeWeek, today, RULES.USUAL_SEARCH_WEEKS).slice(0, RULES.USUAL_WEEKS);
  const prev = weekFacts(data, addDays(beforeWeek, -7), today);
  if (known.length === 0) {
    // A partly logged week is only a lower bound: use it only when it's more
    // than the runner told us at setup (callers fall back to that).
    return prev.reliability === 'partial' && prev.miles > data.profile.startMpw ? { mpw: prev.miles, basis: [prev.start] } : { mpw: null, basis: [] };
  }
  let mpw = median(known.map(w => w.miles));
  if (prev.reliability === 'partial' && prev.miles > mpw) mpw = prev.miles;
  return { mpw: round1(mpw), basis: known.map(w => w.start) };
}

/** Consecutive days with no run and no mark, ending yesterday. */
export function currentGap(data: RunnerData, today: ISODate): { from: ISODate; to: ISODate; days: number } | null {
  const known = new Set([...data.activities.map(a => a.date), ...data.days.map(d => d.date)]);
  let d = addDays(today, -1), days = 0;
  while (!known.has(d) && days < 400 && d >= data.profile.planStart) {
    days++;
    d = addDays(d, -1);
  }
  if (days === 0) return null;
  return { from: addDays(d, 1), to: addDays(today, -1), days };
}

export { weekStart, daysBetween };
