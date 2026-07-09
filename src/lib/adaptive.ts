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

import type { GlobalState, RawSettings, RunEntry, RunState, WeeklyCheckin } from './types';
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

// ============================================================
// PHASE 2B — weekly check-in recovery signal (pure, testable).
//
// Folds the weekly check-in (sleep / soreness / energy / stress, each 1–5) into
// a single deterministic recovery status. Same one-way contract as every other
// adaptive signal: it can only HOLD / REDUCE / DELOAD. A good week never speeds
// the plan up. Missing check-ins — and missing / out-of-range fields inside a
// check-in — are UNKNOWN: skipped, never read as good, bad, or zero. Thresholds
// live in TUNABLES.ADAPTIVE.RECOVERY. No ML, no scoring — just named counts.
// ============================================================

export type RecoveryStatus = 'insufficient' | 'normal' | 'caution' | 'poor';

/** Which fields in a check-in were in their "bad" range (present + out-of-bounds).
 *  A missing/unknown field is never flagged — it stays false. */
export interface RecoveryFlags {
  sleepLow: boolean;
  energyLow: boolean;
  sorenessHigh: boolean;
  stressHigh: boolean;
}

export interface RecoverySignal {
  status: RecoveryStatus;
  weeksConsidered: number;      // recent check-ins with at least one readable field
  cautionWeeks: number;         // recent weeks classified caution or poor
  repeated: boolean;            // cautionWeeks ≥ REPEAT_MIN (drives the shallow deload)
  latestFlags: RecoveryFlags | null; // bad fields in the most recent readable check-in
}

/** A 1–5 rating, or null when the value is missing / not a finite 1–5 number.
 *  0, undefined, NaN and out-of-range are all UNKNOWN — never a valid rating. */
function rating(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) && x >= 1 && x <= 5 ? x : null;
}

interface CheckinClass {
  flags: RecoveryFlags;
  count: number;        // caution flags present
  extremeCount: number; // fields at the very-worst end
  status: 'normal' | 'note' | 'caution' | 'poor';
}

/** Classify ONE check-in. Returns null when no field is readable (all unknown) —
 *  such a check-in is treated exactly like a missing one. */
function classifyCheckin(c: WeeklyCheckin): CheckinClass | null {
  const R = TUNABLES.ADAPTIVE.RECOVERY;
  const sleep = rating(c.sleep), energy = rating(c.energy);
  const soreness = rating(c.soreness), stress = rating(c.stress);
  if (sleep == null && energy == null && soreness == null && stress == null) return null;

  const sleepLow = sleep != null && sleep <= R.SLEEP_LOW;
  const energyLow = energy != null && energy <= R.ENERGY_LOW;
  const sorenessHigh = soreness != null && soreness >= R.SORENESS_HIGH;
  const stressHigh = stress != null && stress >= R.STRESS_HIGH;
  const flags: RecoveryFlags = { sleepLow, energyLow, sorenessHigh, stressHigh };
  const count = [sleepLow, energyLow, sorenessHigh, stressHigh].filter(Boolean).length;
  const extremeCount =
    (sleep != null && sleep <= R.SLEEP_MIN ? 1 : 0) +
    (energy != null && energy <= R.ENERGY_MIN ? 1 : 0) +
    (soreness != null && soreness >= R.SORENESS_MAX ? 1 : 0) +
    (stress != null && stress >= R.STRESS_MAX ? 1 : 0);

  let status: CheckinClass['status'];
  if (count >= R.POOR_MIN_FLAGS || extremeCount >= R.EXTREME_MIN_FLAGS) status = 'poor';
  else if (count >= R.CAUTION_MIN_FLAGS) status = 'caution';
  else if (count === 1) status = 'note';
  else status = 'normal';
  return { flags, count, extremeCount, status };
}

