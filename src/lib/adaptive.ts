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

import type { GlobalState, RawSettings, RunEntry, RunState } from './types';
import { TUNABLES } from '../config/tunables';
import {
  addDaysStr, mondayOf, painBreachDates, weeklyActuals,
} from './metrics';

export type AdaptiveReadiness = 'building' | 'steady' | 'cautious' | 'hold';

// ============================================================
// PHASE 2A — body-response signal detectors (pure, testable).
//
// Each returns a small structured verdict. The one-way rule holds: every signal
// can only push the plan to HOLD / REDUCE / DELOAD. Sparse or missing data
// yields 'insufficient' and does nothing — the engine never guesses. Thresholds
// live in TUNABLES.ADAPTIVE, never inline.
// ============================================================

export type TrendStatus = 'insufficient' | 'stable' | 'rising';

export interface RpeTrend {
  status: TrendStatus;
  samples: number;   // comparable easy runs considered
  olderMean: number;
  recentMean: number;
  delta: number;     // recentMean − olderMean (positive = getting harder)
}

/** Mean of a numeric field over entries (callers guarantee the field is set). */
function meanBy(xs: RunEntry[], pick: (e: RunEntry) => number): number {
  return xs.reduce((s, e) => s + pick(e), 0) / xs.length;
}

/** Split ascending series at floor(n/2): older half then recent half. */
function splitHalves<T>(xs: T[]): { older: T[]; recent: T[] } {
  const half = Math.floor(xs.length / 2);
  return { older: xs.slice(0, half), recent: xs.slice(half) };
}

/**
 * Easy/base-run RPE fatigue trend. Considers only logged runs whose RPE is
 * recorded and ≤ RPE_EASY_MAX — an RPE 8–10 session is an intentional hard
 * effort / race and is excluded so a planned workout can't read as easy-run
 * fatigue. Needs RPE_MIN_SAMPLES comparable runs before it trusts a trend
 * (anti-overreaction to one bad run). Rising = the recent half feels ≥
 * RPE_RISE_MIN harder than the older half. Stable/improving → no action (this
 * phase never speeds the plan up on good signals).
 */
export function easyRunRpeTrend(runState: RunState, today: string): RpeTrend {
  const A = TUNABLES.ADAPTIVE;
  const from = addDaysStr(today, -A.RPE_WINDOW_DAYS);
  const easy = Object.values(runState)
    .filter(e => e.date > from && e.date <= today
      && e.rpe != null && Number.isFinite(e.rpe)
      && (e.rpe as number) > 0 && (e.rpe as number) <= A.RPE_EASY_MAX)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const samples = easy.length;
  if (samples < A.RPE_MIN_SAMPLES) {
    return { status: 'insufficient', samples, olderMean: 0, recentMean: 0, delta: 0 };
  }
  const { older, recent } = splitHalves(easy);
  const olderMean = meanBy(older, e => e.rpe as number);
  const recentMean = meanBy(recent, e => e.rpe as number);
  const delta = recentMean - olderMean;
  return { status: delta >= A.RPE_RISE_MIN ? 'rising' : 'stable', samples, olderMean, recentMean, delta };
}

export interface PainDrift {
  status: TrendStatus;
  samples: number;   // sub-threshold next-AM readings considered
  olderMean: number;
  recentMean: number;
  delta: number;
}

/**
 * Sub-threshold next-morning pain DRIFT (e.g. 0 → 1 → 2 while still at/below the
 * hard pain cap). Milder than a real breach, and deliberately weaker than the
 * flare/breach layer, which handles anything ABOVE the cap. Only next-AM values
 * that are recorded AND ≤ painCap are considered — a MISSING painNextAM is
 * UNKNOWN and is skipped, never counted as 0. Needs PAIN_DRIFT_MIN_SAMPLES
 * readings; rising = recent half ≥ PAIN_DRIFT_RISE_MIN above the older half.
 */
export function painDriftSignal(runState: RunState, today: string, painCap: number): PainDrift {
  const A = TUNABLES.ADAPTIVE;
  const from = addDaysStr(today, -A.PAIN_DRIFT_WINDOW_DAYS);
  const pts = Object.values(runState)
    .filter(e => e.date > from && e.date <= today
      && e.painNextAM != null && Number.isFinite(e.painNextAM)
      && (e.painNextAM as number) >= 0 && (e.painNextAM as number) <= painCap)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const samples = pts.length;
  if (samples < A.PAIN_DRIFT_MIN_SAMPLES) {
    return { status: 'insufficient', samples, olderMean: 0, recentMean: 0, delta: 0 };
  }
  const { older, recent } = splitHalves(pts);
  const olderMean = meanBy(older, e => e.painNextAM as number);
  const recentMean = meanBy(recent, e => e.painNextAM as number);
  const delta = recentMean - olderMean;
  return { status: delta >= A.PAIN_DRIFT_RISE_MIN ? 'rising' : 'stable', samples, olderMean, recentMean, delta };
}

export interface LongRunReadiness {
  status: 'ok' | 'hold' | 'insufficient';
  reason: string | null;
  lastLongDate: string | null;
}

/**
 * Long-run readiness gate. Looks at the most recent long run (the longest logged
 * run inside LR_LOOKBACK_DAYS; ties → most recent) and how it FELT. High RPE,
 * pain during, or elevated next-morning pain → 'hold' (don't step the long-run
 * ladder up this cycle; weekly mileage may still progress modestly). These
 * thresholds sit below the pain cap on purpose — a long run can go badly without
 * breaching. A long run with no readiness data logged → 'insufficient' (a
 * missing signal is not a bad signal; the plan continues at the normal ladder).
 * It NEVER returns anything that raises the long run — good signals only let the
 * existing ≤110% ladder proceed.
 */
