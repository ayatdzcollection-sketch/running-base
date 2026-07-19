// ============================================================
// SPEED GUARD — Phase 2D deterministic blockers + hard budget.
// (Evidence Spec §8 re-lock rules, §10 engine rules.)
//
// The stored speedState is the HIGHEST EARNED tier; this module computes the
// tier usable RIGHT NOW by applying transient suppressors on top of it. The
// design splits "erase progress" from "suppress today":
//
//   • SUPPRESSION (this module, computed live): down week, race week, mileage
//     spike, rising RPE, pain drift, poor recovery, long-run readiness, season
//     transition, missing data. These cap the EFFECTIVE tier and freeze new
//     unlocks (holdTier) without touching the stored tier — a Phase 2A/2B
//     warning downgrades advanced speed immediately but does not erase earned
//     buildup/stride progress.
//   • STORED RELOCK (App effects + return-from-break): flare → tier 0; any
//     hip pain while hills are unlocked → tier 3; long break → tier 0; medium
//     break → one tier down. Pain and detraining DO erase progress.
//
// Every rule is downward-only. Missing optional data (RPE / check-ins) is
// UNKNOWN: it never blocks the basic tiers 1–4 and never unlocks tiers 5+.
// ============================================================

import type { GlobalState, ProposedDay, RaceResult, RunState, SpeedStateNum } from './types';
import { TUNABLES } from '../config/tunables';
import {
  addDaysStr, mondayOf, flareActive, recentBreach, trailing30Longest, weeklyActuals, nextLongFrom,
  isReducedWeek, isSeasonDate, currentSeason,
} from './metrics';
import {
  easyRunRpeTrend, painDriftSignal, longRunReadiness, weeklyRecoverySignal,
} from './adaptive';

export type SpeedAction = 'SKIP_TODAY' | 'HOLD_TIER' | 'DOWNGRADE' | 'RELOCK';

export interface SpeedBlocker {
  key: string;
  label: string;
  action: SpeedAction;
  /** Highest tier usable while this blocker is active (suppression cap). */
  capTier: SpeedStateNum;
  detail: string;
}

export interface SpeedGuard {
  blockers: SpeedBlocker[];
  /** Tier usable today = min(stored tier, every active cap). Never > stored. */
  effectiveTier: SpeedStateNum;
  /** No NEW unlocks while true (ladder frozen; stored tier untouched). */
  holdTier: boolean;
  /** Missing-data rule: advanced tiers (5+) need recent check-in + RPE data. */
  advancedDataOk: boolean;
  /** XC/coach season overlay active: the app is a monitor, not a prescriber
   *  of hard work (coach leads; ≤2 hard/wk including coach work + races). */
  seasonMode: boolean;
  /** Weekly hard-effort budget (units) for the week containing `today`. */
  hardBudget: number;
  /** Units already accounted this week (races = 1 each). */
  hardUnitsUsed: number;
}

export interface SpeedGuardOpts {
  /** Is the week containing `today` a planned down/recovery week? */
  isDownWeek?: boolean;
}

function cap(t: number): SpeedStateNum {
  return Math.max(0, Math.min(8, Math.round(t))) as SpeedStateNum;
}

/** Season overlay: inside the official XC/coach season WINDOW (start..end).
 *  A blank end date is UNKNOWN = open-ended, byte-identical to the original
 *  one-way `date >= xcStartDate` behavior. Shared with the settings-driven plan
 *  via metrics.seasonWindow so the two layers can never disagree. */
export function inSeason(settings: GlobalState['settings'], date: string): boolean {
  return isSeasonDate(settings, date);
}

/** Races dated inside the calendar week (Mon–Sun) containing `date`.
 *  DOWNWARD-ONLY use: a race can only ever suppress speed (taper) and consume
 *  hard-budget units — it never unlocks or raises anything. Past races outside
 *  the current week have zero effect, preserving "results are display-only". */
export function racesInWeek(races: RaceResult[] | undefined, date: string): RaceResult[] {
  if (!races?.length) return [];
  const ws = mondayOf(date);
  const we = addDaysStr(ws, 6);
  return races.filter(r => r.date >= ws && r.date <= we);
}

/** Single-session spike: any run in the trailing week that exceeded the
 *  sanctioned single-run ceiling BEFORE it — nextLongFrom(trailing-30 longest),
 *  i.e. ~110% in half-mile steps (Spike25 guardrail). Using the app's own
 *  ladder ceiling means a legitimate half-step long-run progression can never
 *  read as a spike. */
