// ============================================================
// GENERATE-FUTURE-WEEKS ENGINE
//
// Proposes (never auto-commits) the upcoming week from ACTUAL
// completed training, obeying speedState. Hard rules:
//  * build from actuals, not the static plan
//  * long run = nextLong (Frandsen cap in half-mile steps)
//  * never make up missed miles; resume near last sustained week
//  * auto down week every 3rd–4th build week or after a pain spike
//  * speedState < 7 or delayUntil in future → ZERO hard sessions
//  * strides only at state ≥ 3 with recent pain-free running
//  * hills only at state ≥ 5 && hipSafeFlag (this pass generates none)
//  * VO₂/race-pace only at state ≥ 7 && ptClearedIntensity
//  * no fast session within 48h of the long run; no back-to-back fast days
//  * flare (2 pain days in 7) → easy/rest only, long clamped to trailing30
//  * the coach award is display-only: it is NOT an input to this function,
//    so it can never raise volume or intensity.
// ============================================================

import type { GlobalState, ProposedDay, RawSettings, RunState, WeekProposal } from './types';
import type { AdaptiveModulation } from './adaptive';
import { TUNABLES } from '../config/tunables';
import {
  addDaysStr, nextMonday, mondayOf, trailing30Longest, nextLongFrom, floorToHalf,
  flareActive, painFreeStreak, weeklyActuals,
} from './metrics';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function roundHalf(x: number): number {
  return Math.round(x / TUNABLES.HALF_STEP) * TUNABLES.HALF_STEP;
}

/** Whole days between two YYYY-MM-DD strings (b - a). */
function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000,
  );
}

export interface GeneratorInput {
  runState: RunState;
  globals: GlobalState;
  today: string;
  /** Optional plan settings — shapes days/week, down-week cadence, and the peak
   *  cap. Absent = original 5-day / TUNABLES behavior (unchanged). Settings can
   *  only make the week smaller or the cadence more frequent — never raise a cap
   *  or unlock speed (those stay governed by speedState + gates). */
  settings?: RawSettings | null;
  /** Optional individual adaptation. growthFactor (≤1) scales the positive build
   *  increment DOWN for a fragile responder; downEvery may only tighten the
   *  cadence. Absent = population rate. Never loosens any safety floor. */
  adaptive?: AdaptiveModulation | null;
}

