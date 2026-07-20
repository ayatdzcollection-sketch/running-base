// ============================================================
// TODAY'S SPEED PRESCRIPTION (Phase 2D)
//
// The single optional speed dose surfaced on the Today card for a run day.
// Basic tiers (1–4) surface as NEUROMUSCULAR add-ons (buildups → strides);
// tier 5 may surface a LIGHT FARTLEK suggestion (0.5 hard unit, budget-gated);
// true hard sessions are never add-ons — the generator schedules those with
// 48h long-run spacing. Rules:
//
//   • not a run day                  → nothing
//   • flare / break                  → nothing (guard caps the tier at 0)
//   • long-run day                   → explicit "no strides" row (purely easy)
//   • threshold day (accepted week)  → no add-on (the workout IS the speed)
//   • speed delayed (delayUntil)     → no row
//   • otherwise → the most-advanced add-on the EFFECTIVE tier allows. The
//     effective tier = stored tier minus every active blocker (down week,
//     race week, spike, rising RPE, pain drift, poor recovery, missing data…)
//     — see speedGuard.ts. Suppression never erases the stored tier.
//
// Every offered row is OPTIONAL, carries its skip conditions, and adds zero
// miles. Race results and the award are NOT inputs to the basic rows; a race
// dated in the CURRENT week acts only as a taper suppressor (downward-only).
// ============================================================

import type { BuiltPlan } from '../config/plan';
import type { GlobalState, ProposedDay, RunState } from './types';
import { addDaysStr, mondayOf, flareActive, painFreeStreak, painBreachDates } from './metrics';
import { SPEED_TYPES, gateSatisfied } from './speed';
import { evaluateSpeedGuard, hardUnitsForDays, type SpeedGuard } from './speedGuard';
import { TUNABLES } from '../config/tunables';

export interface TodaySpeedRow {
  name: string;
  detail: string;
  /** Always-visible skip conditions (Evidence Spec §9). */
  skip?: string;
  dose: 'none' | 'low';
  optional: boolean;   // renders the OPTIONAL tag
  /** True when this row is a loggable neuromuscular touch: the Today card
   *  offers a one-tap "done" toggle that writes RunEntry.didStrides — the same
   *  field the day-detail chips have always used, so both surfaces agree.
   *  Light fartlek stays display-only (it is a half hard unit, not a touch). */
  canLog?: boolean;
}

/** The one skip line every optional speed row carries. */
export const SKIP_CONDITIONS = 'Skip if pain, soreness, poor recovery, or this week already feels hard.';

// Design copy per rung (Evidence Spec §5 example copy).
const DETAIL: Record<string, string> = {
  buildups: 'Optional: 4 × 20 sec relaxed buildups after your easy run, if pain-free.',
  shortStrides: 'Optional: 4 × 15 sec smooth strides after the run, full recovery.',
  flatStrides: 'Optional: 6 × 20 sec relaxed strides, full recovery.',
  hills: 'Optional: 6 × 10 sec hill sprints, walk down. Skip if legs feel beat up.',
  fartlek: 'Optional today: a few relaxed 45-sec pickups during your easy run.',
};

function acceptedDay(acceptedWeeks: GlobalState['acceptedWeeks'], date: string): ProposedDay | null {
  for (const days of Object.values(acceptedWeeks ?? {})) {
    for (const d of days) if (d.date === date) return d;
  }
  return null;
}

interface DayType {
  isRun: boolean;
  isLong: boolean;
  isThreshold: boolean;
  isDownWeek: boolean;
  isDayBeforeLong: boolean;
}

