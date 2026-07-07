// ============================================================
// SPEED PERMISSION MACHINE — a single global speedState (1–8)
// gates every kind of fast running. Upward transitions require
// the readiness checklist all-green; downward is always allowed.
// State 8 (flare/deload) is an override that supersedes all.
// ============================================================

import type { GlobalState, RawSettings, RunState, SpeedStateNum } from './types';
import { TUNABLES } from '../config/tunables';
import { painFreeStreak, flareActive, mondayOf, addDaysStr } from './metrics';
import { requiredStreakFor } from './settings';

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
  5: ['hipSafe', 'ptSpeed'],   // intro hills — hip-flexor caution (Yokozawa 2007)
  7: ['ptIntensity'],          // structured speed
};

export const SPEED_STATE_NAMES: Record<SpeedStateNum, string> = {
  1: 'Base only',
  2: 'Buildups allowed',
  3: 'Short strides allowed',
  4: 'Flat neuromuscular strides allowed',
  5: 'Intro hills allowed (hip-safe only)',
  6: 'Intro threshold allowed',
  7: 'Structured speed allowed',
  8: 'Flare-up / deload',
};

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

/**
 * Evaluate readiness to step UP into `target` (= current + 1).
 * All items must be green. Injury gates: 4→5 needs hipSafeFlag &&
 * ptClearedSpeed; 6→7 needs ptClearedIntensity.
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
  //    and the user's pfNeeded setting (settings can only tighten it).
  const streak = painFreeStreak(runState, painCap);
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
    detail: flared ? 'flare window active — deload first' : 'clear',
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
  if (target < current || target === 8) return { allowed: true, reason: 'downgrades are always allowed' };
  if (target > current + 1) return { allowed: false, reason: 'advance one state at a time' };
  const report = evaluateReadiness(target, runState, globals, today, settings);
  return report.allGreen
    ? { allowed: true, reason: 'readiness all green' }
    : { allowed: false, reason: report.items.filter(i => !i.ok).map(i => i.label).join(' · ') };
}

/**
 * When a clearance is revoked out from under the current state, return the
 * downgrade patch the app must apply. Flare (state 8) is left untouched — it's
 * the strongest override. Hills need hip-safe + PT speed; structured needs PT
 * intensity. Missing the hip clearance drops to 4 (the pre-hills state);
 * missing only intensity drops to 6.
 */
export function enforceGateConsistency(globals: GlobalState): Partial<GlobalState> | null {
  const s = globals.speedState;
  if (s === 8) return null;
  if (s >= 5 && !gateSatisfied(STATE_GATES[5], globals)) return { speedState: 4 };
  if (s >= 7 && !gateSatisfied(STATE_GATES[7], globals)) return { speedState: 6 };
  return null;
}

// ── Speed type catalogue ─────────────────────────────────────

export type TypeStatus = 'allowed' | 'delayed' | 'locked';

export interface SpeedType {
  key: string;
  name: string;
  unlockState: SpeedStateNum;
  lowDose: boolean;         // softer visual treatment; add-on, not a workout
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
    unlockState: 2,
    lowDose: true,
    trains: 'Economy, coordination — near-zero fatigue',
    maxFreq: '2/wk',
    fastVolume: '~2 min total fast',
    downgrade: 'Any hip pain',
    plain: 'Gentle accelerations, ≤15–20s, full recovery. The softest possible touch of speed.',
  },
  {
    key: 'shortStrides',
    name: 'Short strides',
    unlockState: 3,
    lowDose: true,
    trains: 'Motor-unit recruitment',
    maxFreq: '3/wk',
    fastVolume: '~3 min total fast',
    downgrade: 'Pain, or reps bunching into anaerobic work',
    plain: '4–6 × 15–20s with full walk recovery. An add-on to an easy run, not a workout.',
  },
  {
    key: 'flatStrides',
    name: 'Flat neuromuscular strides',
    unlockState: 4,
    lowDose: true,
    trains: 'Speed reserve, form at speed',
    maxFreq: '3/wk',
    fastVolume: '~4–5 min total fast',
    downgrade: 'Pain, glycolytic fatigue',
    plain: '4–8 × 20–30s (cap 35s), full recovery. Still low-dose — flat ground only.',
  },
  {
    key: 'hills',
    name: 'Intro hills',
    unlockState: 5,
    lowDose: false,
    trains: 'Force, stiffness',
    maxFreq: '1/wk',
    fastVolume: 'Small',
    downgrade: 'ANY anterior-hip pain → hills lock + state drops to 4',
    plain:
      'Short, low grade, 4–6 × 8–15s. Caution: uphill running increases hip-flexor / iliopsoas ' +
      'recruitment (Yokozawa, Fujii & Ae, J Biomech 2007) — the exact tissue you are recovering. ' +
      'Hills are NOT your safe entry to speed: flat comes first, and hills wait for the hip to ' +
      'prove itself and for PT sign-off.',
    requires: ['hipSafe', 'ptSpeed'],
    extraGateLabel: 'hip-safe flag + PT speed clearance',
  },
  {
    key: 'cruise',
    name: 'Cruise-interval threshold',
    unlockState: 6,
    lowDose: false,
    trains: 'Lactate clearance',
    maxFreq: '1/wk',
    fastVolume: '≤10% of weekly miles',
    downgrade: "Pain, HR won't settle, high easy-pace RPE",
    plain: '3–5 × 5 min at threshold with 60–90s jog. The first real workout — earn it.',
  },
  {
    key: 'tempo',
    name: 'Continuous tempo',
    unlockState: 6,
    lowDose: false,
    trains: 'Threshold',
    maxFreq: '1/wk',
    fastVolume: '≤10% of weekly miles',
    downgrade: 'Pain, fatigue',
    plain: 'Only after ≥2–3 cruise sessions have gone well. Cruise intervals come first.',
  },
  {
    key: 'vo2',
    name: 'VO₂max intervals',
    unlockState: 7,
    lowDose: false,
    trains: 'vVO₂max',
    maxFreq: '1/wk',
    fastVolume: 'Small',
    downgrade: 'Any flare, sleep/soreness spike',
    plain: 'Reps of 3–5 min. Needs PT intensity clearance — the top of the ladder.',
    requires: ['ptIntensity'],
    extraGateLabel: 'PT intensity clearance',
  },
  {
    key: 'racePace',
    name: 'Race-pace / long hard speed',
    unlockState: 7,
    lowDose: false,
    trains: 'Goal-pace economy, pacing',
    maxFreq: '1/wk',
    fastVolume: 'Small',
    downgrade: 'Pain, form breakdown',
    plain: 'Goal-pace work. Needs PT intensity clearance and a settled hip.',
    requires: ['ptIntensity'],
    extraGateLabel: 'PT intensity clearance',
  },
];

export function typeStatus(t: SpeedType, globals: GlobalState, today: string): TypeStatus {
  if (globals.speedState === 8) return 'locked';                    // flare overrides all
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
