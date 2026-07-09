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
import type { AdaptiveModulation } from './adaptive';
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
    weeksShown: WEEK_CONFIGS.length,
    downEvery: 4,
    startDate: PLAN_START_DATE,
    // Official XC/coach season default: the Monday just after the base block
    // ends (mid-August). Weeks on/after this date maintain instead of building.
    xcStartDate: addDaysStr(PLAN_START_DATE, WEEK_CONFIGS.length * 7),
    startMpw: Math.round(staticTotal),
    peakMpw: 30,
    // +1.5 mi/wk: a summer-XC-base-appropriate default (~7.5% at 20mpw, well
    // inside the +10%/wk safety cap) that reaches a 20→30 build in ~7 weeks.
    // Still user-editable 0.5–4; the safety cap governs regardless.
    buildStep: 1.5,
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
    // Rolling model: `weeksShown` (display horizon). Older blobs used
    // `blockWeeks` (which also meant "the block ends here" — that concept is
    // gone). Read either; write `weeksShown`.
    weeksShown: num(raw.weeksShown ?? raw.blockWeeks, d.weeksShown),
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

// ── Return from break ───────────────────────────────────────
// The end-of-break flow. Length-aware, evidence-flavored (detraining after ~3
// weeks off is real; a few days off is not). Scales the pre-break sustained
// volume down and reseeds the plan from `nextMonday(today)`. The run log is
// never touched. Callers apply speed-layer resets (state → 1, PT clearances) on
// long breaks separately; this function only shapes the plan.
//
//   < 7  days   → 100% resume (a rest week doesn't need a reseed)
//   7–13 days   → 90%  gentle re-entry
//  14–20 days   → 75%  standard return-to-running seed
//  21–41 days   → 60%  conservative ramp (detraining measurable)
//  ≥ 42 days    → 45%  very conservative — treat as a fresh base
export function returnFromBreak(
  current: RawSettings | null,
  runState: RunState,
  today: string,
  breakStart: string,
  nowIso: string,
): { settings: RawSettings; breakDays: number; seedFactor: number } {
  const base = current ?? defaultSettings(nowIso);
  const breakDays = Math.max(
    0,
    Math.floor((Date.parse(today + 'T12:00:00Z') - Date.parse(breakStart + 'T12:00:00Z')) / 86_400_000),
  );

  const seedFactor =
    breakDays < 7 ? 1.0
    : breakDays < 14 ? 0.90
    : breakDays < 21 ? 0.75
    : breakDays < 42 ? 0.60
    : 0.45;

  // Pre-break sustained: the last completed week WITH miles, looking BEFORE
  // breakStart. If nothing is on file (very new athlete, or break lands right
  // after starting), fall back to the current startMpw so we don't seed 0.
  const preBreak = weeklyActuals(runState, breakStart).filter(w => w.weekStart < breakStart);
  const lastSustained = [...preBreak].reverse().find(w => w.miles > 0);
  const preBreakVolume = lastSustained?.miles ?? base.startMpw;
  const startMpw = Math.max(6, Math.round(preBreakVolume * seedFactor));

  // Trailing longest naturally decays to the fallback during a real break;
  // clamp to a safe seed regardless.
  const seed = Math.max(2, Math.min(trailing30Longest(runState, today), 5));

  const startDate = nextMonday(today);
  const settings: RawSettings = {
    ...base,
    startDate,
    // Preserve a still-future XC/coach season date: it's the athlete's real
    // season anchor, not a byproduct of the window. Only recompute a fallback
    // when the stored date is missing or now stale (on/before the new start),
    // so a mid-July return can't shove a real September season past its date.
    xcStartDate: base.xcStartDate && base.xcStartDate > startDate
      ? base.xcStartDate
      : addDaysStr(startDate, clampWeeksShown(base.weeksShown) * 7),
    startMpw,
    peakMpw: Math.max(base.peakMpw, startMpw),
    trailingLongest: seed,
    updated_at: nowIso,
  };
  return { settings, breakDays, seedFactor };
}

// ── Build week configs from settings ─────────────────────────

export function roundHalf(x: number): number {
  return Math.round(x / TUNABLES.HALF_STEP) * TUNABLES.HALF_STEP;
}

