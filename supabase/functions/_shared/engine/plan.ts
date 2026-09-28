// Weekly targets and day-by-day plans.
//
// Build weeks follow a trajectory: +~10% a week, a lighter week after every
// 4 build weeks. After each finished week the trajectory checks the facts:
//   • on target (85%+)           → keep building
//   • fully known and well under  → next week starts from what they ran
//   • partly known or unknown     → hold (no build, no cut)
// So missing data can never shrink a plan, and a plan can never run away
// from what the runner actually does.
//
// Plan changes (overrides) replace single future days. The week's target
// becomes the changed total, so a week cut short on purpose and then
// completed counts as on track.
import { addDays, half, round1, weekStart as weekStartOf } from './dates.ts';
import { longRunBase, usualWeek, weekFacts, byDate, type Reliability } from './facts.ts';
import { phaseOfWeek, type WeekPhase } from './phase.ts';
import { RULES, peakFor } from './rules.ts';
import type { ISODate, PlanOverride, RunnerData } from './types.ts';

export type DayKind = 'easy' | 'long' | 'rest' | 'team' | 'meet' | 'free' | 'cross' | 'workout';

export interface PlannedDay {
  date: ISODate;
  kind: DayKind;
  miles: number | null;
  label: string;
  /** Present when this day was changed on purpose. */
  override?: { source: 'app' | 'claude'; note: string | null; was: { kind: DayKind; miles: number | null } };
}

export interface WeekPlan {
  start: ISODate;
  phase: WeekPhase;
  /** Planned miles for the week (build, after changes) or the usual week (coach). */
  target: number | null;
  /** The engine's own number before any plan changes. */
  baseTarget: number | null;
  /** True when target is a starting guess (no known weeks yet). */
  estimated: boolean;
  isDown: boolean;
  days: PlannedDay[];
  why: string[];
  /** Largest single run allowed this week (the long-run cap). */
  longCap: number;
}

/** One row of the build trajectory, for tracing how a number was decided. */
export interface TraceRow {
  week: ISODate;
  target: number;
  effective: number;
  isDown: boolean;
  capped: boolean;
  actual: number | null;
  reliability: Reliability | 'future';
  decision: string;
}

const stepFor = (t: number) =>
  Math.min(RULES.BUILD_ABS_MAX, Math.max(RULES.BUILD_ABS_MIN, Math.round(t * RULES.BUILD_PCT)));

/** Which weekdays are run days: rest goes first to the day after the long
 *  run, then mid-week, so runs are spread out. */
export function runDaysOf(daysPerWeek: number, longRunDay: number): number[] {
  const restOrder = [1, 4, 2, 5, 3, 6].map(k => (longRunDay + k) % 7);
  const rest = new Set(restOrder.slice(0, Math.max(0, 7 - daysPerWeek)));
  return [0, 1, 2, 3, 4, 5, 6].filter(d => !rest.has(d));
}

export function longCap(trailing: number | null, fallback: number): number {
  const base = trailing ?? fallback;
  return half(Math.max(base * RULES.LONG_GROWTH, base + RULES.LONG_GROWTH_MIN_MI));
}