export function longRunReadiness(runState: RunState, today: string): LongRunReadiness {
  const A = TUNABLES.ADAPTIVE;
  const from = addDaysStr(today, -A.LR_LOOKBACK_DAYS);
  const recent = Object.values(runState).filter(
    e => e.date > from && e.date <= today && e.miles_actual != null,
  );
  if (recent.length === 0) return { status: 'insufficient', reason: null, lastLongDate: null };

  let lr = recent[0];
  for (const e of recent) {
    const m = e.miles_actual as number, best = lr.miles_actual as number;
    if (m > best || (m === best && e.date > lr.date)) lr = e;
  }

  const hasData = lr.rpe != null || lr.painDuring != null || lr.painNextAM != null;
  if (!hasData) return { status: 'insufficient', reason: null, lastLongDate: lr.date };

  const highRpe = lr.rpe != null && lr.rpe >= A.LR_RPE_HIGH;
  const highDuring = lr.painDuring != null && lr.painDuring >= A.LR_PAIN_DURING_HIGH;
  const highNextAM = lr.painNextAM != null && lr.painNextAM >= A.LR_PAIN_NEXTAM_HIGH;
  if (highRpe || highDuring || highNextAM) {
    const why = highRpe
      ? 'the last long run had high RPE'
      : highDuring
        ? 'the last long run had elevated pain'
        : 'next-morning soreness after the last long run was elevated';
    return {
      status: 'hold',
      reason: `Holding the long run — ${why}. It stays put until the next one goes smoothly.`,
      lastLongDate: lr.date,
    };
  }
  return { status: 'ok', reason: null, lastLongDate: lr.date };
}

export interface AdaptiveProfile {
  // ── observed signals (individual response) ──
  breachDays90: number;            // pain-cap breach days in the last 90 days
  lastBreachDaysAgo: number | null;
  unsettledRate: number;           // fraction of pain days that didn't settle by morning
  cleanWeeks: number;              // consecutive recent completed weeks with no breach
  adherence: number;               // 0..1, recent completion vs a modest baseline
  // ── Phase 2A body-response signals (observed; each only ever tightens) ──
  rpeTrend: RpeTrend;              // easy/base-run RPE fatigue trend
  painDrift: PainDrift;            // sub-threshold next-AM pain drift
  longRun: LongRunReadiness;       // how the last long run felt
  // ── derived modulation (safety-subordinate; only tightens) ──
  growthFactor: number;            // 0.4..1.0 multiplier on the build increment
  downEvery: number;               // suggested down-week cadence (≤ the setting)
  holdLong: boolean;               // hold the long-run ladder this cycle (readiness gate)
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

  // ── Phase 2A body-response signals (each can only tighten) ──
  // 1. Easy-run RPE trending up → the base is feeling harder → ease the build.
  const rpeTrend = easyRunRpeTrend(runState, today);
  if (rpeTrend.status === 'rising') {
    f *= TUNABLES.ADAPTIVE.RPE_EASE;
    reasons.push('Recent easy runs have felt harder (RPE trending up). Easing the build.');
  }
  // 2. Sub-threshold next-morning pain creeping up (still below the cap) →
  //    shallow hold before it becomes a flare. Weaker than a real breach above.
  const painDrift = painDriftSignal(runState, today, painCap);
  if (painDrift.status === 'rising') {
    f *= TUNABLES.ADAPTIVE.PAIN_DRIFT_EASE;
    reasons.push('Next-morning soreness has crept up over recent runs (still below your pain cap). Holding back the build.');
  }
  // 3. Long-run readiness gate — how the last long run felt (session-specific).
  const longRun = longRunReadiness(runState, today);
  const holdLong = longRun.status === 'hold';
  if (holdLong && longRun.reason) reasons.push(longRun.reason);

  const growthFactor = clamp(f, 0.4, 1.0);

  // More frequent down weeks for a fragile responder (never LESS frequent). Pain
  // drift also tightens the absorption cadence — a shallow deload before a flare.
  const baseDownEvery = settings ? clamp(Math.round(settings.downEvery), 3, 6) : TUNABLES.DOWN_WEEK_AFTER_BUILDS;
  let downEvery = breachDays90 >= 2 ? Math.min(baseDownEvery, 3) : baseDownEvery;
  if (painDrift.status === 'rising') downEvery = Math.min(downEvery, TUNABLES.ADAPTIVE.PAIN_DRIFT_DOWNEVERY);

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
    rpeTrend, painDrift, longRun,
    growthFactor, downEvery, holdLong, readiness, headline, reasons,
  };
}

/** The modulation the plan engine consumes. Absent = population rate (factor 1).
 *  Every field can only tighten: growthFactor ≤ 1, downEvery may only shorten the
 *  cadence, holdLong only freezes the long-run ladder — none can loosen a cap. */
export interface AdaptiveModulation {
  growthFactor: number;   // ≤ 1, tightens the weekly build increment only
  downEvery: number;      // down-week cadence (min with the setting)
  /** Hold the long-run ladder this cycle (long-run readiness gate). Optional so
   *  an omitted/false value is exact identity — the long run ladders normally. */
  holdLong?: boolean;
}

export function toModulation(p: AdaptiveProfile): AdaptiveModulation {
  return { growthFactor: p.growthFactor, downEvery: p.downEvery, holdLong: p.holdLong };
}
