// ============================================================
// INDIVIDUAL ADAPTIVE ENGINE — personalized conservatism.
//
// Reads how THIS runner has actually responded (flare history, how fast pain
// settles overnight, recent adherence, clean-week streak) and tunes the RATE
// of progression to the individual. The one hard rule:
//
//   Adaptation can only make the plan MORE conservative, never less.
//
// So `growthFactor` is clamped to [0.4, 1.0] and only ever SCALES DOWN the
// weekly-volume build increment; a fragile responder builds slower and takes
// down weeks more often, while the most robust responder gets the normal
// population-capped rate (factor 1.0) and no faster. The population safety
// floors are untouched: the 110% single-run cap, the HR ceiling, the pain
// gate, and the speed ladder all stay exactly as they were.
//
// Evidence anchoring:
//  • Prior injury is among the strongest predictors of future injury
//    (Kliethermes/Joachim et al., JOSPT 2024) → recent flares tighten the build.
//  • Loading pain that does not settle by next morning, or rises week to week,
//    signals reactivity (Silbernagel 2007) → slow settlers progress slower.
//  • Never make up missed volume (already core) → low adherence rebuilds gently.
//  • The acute:chronic / weekly-% ratios do NOT predict running injury
//    (Frandsen 2025) → deliberately NOT used here.
// ============================================================

import type { GlobalState, RawSettings, RunState } from './types';
import { TUNABLES } from '../config/tunables';
import {
  addDaysStr, mondayOf, painBreachDates, weeklyActuals,
} from './metrics';

export type AdaptiveReadiness = 'building' | 'steady' | 'cautious' | 'hold';

export interface AdaptiveProfile {
  // ── observed signals (individual response) ──
  breachDays90: number;            // pain-cap breach days in the last 90 days
  lastBreachDaysAgo: number | null;
  unsettledRate: number;           // fraction of pain days that didn't settle by morning
  cleanWeeks: number;              // consecutive recent completed weeks with no breach
  adherence: number;               // 0..1, recent completion vs a modest baseline
  // ── derived modulation (safety-subordinate; only tightens) ──
  growthFactor: number;            // 0.4..1.0 multiplier on the build increment
  downEvery: number;               // suggested down-week cadence (≤ the setting)
  readiness: AdaptiveReadiness;
  headline: string;
  reasons: string[];
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Build the individual response profile from the log. Pure and read-only.
 */
export function computeAdaptiveProfile(
  runState: RunState,
  globals: GlobalState,
  today: string,
  settings: RawSettings | null = null,
): AdaptiveProfile {
  const painCap = globals.painCap;
  const from90 = addDaysStr(today, -90);
  const from14 = addDaysStr(today, -14);

  // 1. Flare / breach history (recency + count) over 90 days.
  const breaches = painBreachDates(runState, painCap).filter(d => d > from90 && d <= today);
  const breachDays90 = breaches.length;
  const lastBreach = breaches.length ? breaches[breaches.length - 1] : null;
  const lastBreachDaysAgo = lastBreach
    ? Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(lastBreach + 'T12:00:00Z')) / 86_400_000)
    : null;

  // 2. How fast does pain settle overnight? (Silbernagel signal.)
  let painDays = 0;
  let unsettled = 0;
  for (const e of Object.values(runState)) {
    if (e.date <= from90 || e.date > today) continue;
    if ((e.painDuring ?? 0) > 0) {
      painDays++;
      if (e.painNextAM != null && e.painNextAM > (e.painDuring ?? 0)) unsettled++;
    }
  }
  const unsettledRate = painDays > 0 ? unsettled / painDays : 0;

  // 3. Consecutive clean completed weeks (no breach, some running), newest
  //    first. Weeks that predate pain tracking don't count — we can't call an
  //    un-tracked week "clean".
  const since = globals.painTrackingSince;
  const breachSet = new Set(painBreachDates(runState, painCap));
  const weeks = weeklyActuals(runState, today).filter(
    w => w.weekStart < mondayOf(today) && (!since || w.weekStart >= since),
  );
  let cleanWeeks = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    const w = weeks[i];
    const weekEnd = addDaysStr(w.weekStart, 6);
    const hadBreach = [...breachSet].some(d => d >= w.weekStart && d <= weekEnd);
    if (w.runCount > 0 && !hadBreach) cleanWeeks++;
    else break;
  }

  // 4. Recent adherence: completed run-days in the last 14 days vs a modest
  //    baseline of two weeks at the configured days/week.
  const daysPerWeek = settings ? clamp(Math.round(settings.daysPerWeek), 3, 6) : 5;
  let completed14 = 0;
  for (const e of Object.values(runState)) {
    if (e.date <= from14 || e.date > today) continue;
    if (e.done || e.miles_actual != null) completed14++;
  }
  const adherence = clamp(completed14 / (2 * daysPerWeek), 0, 1);

  // ── Modulation (downward-only) ──
  let f = 1.0;
  const reasons: string[] = [];
  if (lastBreachDaysAgo != null && lastBreachDaysAgo <= 14) {
    f *= 0.5;
    reasons.push('A pain day in the last two weeks. Easing the build while it settles.');
  }
  if (breachDays90 >= 3) {
    f *= 0.7;
    reasons.push('Several pain days lately. Progressing more cautiously.');
  } else if (breachDays90 >= 1) {
    f *= 0.85;
  }
  if (unsettledRate > 0.3) {
    f *= 0.8;
    reasons.push('Pain has been slow to settle overnight. Slower steps for now.');
  }
  if (adherence < 0.7) {
    f *= 0.85;
    reasons.push('Some recent training gaps. Rebuilding gradually, not making up miles.');
  }
  const growthFactor = clamp(f, 0.4, 1.0);

  // More frequent down weeks for a fragile responder (never LESS frequent).
  const baseDownEvery = settings ? clamp(Math.round(settings.downEvery), 3, 6) : TUNABLES.DOWN_WEEK_AFTER_BUILDS;
  const downEvery = breachDays90 >= 2 ? Math.min(baseDownEvery, 3) : baseDownEvery;

  const readiness: AdaptiveReadiness =
    growthFactor >= 0.95 ? 'building'
    : growthFactor >= 0.75 ? 'steady'
    : growthFactor >= 0.55 ? 'cautious'
    : 'hold';

  if (growthFactor >= 0.95) {
    reasons.push(cleanWeeks >= 3
      ? `${cleanWeeks} clean weeks. Building at the full safe rate.`
      : 'Building at the full safe rate.');
  }

  const headline =
    readiness === 'building' ? 'Building at the full safe rate'
    : readiness === 'steady' ? 'Building steadily, slightly eased'
    : readiness === 'cautious' ? 'Easing the build to protect the hip'
    : 'Holding the build until things settle';

  return {
    breachDays90, lastBreachDaysAgo, unsettledRate, cleanWeeks, adherence,
    growthFactor, downEvery, readiness, headline, reasons,
  };
}

/** The modulation the generator consumes. Absent = population rate (factor 1). */
export interface AdaptiveModulation {
  growthFactor: number;   // ≤ 1, tightens the weekly build increment only
  downEvery: number;      // down-week cadence
}

export function toModulation(p: AdaptiveProfile): AdaptiveModulation {
  return { growthFactor: p.growthFactor, downEvery: p.downEvery };
}