/**
 * Composite weekly recovery read over the recent check-in window. Driven by the
 * MOST RECENT readable check-in, with repetition ESCALATING the response (a
 * cautionary latest week becomes poor + a shallow deload when caution has
 * repeated across recent weeks). One mildly rough field (a single flag) is a
 * 'note' → no plan change. Two bad fields → caution. A genuinely extreme week,
 * ≥3 bad fields, or repeated caution → poor. Missing check-ins / windows with no
 * readable data → 'insufficient' → identity (the plan is untouched).
 */
export function weeklyRecoverySignal(
  checkins: Record<string, WeeklyCheckin> | undefined,
  today: string,
): RecoverySignal {
  const R = TUNABLES.ADAPTIVE.RECOVERY;
  const none: RecoverySignal = {
    status: 'insufficient', weeksConsidered: 0, cautionWeeks: 0, repeated: false, latestFlags: null,
  };
  if (!checkins) return none;

  const currentWeek = mondayOf(today);
  const earliest = addDaysStr(currentWeek, -(R.LOOKBACK_WEEKS - 1) * 7);
  const classified = Object.values(checkins)
    .filter(c => c.weekStart >= earliest && c.weekStart <= currentWeek)
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)) // newest first
    .map(c => classifyCheckin(c))
    .filter((k): k is CheckinClass => k != null);
  if (classified.length === 0) return none;

  const weeksConsidered = classified.length;
  const cautionWeeks = classified.filter(k => k.status === 'caution' || k.status === 'poor').length;
  const repeated = cautionWeeks >= R.REPEAT_MIN;
  const latest = classified[0]; // most recent readable check-in

  let status: RecoveryStatus;
  if (latest.status === 'poor') status = 'poor';
  else if (latest.status === 'caution') status = repeated ? 'poor' : 'caution';
  else status = 'normal'; // latest is note/normal → recovered; stale weeks alone don't ease

  return { status, weeksConsidered, cautionWeeks, repeated, latestFlags: latest.flags };
}

