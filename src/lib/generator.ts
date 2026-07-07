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

import type { GlobalState, ProposedDay, RunState, WeekProposal } from './types';
import { TUNABLES } from '../config/tunables';
import {
  addDaysStr, nextMonday, mondayOf, trailing30Longest, nextLongFrom, floorToHalf,
  flareActive, painFreeStreak, weeklyActuals,
} from './metrics';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function roundHalf(x: number): number {
  return Math.round(x / TUNABLES.HALF_STEP) * TUNABLES.HALF_STEP;
}

export interface GeneratorInput {
  runState: RunState;
  globals: GlobalState;
  today: string;
}

export function generateNextWeek({ runState, globals, today }: GeneratorInput): WeekProposal {
  const warnings: string[] = [];
  const notes: string[] = [];
  const weekStart = nextMonday(today);

  const t30 = trailing30Longest(runState, today);
  const flare = flareActive(runState, today, globals.painCap);
  const streak = painFreeStreak(runState, globals.painCap);
  const delayed = !!globals.delayUntil && globals.delayUntil > today;
  const effectiveState = flare ? 8 : globals.speedState;

  // ── Weekly volume target from actuals ──────────────────────
  // Only COMPLETED calendar weeks count toward the trend — the current
  // in-progress week is partial and would drag the target down mid-week.
  const currentWeekStart = mondayOf(today);
  const weeks = weeklyActuals(runState, today).filter(w => w.weekStart < currentWeekStart);
  const recent = weeks.slice(-3);
  const lastWeek = recent[recent.length - 1];
  const lastSustained = [...weeks].reverse().find(w => w.miles > 0);
  const lastFullWeekStart = addDaysStr(currentWeekStart, -7);

  let baseVolume: number;
  if (!lastSustained) {
    baseVolume = 5 * t30 * 0.8; // no history at all — conservative floor
    notes.push('No logged history — starting from a conservative floor.');
  } else if (!lastWeek || lastWeek.weekStart < lastFullWeekStart) {
    // Missed last week: resume near the last sustained week. Never make up miles.
    baseVolume = lastSustained.miles;
    notes.push(
      `You missed last week, so this resumes near your last sustained week (${lastSustained.miles.toFixed(1)} mi) — missed miles are never made up.`,
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

  // ── Down-week logic ─────────────────────────────────────────
  // A logged week ≤80% of its predecessor counts as a down week.
  let buildsSinceDown = 0;
  for (let i = weeks.length - 1; i >= 1; i--) {
    if (weeks[i].miles <= weeks[i - 1].miles * 0.8) break;
    buildsSinceDown++;
  }
  const painSpike = flare;
  const isDownWeek = painSpike || buildsSinceDown >= TUNABLES.DOWN_WEEK_AFTER_BUILDS;
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
      ? `Long run clamped to your recent longest (${long} mi) — no ladder step during a flare.`
      : `Long run = ${long} mi: the largest half-mile step within ~110% of your trailing-30-day longest (${t30} mi).`,
  );

  let weekTotal = Math.max(roundHalf(baseVolume), long); // week can't be smaller than its long run
  const longPct = long / weekTotal;
  if (longPct > TUNABLES.LONG_RUN_WEEK_PCT_FLAG) {
    warnings.push(
      `Long run is ${(longPct * 100).toFixed(0)}% of the projected week (heuristic flag at 30% — weak evidence; your call).`,
    );
  }

  // ── Distribute Mon–Fri, Sat/Sun off, Friday long ───────────
  const days: ProposedDay[] = [];
  const easyBudget = Math.max(weekTotal - long, 0);
  // Mon–Thu easy split; Thursday lightest (day before the long run).
  const split = [0.28, 0.27, 0.26, 0.19];
  const easyMiles = split.map(f => roundHalf(easyBudget * f));

  const flareEasyOnly = effectiveState === 8;
  for (let i = 0; i < 7; i++) {
    const date = addDaysStr(weekStart, i);
    const dayLabel = DAY_LABELS[i];
    if (i === 4) {
      days.push({
        date, dayLabel, kind: 'long', miles: long,
        why: flare
          ? 'Held at recent longest — flares settle with load reduction, not loading through.'
          : 'Ceiling from the trailing-30-day rule; the ladder only steps when the data earns it.',
      });
    } else if (i >= 5) {
      days.push({
        date, dayLabel, kind: 'rest', miles: null,
        why: i === 5 ? 'Off. Let it absorb. Mobility / PT homework if cleared.' : 'Off. Two full rest days every week is the base-first structure.',
      });
    } else {
      const m = Math.min(easyMiles[i], long); // no weekday run above the long-run ceiling
      days.push({
        date, dayLabel, kind: 'easy', miles: m,
        why: flareEasyOnly
          ? 'Easy only — deload week. HR 140–150, hard cap 155.'
          : 'Easy aerobic volume. HR 140–150, hard cap 155 — the base does the work.',
      });
    }
  }

  // ── Speed content, gated by state ───────────────────────────
  if (effectiveState >= 7 && !delayed && globals.ptClearedIntensity) {
    notes.push('State 7: structured speed is unlocked, but this generator still proposes threshold-first weeks. Add VO₂/race-pace manually with your coach.');
  }
  if (effectiveState >= 6 && !delayed && !isDownWeek) {
    // One cruise-interval threshold session, Tuesday: ≥48h before Friday long,
    // never back-to-back with another fast day, ≤10% of weekly miles fast.
    const tue = days[1];
    const fastMiles = roundHalf(Math.min(weekTotal * TUNABLES.THRESHOLD_MAX_WEEK_PCT, 3));
    tue.kind = 'threshold';
    tue.why = `Cruise intervals (3–5 × 5 min, 60–90s jog), ~${fastMiles} mi fast = ≤10% of the week. 72h clear of the long run.`;
  } else if (effectiveState < 7 || delayed) {
    notes.push(
      delayed
        ? `Speed is delayed until ${globals.delayUntil} — zero hard sessions generated.`
        : 'No hard intervals, hills, VO₂, or race-pace generated — speed state keeps them locked.',
    );
  }

  // Optional strides: state ≥ 3 and recent runs pain-free. Low-dose add-on,
  // Mon + Thu — never the threshold day, never the day before/of the long run
  // in a way that stacks fast work (strides are add-ons, not workouts).
  if (!flareEasyOnly && effectiveState >= TUNABLES.STRIDES_MIN_STATE && streak >= 3 && !delayed) {
    const spec = { reps: 6, durationS: 20, recoveryS: 90 }; // well inside validity limits
    for (const i of [0, 3]) {
      if (days[i].kind === 'easy') {
        days[i].strides = spec;
        days[i].why += ` Optional: ${spec.reps} × ${spec.durationS}s strides, full recovery — add-on, skip if anything niggles.`;
      }
    }
    notes.push('Strides offered (optional): reps ≤ 8, ≤ 35s, ≥ 60s recovery — anything beyond that is a hidden anaerobic session and gets rejected.');
  }

  weekTotal = days.reduce((s, d) => s + (d.miles ?? 0), 0);

  if (flare) {
    warnings.push('Flare rules active: 2+ pain days in 7. Next week is easy/rest/mobility only. Tell your PT.');
  }

  return { weekStart, days, totalMiles: weekTotal, isDownWeek, warnings, notes };
}

// ── Conflict check vs a previously planned week ───────────────
// The generator never rewrites completed weeks, and preserves existing
// future weeks by default. This check only SUGGESTS a safer version when
// a safety gate says the old plan is clearly unsafe; replacing anything
// requires explicit user confirmation in the UI.

export interface PlanConflict {
  message: string;
  saferValue: number;
}

export function checkPlannedLongRunConflict(
  plannedLong: number,
  runState: RunState,
  today: string,
): PlanConflict | null {
  const cap = nextLongFrom(trailing30Longest(runState, today));
  if (plannedLong <= cap) return null;
  return {
    message:
      `The existing plan's long run (${plannedLong} mi) exceeds the current safe ceiling (${cap} mi). ` +
      `Original plan preserved — confirm below to use the safer version.`,
    saferValue: cap,
  };
}