function sessionSpike(runState: RunState, today: string): string | null {
  const from = addDaysStr(today, -7);
  let spikeDate: string | null = null;
  for (const e of Object.values(runState)) {
    if (e.miles_actual == null || e.date <= from || e.date > today) continue;
    const ceiling = nextLongFrom(trailing30Longest(runState, e.date, false));
    if (e.miles_actual > ceiling + 1e-9) {
      if (!spikeDate || e.date > spikeDate) spikeDate = e.date;
    }
  }
  return spikeDate;
}

/** Weekly jump: last completed week grew past every sanctioned growth cap
 *  (even the earned-trust hard ceiling) plus half-step rounding slack, over
 *  the consecutive week before it. Never flags the plan's own growth — in
 *  particular, when the previous week was a scheduled DOWN week the resume is
 *  measured against the PRE-down week as well: a down week is a temporary
 *  absorption dip, not the new baseline, so returning to the pre-down
 *  trajectory is sanctioned while a genuine leap past it still flags. */
function weeklyJump(runState: RunState, today: string): boolean {
  const weeks = weeklyActuals(runState, today).filter(w => w.weekStart < mondayOf(today));
  if (weeks.length < 2) return false;
  const last = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];
  // Only consecutive calendar weeks compare meaningfully, and only when the
  // earlier week was a real training week (≥3 runs) — a 1-run partial week
  // (e.g. the pre-plan bonus day) is noise, not a baseline.
  if (addDaysStr(prev.weekStart, 7) !== last.weekStart) return false;
  if (prev.runCount < 3) return false;
  // Down-week resume exemption: if `prev` reads as a scheduled down week
  // (shared detector, SCHEDULED_DOWN_CUT + rounding slack) the growth baseline
  // is max(prev, pre-down week) — the tissue carried the pre-down load two
  // weeks ago, so resuming toward it is the plan's own behavior, not a spike.
  const prevPrev = weeks.length >= 3 ? weeks[weeks.length - 3] : undefined;
  const baseline = prevPrev && prevPrev.runCount >= 3 && isReducedWeek(prev, prevPrev)
    ? Math.max(prev.miles, prevPrev.miles)
    : prev.miles;
  const sanctioned = Math.max(TUNABLES.WEEKLY_GROWTH_MAX, TUNABLES.ADAPTIVE.EARNED_TRUST.HARD_CEILING);
  return baseline > 0 && last.miles > baseline * sanctioned + TUNABLES.HALF_STEP + 1e-9;
}

/** Morning-pain hold: any entry inside the window whose next-AM pain is worse
 *  than the during-run pain, or at/above MORNING_PAIN_MIN. */
function morningPainHold(runState: RunState, today: string): string | null {
  const S = TUNABLES.SPEED;
  const from = addDaysStr(today, -S.MORNING_PAIN_WINDOW_DAYS);
  let worst: string | null = null;
  for (const e of Object.values(runState)) {
    if (e.date < from || e.date > today || e.painNextAM == null) continue;
    const worse = e.painNextAM > (e.painDuring ?? 0);
    const high = e.painNextAM >= S.MORNING_PAIN_MIN;
    if ((worse && e.painNextAM > 0) || high) {
      if (!worst || e.date > worst) worst = e.date;
    }
  }
  return worst;
}

/**
 * Athlete-logged HARD sessions inside the week containing `date`.
 *
 * In season the app schedules ZERO hard work — the coach owns workouts — so the
 * only way the guard can learn that a hard session happened is the athlete's own
 * RPE. RPE ≥ RPE_EASY_MAX+1 (8–10) is already this codebase's "intentional hard
 * session / race" band (see adaptive.ts's easy-run filter), so it is reused here
 * rather than introducing a second, disagreeing threshold.
 *
 * DOWNWARD-ONLY: these units only ever CONSUME budget, which can suppress
 * app-offered intensity. They can never grant budget, raise a cap, or unlock
 * anything. Missing RPE is UNKNOWN — not counted as hard, and never assumed
 * easy. Race days are excluded because a race already counts as one unit.
 */
function loggedHardUnits(
  runState: RunState, races: RaceResult[] | undefined, date: string,
): number {
  const ws = mondayOf(date);
  const we = addDaysStr(ws, 6);
  const raceDates = new Set(
    (races ?? []).filter(r => r.date >= ws && r.date <= we).map(r => r.date),
  );
  let units = 0;
  for (const e of Object.values(runState)) {
    if (e.date < ws || e.date > we) continue;
    if (raceDates.has(e.date)) continue;                          // already 1 unit
    // An explicit coach-workout tap is ground truth and outranks the inference.
    // Otherwise fall back to RPE ≥ 8. Note `coachWorkout === false` does NOT
    // veto a genuinely hard run: it answers "was this the coach's session?", not
    // "was this easy" — a self-inflicted hard effort still spends the budget.
    const hard = e.coachWorkout === true
      || (e.rpe != null && e.rpe > TUNABLES.ADAPTIVE.RPE_EASY_MAX);
    if (hard) units += 1;
  }
  return units;
}