/** Human-readable list of the bad fields that drove a recovery adjustment. */
function recoveryFieldLabels(f: RecoveryFlags): string {
  const parts: string[] = [];
  if (f.sleepLow) parts.push('low sleep');
  if (f.energyLow) parts.push('low energy');
  if (f.sorenessHigh) parts.push('high soreness');
  if (f.stressHigh) parts.push('high life stress');
  if (parts.length === 0) return 'low recovery';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/** Plain-language reason for a recovery-driven adjustment (structured so the UI
 *  can show exactly why the plan changed). Never scary for a single soft week. */
function recoveryReason(kind: 'caution' | 'poor' | 'poor-repeated', sig: RecoverySignal): string {
  const labels = recoveryFieldLabels(sig.latestFlags ?? { sleepLow: false, energyLow: false, sorenessHigh: false, stressHigh: false });
  switch (kind) {
    case 'caution':
      return `This week's recovery check-in was cautionary (${labels}), so the plan is holding back the build a little instead of pushing it.`;
    case 'poor':
      return `Recovery was poor this week (${labels}). Holding the build while things recover.`;
    case 'poor-repeated':
      return `Recovery has stayed low across ${sig.cautionWeeks} recent check-ins (${labels}). Taking a shallow down week to absorb the load.`;
  }
}

// ============================================================
// PHASE 2C — earned-trust growth (the one and only UPWARD signal).
//
// Everything above this line can only HOLD / REDUCE / DELOAD. Earned-trust is
// the single exception: when recent training is provably clean it may widen the
// week-over-week VOLUME growth ceiling a little (default +10%/wk → up to the
// earned cap, hard-limited by HARD_CEILING). It never loosens a hard safety
// constraint — the long-run ladder, the pain gate, the peak ceiling and the
// completed-week lock are all untouched — and it is grounded ONLY in actual
// logged evidence:
//
//   • EARNED SLOWLY — needs MIN_CLEAN_WEEKS clean completed weeks, MIN_ADHERENCE
//     adherence, a present + non-rising easy-run RPE trend (enough samples), and
//     MIN_CHECKIN_WEEKS present + good weekly check-ins. Missing RPE or missing
//     check-ins are UNKNOWN: they neither grant nor block — they just leave the
//     plan on the default cap. Trust is never manufactured from absent data.
//   • REVOKED INSTANTLY — any single warning (break mode, a pain breach, rising
//     pain drift, rising RPE, a cautionary/poor check-in, a long-run-readiness
//     hold, or any downward modulation at all) disables it for that computation.
// ============================================================

/** Inputs the earned-trust decision reads. All are already-computed, observed
 *  signals — the detector adds no new data source, just a pure verdict. */
export interface EarnedTrustInput {
  onBreak: boolean;
  cleanWeeks: number;
  adherence: number;
  growthFactor: number;      // the post-caution factor (< 1 ⇒ some signal is easing)
  holdLong: boolean;
  breachDays90: number;
  unsettledRate: number;
  rpeTrend: RpeTrend;
  painDrift: PainDrift;
  recovery: RecoverySignal;
}

export interface EarnedTrust {
  active: boolean;
  /** The weekly-growth cap (multiplier) the plan may use. When INACTIVE this is
   *  exactly TUNABLES.WEEKLY_GROWTH_MAX, so nothing downstream changes; when
   *  active it is min(GROWTH_MAX, HARD_CEILING). */
  growthMax: number;
  cleanWeeks: number;
  adherence: number;
  /** The first active warning that disabled trust (revocation), else null. */
  blockedBy: string | null;
  /** Calm, non-reward explanation of the current state (active / paused / not
   *  yet earned) for the UI. */
  reason: string;
}

/**
 * Pure earned-trust verdict. Deterministic, no I/O, fully unit-testable.
 *
 * Order matters: VETOES are checked first so an active warning is reported as a
 * revocation ("paused because …"); only when nothing is wrong AND the concrete
 * positive evidence is all present does trust activate. Insufficient-but-clean
 * evidence reads as "not yet earned", never as a punishment.
 */
export function assessEarnedTrust(inp: EarnedTrustInput): EarnedTrust {
  const ET = TUNABLES.ADAPTIVE.EARNED_TRUST;
  const defaultMax = TUNABLES.WEEKLY_GROWTH_MAX;
  const defPct = Math.round((defaultMax - 1) * 100);
  const base = { growthMax: defaultMax, cleanWeeks: inp.cleanWeeks, adherence: inp.adherence };

  if (!ET.ENABLED) {
    return { active: false, ...base, blockedBy: null, reason: `Normal safety cap active (+${defPct}%/wk).` };
  }

  // ── Vetoes — ANY one instantly disables earned-trust (revoke instantly). ──
  // Ordered most-informative-first so the reported reason is the clearest one.
  const veto: string | null =
    inp.onBreak ? 'break mode is active'
    : inp.breachDays90 > 0 ? 'a recent pain-cap breach'
    : inp.unsettledRate > 0.3 ? 'recent pain has been slow to settle overnight'
    : inp.painDrift.status === 'rising' ? 'next-morning soreness is drifting up'
    : inp.rpeTrend.status === 'rising' ? 'easy-run RPE is trending up'
    : inp.recovery.status === 'poor' ? 'a poor recovery check-in'
    : inp.recovery.status === 'caution' ? 'a cautionary recovery check-in'
    : inp.holdLong ? 'the last long run needs another smooth week'
    // Backstop: any residual downward modulation (e.g. a lone breach in 90d that
    // only softly eased) still keeps the plan on the default cap.
    : inp.growthFactor < 1 - 1e-9 ? 'a caution signal is easing the build'
    : null;

  if (veto) {
    return {
      active: false, ...base, blockedBy: veto,
      reason: `Earned-trust paused: ${veto}. The build stays on the normal +${defPct}%/wk safety cap.`,
    };
  }

  // ── Positive evidence — every item must be PRESENT and clean. Missing RPE or
  //    missing check-ins fail these gates (unknown ≠ good), never grant trust. ──
  const enoughCleanWeeks = inp.cleanWeeks >= ET.MIN_CLEAN_WEEKS;
  const enoughAdherence = inp.adherence >= ET.MIN_ADHERENCE;
  const rpeConfirmed = inp.rpeTrend.status === 'stable'; // ⇒ ≥ RPE_MIN_SAMPLES samples, not rising
  const recoveryConfirmed =
    inp.recovery.status === 'normal'
    && inp.recovery.weeksConsidered >= ET.MIN_CHECKIN_WEEKS
    && inp.recovery.cautionWeeks === 0; // no caution/poor anywhere in the window
  const hasEvidence = enoughCleanWeeks && enoughAdherence && rpeConfirmed && recoveryConfirmed;

  if (!hasEvidence) {
    return {
      active: false, ...base, blockedBy: null,
      reason:
        `Normal safety cap active (+${defPct}%/wk). Earned-trust needs ${ET.MIN_CLEAN_WEEKS}+ clean weeks with `
        + `strong adherence, steady easy-run effort, and good recovery check-ins before the build widens.`,
    };
  }

  const growthMax = Math.min(ET.GROWTH_MAX, ET.HARD_CEILING);
  const pct = Math.round((growthMax - 1) * 100);
  return {
    active: true, ...base, growthMax, blockedBy: null,
    reason:
      `Earned-trust active: ${inp.cleanWeeks} clean weeks with strong adherence, steady easy-run effort, and good `
      + `recovery check-ins — the build may use a slightly wider +${pct}%/wk cap. Still capped by the long-run, pain, `
      + `recovery, and peak rules.`,
  };
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
  // ── Phase 2B weekly check-in recovery signal (observed; only ever tightens) ──
  recovery: RecoverySignal;        // composite sleep/soreness/energy/stress read
  // ── Phase 2C earned-trust (the only signal that may build FASTER) ──
  earnedTrust: EarnedTrust;        // clean-evidence verdict + the earned growth cap
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

  // ── Phase 2B — weekly check-in recovery signal (downward-only) ──
  // A cautionary week eases the build; a poor week holds it; repeated poor weeks
  // also tighten the absorption cadence (a shallow deload). Because f is a single
  // multiplicative factor, this compounds naturally with the RPE / pain-drift
  // signals above: two mild signals together ease more than either alone. It only
  // ever multiplies f DOWN, so it can never weaken the pain-breach response.
  const recovery = weeklyRecoverySignal(globals.checkins, today);
  if (recovery.status === 'caution') {
    f *= TUNABLES.ADAPTIVE.RECOVERY.CAUTION_EASE;
    reasons.push(recoveryReason('caution', recovery));
  } else if (recovery.status === 'poor') {
    f *= TUNABLES.ADAPTIVE.RECOVERY.POOR_EASE;
    reasons.push(recoveryReason(recovery.repeated ? 'poor-repeated' : 'poor', recovery));
  }
  // Name the stack when recovery is low AND a Phase 2A trend is also rising —
  // the eased factor already compounds; this line makes the "combined" reason
  // explicit (a real pain breach still outranks all of this, handled above).
  if ((recovery.status === 'caution' || recovery.status === 'poor')
    && (rpeTrend.status === 'rising' || painDrift.status === 'rising')) {
    const other = rpeTrend.status === 'rising' ? 'easy-run RPE is rising' : 'next-morning soreness is creeping up';
    reasons.push(`Recovery is low and ${other} — easing the build more than either signal would alone this week.`);
  }

  const growthFactor = clamp(f, 0.4, 1.0);

  // More frequent down weeks for a fragile responder (never LESS frequent). Pain
  // drift also tightens the absorption cadence — a shallow deload before a flare.
  const baseDownEvery = settings ? clamp(Math.round(settings.downEvery), 3, 6) : TUNABLES.DOWN_WEEK_AFTER_BUILDS;
  let downEvery = breachDays90 >= 2 ? Math.min(baseDownEvery, 3) : baseDownEvery;
  if (painDrift.status === 'rising') downEvery = Math.min(downEvery, TUNABLES.ADAPTIVE.PAIN_DRIFT_DOWNEVERY);
  // Repeated poor recovery earns a shallow deload — a more frequent absorption
  // week. Only ever SHORTENS the cadence (min), never loosens it.
  if (recovery.status === 'poor' && recovery.repeated) {
    downEvery = Math.min(downEvery, TUNABLES.ADAPTIVE.RECOVERY.POOR_DOWNEVERY);
  }

  // ── Phase 2C — earned-trust (the only UPWARD signal) ────────────────────────
  // Read from the SAME observed signals as everything above, plus break state.
  // It never touches growthFactor / downEvery / holdLong (those only tighten);
  // instead it may widen the weekly growth CEILING the plan builds under. Any
  // caution above (growthFactor < 1, holdLong) or a warning signal disables it,
  // so earned-trust and any easing are mutually exclusive by construction.
  const onBreak = !!globals.breakStart && globals.breakStart <= today;
  const earnedTrust = assessEarnedTrust({
    onBreak, cleanWeeks, adherence, growthFactor, holdLong,
    breachDays90, unsettledRate, rpeTrend, painDrift, recovery,
  });

  const readiness: AdaptiveReadiness =
    growthFactor >= 0.95 ? 'building'
    : growthFactor >= 0.75 ? 'steady'
    : growthFactor >= 0.55 ? 'cautious'
    : 'hold';

  if (earnedTrust.active) {
    reasons.push(earnedTrust.reason);
  } else if (growthFactor >= 0.95) {
    reasons.push(cleanWeeks >= 3
      ? `${cleanWeeks} clean weeks. Building at the full safe rate.`
      : 'Building at the full safe rate.');
  }

  const headline =
    earnedTrust.active ? 'Building at a slightly wider earned rate'
    : readiness === 'building' ? 'Building at the full safe rate'
    : readiness === 'steady' ? 'Building steadily, slightly eased'
    : readiness === 'cautious' ? 'Easing the build to protect the hip'
    : 'Holding the build until things settle';

  return {
    breachDays90, lastBreachDaysAgo, unsettledRate, cleanWeeks, adherence,
    rpeTrend, painDrift, longRun, recovery, earnedTrust,
    growthFactor, downEvery, holdLong, readiness, headline, reasons,
  };
}

/** The modulation the plan engine consumes. Absent = population rate (factor 1).
 *  The Phase 2A/2B fields can only tighten: growthFactor ≤ 1, downEvery may only
 *  shorten the cadence, holdLong only freezes the long-run ladder — none can
 *  loosen a cap. The Phase 2C `earnedGrowthMax` is the single field that may
 *  WIDEN one ceiling (the week-over-week volume growth cap) — and it is present
 *  ONLY when earned-trust is active, so an omitted value is exact Phase 2B
 *  identity (consumers fall back to TUNABLES.WEEKLY_GROWTH_MAX). It still never
 *  loosens the long-run cap, the peak ceiling, or the pain gate. */
export interface AdaptiveModulation {
  growthFactor: number;   // ≤ 1, tightens the weekly build increment only
  downEvery: number;      // down-week cadence (min with the setting)
  /** Hold the long-run ladder this cycle (long-run readiness gate). Optional so
   *  an omitted/false value is exact identity — the long run ladders normally. */
  holdLong?: boolean;
  /** Earned-trust weekly-growth cap (multiplier). Present ONLY when earned-trust
   *  is active; omitted otherwise so the default +10%/wk cap binds unchanged.
   *  Consumers MUST re-clamp it to EARNED_TRUST.HARD_CEILING defensively. */
  earnedGrowthMax?: number;
}

export function toModulation(p: AdaptiveProfile): AdaptiveModulation {
  const mod: AdaptiveModulation = {
    growthFactor: p.growthFactor, downEvery: p.downEvery, holdLong: p.holdLong,
  };
  // Emit earnedGrowthMax ONLY when earned-trust is active. Omitting it entirely
  // when inactive keeps the modulation byte-identical to Phase 2B (an absent key,
  // not an undefined one), so the default plan is provably unchanged.
  if (p.earnedTrust.active) mod.earnedGrowthMax = p.earnedTrust.growthMax;
  return mod;
}