function todayDayType(plan: BuiltPlan, acceptedWeeks: GlobalState['acceptedWeeks'], today: string): DayType {
  const tomorrow = addDaysStr(today, 1);
  const accTomorrow = acceptedDay(acceptedWeeks, tomorrow);
  const isDayBeforeLong = accTomorrow
    ? accTomorrow.kind === 'long'
    : plan.dateToDay.get(tomorrow)?.isLongRun === true;

  // Confirmed generated weeks take precedence over the static/settings plan.
  const acc = acceptedDay(acceptedWeeks, today);
  if (acc) {
    return {
      isRun: acc.kind !== 'rest', isLong: acc.kind === 'long',
      isThreshold: acc.kind === 'threshold', isDownWeek: false, isDayBeforeLong,
    };
  }
  const d = plan.dateToDay.get(today);
  if (d && d.type === 'run') {
    return { isRun: true, isLong: d.isLongRun, isThreshold: false, isDownWeek: d.isDownWeek, isDayBeforeLong };
  }
  return { isRun: false, isLong: false, isThreshold: false, isDownWeek: false, isDayBeforeLong };
}

export interface TodaySpeedArgs {
  runState: RunState;
  globals: GlobalState;
  today: string;
  plan: BuiltPlan;
  acceptedWeeks: GlobalState['acceptedWeeks'];
}

export function computeTodaySpeed(args: TodaySpeedArgs): TodaySpeedRow | null {
  const { runState, globals, today, plan, acceptedWeeks } = args;
  const dt = todayDayType(plan, acceptedWeeks, today);

  // Not a run day → nothing.
  if (!dt.isRun) return null;

  // Flare suppresses everything (no row) — the guard would cap the tier at 0
  // anyway, but nothing should render during a flare, not even "no strides".
  if (flareActive(runState, today, globals.painCap)) return null;

  // Long-run day: purely easy, explicit message (distinct from "no row").
  if (dt.isLong) {
    return { name: 'No strides today', detail: 'Long-run day stays purely easy.', dose: 'none', optional: false };
  }

  // A threshold day already IS the speed session — no add-on.
  if (dt.isThreshold) return null;

  // Speed delayed → hold, no add-on.
  if (globals.delayUntil && globals.delayUntil > today) return null;

  // Effective tier = stored tier minus every active blocker (Phase 2D guard).
  const guard = evaluateSpeedGuard(runState, globals, today, { isDownWeek: dt.isDownWeek });
  const tier = guard.effectiveTier;
  if (tier < 1) return null;

  // ── Tier 5+: light fartlek suggestion (0.5 hard unit, budget-gated). ──
  // Suppressed in coach/season mode (the app stops prescribing its own hard
  // work), on the day before the long run (spacing), and whenever this week's
  // accepted plan + races already spend the hard budget.
  if (tier >= TUNABLES.SPEED.ADVANCED_MIN_TIER && !guard.seasonMode && !dt.isDayBeforeLong) {
    const weekStart = mondayOf(today);
    const plannedUnits = hardUnitsForDays(acceptedWeeks?.[weekStart] ?? [], globals.races, weekStart);
    // Two views of this week's hard load: what the PLAN scheduled, and what the
    // athlete actually LOGGED (guard.hardUnitsUsed — races + any RPE ≥ 8 session,
    // which is how coach-led workouts become visible at all). Both already count
    // races identically, so MAX combines them without double-counting a race, and
    // takes the more conservative of the two. A coach session the app never
    // scheduled now correctly spends the budget and withdraws the fartlek offer.
    const usedUnits = Math.max(plannedUnits, guard.hardUnitsUsed);
    if (usedUnits + TUNABLES.SPEED.FARTLEK_UNITS <= guard.hardBudget + 1e-9) {
      return {
        name: 'Light fartlek',
        detail: DETAIL.fartlek,
        skip: SKIP_CONDITIONS,
        dose: 'low',
        optional: true,
      };
    }
    // Budget spent → fall through to the neuromuscular add-on instead.
  }

  // ── Basic neuromuscular add-on (buildups → short → flat strides). ──
  // Never gate these on optional data — the missing-data rule protects them.
  const pick = pickBasicTouch(runState, globals, tier);
  if (!pick) return null;

  return {
    name: pick.name,
    detail: DETAIL[pick.key] ?? pick.plain,
    skip: SKIP_CONDITIONS,
    dose: 'low',
    optional: true,
    canLog: true,
  };
}