/**
 * Evaluate every transient speed blocker for `today`. Pure and read-only.
 * Most-severe-wins is structural: the effective tier is the MIN of all caps.
 */
export function evaluateSpeedGuard(
  runState: RunState,
  globals: GlobalState,
  today: string,
  opts: SpeedGuardOpts = {},
): SpeedGuard {
  const S = TUNABLES.SPEED;
  const settings = globals.settings ?? null;
  const blockers: SpeedBlocker[] = [];

  const season = inSeason(settings, today);
  const onBreak = !!globals.breakStart && globals.breakStart <= today;
  const flare = flareActive(runState, today, globals.painCap);
  const breach = recentBreach(runState, today, globals.painCap);

  // ── Hard stops (cap 0/1): pain and breaks erase the week's speed. ──
  if (onBreak) {
    blockers.push({
      key: 'breakMode', label: 'On a training break', action: 'RELOCK', capTier: 0,
      detail: 'The plan is paused. Speed is re-earned from the bottom on return.',
    });
  }
  if (flare) {
    blockers.push({
      key: 'flare', label: 'Pain flare — deload active', action: 'RELOCK', capTier: 0,
      detail: 'Two pain days above your cap inside 7 days. Easy running only until it settles.',
    });
  } else if (breach) {
    blockers.push({
      key: 'painDuringRun', label: 'Pain above your cap this week', action: 'HOLD_TIER', capTier: 1,
      detail: 'A run breached the pain cap in the last 7 days. Hard work is off; at most gentle buildups if fully pain-free.',
    });
  }

  // ── Morning pain (24–48h hold on hard work). ──
  const amPain = morningPainHold(runState, today);
  if (amPain) {
    blockers.push({
      key: 'painNextAM', label: 'Next-morning pain', action: 'HOLD_TIER', capTier: 3,
      detail: `Morning-after pain logged on ${amPain}. No hills or hard work until 24–48h pain-free.`,
    });
  }

  // ── Phase 2A body-response signals (suppress advanced, keep basic). ──
  const drift = painDriftSignal(runState, today, globals.painCap);
  if (drift.status === 'rising') {
    blockers.push({
      key: 'painDrift', label: 'Soreness drifting up', action: 'HOLD_TIER', capTier: 4,
      detail: 'Next-morning soreness is creeping up (still under your cap). Advanced speed pauses; strides only if genuinely pain-free.',
    });
  }
  const rpe = easyRunRpeTrend(runState, today);
  if (rpe.status === 'rising') {
    blockers.push({
      key: 'risingRpe', label: 'Easy runs feeling harder', action: 'SKIP_TODAY', capTier: 4,
      detail: 'Easy-run RPE is trending up. Skip hard work and hold the ladder until effort settles.',
    });
  }
  const lr = longRunReadiness(runState, today);
  if (lr.status === 'hold') {
    blockers.push({
      key: 'longRunReadiness', label: 'Last long run went poorly', action: 'DOWNGRADE', capTier: 4,
      detail: 'The last long run was poorly tolerated. No hard sessions near the long run this cycle.',
    });
  }

  // ── Phase 2B weekly recovery (suppress advanced; never erase basic). ──
  const rec = weeklyRecoverySignal(globals.checkins, today);
  if (rec.status === 'caution') {
    blockers.push({
      key: 'poorRecovery', label: 'Recovery check-in cautionary', action: 'DOWNGRADE', capTier: 4,
      detail: 'This week\'s check-in was rough. Today\'s planned hard work downgrades to easy + strides.',
    });
  } else if (rec.status === 'poor') {
    blockers.push({
      key: 'poorRecovery', label: rec.repeated ? 'Recovery poor for several weeks' : 'Recovery check-in poor', action: 'HOLD_TIER', capTier: 4,
      detail: 'Recovery is poor. Advanced speed is off until check-ins recover; easy running and optional strides remain.',
    });
  }

  // ── Load-spike guardrails (Spike25). ──
  const spike = sessionSpike(runState, today);
  if (spike) {
    blockers.push({
      key: 'mileageSpike', label: 'Single-run spike this week', action: 'HOLD_TIER', capTier: 4,
      detail: `A run on ${spike} exceeded ~110% of your trailing-30-day longest. No new speed this week.`,
    });
  } else if (weeklyJump(runState, today)) {
    blockers.push({
      key: 'mileageJump', label: 'Big weekly mileage jump', action: 'HOLD_TIER', capTier: 4,
      detail: 'Last week grew faster than the +10% guideline. Hold intensity while the volume absorbs.',
    });
  }

  // ── Planned structure: down week / race week / season transition. ──
  if (opts.isDownWeek) {
    blockers.push({
      key: 'downWeek', label: 'Down / recovery week', action: 'HOLD_TIER', capTier: 3,
      detail: 'Absorption week: hard budget is zero and the ladder is frozen. Easy running + optional strides only.',
    });
  }
  const weekRaces = racesInWeek(globals.races, today);
  if (weekRaces.length > 0) {
    blockers.push({
      key: 'raceWeek', label: 'Race week', action: 'HOLD_TIER', capTier: 3,
      detail: 'A race this week IS the hard day. Taper: sharpening strides only, no new stimulus.',
    });
  }
  const activeSeason = currentSeason(settings, today);
  if (season && activeSeason) {
    // Hold measured from THIS season's start — so entering track in spring gets
    // the same two-week transition freeze that entering XC does.
    const holdUntil = addDaysStr(activeSeason.startDate, S.SEASON_TRANSITION_HOLD_DAYS);
    if (today < holdUntil) {
      blockers.push({
        key: 'seasonTransition', label: 'Season just started', action: 'HOLD_TIER', capTier: cap(globals.speedState),
        detail: 'Entering daily team practice is itself a load spike. The ladder holds for the first two weeks of season.',
      });
    }
  }

  // ── Missing-data rule: advanced tiers (5+) need check-in + RPE data. ──
  const advancedDataOk =
    rec.weeksConsidered >= S.ADVANCED_MIN_CHECKIN_WEEKS
    && rpe.samples >= TUNABLES.ADAPTIVE.RPE_MIN_SAMPLES;
  if (!advancedDataOk && globals.speedState >= S.ADVANCED_MIN_TIER) {
    blockers.push({
      key: 'missingData', label: 'Not enough recent check-in / RPE data', action: 'DOWNGRADE', capTier: 4,
      detail: 'Advanced speed needs recent check-ins and easy-run RPE to gate safely. Basic strides stay available — nothing is lost.',
    });
  }

  // ── Effective tier + hold. ──
  let effectiveTier = cap(globals.speedState);
  for (const b of blockers) effectiveTier = cap(Math.min(effectiveTier, b.capTier));
  // Advanced tiers are never usable without data, whatever the stored tier says.
  if (!advancedDataOk) effectiveTier = cap(Math.min(effectiveTier, S.ADVANCED_MIN_TIER - 1));
  const holdTier = blockers.some(b => b.action === 'HOLD_TIER' || b.action === 'RELOCK');

  // ── Hard budget for the week containing today (races count 1 unit each). ──
  const hardBudget = opts.isDownWeek || flare || onBreak
    ? 0
    : season ? S.HARD_BUDGET_SEASON : S.HARD_BUDGET_BASE;
  // Races + any hard session the athlete actually logged (the coach's work, which
  // the app never scheduled and otherwise could not see). Downward-only.
  const hardUnitsUsed = weekRaces.length + loggedHardUnits(runState, globals.races, today);

  return { blockers, effectiveTier, holdTier, advancedDataOk, seasonMode: season, hardBudget, hardUnitsUsed };
}

