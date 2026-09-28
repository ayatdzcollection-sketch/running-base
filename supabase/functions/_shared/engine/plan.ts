// Weekly targets and day-by-day plans.
//
// Build weeks follow a trajectory: +~10% a week, every 4th week lighter.
// After each finished week the trajectory checks the facts:
//   • fully known and on target  → keep building
//   • fully known and well under → next week starts from what they ran
//   • partly known or unknown    → hold (no build, no cut)
// So missing data can never shrink a plan, and a plan can never run
// away from what the runner actually does.
import { addDays, half, round1, weekStart as weekStartOf } from './dates.ts';
import { longRunBase, usualWeek, weekFacts, byDate } from './facts.ts';
import { phaseOfWeek, type WeekPhase } from './phase.ts';
import { RULES, peakFor } from './rules.ts';
import type { ISODate, RunnerData } from './types.ts';

export type DayKind = 'easy' | 'long' | 'rest' | 'team' | 'meet' | 'free';

export interface PlannedDay {
  date: ISODate;
  kind: DayKind;
  miles: number | null;
  label: string;
}

export interface WeekPlan {
  start: ISODate;
  phase: WeekPhase;
  /** Planned miles for the week (build), or the runner's usual week (coach). */
  target: number | null;
  isDown: boolean;
  days: PlannedDay[];
  /** Plain-English reasons for the numbers. */
  why: string[];
}