/** The most-advanced allowed LOW-DOSE (neuromuscular) touch at `tier`. Strides
 *  need a live pain-free streak (mirrors the generator); when it has slipped,
 *  fall back to buildups. null = nothing available. Shared by the Today row
 *  and the weekly-touches target so the two surfaces always name the SAME
 *  touch — no more "strides here, buildups there". */
function pickBasicTouch(runState: RunState, globals: GlobalState, tier: number) {
  const allowedLow = SPEED_TYPES.filter(t =>
    t.lowDose && t.unlockState <= tier && gateSatisfied(t.requires, globals));
  let pick = allowedLow[allowedLow.length - 1];
  if (!pick) return null;
  const isStride = pick.key === 'shortStrides' || pick.key === 'flatStrides';
  if (isStride && painFreeStreak(runState, globals.painCap) < TUNABLES.STRIDES_MIN_STREAK) {
    const bu = allowedLow.find(t => t.key === 'buildups');
    if (!bu) return null;
    pick = bu;
  }
  return pick;
}

/** Suppression reasons (for tests / an optional "why nothing" affordance). */
export function todaySpeedReasons(args: TodaySpeedArgs): string[] {
  const { runState, globals, today, plan, acceptedWeeks } = args;
  const dt = todayDayType(plan, acceptedWeeks, today);
  const reasons: string[] = [];
  if (!dt.isRun) reasons.push('not a run day');
  if (flareActive(runState, today, globals.painCap)) reasons.push('flare / deload');
  if (dt.isLong) reasons.push('long-run day stays easy');
  if (dt.isThreshold) reasons.push('threshold day is the speed session');
  if (globals.delayUntil && globals.delayUntil > today) reasons.push('speed delayed');
  const guard = evaluateSpeedGuard(runState, globals, today, { isDownWeek: dt.isDownWeek });
  for (const b of guard.blockers) reasons.push(b.label);
  return reasons;
}

/** Re-export for callers that need the full blocker picture alongside the row. */
export function todaySpeedGuard(args: TodaySpeedArgs): SpeedGuard {
  const { runState, globals, today, plan, acceptedWeeks } = args;
  const dt = todayDayType(plan, acceptedWeeks, today);
  return evaluateSpeedGuard(runState, globals, today, { isDownWeek: dt.isDownWeek });
}

// ============================================================
// WEEKLY SPEED TOUCHES (the "aim for N this week" model)
//
// The old model pinned optional add-on lines to two fixed days (first run day
// + day before the long run) — days the athlete experienced as arbitrary. The
// replacement is a WEEKLY TARGET: the app names the one touch the current tier
// allows, says how many to aim for this week, and counts the ones actually
// logged (RunEntry.didStrides — one tap on the Today card or the day-detail
// chips). Which days is the athlete's call. The target is a display aim, never
// a requirement: it feeds no gate, no cap, no unlock — skipping every touch is
// never a failure, and doing extras never accelerates anything.
// ============================================================

export interface WeeklyTouches {
  /** Speed-type key of the touch this tier allows (buildups/shortStrides/…). */
  key: string;
  name: string;
  detail: string;
  /** Aim-for count for the week — PROGRESSIVE (see touchTargetFor). */
  target: number;
  /** Touches actually logged this calendar week (didStrides === true). */
  done: number;
  doneDates: string[];
  /** Current week is a down/absorption week (touches still fine; extra-easy). */
  downWeek: boolean;
  /** The earned ceiling for this athlete (min of TOUCHES.MAX and run days − 1). */
  ceiling: number;
  /** Qualifying weeks still needed before the aim rises; null at the ceiling. */
  weeksToNext: number | null;
}

