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
//
// It also probes ROUTES: if the target is out of reach with the current run
// days, it tests whether adding a run day (a higher distribution ceiling) would
// help — because miles spread over more runs mean less per-run/long-run
// pressure. It suggests this, but never applies it: changing days stays the
// user's choice.
// ============================================================

import type { EffectiveSettings } from './settings';
import { buildWeekConfigsFromSettings } from './settings';
import { TUNABLES } from '../config/tunables';
import { addDaysStr, nextLongFrom, floorToHalf } from './metrics';

export type PeakLimiter = 'none' | 'time' | 'distribution' | 'buildstep';

/** A suggested route: how many run days it would take, and what it would buy. */
export interface DaysRoute {
  toDays: number;       // the run-days/week to try (current + 1)
  reachable: number;    // safe reachable peak at that many days
  feasible: boolean;    // would the target become reachable?
}

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
  daysRoute: DaysRoute | null; // adding a run day would help (null if it wouldn't / n/a)
  reasons: string[];
  suggestions: string[];
}

function normDownEvery(d: number): number {
  return Math.max(2, Math.round(d));
}
function roundHalf(x: number): number {
  return Math.round(x / TUNABLES.HALF_STEP) * TUNABLES.HALF_STEP;
}
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * The most a plan can safely reach in `buildWeeks` weeks with `days` run days,
 * climbing at the +10%/wk cap, dipping on the down-week cadence, laddering the
 * long run (capped at the peak), and never letting a week exceed days × longRun.
 * Returns the reachable total and whether the DISTRIBUTION ceiling (days × long)
 * was the binding constraint on the final build week.
 */
function simMaxSafe(
  startMpw: number, days: number, downEvery: number,
  trailingLongest: number, targetPeak: number, buildWeeks: number,
): { reachable: number; distBoundAtEnd: boolean } {
  const cap = floorToHalf(targetPeak);
  // W1 (engine index 0) already ladders the long one step off the seed, so mirror
  // that here — otherwise the distribution ceiling (days × long) reads one step
  // low and a reachable peak looks infeasible.
  let long = Math.min(nextLongFrom(trailingLongest), cap);
  let total = startMpw;
  let traj = startMpw;
  let maxSafe = total;
  let distBoundAtEnd = false;
  for (let i = 1; i < buildWeeks; i++) {
    const isDown = (i + 1) % downEvery === 0;
    if (isDown) {
      total = traj * (1 - TUNABLES.SCHEDULED_DOWN_CUT); // dip off the trajectory; long held
    } else {
      long = Math.min(nextLongFrom(long), cap);
      const growthCap = traj * TUNABLES.WEEKLY_GROWTH_MAX;
      const distCap = days * long;
      total = Math.min(growthCap, distCap);
      distBoundAtEnd = distCap < growthCap - 1e-9;
      traj = total;
    }
    maxSafe = Math.max(maxSafe, total);
  }
  return { reachable: maxSafe, distBoundAtEnd };
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
      buildWeeks: Infinity, limiter: 'none', daysRoute: null, reasons: [], suggestions: [],
    };
  }

  // Build weeks available before the boundary (weekStart < xcStartDate). Capped
  // at 60 so a far-off boundary can't loop forever (60 weeks is plenty to peak).
  let buildWeeks = 0;
  for (let i = 0; i < 60; i++) {
    if (addDaysStr(eff.startDate, i * 7) < boundary) buildWeeks++;
    else break;
  }

  // Max-safe ramp with the CURRENT run days.
  const cur = simMaxSafe(eff.startMpw, days, downEvery, eff.trailingLongest, target, buildWeeks);
  const maxSafeReachable = roundHalf(cur.reachable);

  // What the CURRENT settings ramp actually reaches before the boundary.
  const cfgs = buildWeekConfigsFromSettings(eff, Math.max(1, buildWeeks));
  const reachedByPlan = roundHalf(Math.max(...cfgs.map(c => c.miles.reduce((a, b) => a + b, 0))));

  const feasible = maxSafeReachable >= target - 0.5;
  const delivering = reachedByPlan >= target - 0.5;

  // ── ROUTE: would ONE more run day help? Test days+1 (higher distribution
  //    ceiling). It only helps when distribution — not weekly growth or weeks —
  //    is the limiter, so this is an honest probe, not a blanket "add days". ──
  let daysRoute: DaysRoute | null = null;
  if (!feasible && days < 6) {
    const alt = simMaxSafe(eff.startMpw, days + 1, downEvery, eff.trailingLongest, target, buildWeeks);
    const altReachable = roundHalf(alt.reachable);
    const altFeasible = altReachable >= target - 0.5;
    if (altFeasible || altReachable > maxSafeReachable + 0.4) {
      daysRoute = { toDays: days + 1, reachable: altReachable, feasible: altFeasible };
    }
  }

  const reasons: string[] = [];
  const suggestions: string[] = [];
  let limiter: PeakLimiter = 'none';

  if (!feasible) {
    const distributionLimited = cur.distBoundAtEnd || !!daysRoute;
    if (distributionLimited) {
      limiter = 'distribution';
      reasons.push(
        `With ${days} run days, ${target} mi can't spread across the week without a run exceeding the long-run cap — the miles won't fit. Safe max at ${days} days is ~${maxSafeReachable} mi.`,
      );
      if (daysRoute) {
        suggestions.push(
          daysRoute.feasible
            ? `Add a ${ordinal(daysRoute.toDays)} easy day — spreading the load makes ${target} mi reachable.`
            : `Add a ${ordinal(daysRoute.toDays)} easy day — spreading the load raises the safe max to ~${daysRoute.reachable} mi.`,
        );
      } else {
        suggestions.push('Start with a longer long run, or give the long-run ladder more weeks before XC.');
      }
      suggestions.push('Or move the XC start date later / lower the peak.');
    } else {
      limiter = 'time';
      reasons.push(
        `Even at the +${Math.round((TUNABLES.WEEKLY_GROWTH_MAX - 1) * 100)}%/week safety limit, ${buildWeeks} build weeks before ${boundary} only reach ~${maxSafeReachable} mi.`,
      );
      if (days < 6) reasons.push("More run days won't raise this — the limit is available weeks, not distribution.");
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
    limiter, daysRoute, reasons, suggestions,
  };
}
