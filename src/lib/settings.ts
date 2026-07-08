// ============================================================
// PLAN SETTINGS — raw (user-typed) vs effective (safety-clamped).
//
// The user's raw input is persisted verbatim so they never lose a
// value. But NOTHING consumes raw directly: every consumer reads
// effectiveSettings(), whose values are clamped so settings can
// never raise an HR cap, the long-run cap %, the build rate, or
// loosen the pain-free streak gate during this base block. Users
// may make the plan MORE conservative, never less.
// ============================================================

import type { RawSettings, RunState, SpeedStateNum } from './types';
import type { WeekConfig } from '../config/plan';
import { PLAN_START_DATE, WEEK_CONFIGS, HR, AWARD } from '../config/plan';
import { DEFAULT_HIDDEN_IDS } from '../config/homeBlocks';
import { TUNABLES } from '../config/tunables';
import {
  mondayOf, nextMonday, addDaysStr, weeklyActuals, trailing30Longest, nextLongFrom, floorToHalf,
} from './metrics';

const SETTINGS_VERSION = 1 as const;

/** Design/static-plan defaults — the Settings UI's starting values. Note:
 *  settings === null (never opened) yields the pure static plan; these
 *  defaults are what populate the form the first time it opens. */
export function defaultSettings(nowIso: string): RawSettings {
  const staticTotal = WEEK_CONFIGS[0].miles.reduce((a, b) => a + b, 0);
  return {
    version: SETTINGS_VERSION,
    goalMiles: AWARD.target,
    safeDelivery: AWARD.safePlanDelivery,
    daysPerWeek: 5,
    blockWeeks: WEEK_CONFIGS.length,
    downEvery: 4,
    startDate: PLAN_START_DATE,
    // Official XC/coach season default: the Monday just after the base block
    // ends (mid-August). Weeks on/after this date maintain instead of building.
    xcStartDate: addDaysStr(PLAN_START_DATE, WEEK_CONFIGS.length * 7),
    startMpw: Math.round(staticTotal),
    peakMpw: 30,
    buildStep: 1,
    trailingLongest: TUNABLES.TRAILING_FALLBACK,
    hrEasyMin: HR.easyMin,
    hrEasyMax: HR.easyMax,
    hrHardCap: HR.hardCap,
    hrMax: HR.hrmax,
    capPct: Math.round(TUNABLES.CAP_FACTOR * 100),
    pfNeeded: 4,
    adaptive: true,
    layoutOrder: [],                    // [] = registry default order (Stage G)
    layoutOff: [...DEFAULT_HIDDEN_IDS],  // secondary widgets are hidden by default
    updated_at: nowIso,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Additive, idempotent settings migration. Accepts the design prototype's
 * shape too — notably layoutOff as Record<string,boolean> (converted to a
 * string[] of hidden ids). null in → null out (settings absent = static plan).
 */
export function migrateSettings(raw: unknown, nowIso: string): RawSettings | null {
  if (raw == null) return null;
  if (!isRecord(raw)) return null;
  const d = defaultSettings(nowIso);

  // layoutOff may arrive as Record<string,boolean> (prototype) or string[].
  // Absent entirely → stubs hidden by default (a fresh layout).
  let layoutOff: string[];
  if (Array.isArray(raw.layoutOff)) {
    layoutOff = raw.layoutOff.filter(x => typeof x === 'string');
  } else if (isRecord(raw.layoutOff)) {
    layoutOff = Object.keys(raw.layoutOff).filter(k => raw.layoutOff && (raw.layoutOff as Record<string, unknown>)[k] === true);
  } else {
    layoutOff = [...DEFAULT_HIDDEN_IDS];
  }
  const layoutOrder = Array.isArray(raw.layoutOrder)
    ? raw.layoutOrder.filter(x => typeof x === 'string')
    : [];

  return {
    version: SETTINGS_VERSION,
    goalMiles: num(raw.goalMiles, d.goalMiles),
    safeDelivery: num(raw.safeDelivery, d.safeDelivery),
    daysPerWeek: num(raw.daysPerWeek, d.daysPerWeek),
    blockWeeks: num(raw.blockWeeks, d.blockWeeks),
    downEvery: num(raw.downEvery, d.downEvery),
    startDate: typeof raw.startDate === 'string' ? raw.startDate : d.startDate,
    xcStartDate: typeof raw.xcStartDate === 'string' ? raw.xcStartDate : d.xcStartDate,
    startMpw: num(raw.startMpw, d.startMpw),
    peakMpw: num(raw.peakMpw, d.peakMpw),
    buildStep: num(raw.buildStep, d.buildStep),
    trailingLongest: num(raw.trailingLongest, d.trailingLongest),
    hrEasyMin: num(raw.hrEasyMin, d.hrEasyMin),
    hrEasyMax: num(raw.hrEasyMax, d.hrEasyMax),
    hrHardCap: num(raw.hrHardCap, d.hrHardCap),
    hrMax: num(raw.hrMax, d.hrMax),
    capPct: num(raw.capPct, d.capPct),
    pfNeeded: num(raw.pfNeeded, d.pfNeeded),
    adaptive: raw.adaptive !== false,
    layoutOrder,
    layoutOff,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : nowIso,
  };
}

// ── Effective (clamped) settings ─────────────────────────────

export interface ClampNote {
  field: string;
  requested: number;
  applied: number;
  reason: string;
}

export type EffectiveSettings = RawSettings;

function clampField(
  clamps: ClampNote[], field: string, requested: number, applied: number, reason: string,
): number {
  if (Math.abs(requested - applied) > 1e-9) clamps.push({ field, requested, applied, reason });
  return applied;
}

/**
 * Clamp raw settings to the base-block safety envelope. Returns the effective
 * (safe) settings plus human-readable notes for every value that was pulled
 * back. Lowering a cap is always honored; raising one is clamped.
 */
export function effectiveSettings(
  raw: RawSettings, runState: RunState, today: string,
): { eff: EffectiveSettings; clamps: ClampNote[] } {
  const clamps: ClampNote[] = [];
  const eff: RawSettings = { ...raw };

  // Long-run cap %: never above the Frandsen 110% ceiling. Lower is allowed.
  const capCeil = Math.round(TUNABLES.CAP_FACTOR * 100);
  eff.capPct = clampField(clamps, 'capPct', raw.capPct, Math.min(raw.capPct, capCeil),
    `The long-run cap can't exceed ${capCeil}% of your recent longest. That's the core injury rule (Frandsen 2025).`);

  // HR intensity caps: never above the configured governors. Lower allowed.
  eff.hrEasyMin = clampField(clamps, 'hrEasyMin', raw.hrEasyMin, Math.min(raw.hrEasyMin, HR.easyMin),
    `Easy HR floor stays at or below ${HR.easyMin} for base work.`);
  eff.hrEasyMax = clampField(clamps, 'hrEasyMax', raw.hrEasyMax, Math.min(raw.hrEasyMax, HR.easyMax),
    `Easy HR ceiling stays at or below ${HR.easyMax}, the aerobic band.`);
  eff.hrHardCap = clampField(clamps, 'hrHardCap', raw.hrHardCap, Math.min(raw.hrHardCap, HR.hardCap),
    `Hard-cap HR stays at or below ${HR.hardCap} this block. No training above it.`);
  // hrMax is physiological, not a safety cap (it's the % denominator); left as
  // typed within the migrate bounds. Raising it only makes the % read lower.

  // Starting-longest seed: never above one ladder step past your logged longest.
  const seedCeil = nextLongFrom(trailing30Longest(runState, today));
  eff.trailingLongest = clampField(clamps, 'trailingLongest', raw.trailingLongest,
    Math.min(raw.trailingLongest, seedCeil),
    `Your starting long run can't exceed the safe next step (${seedCeil.toFixed(1)} mi) from your logged runs.`);

  // Starting week volume: never more than +10% over your last sustained week.
  const weeks = weeklyActuals(runState, today).filter(w => w.weekStart < mondayOf(today));
  const lastSustained = [...weeks].reverse().find(w => w.miles > 0);
  const staticW1 = WEEK_CONFIGS[0].miles.reduce((a, b) => a + b, 0);
  const startCeil = Math.max(lastSustained?.miles ?? 0, staticW1) * TUNABLES.WEEKLY_GROWTH_MAX;
  eff.startMpw = clampField(clamps, 'startMpw', raw.startMpw, Math.min(raw.startMpw, startCeil),
    `First week can't jump more than +10% over your last sustained week (${startCeil.toFixed(1)} mi).`);

  // Peak: a ceiling the build aims at; must be at least the start.
  eff.peakMpw = clampField(clamps, 'peakMpw', raw.peakMpw, Math.max(raw.peakMpw, eff.startMpw),
    `Peak week can't be below the starting week.`);

  // buildStep is enforced week-by-week in the builder (min with +10%); flag if
  // the requested absolute step exceeds 10% of the starting week.
  const stepCeil = eff.startMpw * (TUNABLES.WEEKLY_GROWTH_MAX - 1);
  if (raw.buildStep > stepCeil + 1e-9) {
    clamps.push({
      field: 'buildStep', requested: raw.buildStep, applied: Math.round(stepCeil * 10) / 10,
      reason: `Weekly growth is capped at +10%; large steps are throttled each week.`,
    });
  }
  // pfNeeded is combined per-target via requiredStreakFor (never below the
  // built-in requirement), so raw stays as-is here (raising it is safe).

  return { eff, clamps };
}

/** Per-target pain-free streak requirement: the STRICTER of the user's
 *  pfNeeded and the built-in per-state requirement. Users can demand more,
 *  never less. */
export function requiredStreakFor(target: SpeedStateNum, eff: RawSettings | null): number {
  const builtin = TUNABLES.REQUIRED_STREAK[target] ?? 4;
  return Math.max(builtin, eff?.pfNeeded ?? 0);
}

// ── Season reset / transition block ──────────────────────────
// Reseed a FRESH base block from RECENT ACTUAL training, not the old peak.
// After a season or a break, fitness and tissue tolerance reflect what the
// runner has done LATELY, so the restart anchors startMpw to ~80% of the last
// sustained week and the long-run seed to the trailing-30 longest. Preferences
// (goal, days/week, block length, governors, layout) carry over unchanged.
// The caller resets speedState to 1 so speed is RE-EARNED through the ladder,
// never auto-resumed. No logged run is ever deleted.
export function resetToRecentActuals(
  current: RawSettings | null,
  runState: RunState,
  today: string,
  nowIso: string,
): RawSettings {
  const base = current ?? defaultSettings(nowIso);
  // Use COMPLETE weeks only — the partial current week undercounts recent volume
  // (same reasoning as the generator's trend calculation).
  const curMonday = mondayOf(today);
  const complete = today >= addDaysStr(curMonday, 6);
  const weeks = weeklyActuals(runState, today).filter(
    w => w.weekStart < curMonday || (w.weekStart === curMonday && complete),
  );
  const lastSustained = [...weeks].reverse().find(w => w.miles > 0);
  // Conservative re-entry: 80% of the last sustained week, floored, and never
  // above what the settings clamp would already allow.
  const recent = lastSustained ? lastSustained.miles : 0;
  const startMpw = recent > 0 ? Math.max(8, Math.round(recent * 0.8)) : Math.min(base.startMpw, 15);
  const seed = Math.max(2, Math.min(trailing30Longest(runState, today), 15));

  const startDate = nextMonday(today);
  return {
    ...base,
    startDate,
    // A fresh base block BUILDS again, so push the XC/maintenance line to just
    // after the new block — otherwise an old (now-past) xcStartDate would flip
    // the whole restart straight into maintenance.
    xcStartDate: addDaysStr(startDate, clampBlockWeeks(base.blockWeeks) * 7),
    startMpw,
    peakMpw: Math.max(base.peakMpw, startMpw),
    trailingLongest: seed,
    updated_at: nowIso,
  };
}

// ── Build week configs from settings ─────────────────────────

export function roundHalf(x: number): number {
  return Math.round(x / TUNABLES.HALF_STEP) * TUNABLES.HALF_STEP;
}

/** Split a weekly total into run-day miles: long run last, day-before-long
 *  lightest, no easy day above the long-run ceiling. The prescribed sum never
 *  exceeds roundHalf(total) — half-step rounding is trimmed down, never up, so
 *  the peak-week ceiling genuinely binds. */
export function splitWeek(total: number, long: number, daysPerWeek: number): number[] {
  const easyCount = Math.max(0, daysPerWeek - 1);
  const longR = roundHalf(long);
  if (easyCount === 0) return [longR];
  const easyBudget = Math.max(roundHalf(total) - longR, 0);
  const weights: number[] = [];
  for (let i = 0; i < easyCount; i++) weights.push(i === easyCount - 1 ? 0.7 : 1); // last easy day lighter
  const wsum = weights.reduce((a, b) => a + b, 0);
  const easy = weights.map(w => Math.min(roundHalf((easyBudget * w) / wsum), longR));
  // Trim rounding overshoot from the largest easy day so the total never
  // exceeds the (rounded) target — keeps peakMpw a true ceiling.
  let sum = easy.reduce((a, b) => a + b, 0);
  while (sum > easyBudget + 1e-9) {
    let idx = 0;
    for (let i = 1; i < easy.length; i++) if (easy[i] > easy[idx]) idx = i;
    if (easy[idx] <= 0) break;
    easy[idx] -= TUNABLES.HALF_STEP;
    sum -= TUNABLES.HALF_STEP;
  }
  easy.push(longR);
  return easy;
}

export function clampBlockWeeks(n: number): number {
  return Math.round(Math.min(12, Math.max(1, n)));
}

/** Normalized down-week cadence — every Nth week, N ≥ 2. */
function normDownEvery(downEvery: number): number {
  return Math.max(2, Math.round(downEvery));
}

/**
 * Is week `j` a SCHEDULED down (absorption) week? Every `downEvery`th week, but
 * never the first week and never the final (handoff) week — the block hands off
 * at the peak, not a deload. This is the base-block scaffold's cadence; the
 * generator inserts pain-driven down weeks dynamically on top of actuals.
 */
function isScheduledDownIdx(j: number, weeksN: number, downEvery: number): boolean {
  const isFinal = j === weeksN - 1 && weeksN > 1;
  return !isFinal && j > 0 && (j + 1) % downEvery === 0;
}

/** Is week `j` in the XC/coach maintenance phase? True when its Monday lands on
 *  or after xcStartDate — from there the plan MAINTAINS (holds volume) instead
 *  of building toward the peak. Absent/blank xcStartDate → never (pure base). */
function isMaintenanceIdx(j: number, eff: EffectiveSettings): boolean {
  if (!eff.xcStartDate) return false;
  return addDaysStr(eff.startDate, j * 7) >= eff.xcStartDate;
}

/** Count of true BUILD weeks from index `i` through the end (inclusive) —
 *  neither scheduled down weeks NOR maintenance weeks count, so the ramp sizes
 *  each step to reach peakMpw by the time it hands off / enters maintenance,
 *  never spreading the gap across weeks that will not actually build. Always ≥ 1. */
function buildsRemainingFrom(i: number, weeksN: number, eff: EffectiveSettings): number {
  const downEvery = normDownEvery(eff.downEvery);
  let n = 0;
  for (let j = i; j < weeksN; j++) {
    if (!isScheduledDownIdx(j, weeksN, downEvery) && !isMaintenanceIdx(j, eff)) n++;
  }
  return Math.max(1, n);
}

/** Carried between weeks: the long-run seed and the BUILD trajectory (the last
 *  real build week's total). The trajectory — NOT the displayed total — is what
 *  the next build resumes from, so an absorption week never re-baselines the
 *  plan downward. */
export interface StepCarry {
  long: number;
  traj: number;
}

/**
 * Build one week from the carried long-run seed + build trajectory. The block
 * ramps from startMpw toward peakMpw and HANDS OFF at the peak (the final week
 * is a peak/handoff week, never a forced taper — a taper belongs to a race week,
 * which this base block has none of). Scheduled down weeks are temporary dips
 * off the trajectory; the following week resumes the build from the trajectory,
 * not from the down week.
 *
 * Structural safety baked in (all preserved from before):
 *  • no build week grows more than +10% over the last BUILD week (trajectory)
 *  • no week ever exceeds peakMpw
 *  • down weeks cut ~20% off the trajectory and HOLD the long run (no ladder step)
 *  • the long run advances only via nextLongFrom(prevLong) — ≤110% of prior
 *
 * What changed (the progression fix):
 *  • buildStep is a slope FLOOR, not the whole step: each build also moves a
 *    share of the remaining gap to peak, so editing peakMpw actually re-solves
 *    the future toward that target instead of crawling +buildStep forever.
 *  • the trajectory survives down weeks, so W(after-down) resumes near the last
 *    build level rather than anchoring to the reduced down-week volume.
 *  • the final week is a handoff at peak, not an unconditional collapse.
 *
 * Maintenance phase (XC season): weeks on/after xcStartDate HOLD volume at the
 * trajectory (min with peak) instead of building — coach-primary/guardrail mode.
 * Scheduled down weeks still apply; the long run holds (no ladder step). The
 * trajectory and long-run seed are preserved, so maintenance is flat, not drift.
 */
export function stepWeek(
  i: number, weeksN: number, prev: StepCarry, eff: EffectiveSettings,
): { config: WeekConfig; total: number; long: number; traj: number } {
  const days = Math.round(Math.min(6, Math.max(3, eff.daysPerWeek)));
  const downEvery = normDownEvery(eff.downEvery);
  const isFinal = i === weeksN - 1 && weeksN > 1;
  const isDown = isScheduledDownIdx(i, weeksN, downEvery);
  const isMaint = isMaintenanceIdx(i, eff);

  let total: number;
  if (i === 0) {
    total = eff.startMpw;
  } else if (isDown) {
    // Absorption week: dip off the BUILD trajectory (not the previous displayed
    // total). The trajectory is left untouched below so the next build resumes
    // from the last real build level.
    total = prev.traj * (1 - TUNABLES.SCHEDULED_DOWN_CUT);
  } else if (isMaint) {
    // XC/coach season: maintain — hold at the trajectory (never build past it),
    // capped at the peak. Volume stays flat while the coach drives the work.
    total = Math.min(prev.traj, eff.peakMpw);
  } else {
    // Build toward peakMpw: buildStep is a floor, the gap-to-peak spread over
    // the remaining build weeks is the target, and +10%/week is the hard safety
    // ceiling. So the ramp reaches the peak by the handoff without ever
    // breaching the week-over-week growth cap or overshooting the peak.
    const remaining = buildsRemainingFrom(i, weeksN, eff);
    const gapStep = Math.max(0, eff.peakMpw - prev.traj) / remaining;
    const step = Math.min(
      Math.max(eff.buildStep, gapStep),
      prev.traj * (TUNABLES.WEEKLY_GROWTH_MAX - 1),
    );
    total = Math.min(prev.traj + step, eff.peakMpw);
  }

  // Down AND maintenance weeks hold the long run (prev.long is already a
  // half-step); only build/handoff weeks step it up the ladder. The long run is
  // then capped at the peak WEEK: a single run can never exceed a whole week's
  // ceiling, so a high starting-long seed or a long block can't ladder the long
  // run past peakMpw and drag the week total above its own cap.
  const holdLong = isDown || isMaint;
  const rawLong = holdLong ? floorToHalf(prev.long) : nextLongFrom(prev.long);
  const long = Math.min(rawLong, floorToHalf(eff.peakMpw));
  total = Math.max(roundHalf(total), long); // a week is never smaller than its long run

  const miles = splitWeek(total, long, days);
  // Carry the ACTUAL prescribed sum forward (not the pre-split target) so the
  // +10% growth cap is measured against real totals and never compounds drift.
  const actualTotal = miles.reduce((a, b) => a + b, 0);

  let note: string | undefined;
  if (isDown) note = 'down week';
  else if (isMaint && !isFinal) note = 'maintain';
  else if (isFinal) note = 'handoff';
  else if (actualTotal >= eff.peakMpw - 1e-9 && prev.traj < eff.peakMpw - 1e-9) note = 'peak';

  return {
    config: { miles, note, isDownWeek: isDown },
    total: actualTotal,
    // The trajectory only advances on real build weeks; absorption AND
    // maintenance weeks keep the prior trajectory so volume neither drifts up
    // nor re-baselines down.
    traj: holdLong ? prev.traj : actualTotal,
    long: holdLong ? prev.long : long,
  };
}

/** Build a full WeekConfig[] purely from settings (no locked-week splicing). */
export function buildWeekConfigsFromSettings(eff: EffectiveSettings): WeekConfig[] {
  const weeksN = clampBlockWeeks(eff.blockWeeks);
  const configs: WeekConfig[] = [];
  let carry: StepCarry = { long: eff.trailingLongest, traj: eff.startMpw };
  for (let i = 0; i < weeksN; i++) {
    const { config, long, traj } = stepWeek(i, weeksN, carry, eff);
    configs.push(config);
    carry = { long, traj };
  }
  return configs;
}