/** Split a weekly target across run days, long run on its day. */
export function splitWeek(start: ISODate, target: number, daysPerWeek: number, longRunDay: number, cap: number): PlannedDay[] {
  let n = daysPerWeek;
  let runDays = runDaysOf(n, longRunDay);
  let long = 0;
  for (;;) {
    const share = n <= 4 ? RULES.LONG_SHARE_FEW_DAYS : RULES.LONG_SHARE;
    long = Math.max(RULES.MIN_RUN_MI, Math.min(half(target * share), cap));
    const each = n > 1 ? (target - long) / (n - 1) : 0;
    if (each >= RULES.MIN_RUN_MI || n <= 3) break;
    n--;
    runDays = runDaysOf(n, longRunDay);
  }
  const hasLong = runDays.includes(longRunDay);
  const easyDays = runDays.filter(d => !hasLong || d !== longRunDay);
  const easyTotal = half(target - (hasLong ? long : 0));
  const baseEach = Math.floor((easyTotal / Math.max(1, easyDays.length)) * 2) / 2;
  let extra = Math.round((easyTotal - baseEach * easyDays.length) * 2);
  const miles = new Map<number, number>();
  for (const d of easyDays) {
    // The long-run limit caps every run, so a week that can't fit under it
    // comes out smaller rather than with easy days longer than the long run.
    miles.set(d, Math.min(cap, Math.max(RULES.MIN_RUN_MI, baseEach + (extra > 0 ? 0.5 : 0))));
    if (extra > 0) extra--;
  }
  if (hasLong) miles.set(longRunDay, long);
  return [0, 1, 2, 3, 4, 5, 6].map(d => {
    const date = addDays(start, d);
    const m = miles.get(d);
    if (m == null) return { date, kind: 'rest' as const, miles: null, label: 'Rest' };
    // A "long run" that isn't longer than the easy days is just an easy run.
    const isLong = hasLong && d === longRunDay && long > Math.max(0, ...easyDays.map(e => miles.get(e) ?? 0));
    return { date, kind: isLong ? 'long' as const : 'easy' as const, miles: m, label: isLong ? 'Long run' : 'Easy run' };
  });
}

const OVERRIDE_LABEL: Record<PlanOverride['kind'], string> = {
  easy: 'Easy run', long: 'Long run', rest: 'Rest', cross: 'Cross-train', workout: 'Workout',
};

/** Apply plan changes to a list of planned days. */
export function applyOverrides(days: PlannedDay[], overrides: PlanOverride[] | undefined): PlannedDay[] {
  if (!overrides?.length) return days;
  const byDay = new Map(overrides.map(o => [o.date, o]));
  return days.map(d => {
    const o = byDay.get(d.date);
    if (!o) return d;
    const miles = o.kind === 'rest' || o.kind === 'cross' ? null : o.miles ?? d.miles;
    return {
      date: d.date, kind: o.kind as DayKind, miles, label: OVERRIDE_LABEL[o.kind],
      override: { source: o.source, note: o.note ?? null, was: { kind: d.kind, miles: d.miles } },
    };
  });
}

const sumMiles = (days: PlannedDay[]) => round1(days.reduce((s, d) => s + (d.kind === 'cross' ? 0 : d.miles ?? 0), 0));

interface Traj { targets: Map<ISODate, { target: number; isDown: boolean; why: string[] }>; trace: TraceRow[] }