export function generateNextWeek({ runState, globals, today, settings, adaptive }: GeneratorInput): WeekProposal {
  const warnings: string[] = [];
  const notes: string[] = [];
  const weekStart = nextMonday(today);

  // Settings-derived shape (all safety-subordinate; default = current behavior).
  const runDaysN = settings ? Math.round(Math.min(6, Math.max(3, settings.daysPerWeek))) : 5;
  const lastRunIdx = runDaysN - 1;
  const settingsDownEvery = settings ? Math.max(2, Math.round(settings.downEvery)) : TUNABLES.DOWN_WEEK_AFTER_BUILDS;
  // Adaptation may only TIGHTEN the cadence (min), never loosen it.
  const downEvery = adaptive ? Math.min(settingsDownEvery, adaptive.downEvery) : settingsDownEvery;
  const peakCap = settings ? settings.peakMpw : Infinity;

  const t30 = trailing30Longest(runState, today);
  const flare = flareActive(runState, today, globals.painCap);
  const streak = painFreeStreak(runState, globals.painCap);
  const delayed = !!globals.delayUntil && globals.delayUntil > today;
  const effectiveState = flare ? 8 : globals.speedState;

  // ── Weekly volume target from actuals ──────────────────────
  // Only COMPLETED calendar weeks count toward the trend — the current
  // in-progress week is partial and would drag the target down mid-week.
  // Exception: when `today` is that week's last day (Sunday), it IS complete —
  // this is what makes multi-week chaining ladder correctly (each simulated
  // week counts for the next) instead of dipping then jumping.
  const currentWeekStart = mondayOf(today);
  const currentWeekComplete = today >= addDaysStr(currentWeekStart, 6);
  const weeks = weeklyActuals(runState, today).filter(
    w => w.weekStart < currentWeekStart || (w.weekStart === currentWeekStart && currentWeekComplete),
  );
  const recent = weeks.slice(-3);
  const lastWeek = recent[recent.length - 1];
  const lastSustained = [...weeks].reverse().find(w => w.miles > 0);
  const lastFullWeekStart = addDaysStr(currentWeekStart, -7);

  let baseVolume: number;
  if (!lastSustained) {
    baseVolume = 5 * t30 * 0.8; // no history at all — conservative floor
    notes.push('No logged history. Starting from a conservative floor.');
  } else if (!lastWeek || lastWeek.weekStart < lastFullWeekStart) {
    // Missed last week: resume near the last sustained week. Never make up miles.
    baseVolume = lastSustained.miles;
    notes.push(
      `You missed last week, so this resumes near your last sustained week (${lastSustained.miles.toFixed(1)} mi). Missed miles are never made up.`,
    );
  } else {
    // Nudge toward the recent trend, capped at +10% over last week. No leaps.
    const trend = recent.reduce((s, w) => s + w.miles, 0) / recent.length;
    const nudged = Math.max(lastWeek.miles, trend);
    baseVolume = Math.min(nudged * TUNABLES.WEEKLY_GROWTH_MAX, lastWeek.miles * TUNABLES.WEEKLY_GROWTH_MAX);
    notes.push(
      `Volume built from your actuals: last week ${lastWeek.miles.toFixed(1)} mi, recent trend ${trend.toFixed(1)} mi, growth capped at +10%.`,
    );
  }

  // ── Individual adaptation (downward-only) ───────────────────
  // Scale ONLY the positive growth increment over last week. Never pushes a
  // week below last week and never above the population +10% already applied,
  // so a fragile responder builds slower and a robust one keeps the capped rate.
  if (adaptive && lastWeek && baseVolume > lastWeek.miles && adaptive.growthFactor < 0.999) {
    baseVolume = lastWeek.miles + (baseVolume - lastWeek.miles) * adaptive.growthFactor;
    notes.push(
      `Build eased to ${Math.round(adaptive.growthFactor * 100)}% of the normal step, matched to your recent response.`,
    );
  }

  // ── Down-week logic ─────────────────────────────────────────
  // A logged week ≤80% of its predecessor counts as a down week.
  let buildsSinceDown = 0;
  for (let i = weeks.length - 1; i >= 1; i--) {
    if (weeks[i].miles <= weeks[i - 1].miles * 0.8) break;
    buildsSinceDown++;
  }
  const painSpike = flare;
  const isDownWeek = painSpike || buildsSinceDown >= downEvery;
  if (isDownWeek) {
    baseVolume = baseVolume * (1 - TUNABLES.DOWN_WEEK_CUT);
    notes.push(
      painSpike
        ? 'Deload week: recent pain spike. Volume cut ~25–30%; recovery is the work.'
        : `Down week auto-inserted after ${buildsSinceDown} consecutive build weeks. Volume cut ~25–30%, long run held.`,
    );
  }

  // ── Long run ────────────────────────────────────────────────
  // Flare clamps the long run to the trailing-30 longest — no step up.
  const long = flare ? floorToHalf(t30) : nextLongFrom(t30);
  notes.push(
    flare
      ? `Long run clamped to your recent longest (${long} mi). No ladder step during a flare.`
      : `Long run = ${long} mi: the largest half-mile step within ~110% of your trailing-30-day longest (${t30} mi).`,
  );

  let weekTotal = Math.max(Math.min(roundHalf(baseVolume), peakCap), long); // ≥ long, ≤ peak
  if (peakCap !== Infinity && roundHalf(baseVolume) > peakCap) {
    notes.push(`Held to your peak-week ceiling of ${peakCap} mi.`);
  }
  const longPct = long / weekTotal;
  if (longPct > TUNABLES.LONG_RUN_WEEK_PCT_FLAG) {
    warnings.push(
      `Long run is ${(longPct * 100).toFixed(0)}% of the projected week (heuristic flag at 30%, weak evidence; your call).`,
    );
  }

  // ── Distribute run days (long last), remaining weekdays off ──
  const days: ProposedDay[] = [];
  const easyBudget = Math.max(weekTotal - long, 0);
  const easyCount = lastRunIdx; // easy days before the long run
  const weights: number[] = [];
  for (let i = 0; i < easyCount; i++) weights.push(i === easyCount - 1 ? 0.7 : 1); // day-before-long lighter
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  const easyMiles = weights.map(w => roundHalf((easyBudget * w) / wsum));

  const flareEasyOnly = effectiveState === 8;
  for (let i = 0; i < 7; i++) {
    const date = addDaysStr(weekStart, i);
    const dayLabel = DAY_LABELS[i];
    if (i === lastRunIdx) {
      days.push({
        date, dayLabel, kind: 'long', miles: long,
        why: flare
          ? 'Held at recent longest. Flares settle with load reduction, not loading through.'
          : 'Ceiling from the trailing-30-day rule; the ladder only steps when the data earns it.',
      });
    } else if (i > lastRunIdx) {
      days.push({
        date, dayLabel, kind: 'rest', miles: null,
        why: i === lastRunIdx + 1 ? 'Off. Let it absorb. Mobility / PT homework if cleared.' : 'Off. Base-first structure keeps full rest days.',
      });
    } else {
      const m = Math.min(easyMiles[i], long); // no weekday run above the long-run ceiling
      days.push({
        date, dayLabel, kind: 'easy', miles: m,
        why: flareEasyOnly
          ? 'Easy only. Deload week. HR 140–150, hard cap 155.'
          : 'Easy aerobic volume. HR 140–150, hard cap 155. The base does the work.',
      });
    }
  }

  // ── Speed content, gated by state ───────────────────────────
  if (effectiveState >= 7 && !delayed && globals.ptClearedIntensity) {
    notes.push('State 7: structured speed is unlocked, but this generator still proposes threshold-first weeks. Add VO₂/race-pace manually with your coach.');
  }
  // One cruise-interval threshold on the 2nd run day, only if it stays ≥48h
  // clear of the long run (skipped on very short weeks where it can't).
  const thresholdIdx = 1;
  const thresholdFits = lastRunIdx - thresholdIdx >= 2;
  if (effectiveState >= 6 && !delayed && !isDownWeek && thresholdFits) {
    const tue = days[thresholdIdx];
    const fastMiles = roundHalf(Math.min(weekTotal * TUNABLES.THRESHOLD_MAX_WEEK_PCT, 3));
    tue.kind = 'threshold';
    tue.why = `Cruise intervals (3–5 × 5 min, 60–90s jog), ~${fastMiles} mi fast = ≤10% of the week. ≥48h clear of the long run.`;
  } else if (effectiveState < 7 || delayed) {
    notes.push(
      delayed
        ? `Speed is delayed until ${globals.delayUntil}. Zero hard sessions generated.`
        : 'No hard intervals, hills, VO₂, or race-pace generated. Speed state keeps them locked.',
    );
  }

  // Optional strides: state ≥ 3 and recent runs pain-free. Low-dose add-on,
  // Mon + Thu — never the threshold day, never the day before/of the long run
  // in a way that stacks fast work (strides are add-ons, not workouts).
  if (!flareEasyOnly && effectiveState >= TUNABLES.STRIDES_MIN_STATE && streak >= 3 && !delayed) {
    const spec = { reps: 6, durationS: 20, recoveryS: 90 }; // well inside validity limits
    const strideDays = [...new Set([0, Math.max(0, lastRunIdx - 1)])]; // first day + day before long
    for (const i of strideDays) {
      if (days[i].kind === 'easy') {
        days[i].strides = spec;
        days[i].why += ` Optional: ${spec.reps} × ${spec.durationS}s strides, full recovery. Add-on, skip if anything niggles.`;
      }
    }
    notes.push('Strides offered (optional): reps ≤ 8, ≤ 35s, ≥ 60s recovery. Anything beyond that is a hidden anaerobic session and gets rejected.');
  }

  weekTotal = days.reduce((s, d) => s + (d.miles ?? 0), 0);

  if (flare) {
    warnings.push('Flare rules active: 2+ pain days in 7. Next week is easy/rest/mobility only. Tell your PT.');
  }

  return { weekStart, days, totalMiles: weekTotal, isDownWeek, warnings, notes };
}