/** Split a weekly total into run-day miles: long run last, day-before-long
 *  lightest, no easy day above the long-run ceiling.
 *
 *  The easy days sum EXACTLY to `roundHalf(total) - longR` (when per-day
 *  capacity allows) via a largest-remainder apportionment in half-steps —
 *  never a silent round-DOWN. That matters because the previous
 *  round-each-day-then-trim approach could shave up to ~1.5 mi off a week, so a
 *  1.0–2.0 mi weekly build step got quietly eaten and the plan crawled. The
 *  prescribed sum still never EXCEEDS roundHalf(total), so peakMpw stays a true
 *  ceiling; and no easy day ever exceeds the long run (per-day cap). */
export function splitWeek(total: number, long: number, daysPerWeek: number): number[] {
  const easyCount = Math.max(0, daysPerWeek - 1);
  const longR = roundHalf(long);
  if (easyCount === 0) return [longR];

  const STEP = TUNABLES.HALF_STEP;
  const easyBudget = Math.max(roundHalf(total) - longR, 0);
  const weights: number[] = [];
  for (let i = 0; i < easyCount; i++) weights.push(i === easyCount - 1 ? 0.7 : 1); // last easy day lighter
  const wsum = weights.reduce((a, b) => a + b, 0);

  // Work in whole half-steps so the easy days can sum to the budget exactly.
  const capSteps = Math.max(0, Math.round(longR / STEP));       // no easy day > long run
  const budgetSteps = Math.round(easyBudget / STEP);
  const ideal = weights.map(w => (budgetSteps * w) / wsum);     // each day's fair share (half-steps)
  const steps = ideal.map(x => Math.min(Math.floor(x + 1e-9), capSteps));
  let placed = steps.reduce((a, b) => a + b, 0);

  // Hand out the leftover half-steps to the days furthest below their fair
  // share (largest-remainder). Strict '>' means ties go to the EARLIER, heavier
  // day, so the day before the long run stays the lightest. Per-day cap keeps
  // any easy day from exceeding the long run; if every day is capped we simply
  // stop (the week can't hold more without breaching that rule).
  while (placed < budgetSteps) {
    let best = -1;
    let bestGap = -Infinity;
    for (let i = 0; i < easyCount; i++) {
      if (steps[i] >= capSteps) continue;
      const gap = ideal[i] - steps[i];
      if (gap > bestGap + 1e-9) { bestGap = gap; best = i; }
    }
    if (best < 0) break;
    steps[best]++;
    placed++;
  }

  const easy = steps.map(s => s * STEP);
  easy.push(longR);
  return easy;
}

/** Clamp the display window (how many future weeks the app renders). Purely a
 *  visualization horizon — the rolling engine can generate arbitrarily many
 *  weeks beyond it. Kept ≥1 so there's always something to show, and ≤24 so
 *  the DOM/computation stays cheap. */
export function clampWeeksShown(n: number): number {
  return Math.round(Math.min(24, Math.max(1, n)));
}

/** Normalized down-week cadence — every Nth week, N ≥ 2. */
function normDownEvery(downEvery: number): number {
  return Math.max(2, Math.round(downEvery));
}

/** Growth-factor guard for individual adaptation. The modulation may only SLOW
 *  or HOLD the build, never accelerate it, so the factor is clamped to [0,1]:
 *  1 (or an absent/NaN factor) is identity, 0 holds volume flat. This keeps the
 *  hook safety-subordinate even if a caller passes an out-of-range value. */
function clampGrowth(f: number): number {
  return Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 1;
}

/**
 * Is week `j` a SCHEDULED down (absorption) week? Every `downEvery`th week
 * (excluding the very first). The rolling model has no "final week" — the plan
 * keeps going — so the cadence is uniform. The generator layers pain-driven
 * down weeks dynamically on top of the cadence.
 */
function isScheduledDownIdx(j: number, downEvery: number): boolean {
  return j > 0 && (j + 1) % downEvery === 0;
}

/** Is week `j` in the XC/coach maintenance phase? True when its Monday lands on
 *  or after xcStartDate — from there the plan MAINTAINS (holds volume) instead
 *  of building toward the peak. Absent/blank xcStartDate → never (pure base). */