/**
 * The PROGRESSIVE weekly touch aim. Titrates frequency the way every published
 * progression does (Johnson's phased HS strides; post-injury protocols that
 * restart at 2/wk; Daniels' 2–3 stride days): start at TOUCHES.FLOOR, add one
 * per TOUCHES.STEP_CLEAN_WEEKS consecutive QUALIFYING completed weeks, capped
 * at min(TOUCHES.MAX, run days − 1) — the long-run day always stays purely
 * easy. A week qualifies when it had real running, ZERO pain-cap breaches, and
 * at least FLOOR touches actually logged — you earn more by doing the current
 * dose cleanly, not by wanting more. Any non-qualifying week breaks the streak
 * (missed week, breach, or touches not done), dropping the aim back toward the
 * floor: judged-unready or unproven exposure re-titrates, mirroring the
 * earned-trust asymmetry (earned slowly, revoked instantly).
 */
export function touchTargetFor(
  runState: RunState,
  globals: GlobalState,
  today: string,
): { target: number; ceiling: number; weeksToNext: number | null; cleanWeeks: number } {
  const T = TUNABLES.SPEED.TOUCHES;
  const settings = globals.settings ?? null;
  const daysPerWeek = settings ? Math.round(Math.min(6, Math.max(3, settings.daysPerWeek))) : 5;
  const ceiling = Math.max(T.FLOOR, Math.min(T.MAX, daysPerWeek - 1));

  const breaches = painBreachDates(runState, globals.painCap);
  const curMonday = mondayOf(today);
  const maxUseful = (ceiling - T.FLOOR) * T.STEP_CLEAN_WEEKS;
  let streak = 0;
  for (let k = 1; k <= 26 && streak < maxUseful; k++) {
    const ws = addDaysStr(curMonday, -7 * k);
    if (globals.painTrackingSince && ws < globals.painTrackingSince) break;
    const we = addDaysStr(ws, 6);
    const entries = Object.values(runState).filter(e => e.date >= ws && e.date <= we);
    const ran = entries.some(e => e.done || e.miles_actual != null);
    const touches = entries.filter(e => e.didStrides === true).length;
    const breached = breaches.some(d => d >= ws && d <= we);
    if (!ran || breached || touches < T.FLOOR) break;
    streak++;
  }

  const target = Math.min(T.FLOOR + Math.floor(streak / T.STEP_CLEAN_WEEKS), ceiling);
  const weeksToNext = target >= ceiling
    ? null
    : T.STEP_CLEAN_WEEKS - (streak % T.STEP_CLEAN_WEEKS);
  return { target, ceiling, weeksToNext, cleanWeeks: streak };
}

export function weeklyTouches(args: TodaySpeedArgs): WeeklyTouches | null {
  const { runState, globals, today, plan } = args;
  if (flareActive(runState, today, globals.painCap)) return null;
  if (globals.delayUntil && globals.delayUntil > today) return null;

  const downWeek = plan.dateToWeek.get(today)?.isDownWeek ?? false;
  const guard = evaluateSpeedGuard(runState, globals, today, { isDownWeek: downWeek });
  if (guard.effectiveTier < 1) return null;

  const pick = pickBasicTouch(runState, globals, guard.effectiveTier);
  if (!pick) return null;

  const weekStart = mondayOf(today);
  const weekEnd = addDaysStr(weekStart, 6);
  const doneDates = Object.values(runState)
    .filter(e => e.date >= weekStart && e.date <= weekEnd && e.didStrides === true)
    .map(e => e.date)
    .sort();

  const { target, ceiling, weeksToNext } = touchTargetFor(runState, globals, today);
  return {
    key: pick.key,
    name: pick.name,
    detail: DETAIL[pick.key] ?? pick.plain,
    target,
    done: doneDates.length,
    doneDates,
    downWeek,
    ceiling,
    weeksToNext,
  };
}

/** Recent logged touches (didStrides days), newest first — the speed log the
 *  Speed panel shows so completed touches are visibly banked. Display-only. */
export interface TouchLogEntry {
  date: string;
  miles: number | null;
}

export function recentTouches(runState: RunState, today: string, days = 21): TouchLogEntry[] {
  const from = addDaysStr(today, -days);
  return Object.values(runState)
    .filter(e => e.date > from && e.date <= today && e.didStrides === true)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(e => ({ date: e.date, miles: e.miles_actual }));
}
