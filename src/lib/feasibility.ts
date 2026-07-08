// ============================================================
// PEAK FEASIBILITY — a read-only DIAGNOSTIC layer (no engine change).
//
// Answers: "can peakMpw be safely reached before the maintenance/XC phase
// begins (xcStartDate)?" It NEVER changes the plan — the engine keeps building
// per stepWeek within its safety caps. This just tells the UI whether the target
// is reachable, what the safe reachable peak is, why not, and how to fix it.
//
// The safe reachable peak is the most a plan could reach while obeying EVERY
// safety rule: the +10%/wk weekly-growth cap, scheduled down weeks, the
// long-run ladder (≤110%/step), and the distribution ceiling (no easy day above
// the long run, so a week can hold at most daysPerWeek × longRun). The boundary
// is xcStartDate — a real training phase, NOT weeksShown — so the display window
// never affects feasibility.
// ============================================================

import type { EffectiveSettings } from './settings';
import { buildWeekConfigsFromSettings } from './settings';
import { TUNABLES } from '../config/tunables';
import { addDaysStr, nextLongFrom, floorToHalf } from './metrics';

export type PeakLimiter = 'none' | 'time' | 'distribution' | 'buildstep';

export interface PeakFeasibility {
  hasBoundary: boolean;      // is there an XC/maintenance boundary at all?
  feasible: boolean;         // is the target safely reachable before the boundary?
  delivering: boolean;       // does the CURRENT plan actually reach it before the boundary?
  targetPeak: number;
  reachedByPlan: number;     // current settings ramp's highest week before the boundary
  maxSafeReachable: number;  // the most any safe ramp reaches before the boundary
  boundaryDate: string | null;
  buildWeeks: number;        // build weeks available before the boundary
  limiter: PeakLimiter;
  reasons: string[];
  suggestions: string[];
}

function normDownEvery(d: number): number {
  return Math.max(2, Math.round(d));
}
function roundHalf(x: number): number {
  return Math.round(x / TUNABLES.HALF_STEP) * TUNABLES.HALF_STEP;
}

/**
 * Assess whether eff.peakMpw is safely reachable before eff.xcStartDate.
 * Pure — reads only settings, mutates nothing.
 */
export function assessPeakFeasibility(eff: EffectiveSettings): PeakFeasibility {
  const target = eff.peakMpw;
  const days = Math.round(Math.min(6, Math.max(3, eff.daysPerWeek)));
  const downEvery = normDownEvery(eff.downEvery);
  const boundary = eff.xcStartDate || null;

  // No maintenance boundary → the rolling plan will reach the peak eventually.
  if (!boundary || boundary <= eff.startDate) {
    return {
      hasBoundary: false, feasible: true, delivering: true, targetPeak: target,
      reachedByPlan: target, maxSafeReachable: target, boundaryDate: boundary,
      buildWeeks: Infinity, limiter: 'none', reasons: [], suggestions: [],
    };
  }

  // Build weeks available before the boundary (weekStart < xcStartDate). Capped
  // at 60 so a far-off boundary can't loop forever (60 weeks is plenty to peak).
  let buildWeeks = 0;
  for (let i = 0; i < 60; i++) {
    if (addDaysStr(eff.startDate, i * 7) < boundary) buildWeeks++;
    else break;
  }

  // ── Max-safe ramp: climb at the +10%/wk cap, dip on the down-week cadence,
  //    ladder the long run (capped at the peak), and never let a week's total
  //    exceed daysPerWeek × longRun (the distribution ceiling). ──
  let total = eff.startMpw;
  let traj = eff.startMpw;
  let long = eff.trailingLongest;
  let maxSafe = total;
  let finalDistBound = false;
  for (let i = 1; i < buildWeeks; i++) {
    const isDown = (i + 1) % downEvery === 0;
    if (isDown) {
      total = traj * (1 - TUNABLES.SCHEDULED_DOWN_CUT); // dip off the trajectory; long held
    } else {
      long = Math.min(nextLongFrom(long), floorToHalf(target));
      const growthCap = traj * TUNABLES.WEEKLY_GROWTH_MAX;
      const distCap = days * long;
      total = Math.min(growthCap, distCap);
      finalDistBound = distCap < growthCap - 1e-9; // which cap bound the newest build week?
      traj = total;
    }
    maxSafe = Math.max(maxSafe, total);
  }
  const maxSafeReachable = roundHalf(maxSafe);

  // ── What the CURRENT settings ramp actually reaches before the boundary. ──
  const cfgs = buildWeekConfigsFromSettings(eff, Math.max(1, buildWeeks));
  const reachedByPlan = roundHalf(Math.max(...cfgs.map(c => c.miles.reduce((a, b) => a + b, 0))));

  const feasible = maxSafeReachable >= target - 0.5;
  const delivering = reachedByPlan >= target - 0.5;

  const reasons: string[] = [];
  const suggestions: string[] = [];
  let limiter: PeakLimiter = 'none';

  if (!feasible) {
    if (finalDistBound) {
      limiter = 'distribution';
      reasons.push(
        `With ${days} run days and a ~${long.toFixed(1)} mi long run, one week can safely hold at most ~${Math.round(days * long)} mi — below your ${target} mi peak (no easy day may exceed the long run).`,
      );
      suggestions.push('Add a run day — more days let a week hold more miles.');
      suggestions.push('Start with a longer long run, or give the long-run ladder more weeks before XC.');
    } else {
      limiter = 'time';
      reasons.push(
        `Even at the +${Math.round((TUNABLES.WEEKLY_GROWTH_MAX - 1) * 100)}%/week safety limit, ${buildWeeks} build weeks before ${boundary} only reach ~${maxSafeReachable} mi.`,
      );
      suggestions.push('Move your XC start date later to add build weeks.');
      suggestions.push(`Lower the peak toward ~${maxSafeReachable} mi (the safe max before XC).`);
    }
    suggestions.push('Raise the minimum build step (still capped by weekly safety).');
  } else if (!delivering) {
    limiter = 'buildstep';
    reasons.push(
      `${target} mi is safely reachable, but your current build only reaches ~${reachedByPlan} mi before ${boundary}.`,
    );
    suggestions.push('Raise the minimum build step to climb toward the peak sooner.');
  }

  return {
    hasBoundary: true, feasible, delivering, targetPeak: target,
    reachedByPlan, maxSafeReachable, boundaryDate: boundary, buildWeeks,
    limiter, reasons, suggestions,
  };
}