function isMaintenanceIdx(j: number, eff: EffectiveSettings): boolean {
  if (!eff.xcStartDate) return false;
  return addDaysStr(eff.startDate, j * 7) >= eff.xcStartDate;
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
 * Build one week from the carried long-run seed + build trajectory. This is a
 * ROLLING model — no block boundary, no "final week," no forced handoff. The
 * plan builds from startMpw toward peakMpw at `buildStep` mi/week, holds a
 * scheduled down week every `downEvery` weeks (a shallow dip off the
 * trajectory), then holds at peak indefinitely. A separate MAINTENANCE phase
 * kicks in on/after xcStartDate — coach-primary hold, no build, long run flat.
 *
 * Structural safety (invariants that survive every settings combo):
 *  • no build week grows more than +10% of the last BUILD week (trajectory) —
 *    or, when Phase 2C earned-trust is active, up to the earned cap
 *    (mod.earnedGrowthMax, hard-limited to EARNED_TRUST.HARD_CEILING); the
 *    default (no/identity mod) stays at exactly +10%/wk
 *  • no week's total ever exceeds peakMpw
 *  • no single run ever exceeds the peak WEEK (long capped at floorToHalf(peak))
 *  • the long-run ladder advances only via nextLongFrom(prevLong) — ≤110%
 *  • down weeks cut ~15% off the trajectory and HOLD the long run
 *  • the trajectory survives down weeks: the week AFTER a down week resumes
 *    from the last real BUILD level, never from the reduced down-week total
 *  • buildStep drives the rate honestly — changing the display window does
 *    not compress or stretch the training slope
 *
 * Individual adaptation (`mod`, optional): `growthFactor` (≤1) scales ONLY the
 * positive build increment; `downEvery` may only TIGHTEN the absorption cadence
 * (min with the setting); `holdLong` (Phase 2A long-run readiness gate) freezes
 * the long-run ladder for this cycle without freezing the weekly trajectory.
 * Those three are downward-only. Phase 2C adds `earnedGrowthMax` — the one field
 * that may WIDEN a ceiling (the +10%/wk weekly-growth cap → the earned cap),
 * present only when earned-trust is active. Absent `mod` (or an identity `mod`
 * with holdLong falsy and no earnedGrowthMax) leaves every week byte-identical.
 * Even with earnedGrowthMax set, `mod` can never loosen the long-run ladder, the
 * peak ceiling, or the pain gate — only the weekly-volume growth increment.
 */
export function stepWeek(
  i: number, prev: StepCarry, eff: EffectiveSettings, mod?: AdaptiveModulation | null,
): { config: WeekConfig; total: number; long: number; traj: number } {
  const days = Math.round(Math.min(6, Math.max(3, eff.daysPerWeek)));
  // Adaptation may only tighten the cadence (min), never loosen it. Identity =
  // no mod, or a mod whose downEvery is ≥ the setting.
  const downEvery = normDownEvery(mod ? Math.min(eff.downEvery, mod.downEvery) : eff.downEvery);
  // growthFactor scales the positive build increment only. Identity = 1.
  const growthFactor = mod ? clampGrowth(mod.growthFactor) : 1;
  const isDown = isScheduledDownIdx(i, downEvery);
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
    // Ramp toward peakMpw. `buildStep` is the MINIMUM weekly increase; when the
    // peak is still far the plan closes a share (~1/PEAK_RAMP_WEEKS) of the gap
    // each week so that raising or lowering the peak visibly reshapes the future
    // — but never faster than the weekly-growth safety ceiling, and never past
    // the peak. The gap term uses a FIXED reference horizon, NOT weeksShown, so
    // the display window never changes the training slope (no horizon
    // compression). A near peak (small gap) moves at buildStep; a distant peak
    // accelerates up to the safety cap; peakMpw is always the terminal ceiling.
    //
    // Phase 2C earned-trust: the ONLY input that may WIDEN this ceiling. When the
    // modulation carries `earnedGrowthMax` (present only when trust is earned) the
    // build week may grow up to that cap instead of the +10%/wk default —
    // defensively re-clamped to HARD_CEILING so no malformed mod can exceed it.
    // Absent = the default +10%/wk cap, byte-identical to Phase 2B. Down and
    // maintenance weeks never reach this branch, so earned-trust is never active
    // on an absorption week; peakMpw and the long-run ladder still bind below.
    const weeklyGrowthMax = mod?.earnedGrowthMax != null
      ? Math.min(mod.earnedGrowthMax, TUNABLES.ADAPTIVE.EARNED_TRUST.HARD_CEILING)
      : TUNABLES.WEEKLY_GROWTH_MAX;
    const cap = prev.traj * (weeklyGrowthMax - 1);
    const gapSeek = Math.max(0, eff.peakMpw - prev.traj) / TUNABLES.PEAK_RAMP_WEEKS;
    // `growthFactor` (≤1) eases the increment for a fragile responder. It's applied
    // AFTER the growth cap, so the eased step is still ≤ cap and ≥ 0 — the safety
    // ceiling and the peak still bind, and identity (factor 1) is exact. (Earned
    // trust and easing never coexist: any easing sets growthFactor < 1, which
    // disables earned-trust upstream, so earnedGrowthMax is absent whenever
    // growthFactor < 1.)
    const step = Math.min(cap, Math.max(eff.buildStep, gapSeek)) * growthFactor;
    total = Math.min(prev.traj + step, eff.peakMpw);
  }

  // Down AND maintenance weeks hold the long run (prev.long is already a
  // half-step); only build weeks step it up the ladder. The long-run READINESS
  // gate (mod.holdLong, Phase 2A) ALSO holds the ladder — a poorly-tolerated
  // last long run freezes the long-run step even on a build week, while the
  // weekly trajectory may still progress modestly (holdTraj stays false). The
  // long run is capped at the peak week: a single run can never exceed a whole
  // week's cap. holdLong only ever HOLDS the ladder — it can never step it up,
  // so identity (no mod / holdLong falsy) is byte-exact.
  const holdTraj = isDown || isMaint;
  const holdLongRun = holdTraj || mod?.holdLong === true;
  const rawLong = holdLongRun ? floorToHalf(prev.long) : nextLongFrom(prev.long);
  const long = Math.min(rawLong, floorToHalf(eff.peakMpw));
  const targetTotal = Math.max(roundHalf(total), long); // a week is never smaller than its long run

  const miles = splitWeek(targetTotal, long, days);
  // Displayed sum can be slightly under the target because splitWeek rounds each
  // easy day down (a half-step per day). Show that; but carry the pre-split
  // TARGET as the trajectory, otherwise the round-down drift compounds and the
  // plan would only grow at ~half the requested buildStep. The +10%/wk safety
  // cap still binds — it's measured against the target, which is a strict upper
  // bound on the display anyway.
  const actualTotal = miles.reduce((a, b) => a + b, 0);

  let note: string | undefined;
  if (isDown) note = 'down week';
  else if (isMaint) note = 'maintain';
  else if (targetTotal >= eff.peakMpw - 1e-9 && prev.traj < eff.peakMpw - 1e-9) note = 'peak';

  return {
    config: { miles, note, isDownWeek: isDown },
    total: actualTotal,
    // The trajectory only advances on real build weeks; absorption AND
    // maintenance weeks keep the prior trajectory so volume neither drifts up
    // nor re-baselines down. A long-run HOLD does not freeze the trajectory —
    // weekly mileage may still progress while the long run stays put.
    traj: holdTraj ? prev.traj : targetTotal,
    long: holdLongRun ? prev.long : long,
  };
}

/** Build a full WeekConfig[] purely from settings (no locked-week splicing).
 *  Optional `count` overrides the visible-window size — the engine is rolling,
 *  so callers can extend as far as they like beyond `weeksShown`. Optional `mod`
 *  applies the same downward-only individual adaptation as stepWeek (identity by
 *  default). */
export function buildWeekConfigsFromSettings(
  eff: EffectiveSettings, count?: number, mod?: AdaptiveModulation | null,
): WeekConfig[] {
  const weeksN = clampWeeksShown(count ?? eff.weeksShown);
  const configs: WeekConfig[] = [];
  let carry: StepCarry = { long: eff.trailingLongest, traj: eff.startMpw };
  for (let i = 0; i < weeksN; i++) {
    const { config, long, traj } = stepWeek(i, carry, eff, mod);
    configs.push(config);
    carry = { long, traj };
  }
  return configs;
}
