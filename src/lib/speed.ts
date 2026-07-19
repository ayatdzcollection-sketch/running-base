// ============================================================
// SPEED PERMISSION MACHINE — a single global speedState (tier 0–8)
// gates every kind of fast running (Phase 2D ladder, Evidence Spec §5):
//
//   0 Speed locked · 1 Buildups · 2 Short strides · 3 Flat strides ·
//   4 Hill strides · 5 Light fartlek · 6 Cruise/threshold intervals ·
//   7 Continuous tempo · 8 VO₂ / race-specific (season-gated)
//
// Upward transitions require the readiness checklist all-green; downward is
// always allowed. Tiers 1–4 are BASIC neuromuscular touches: available on
// pain-free stable training alone. Tiers 5+ are ADVANCED: they additionally
// require recent check-in + RPE data and clean-week evidence (the
// missing-data rule — absent optional data never punishes basic touches and
// never unlocks advanced ones). Tier 8 requires being in/near the XC season.
// Flare/deload is no longer a rung: it is computed live (metrics.flareActive)
// and relocks the stored tier to 0. Transient blockers (down week, race week,
// spike, poor recovery…) live in speedGuard.ts and SUPPRESS below the stored
// tier without erasing earned progress.
// ============================================================

import type { GlobalState, RawSettings, RunState, SpeedStateNum } from './types';
import { TUNABLES } from '../config/tunables';
import {
  painFreeStreak, flareActive, mondayOf, addDaysStr, laterDate, weeklyActuals, painBreachDates,
  currentSeason, nextSeasonStart,
} from './metrics';
import { requiredStreakFor } from './settings';
import { easyRunRpeTrend, weeklyRecoverySignal } from './adaptive';

// ── General restriction model ────────────────────────────────
// A gate is a named clearance that must be satisfied on top of the speed
// state. Modeled as a general list (not hard-coded to the hip case) so the
// same machinery covers hills (hip-safe + PT speed) and structured speed (PT
// intensity), and could cover other restrictions later. Hip safeguards stay.

export type GateReq = 'hipSafe' | 'ptSpeed' | 'ptIntensity';

const GATE_LABELS: Record<GateReq, string> = {
  hipSafe: 'hip-safe flag',
  ptSpeed: 'PT speed clearance',
  ptIntensity: 'PT intensity clearance',
};

export function gateSatisfied(requires: GateReq[] | undefined, g: GlobalState): boolean {
  if (!requires || requires.length === 0) return true;
  return requires.every(r =>
    r === 'hipSafe' ? g.hipSafeFlag
    : r === 'ptSpeed' ? g.ptClearedSpeed
    : g.ptClearedIntensity);
}

function gateLabel(requires: GateReq[]): string {
  return requires.map(r => GATE_LABELS[r]).join(' + ');
}

/** Extra clearances required to ENTER a given speed state (beyond readiness). */
export const STATE_GATES: Partial<Record<SpeedStateNum, GateReq[]>> = {
  4: ['hipSafe', 'ptSpeed'],   // hill strides — hip-flexor caution (Yokozawa 2007)
  8: ['ptIntensity'],          // VO₂ / race-specific
};

export const SPEED_STATE_NAMES: Record<SpeedStateNum, string> = {
  0: 'Speed locked — base only',
  1: 'Buildups allowed',
  2: 'Short strides allowed',
  3: 'Flat strides allowed',
  4: 'Hill strides allowed (hip-safe only)',
  5: 'Light fartlek allowed',
  6: 'Cruise / threshold intervals allowed',
  7: 'Continuous tempo allowed',
  8: 'VO₂ / race-specific allowed (season)',
};

export const MAX_SPEED_TIER: SpeedStateNum = 8;

/** Tiers at/above this are ADVANCED (need data + earned evidence to unlock). */
export const ADVANCED_TIER = TUNABLES.SPEED.ADVANCED_MIN_TIER as SpeedStateNum;

// ── Readiness checklist ──────────────────────────────────────