/** Walk a build block week by week from its first Monday to `until`. */
function buildTrajectory(data: RunnerData, phase: WeekPhase, until: ISODate, today: ISODate): Traj {
  const p = data.profile;
  const peak = peakFor(p.experienceYears, p.goalMpw, p.birthYear, today);
  const runsByDate = byDate(data);
  const targets: Traj['targets'] = new Map();
  const trace: TraceRow[] = [];

  let level: number;
  let startWhy: string;
  if (phase.afterSeasonFrom) {
    const before = usualWeek(data, phase.afterSeasonFrom, today);
    level = half((before.mpw ?? p.startMpw) * RULES.RETURN_FACTOR);
    startWhy = before.mpw != null
      ? `After the season and break, starts at ${level} mi (about 60% of your in-season ${before.mpw}).`
      : `After the season and break, starts at ${level} mi.`;
  } else {
    const usual = usualWeek(data, phase.since, today);
    if (phase.since > weekStartOf(p.planStart) && usual.mpw != null) {
      level = half(usual.mpw);
      startWhy = `Starts from your usual ${usual.mpw} mi a week.`;
    } else {
      level = p.startMpw;
      startWhy = `Starts from the ${round1(level)} mi a week you told us you run.`;
    }
  }
  if (level > peak) startWhy += ` Held at your ${peak} mi ceiling.`;
  level = Math.min(level, peak);

  let build = level;         // the build trajectory (ignores lighter weeks)
  let buildWeeks = 0;        // build weeks since the last lighter week
  let lastTarget = level;
  for (let w = phase.since; w <= until; w = addDays(w, 7)) {
    const isDown = buildWeeks >= RULES.BUILDS_BEFORE_DOWN;
    let target = isDown ? half(lastTarget * RULES.DOWN_FACTOR) : half(build);
    const why: string[] = [];
    if (w === phase.since) why.push(startWhy);
    if (isDown) why.push(`Lighter week (${Math.round(RULES.DOWN_FACTOR * 100)}% of the week before) so your body catches up.`);

    // Only a fully known week can hold the plan back; a partly logged week
    // proves at least its miles, so it can only raise the cap.
    let capped = false;
    const recent = [1, 2, 3]
      .map(i => weekFacts(data, addDays(w, -7 * i), today, runsByDate))
      .filter(f => f.finished && f.reliability !== 'none');
    if (recent.some(f => f.reliability === 'full') && w <= addDays(today, 7)) {
      const capV = half(Math.max(...recent.map(f => f.miles)) * RULES.MAX_OVER_VERIFIED);
      if (target > capV && !isDown) {
        target = Math.max(capV, RULES.MIN_RUN_MI * 2);
        capped = true;
        why.push(`Capped at ${target} mi: no more than 15% above your biggest recent week.`);
      }
    }
    targets.set(w, { target, isDown, why });
    lastTarget = target;

    // The week as the runner was actually asked to run it (plan changes included).
    let effective = target;
    const weekOverrides = (data.overrides ?? []).filter(o => o.date >= w && o.date <= addDays(w, 6));
    if (weekOverrides.length) {
      const cap = longCap(longRunBase(data, w), Math.max(RULES.MIN_RUN_MI, target * RULES.LONG_SHARE));
      effective = sumMiles(applyOverrides(splitWeek(w, target, p.daysPerWeek, p.longRunDay, cap), weekOverrides));
    }

    const f = weekFacts(data, w, today, runsByDate);
    buildWeeks = isDown ? 0 : buildWeeks + 1;
    let decision: string;
    if (!f.finished) {
      if (!isDown) build = Math.min(peak, build + stepFor(build));
      decision = 'Not finished yet: assume on track.';
    } else if (f.miles >= RULES.ON_TRACK * effective) {
      if (!isDown) build = Math.min(peak, build + stepFor(build));
      decision = isDown ? 'Lighter week done.' : `On track (${f.miles} of ${effective}): keep building.`;
    } else if (f.reliability === 'full') {
      build = Math.max(RULES.MIN_RUN_MI * 2, half(f.miles));
      buildWeeks = 0;
      decision = `Fully known and under (${f.miles} of ${effective}): next week starts from ${build}.`;
    } else {
      decision = f.reliability === 'none' ? 'No data: hold, no build and no cut.' : `Partly known (${f.miles} logged): hold.`;
    }
    trace.push({ week: w, target, effective, isDown, capped, actual: f.finished ? f.miles : null, reliability: f.finished ? f.reliability : 'future', decision });
  }
  return { targets, trace };
}