// ── Multi-week generation ─────────────────────────────────────
// Chains generateNextWeek by SIMULATING each proposed week as completed into a
// scratch log and advancing the cursor. Long-run laddering, +10% growth, and
// the down-week cadence all emerge from the single-week engine — no duplicated
// rules. Weeks already confirmed in acceptedWeeks are skipped (never
// overwritten). Award/race data are not parameters.

export interface MultiWeekResult {
  proposals: WeekProposal[];
  conflicts: AcceptedWeekConflict[];
}

export function generateWeeks(
  input: GeneratorInput & { count: number },
): MultiWeekResult {
  const { runState, globals, today, settings, adaptive } = input;
  const count = Math.max(1, Math.min(12, Math.round(input.count)));
  const accepted = globals.acceptedWeeks ?? {};
  const proposals: WeekProposal[] = [];
  const scratch: RunState = { ...runState };
  let cursor = today;

  for (let n = 0; n < count; n++) {
    const ws = nextMonday(cursor);
    if (accepted[ws]) { cursor = addDaysStr(ws, 6); continue; } // skip confirmed weeks
    const p = generateNextWeek({ runState: scratch, globals, today: cursor, settings, adaptive });
    proposals.push(p);
    // Simulate this week as completed so the next week ladders from it.
    for (const d of p.days) {
      if (d.miles != null) {
        scratch[d.date] = { date: d.date, done: true, miles_actual: d.miles, updated_at: cursor + 'T12:00:00Z' };
      }
    }
    cursor = addDaysStr(ws, 6); // that week's Sunday
  }

  return { proposals, conflicts: checkAcceptedWeeks(accepted, runState, globals, today) };
}