export interface ReadinessItem {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface ReadinessReport {
  items: ReadinessItem[];
  allGreen: boolean;
}

interface PainSample { date: string; pain: number; settled: boolean }

/** Most recent run with any pain logged (during or next-AM). */
function lastLoadingPain(runState: RunState): PainSample | null {
  const entries = Object.values(runState)
    .filter(e => e.painDuring != null || e.painNextAM != null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const e = entries[0];
  if (!e) return null;
  const during = e.painDuring ?? 0;
  const nextAM = e.painNextAM ?? 0;
  return {
    date: e.date,
    pain: Math.max(during, nextAM),
    // "settled by next morning": morning pain no worse than during-run pain
    settled: nextAM <= during,
  };
}

/** Max logged pain per calendar week — used for the week-over-week check. */
function weekPainMax(runState: RunState, weekStart: string): number {
  const weekEnd = addDaysStr(weekStart, 6);
  let max = 0;
  for (const e of Object.values(runState)) {
    if (e.date < weekStart || e.date > weekEnd) continue;
    max = Math.max(max, e.painDuring ?? 0, e.painNextAM ?? 0);
  }
  return max;
}

/** Consecutive clean completed calendar weeks (no pain-cap breach, real
 *  running), inside the pain-tracking era — the "provably clean training"
 *  evidence advanced tiers require. Mirrors the adaptive engine's clean-week
 *  count (same rules) so the two never disagree. */
export function cleanCompletedWeeks(runState: RunState, globals: GlobalState, today: string): number {
  const since = globals.painTrackingSince;
  const breachSet = new Set(painBreachDates(runState, globals.painCap));
  const weeks = weeklyActuals(runState, today).filter(
    w => w.weekStart < mondayOf(today) && (!since || w.weekStart >= since),
  );
  let clean = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    const w = weeks[i];
    const weekEnd = addDaysStr(w.weekStart, 6);
    const hadBreach = [...breachSet].some(d => d >= w.weekStart && d <= weekEnd);
    if (w.runCount > 0 && !hadBreach) clean++;
    else break;
  }
  return clean;
}

/**
 * Evaluate readiness to step UP into `target` (= current + 1).
 * All items must be green. Injury gates: 3→4 (hill strides) needs hipSafeFlag
 * && ptClearedSpeed; 7→8 (VO₂/race) needs ptClearedIntensity. Advanced tiers
 * (5+) additionally need recent check-in + RPE data and clean-week evidence
 * (missing-data rule: absent optional data can never unlock them). Tier 8 also
 * needs to be in/near the XC season.
 */
export function evaluateReadiness(
  target: SpeedStateNum,
  runState: RunState,
  globals: GlobalState,
  today: string,
  settings: RawSettings | null = null,
): ReadinessReport {
  const items: ReadinessItem[] = [];
  const painCap = globals.painCap;

  // 1. Pain-free easy-run streak — the STRICTER of the built-in requirement
  //    and the user's pfNeeded setting (settings can only tighten it). Runs
  //    predating pain tracking don't count as proven pain-free evidence — and
  //    neither do runs from BEFORE the current state was entered (speedStateSince):
  //    each advance needs a FRESH streak at the new state, so one long streak
  //    can't unlock the whole ladder in a single sitting. (speedStateSince
  //    absent/null → falls back to the pain-tracking baseline, unchanged.)
  const streakSince = laterDate(globals.painTrackingSince, globals.speedStateSince);
  const streak = painFreeStreak(runState, painCap, streakSince);
  const required = requiredStreakFor(target, settings);
  items.push({
    key: 'streak',
    label: `Pain-free easy-run streak ≥ ${required}`,
    ok: streak >= required,
    detail: `currently ${streak}`,
  });

  // 2. Last loading pain within cap, settled by next morning
  const last = lastLoadingPain(runState);
  items.push({
    key: 'lastPain',
    label: `Last loading pain ≤ ${painCap} and settled by morning`,
    ok: last == null || (last.pain <= painCap && last.settled),
    detail: last == null ? 'no pain logged yet (counts as green)' : `${last.pain}/10 on ${last.date}`,
  });

  // 3. No week-over-week pain increase
  const thisWeek = mondayOf(today);
  const lastWeek = addDaysStr(thisWeek, -7);
  const thisMax = weekPainMax(runState, thisWeek);
  const prevMax = weekPainMax(runState, lastWeek);
  items.push({
    key: 'weekTrend',
    label: 'No week-over-week pain increase',
    ok: thisMax === 0 || thisMax <= prevMax,
    detail: `this week max ${thisMax}, last week ${prevMax}`,
  });

  // 4. delayUntil passed (if set)
  const delayOk = !globals.delayUntil || globals.delayUntil <= today;
  items.push({
    key: 'delay',
    label: 'Delay window passed',
    ok: delayOk,
    detail: globals.delayUntil ? `delayed until ${globals.delayUntil}` : 'no delay set',
  });

  // 5. No active flare
  const flared = flareActive(runState, today, painCap);
  items.push({
    key: 'flare',
    label: 'No active flare (2 pain days in 7)',
    ok: !flared,
    detail: flared ? 'flare window active. Deload first' : 'clear',
  });

  // 6. Clearance gates on gated transitions (general model, hip-safe intact)
  const gates = STATE_GATES[target];
  if (gates) {
    items.push({
      key: 'clearanceGate',
      label: `Clearance: ${gateLabel(gates)}`,
      ok: gateSatisfied(gates, globals),
      detail: gates.map(r =>
        `${GATE_LABELS[r]} ${gateSatisfied([r], globals) ? '✓' : '✗'}`).join(' · '),
    });
  }

  // ── Phase 2D: advanced tiers (5+) need real evidence, not just a streak ──
  // Missing-data rule: these items exist ONLY for advanced targets, so absent
  // RPE/check-in data never blocks the basic neuromuscular tiers 1–4.
  if (target >= ADVANCED_TIER) {
    const S = TUNABLES.SPEED;
    // a. Recent weekly check-in data present (readiness gating needs it).
    const rec = weeklyRecoverySignal(globals.checkins, today);
    items.push({
      key: 'checkinData',
      label: `Recent check-in data (≥ ${S.ADVANCED_MIN_CHECKIN_WEEKS} readable week${S.ADVANCED_MIN_CHECKIN_WEEKS > 1 ? 's' : ''})`,
      ok: rec.weeksConsidered >= S.ADVANCED_MIN_CHECKIN_WEEKS,
      detail: rec.weeksConsidered === 0
        ? 'no recent check-ins — advanced speed stays locked (basic touches are unaffected)'
        : `${rec.weeksConsidered} recent readable check-in(s)`,
    });
    // b. Enough easy-run RPE samples that the rising-RPE guard can actually see.
    const rpe = easyRunRpeTrend(runState, today);
    const rpeNeeded = TUNABLES.ADAPTIVE.RPE_MIN_SAMPLES;
    items.push({
      key: 'rpeData',
      label: `Easy-run RPE logged (≥ ${rpeNeeded} recent samples)`,
      ok: rpe.samples >= rpeNeeded,
      detail: `${rpe.samples} of ${rpeNeeded} recent easy runs with RPE`,
    });
    // c. Earned evidence: consecutive clean completed weeks (provably clean).
    const cleanNeeded = TUNABLES.ADAPTIVE.EARNED_TRUST.MIN_CLEAN_WEEKS;
    const clean = cleanCompletedWeeks(runState, globals, today);
    items.push({
      key: 'cleanWeeks',
      label: `Clean completed weeks ≥ ${cleanNeeded}`,
      ok: clean >= cleanNeeded,
      detail: `currently ${clean}`,
    });
  }

  // ── Tier 8 (VO₂ / race-specific) is season-gated: in/near ANY coach season. ──
  // Already in a season → green. Otherwise the gate opens NEAR_SEASON_DAYS
  // before the next one starts, so track sharpening is gated exactly like XC.
  if (target >= 8) {
    const active = currentSeason(settings, today);
    const upcoming = nextSeasonStart(settings, today);
    const nearFrom = upcoming ? addDaysStr(upcoming, -TUNABLES.SPEED.NEAR_SEASON_DAYS) : null;
    const ok = !!active || (!!nearFrom && today >= nearFrom);
    items.push({
      key: 'season',
      label: 'In or near a coach-led season (sharpening window)',
      ok,
      detail: active
        ? `in the ${active.label} season`
        : upcoming ? `next season starts ${upcoming}` : 'no season date set',
    });
  }

  return { items, allGreen: items.every(i => i.ok) };
}

/** Downward transitions are always allowed; upward only one step, all-green. */
export function canSetState(
  target: SpeedStateNum,
  runState: RunState,
  globals: GlobalState,
  today: string,
  settings: RawSettings | null = null,
): { allowed: boolean; reason: string } {
  const current = globals.speedState;
  if (target === current) return { allowed: true, reason: 'no change' };
  if (target < current) return { allowed: true, reason: 'downgrades are always allowed' };
  if (target > current + 1) return { allowed: false, reason: 'advance one state at a time' };
  const report = evaluateReadiness(target, runState, globals, today, settings);
  return report.allGreen
    ? { allowed: true, reason: 'readiness all green' }
    : { allowed: false, reason: report.items.filter(i => !i.ok).map(i => i.label).join(' · ') };
}

/**
 * When a clearance is revoked out from under the current state, return the
 * downgrade patch the app must apply. Hill strides (tier 4) need hip-safe +
 * PT speed; VO₂/race (tier 8) needs PT intensity. Missing the hip clearance
 * drops to 3 (the pre-hills tier); missing only intensity drops to 7.
 */
export function enforceGateConsistency(globals: GlobalState): Partial<GlobalState> | null {
  const s = globals.speedState;
  if (s >= 4 && !gateSatisfied(STATE_GATES[4], globals)) return { speedState: 3 };
  if (s >= 8 && !gateSatisfied(STATE_GATES[8], globals)) return { speedState: 7 };
  return null;
}

// ── Speed type catalogue ─────────────────────────────────────

export type TypeStatus = 'allowed' | 'delayed' | 'locked';

/** Intensity bucket (Evidence Spec §3). Neuromuscular touches never count
 *  toward the hard budget; light fartlek counts 0.5; Bucket C counts 1. */
export type SpeedBucket = 'neuromuscular' | 'light' | 'hard';

export interface SpeedType {
  key: string;
  name: string;
  unlockState: SpeedStateNum;
  lowDose: boolean;         // softer visual treatment; add-on, not a workout
  /** Intensity bucket + hard-budget units (Evidence Spec §3/§10). */
  bucket: SpeedBucket;
  units: number;            // 0 neuromuscular · 0.5 light fartlek · 1 hard
  trains: string;
  maxFreq: string;
  fastVolume: string;
  downgrade: string;
  plain: string;            // one plain-English line
  /** extra clearances beyond speedState (general restriction model) */
  requires?: GateReq[];
  extraGateLabel?: string;
}

export const SPEED_TYPES: SpeedType[] = [
  {
    key: 'buildups',
    name: 'Buildups',
    unlockState: 1,
    lowDose: true,
    bucket: 'neuromuscular',
    units: 0,
    trains: 'Economy, coordination (near-zero fatigue)',
    maxFreq: '2/wk',
    fastVolume: '~2 min total fast',
    downgrade: 'Any hip pain',
    plain: 'Gentle accelerations, ≤15–20s, full recovery. The softest possible touch of speed.',
  },
  {
    key: 'shortStrides',
    name: 'Short strides',
    unlockState: 2,
    lowDose: true,
    bucket: 'neuromuscular',
    units: 0,
    trains: 'Motor-unit recruitment',
    maxFreq: '3/wk',
    fastVolume: '~3 min total fast',
    downgrade: 'Pain, or reps bunching into anaerobic work',
    plain: '4–6 × 15–20s with full walk recovery. An add-on to an easy run, not a workout.',
  },
  {
    key: 'flatStrides',
    name: 'Flat strides',
    unlockState: 3,
    lowDose: true,
    bucket: 'neuromuscular',
    units: 0,
    trains: 'Speed reserve, form at speed',
    maxFreq: '3/wk',
    fastVolume: '~4–5 min total fast',
    downgrade: 'Pain, glycolytic fatigue',
    plain: '4–8 × 20–30s (cap 35s), full recovery. Still low-dose, flat ground only.',
  },
  {
    key: 'hills',
    name: 'Hill strides / short hill sprints',
    unlockState: 4,
    lowDose: false,
    bucket: 'neuromuscular',
    units: 0,
    trains: 'Force, stiffness, eccentric durability',
    maxFreq: '1–2/wk',
    fastVolume: 'Small (6–10 × 8–12s)',
    downgrade: 'ANY anterior-hip pain → hills lock + tier drops to 3',
    plain:
      'Short, low grade, 6–10 × 8–12s, walk-down recovery. Caution: uphill running increases ' +
      'hip-flexor / iliopsoas recruitment (Yokozawa, Fujii & Ae, J Biomech 2007). The exact tissue ' +
      'you are recovering. Hills are NOT your safe entry to speed: flat comes first, and hills wait ' +
      'for the hip to prove itself and for PT sign-off.',
    requires: ['hipSafe', 'ptSpeed'],
    extraGateLabel: 'hip-safe flag + PT speed clearance',
  },
  {
    key: 'fartlek',
    name: 'Light fartlek',
    unlockState: 5,
    lowDose: false,
    bucket: 'light',
    units: TUNABLES.SPEED.FARTLEK_UNITS,
    trains: 'First sustained moderate effort (bridge to workouts)',
    maxFreq: '0–1/wk',
    fastVolume: '4–6 × 30–60s moderate inside an easy run',
    downgrade: 'Pain, high RPE, poor recovery, spike or race week',
    plain:
      'A few relaxed 30–60s pickups inside an easy run — the gentlest introduction to sustained ' +
      'effort. Counts half a hard unit; needs recent check-in data and clean weeks to unlock.',
  },
  {
    key: 'cruise',
    name: 'Cruise-interval threshold',
    unlockState: 6,
    lowDose: false,
    bucket: 'hard',
    units: 1,
    trains: 'Lactate clearance',
    maxFreq: '1/wk',
    fastVolume: '≤10% of weekly miles',
    downgrade: "Pain, HR won't settle, high easy-pace RPE",
    plain: '3–5 × 5 min at threshold with 60–90s jog. The first real workout. Earn it.',
  },
  {
    key: 'tempo',
    name: 'Continuous tempo',
    unlockState: 7,
    lowDose: false,
    bucket: 'hard',
    units: 1,
    trains: 'Sustained threshold, pacing control',
    maxFreq: '1/wk',
    fastVolume: '15–25 min continuous',
    downgrade: 'Pain, fatigue',
    plain: 'Only after ≥2–3 cruise sessions have gone well. Cruise intervals come first. Replaces (never adds to) the weekly hard slot.',
  },
  {
    key: 'vo2',
    name: 'VO₂max intervals',
    unlockState: 8,
    lowDose: false,
    bucket: 'hard',
    units: 1,
    trains: 'vVO₂max',
    maxFreq: '≤1/wk, season only',
    fastVolume: 'Small (4–6 × 3 min)',
    downgrade: 'Any flare, sleep/soreness spike, off-season',
    plain: 'Reps of 3–5 min. Season-gated: youth evidence says VO₂ work buys little that base + threshold don\'t (Engel 2018; Matzka 2025). Needs PT intensity clearance and the coach-led season window.',
    requires: ['ptIntensity'],
    extraGateLabel: 'PT intensity clearance',
  },
  {
    key: 'racePace',
    name: 'Race-pace / long hard speed',
    unlockState: 8,
    lowDose: false,
    bucket: 'hard',
    units: 1,
    trains: 'Goal-pace economy, pacing',
    maxFreq: 'Sparse, season only',
    fastVolume: 'Small',
    downgrade: 'Pain, form breakdown, no goal race',
    plain: 'Goal-pace work inside a valid peak window. Needs PT intensity clearance, a settled hip, and the season.',
    requires: ['ptIntensity'],
    extraGateLabel: 'PT intensity clearance',
  },
];

export function typeStatus(t: SpeedType, globals: GlobalState, today: string): TypeStatus {
  if (globals.speedState < t.unlockState) return 'locked';
  if (!gateSatisfied(t.requires, globals)) return 'locked';
  if (globals.delayUntil && globals.delayUntil > today) return 'delayed';
  return 'allowed';
}

/** Stride validity — reject anything that is a hidden anaerobic session. */
export function validStrides(reps: number, durationS: number, recoveryS: number): boolean {
  return (
    reps >= 1 && reps <= TUNABLES.STRIDES.MAX_REPS &&
    durationS > 0 && durationS <= TUNABLES.STRIDES.MAX_DURATION_S &&
    recoveryS >= TUNABLES.STRIDES.MIN_RECOVERY_S
  );
}
