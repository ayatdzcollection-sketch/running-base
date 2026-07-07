// ============================================================
// TODAY'S SPEED PRESCRIPTION
//
// The single optional speed dose surfaced on the Today card for a run day.
// It only ever offers a LOW-DOSE add-on (buildups → strides), never a hard
// workout — hard sessions are scheduled runs the generator places with 48h
// long-run spacing, not add-ons. So the rules here are:
//
//   • flare / deload (state 8)      → no row (design: nothing shown)
//   • long-run day                  → explicit "no strides" row (purely easy)
//   • threshold day (accepted week) → no add-on (the workout IS the speed)
//   • speed delayed (delayUntil)    → no row
//   • otherwise → the most-advanced unlocked low-dose add-on, gated by the
//     speed state and (for strides) a live pain-free streak ≥ 3.
//
// Race results and the award are NOT inputs — the signature makes that
// structural, and tests assert it.
// ============================================================

import type { BuiltPlan } from '../config/plan';
import type { GlobalState, ProposedDay, RunState } from './types';
import { flareActive, painFreeStreak } from './metrics';
import { SPEED_TYPES, typeStatus } from './speed';
import { TUNABLES } from '../config/tunables';

export interface TodaySpeedRow {
  name: string;
  detail: string;
  dose: 'none' | 'low';
  optional: boolean;   // renders the OPTIONAL tag
}

// Design copy per low-dose rung.
const DETAIL: Record<string, string> = {
  buildups: 'End the run with 4–6 relaxed buildups to ~80%.',
  shortStrides: 'After the run — 4 × 10s on flat grass, full recovery.',
  flatStrides: 'After the run — 6 × 20s at mile-race feel, full recovery.',
};

function acceptedDay(acceptedWeeks: GlobalState['acceptedWeeks'], date: string): ProposedDay | null {
  for (const days of Object.values(acceptedWeeks ?? {})) {
    for (const d of days) if (d.date === date) return d;
  }
  return null;
}

interface DayType { isRun: boolean; isLong: boolean; isThreshold: boolean }

function todayDayType(plan: BuiltPlan, acceptedWeeks: GlobalState['acceptedWeeks'], today: string): DayType {
  // Confirmed generated weeks take precedence over the static/settings plan.
  const acc = acceptedDay(acceptedWeeks, today);
  if (acc) {
    return { isRun: acc.kind !== 'rest', isLong: acc.kind === 'long', isThreshold: acc.kind === 'threshold' };
  }
  const d = plan.dateToDay.get(today);
  if (d && d.type === 'run') return { isRun: true, isLong: d.isLongRun, isThreshold: false };
  return { isRun: false, isLong: false, isThreshold: false };
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

  // Flare / deload suppresses everything (no row).
  if (globals.speedState === 8 || flareActive(runState, today, globals.painCap)) return null;

  // Long-run day: purely easy, explicit message (distinct from "no row").
  if (dt.isLong) {
    return { name: 'No strides today', detail: 'Long-run day stays purely easy.', dose: 'none', optional: false };
  }

  // A threshold day already IS the speed session — no add-on.
  if (dt.isThreshold) return null;

  // Speed delayed → hold, no add-on.
  if (globals.delayUntil && globals.delayUntil > today) return null;

  // Most-advanced unlocked LOW-DOSE add-on (buildups → short → flat strides).
  const allowedLow = SPEED_TYPES.filter(t => t.lowDose && typeStatus(t, globals, today) === 'allowed');
  let pick = allowedLow[allowedLow.length - 1];
  if (!pick) return null;

  // Strides need a live pain-free streak ≥ 3 (mirror the generator); if it has
  // slipped, fall back to buildups.
  const isStride = pick.key === 'shortStrides' || pick.key === 'flatStrides';
  if (isStride && painFreeStreak(runState, globals.painCap) < TUNABLES.STRIDES_MIN_STATE) {
    const bu = allowedLow.find(t => t.key === 'buildups');
    if (!bu) return null;
    pick = bu;
  }

  return {
    name: pick.name,
    detail: DETAIL[pick.key] ?? pick.plain,
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
  if (globals.speedState === 8 || flareActive(runState, today, globals.painCap)) reasons.push('flare / deload');
  if (dt.isLong) reasons.push('long-run day stays easy');
  if (dt.isThreshold) reasons.push('threshold day is the speed session');
  if (globals.delayUntil && globals.delayUntil > today) reasons.push('speed delayed');
  return reasons;
}
