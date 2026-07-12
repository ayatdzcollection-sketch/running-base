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
import type { GlobalState, PlanWeek, ProposedDay, RunState } from './types';
import { addDaysStr, mondayOf, flareActive, painFreeStreak } from './metrics';
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
    if (plannedUnits + TUNABLES.SPEED.FARTLEK_UNITS <= guard.hardBudget + 1e-9) {
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
  const allowedLow = SPEED_TYPES.filter(t =>
    t.lowDose && t.unlockState <= tier && gateSatisfied(t.requires, globals));
  let pick = allowedLow[allowedLow.length - 1];
  if (!pick) return null;

  // Strides need a live pain-free streak (mirror the generator); if it has
  // slipped, fall back to buildups.
  const isStride = pick.key === 'shortStrides' || pick.key === 'flatStrides';
  if (isStride && painFreeStreak(runState, globals.painCap) < TUNABLES.STRIDES_MIN_STREAK) {
    const bu = allowedLow.find(t => t.key === 'buildups');
    if (!bu) return null;
    pick = bu;
  }

  return {
    name: pick.name,
    detail: DETAIL[pick.key] ?? pick.plain,
    skip: SKIP_CONDITIONS,
    dose: 'low',
    optional: true,
  };
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
// PLAN-INTEGRATED SPEED ADD-ONS (Phase 2D, Evidence Spec §9)
//
// Speed lives INSIDE the week plan, not only on the Today card / unlock
// panel: when a basic neuromuscular touch is unlocked and safe, up to two
// easy-run days per upcoming week carry a quiet optional add-on line with
// skip conditions. Text only — it never changes the day's miles, is never
// required, and a skipped add-on is never a failure.
// ============================================================

export interface PlanSpeedAddOn {
  name: string;
  detail: string;
  skip: string;
}

/** Optional speed add-ons for one displayed plan week: date → add-on line.
 *  Basic neuromuscular touches only (buildups/strides — the missing-data rule
 *  keeps these available without any optional logs); at most two easy days
 *  per week (first run day + day before the long run, mirroring the
 *  generator's stride placement); only today/future, un-logged days. */
export function planWeekSpeedAddOns(
  week: PlanWeek,
  runState: RunState,
  globals: GlobalState,
  today: string,
): Map<string, PlanSpeedAddOn> {
  const out = new Map<string, PlanSpeedAddOn>();
  if (week.endDate < today) return out;                       // past week — history only
  if (flareActive(runState, today, globals.painCap)) return out;
  if (globals.delayUntil && globals.delayUntil > today) return out;

  const guard = evaluateSpeedGuard(runState, globals, today, { isDownWeek: week.isDownWeek });
  const tier = Math.min(guard.effectiveTier, 3);              // plan add-ons stay neuromuscular + flat
  if (tier < 1) return out;

  const allowedLow = SPEED_TYPES.filter(t => t.lowDose && t.unlockState <= tier && gateSatisfied(t.requires, globals));
  let pick = allowedLow[allowedLow.length - 1];
  if (!pick) return out;
  const isStride = pick.key === 'shortStrides' || pick.key === 'flatStrides';
  if (isStride && painFreeStreak(runState, globals.painCap) < TUNABLES.STRIDES_MIN_STREAK) {
    const bu = allowedLow.find(t => t.key === 'buildups');
    if (!bu) return out;
    pick = bu;
  }

  // Placement mirrors the generator: first run day + day before the long run.
  // An accepted threshold day already IS the speed session — never stack an
  // add-on line on it.
  const runDays = week.allDays.filter(d => d.type === 'run' && !d.isLongRun && d.kind !== 'threshold');
  if (runDays.length === 0) return out;
  const longIdx = week.allDays.findIndex(d => d.isLongRun);
  const beforeLong = longIdx > 0
    ? runDays.filter(d => d.date < week.allDays[longIdx].date).slice(-1)[0]
    : undefined;
  const targets = [...new Set([runDays[0], beforeLong].filter((d): d is NonNullable<typeof d> => d != null))];

  for (const d of targets) {
    if (d.date < today) continue;                              // never mark the past
    const e = runState[d.date];
    if (e && (e.done || e.miles_actual != null)) continue;     // already ran — nothing to suggest
    out.set(d.date, {
      name: pick.name,
      detail: DETAIL[pick.key] ?? pick.plain,
      skip: SKIP_CONDITIONS,
    });
  }
  return out;
}