export function planWeek(data: RunnerData, monday: ISODate, today: ISODate): WeekPlan {
  const p = data.profile;
  const phase = phaseOfWeek(monday, data.seasons, p.planStart);
  const meets = new Map(data.meets.map(m => [m.date, m]));
  // Future weeks use what we know today, not a window that slides past it.
  const asOf = monday < weekStartOf(today) ? monday : weekStartOf(today);
  const trailing = longRunBase(data, asOf);

  if (phase.kind === 'break') {
    return {
      start: monday, phase, target: null, baseTarget: null, estimated: false, isDown: false, longCap: longCap(trailing, p.startLongest),
      days: [0, 1, 2, 3, 4, 5, 6].map(d => ({ date: addDays(monday, d), kind: 'free' as const, miles: null, label: 'Free day' })),
      why: ['Season is over. Two weeks with no plan: rest, play other sports, or an easy run if you miss it.'],
    };
  }

  if (phase.kind === 'coach') {
    const usual = usualWeek(data, asOf, today);
    const aim = usual.mpw ?? p.startMpw;
    const cap = longCap(trailing, p.startLongest);
    const runDays = runDaysOf(p.daysPerWeek, p.longRunDay);
    const workout = new Set(phase.season?.workoutDays ?? []);
    const easy = Math.min(cap, Math.max(RULES.MIN_RUN_MI, half(aim / Math.max(1, p.daysPerWeek))));
    const base: PlannedDay[] = [0, 1, 2, 3, 4, 5, 6].map(d => {
      const date = addDays(monday, d);
      const meet = meets.get(date);
      if (meet) return { date, kind: 'meet' as const, miles: meet.distanceMi ?? null, label: meet.name ? `Meet · ${meet.name}` : 'Meet' };
      if (workout.has(d)) return { date, kind: 'team' as const, miles: null, label: 'Team workout' };
      if (!runDays.includes(d)) return { date, kind: 'rest' as const, miles: null, label: 'Rest' };
      if (d === p.longRunDay) return { date, kind: 'long' as const, miles: Math.min(half(aim * RULES.LONG_SHARE), cap), label: 'Long run' };
      return { date, kind: 'easy' as const, miles: easy, label: 'Easy run' };
    });
    const days = applyOverrides(base, data.overrides);
    const why = usual.mpw != null
      ? [`Your coach runs the hard days. Easy days keep you near your usual ${usual.mpw} mi a week (the middle of your last ${usual.basis.length} full weeks).`]
      : [`Your coach runs the hard days. Until we see a couple of full weeks, we start from the ${p.startMpw} mi a week you told us.`];
    if (days.some(d => d.override)) why.push('Some days were changed on purpose.');
    return { start: monday, phase, target: aim, baseTarget: aim, estimated: usual.mpw == null, isDown: false, days, why, longCap: cap };
  }

  if (monday < phase.since) {
    // Before the plan started: nothing was planned.
    return {
      start: monday, phase, target: null, baseTarget: null, estimated: false, isDown: false, longCap: longCap(trailing, p.startLongest),
      days: [0, 1, 2, 3, 4, 5, 6].map(d => ({ date: addDays(monday, d), kind: 'rest' as const, miles: null, label: 'Before your plan' })),
      why: ['This week is before your plan started.'],
    };
  }
  const traj = buildTrajectory(data, phase, monday, today);
  const t = traj.targets.get(monday)!;
  const cap = longCap(trailing, Math.max(RULES.MIN_RUN_MI, t.target * RULES.LONG_SHARE));
  const planned = splitWeek(monday, t.target, p.daysPerWeek, p.longRunDay, cap).map(d => {
    const meet = meets.get(d.date);
    return meet ? { date: d.date, kind: 'meet' as const, miles: meet.distanceMi ?? null, label: meet.name ? `Race · ${meet.name}` : 'Race' } : d;
  });
  const fits = sumMiles(planned.filter(d => d.kind !== 'meet'));
  const baseTarget = planned.some(d => d.kind === 'meet') ? t.target : Math.min(t.target, fits);
  const days = applyOverrides(planned, data.overrides);
  const changed = days.some(d => d.override);
  const why = [...t.why];
  if (baseTarget < t.target) why.push(`Held to ${baseTarget} mi so no run is longer than ${cap} mi (about 10% past your longest recent run).`);
  if (changed) why.push(`Some days were changed on purpose: this week is ${sumMiles(days)} mi instead of ${t.target}.`);
  if (phase.nextSeason) why.push(`Building toward ${phase.nextSeason.label || 'your next season'}, which starts ${phase.nextSeason.startDate}.`);
  return {
    start: monday, phase, target: changed ? sumMiles(days) : baseTarget, baseTarget,
    estimated: false, isDown: t.isDown, days, why, longCap: cap,
  };
}

/** How a build week's number was decided, week by week. */
export function traceWeek(data: RunnerData, monday: ISODate, today: ISODate): { phase: WeekPhase; rows: TraceRow[]; peak: number } {
  const p = data.profile;
  const phase = phaseOfWeek(monday, data.seasons, p.planStart);
  const peak = peakFor(p.experienceYears, p.goalMpw, p.birthYear, today);
  if (phase.kind !== 'build') return { phase, rows: [], peak };
  return { phase, rows: buildTrajectory(data, phase, monday, today).trace, peak };
}