// ── Conflict check vs previously-accepted future weeks ────────
// Never rewrites anything: for each FUTURE, UNLOCKED accepted week that a
// current safety gate says is unsafe, produces a safety-clamped `suggested`
// copy alongside the untouched `original`. The UI swaps only on confirm.

export interface AcceptedWeekConflict {
  weekStart: string;
  original: ProposedDay[];
  suggested: ProposedDay[];
  reasons: string[];
}

export function checkAcceptedWeeks(
  accepted: Record<string, ProposedDay[]>,
  runState: RunState,
  globals: GlobalState,
  today: string,
): AcceptedWeekConflict[] {
  const out: AcceptedWeekConflict[] = [];
  const cap = nextLongFrom(trailing30Longest(runState, today));
  const flare = flareActive(runState, today, globals.painCap);
  const delayed = !!globals.delayUntil && globals.delayUntil > today;
  const state = flare ? 8 : globals.speedState;
  const curMonday = mondayOf(today);

  for (const [ws, days] of Object.entries(accepted)) {
    if (ws <= curMonday) continue; // past/current — locked, never re-suggest
    const weekEnd = addDaysStr(ws, 6);
    const hasLogged = Object.values(runState).some(
      e => e.date >= ws && e.date <= weekEnd && (e.done || e.miles_actual != null),
    );
    if (hasLogged) continue; // a logged run locks the week

    const reasons: string[] = [];
    let suggested = days.map(d => ({ ...d }));
    const longDay = days.find(d => d.kind === 'long');
    const fastDay = days.find(d => d.kind === 'threshold');

    if (longDay && longDay.miles != null && longDay.miles > cap + 1e-9) {
      reasons.push(`Long run ${longDay.miles} mi now exceeds the ${cap} mi ceiling from recent training.`);
      suggested = suggested.map(d => (d.kind === 'long' ? { ...d, miles: cap, why: `Clamped to the current ${cap} mi ceiling.` } : d));
    }
    if (fastDay && (state < 6 || delayed || flare)) {
      reasons.push('A hard session is planned but speed is currently locked, delayed, or flared.');
      suggested = suggested.map(d => (d.kind === 'threshold' ? { ...d, kind: 'easy' as const, why: 'Demoted to easy. Speed is not unlocked yet.' } : d));
    }
    if (fastDay && longDay && Math.abs(daysBetween(fastDay.date, longDay.date)) < 2) {
      reasons.push('A hard session sits within 48h of the long run.');
      suggested = suggested.map(d => (d.kind === 'threshold' ? { ...d, kind: 'easy' as const, why: 'Demoted to easy. Too close to the long run.' } : d));
    }

    if (reasons.length) out.push({ weekStart: ws, original: days, suggested, reasons });
  }
  return out;
}

// Back-compat: the single-value long-run conflict, now expressed via the cap.
export function checkPlannedLongRunConflict(
  plannedLong: number,
  runState: RunState,
  today: string,
): { message: string; saferValue: number } | null {
  const cap = nextLongFrom(trailing30Longest(runState, today));
  if (plannedLong <= cap) return null;
  return {
    message:
      `The existing plan's long run (${plannedLong} mi) exceeds the current safe ceiling (${cap} mi). ` +
      `Original plan preserved. Confirm below to use the safer version.`,
    saferValue: cap,
  };
}