/** Hard-budget units for a PROPOSED week: races that week (1 each) + any
 *  threshold day (1) + any fartlek day (0.5). Used by the generator to refuse
 *  scheduling beyond budget. */
export function hardUnitsForDays(days: ProposedDay[], races: RaceResult[] | undefined, weekStart: string): number {
  const we = addDaysStr(weekStart, 6);
  const raceUnits = (races ?? []).filter(r => r.date >= weekStart && r.date <= we).length;
  let units = raceUnits;
  for (const d of days) {
    if (d.kind === 'threshold') units += 1;
    if (d.fartlek) units += TUNABLES.SPEED.FARTLEK_UNITS;
  }
  return units;
}

/** Speed-layer patch for Return-from-break (Evidence Spec §8: break →
 *  re-earn). ≥21 days = real detraining → full relock to 0 and clearances
 *  reset; 7–20 days → one tier down (re-earn the last rung); <7 days → keep.
 *  Always restamps the readiness streak baseline when the tier moves. */
export function returnFromBreakSpeedPatch(
  breakDays: number,
  globals: GlobalState,
  today: string,
): Partial<GlobalState> {
  if (breakDays >= 21) {
    return {
      speedState: 0,
      speedStateSince: today,
      hipSafeFlag: false,
      ptClearedSpeed: false,
      ptClearedIntensity: false,
      delayUntil: null,
      lastFastSessionDate: null,
      lastLongRunDate: null,
      painFreeEasyRunStreak: 0,
    };
  }
  if (breakDays >= 7 && globals.speedState > 0) {
    return {
      speedState: cap(globals.speedState - 1),
      speedStateSince: today,
      painFreeEasyRunStreak: 0,
    };
  }
  return {};
}