// Whole-mile steps read better than 2.5s: 20 → 22 → 24 → 26.
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
export function splitWeek(
  start: ISODate,
  target: number,
  daysPerWeek: number,
  longRunDay: number,
  cap: number,
): PlannedDay[] {
  let n = daysPerWeek;
  let runDays = runDaysOf(n, longRunDay);
  let long = 0, each = 0;
  for (;;) {
    const share = n <= 4 ? RULES.LONG_SHARE_FEW_DAYS : RULES.LONG_SHARE;
    long = Math.max(RULES.MIN_RUN_MI, Math.min(half(target * share), cap));
    const others = n - 1;
    each = others > 0 ? (target - long) / others : 0;
    if (each >= RULES.MIN_RUN_MI || n <= 3) break;
    n--;
    runDays = runDaysOf(n, longRunDay);
  }
  const hasLong = runDays.includes(longRunDay);
  const easyDays = runDays.filter(d => !hasLong || d !== longRunDay);
  // Easy days in half miles, remainder spread from the start of the week,
  // so the total lands on the target (to the nearest half mile).
  const easyTotal = half(target - (hasLong ? long : 0));
  const baseEach = Math.floor((easyTotal / Math.max(1, easyDays.length)) * 2) / 2;
  let extra = Math.round((easyTotal - baseEach * easyDays.length) * 2);
  const miles = new Map<number, number>();
  for (const d of easyDays) {
    miles.set(d, Math.max(RULES.MIN_RUN_MI, baseEach + (extra > 0 ? 0.5 : 0)));
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

interface Trajectory {
  targets: Map<ISODate, { target: number; isDown: boolean; why: string[] }>;
}

/** Walk a build block week by week from its first Monday to `until`. */
function buildTrajectory(data: RunnerData, phase: WeekPhase, until: ISODate, today: ISODate): Trajectory {
  const peak = peakFor(data.profile.experienceYears, data.profile.goalMpw);
  const runsByDate = byDate(data);
  const targets = new Map<ISODate, { target: number; isDown: boolean; why: string[] }>();

  // Starting level for the block.
  let level: number;
  let startWhy: string;
  if (phase.afterSeasonFrom) {
    const before = usualWeek(data, phase.afterSeasonFrom, today);
    level = half((before.mpw ?? data.profile.startMpw) * RULES.RETURN_FACTOR);
    startWhy = before.mpw != null
      ? `After the season and break, starts at ${level} mi (about 60% of your in-season ${before.mpw}).`
      : `After the season and break, starts at ${level} mi.`;
  } else {
    const usual = usualWeek(data, phase.since, today);
    if (phase.since > weekStartOf(data.profile.planStart) && usual.mpw != null) {
      level = half(usual.mpw);
      startWhy = `Starts from your usual ${usual.mpw} mi a week.`;
    } else {
      level = data.profile.startMpw;
      startWhy = `Starts from the ${round1(level)} mi a week you told us you run.`;
    }
  }
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

    // Never plan far past the last verified weeks.
    // Only a fully known week can hold the plan back; a partly logged week
    // proves at least its miles, so it can only raise the cap.
    const recent = [1, 2, 3]
      .map(i => weekFacts(data, addDays(w, -7 * i), today, runsByDate))
      .filter(f => f.finished && f.reliability !== 'none');
    if (recent.some(f => f.reliability === 'full') && w <= addDays(today, 7)) {
      const capV = half(Math.max(...recent.map(f => f.miles)) * RULES.MAX_OVER_VERIFIED);
      if (target > capV && !isDown) {
        target = Math.max(capV, RULES.MIN_RUN_MI * 2);
        why.push(`Capped at ${target} mi: no more than 15% above your biggest recent week.`);
      }
    }
    targets.set(w, { target, isDown, why });
    lastTarget = target;

    // Decide the next week from the facts of this one.
    const f = weekFacts(data, w, today, runsByDate);
    buildWeeks = isDown ? 0 : buildWeeks + 1;
    if (!f.finished) {
      if (!isDown) build = Math.min(peak, build + stepFor(build)); // future weeks: assume on track
      continue;
    }
    const onTrack = f.miles >= RULES.ON_TRACK * target;
    if (onTrack) {
      if (!isDown) build = Math.min(peak, build + stepFor(build));
    } else if (f.reliability === 'full') {
      build = Math.max(RULES.MIN_RUN_MI * 2, half(f.miles));
      buildWeeks = 0;
    }
    // partial / unknown and under target: hold `build` exactly where it is.
  }
  return { targets };
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
      start: monday, phase, target: null, isDown: false,
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
    const easy = half(aim / Math.max(1, p.daysPerWeek));
    const days: PlannedDay[] = [0, 1, 2, 3, 4, 5, 6].map(d => {
      const date = addDays(monday, d);
      const meet = meets.get(date);
      if (meet) return { date, kind: 'meet' as const, miles: meet.distanceMi ?? null, label: meet.name ? `Meet · ${meet.name}` : 'Meet' };
      if (workout.has(d)) return { date, kind: 'team' as const, miles: null, label: 'Team workout' };
      if (!runDays.includes(d)) return { date, kind: 'rest' as const, miles: null, label: 'Rest' };
      if (d === p.longRunDay) {
        const long = Math.min(half(aim * RULES.LONG_SHARE), cap);
        return { date, kind: 'long' as const, miles: long, label: 'Long run' };
      }
      return { date, kind: 'easy' as const, miles: easy, label: 'Easy run' };
    });
    const why = usual.mpw != null
      ? [`Your coach runs the hard days. Easy days keep you near your usual ${usual.mpw} mi a week (the middle of your last ${usual.basis.length} full weeks).`]
      : ['Your coach runs the hard days. We need a couple of full weeks of runs to learn your usual week.'];
    return { start: monday, phase, target: usual.mpw ?? null, isDown: false, days, why };
  }

  // Build.
  const traj = buildTrajectory(data, phase, monday, today);
  const t = traj.targets.get(monday)!;
  const cap = longCap(trailing, Math.max(RULES.MIN_RUN_MI, t.target * RULES.LONG_SHARE));
  const days = splitWeek(monday, t.target, p.daysPerWeek, p.longRunDay, cap).map(d => {
    const meet = meets.get(d.date);
    return meet ? { date: d.date, kind: 'meet' as const, miles: meet.distanceMi ?? null, label: meet.name ? `Race · ${meet.name}` : 'Race' } : d;
  });
  const why = [...t.why];
  const next = phase.nextSeason;
  if (next) why.push(`Building toward ${next.label || 'your next season'}, which starts ${next.startDate}.`);
  return { start: monday, phase, target: t.target, isDown: t.isDown, days, why };
}
