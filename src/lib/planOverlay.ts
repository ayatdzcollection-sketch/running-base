// ============================================================
// PLAN OVERLAY — reconciles the static plan, settings-derived
// weeks, and locked/completed weeks into the plan actually shown.
//
// Hard rules:
//  • settings === null → the pure static plan, byte-identical to getPlan().
//  • Regeneration replaces only FUTURE, UNLOCKED weeks. A locked week (past,
//    current, or any week with a logged run) keeps its original prescription:
//    the static WEEK_CONFIGS scaffold for the canonical plan, or the settings
//    engine's own output once the plan has been reseeded off PLAN_START_DATE.
//  • Regeneration NEVER touches bb_run_state; logged actuals are per-date and
//    independent of the prescription shown, so a completed week's real miles
//    survive any settings change.
// ============================================================

import type { BuiltPlan, WeekConfig } from '../config/plan';
import { buildPlan, getPlan, WEEK_CONFIGS, PLAN_START_DATE } from '../config/plan';
import type { ProposedDay, RawSettings, RunState, Season } from './types';
import type { AdaptiveModulation } from './adaptive';
import { TUNABLES } from '../config/tunables';
import { mondayOf, addDaysStr, currentSeason } from './metrics';
import {
  effectiveSettings, stepWeek, clampWeeksShown, seasonResumeTraj, downSlot,
  type ClampNote, type StepCarry,
} from './settings';

/**
 * A week is locked (never re-prescribed by regeneration) iff it starts on or
 * before the current week's Monday, OR any day in it has a logged run.
 */
export function isWeekLocked(weekStart: string, runState: RunState, today: string): boolean {
  if (weekStart <= mondayOf(today)) return true;
  const weekEnd = addDaysStr(weekStart, 6);
  for (const e of Object.values(runState)) {
    if (e.date >= weekStart && e.date <= weekEnd && (e.done || e.miles_actual != null)) return true;
  }
  return false;
}

/**
 * A week is REPLANNABLE on its own Monday: today IS that Monday and nothing in
 * the week has been logged yet. The one sanctioned exception to the week lock,
 * and only the down-week postpone flow uses it — the athlete wakes up on the
 * down week's Monday, remembers the trip, and moves it before running a step.
 * The moment anything is logged (or the day passes) the window closes.
 */
export function isMondayReplannable(weekStart: string, runState: RunState, today: string): boolean {
  if (today !== weekStart) return false;
  const weekEnd = addDaysStr(weekStart, 6);
  for (const e of Object.values(runState)) {
    if (e.date >= weekStart && e.date <= weekEnd && (e.done || e.miles_actual != null)) return false;
  }
  return true;
}

export interface ResolvedPlan {
  plan: BuiltPlan;
  /** weekStart → whether that week came from the static plan, settings, or a
   *  confirmed accepted (generated) week. */
  weekSource: Map<string, 'static' | 'settings' | 'accepted'>;
  clamps: ClampNote[];
}

function configTotal(cfg: WeekConfig): number {
  return cfg.miles.reduce((a, b) => a + b, 0);
}
function configLong(cfg: WeekConfig): number {
  return cfg.miles[cfg.miles.length - 1];
}

/** Whole days between two YYYY-MM-DD strings (b − a). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000);
}

/** ACTUAL miles run against a displayed week: logged miles, with a done-but-
 *  unmeasured day credited at its prescription (same read WeekProgress uses).
 *  Feeds the missed-week re-entry judge, so a tap-done day never reads as 0. */
function weekActualMiles(cfg: WeekConfig, weekStart: string, runState: RunState): number {
  const weekEnd = addDaysStr(weekStart, 6);
  let sum = 0;
  for (const e of Object.values(runState)) {
    if (e.date < weekStart || e.date > weekEnd) continue;
    if (e.miles_actual != null) { sum += e.miles_actual; continue; }
    if (e.done) sum += cfg.miles[daysBetween(weekStart, e.date)] ?? 0;
  }
  return sum;
}

/** A confirmed accepted week (GenerateWeek output) as a displayable WeekConfig.
 *  Run days in date order; day kinds carried so threshold/long/easy survive
 *  into the displayed plan. null when the entry has no run days. */
function acceptedConfig(days: ProposedDay[]): WeekConfig | null {
  const run = [...days]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .filter(d => d.kind !== 'rest' && d.miles != null);
  if (run.length === 0) return null;
  return {
    miles: run.map(d => d.miles as number),
    kinds: run.map(d => d.kind),
    note: 'accepted',
  };
}

/** The long run of an accepted config: the day marked 'long', else the last
 *  run day (the generator always places the long run last). */
function acceptedLong(cfg: WeekConfig): number {
  const i = cfg.kinds?.indexOf('long') ?? -1;
  return i >= 0 ? cfg.miles[i] : configLong(cfg);
}

/**
 * Resolve the plan to display. With no settings, this is the static plan.
 * With settings, weeks are built in one continuous forward pass: a LOCKED week
 * keeps its original static prescription, an unlocked week is regenerated from
 * settings — and crucially the volume/long-run ladder carries across the
 * boundary, so a settings week that follows a locked week never jumps the long
 * run (it continues from the locked week's long run, ≤110%).
 *
 * Rolling model: `weeksShown` is a display horizon, not a training boundary.
 * Callers can pass `count` to extend the horizon further (the engine keeps
 * generating; it never "ends"). Break Mode: pass `breakStart` and settings-
 * generated weeks on/after that date are omitted (locked weeks still show).
 */
export function resolveEffectivePlan(
  raw: RawSettings | null,
  runState: RunState,
  today: string,
  opts?: {
    count?: number;
    breakStart?: string | null;
    modulation?: AdaptiveModulation | null;
    /** Confirmed generated weeks (globals.acceptedWeeks). When present, an
     *  accepted week IS the displayed prescription for its week — the
     *  "confirmed, locked into the plan" promise made real. Absent/empty =
     *  behavior unchanged. */
    acceptedWeeks?: Record<string, ProposedDay[]> | null;
  },
): ResolvedPlan {
  const staticPlan = getPlan();
  const weekSource = new Map<string, 'static' | 'settings' | 'accepted'>();
  const accepted = opts?.acceptedWeeks ?? null;

  if (!raw) {
    // Static plan: splice accepted weeks onto the fixed grid where their
    // Monday aligns; everything else is the untouched static scaffold.
    if (!accepted || Object.keys(accepted).length === 0) {
      for (const w of staticPlan.weeks) weekSource.set(w.startDate, 'static');
      return { plan: staticPlan, weekSource, clamps: [] };
    }
    const cfgs = WEEK_CONFIGS.map((cfg, i) => {
      const ws = addDaysStr(PLAN_START_DATE, i * 7);
      const acc = accepted[ws] ? acceptedConfig(accepted[ws]) : null;
      weekSource.set(ws, acc ? 'accepted' : 'static');
      return acc ?? cfg;
    });
    return { plan: buildPlan(cfgs, PLAN_START_DATE), weekSource, clamps: [] };
  }

  const { eff, clamps } = effectiveSettings(raw, runState, today);
  const weeksN = clampWeeksShown(opts?.count ?? eff.weeksShown);
  const configs: WeekConfig[] = [];
  const startDates: string[] = [];
  let carry: StepCarry = { long: eff.trailingLongest, traj: eff.startMpw };
  // Season-END re-anchor state. The trajectory is frozen for the whole season,
  // so it is stale by the close; at the boundary we resume from recent ACTUAL
  // volume instead (see seasonResumeTraj). Fires at most once, and only when the
  // season has genuinely ended in the PAST — a future end date has no actuals to
  // anchor to yet, so those weeks keep projecting off the frozen trajectory.
  let prevSeason: Season | null = null;
  let resumeApplied = false;
  // Missed-week re-entry state. The most recent fully COMPLETED week's actual
  // miles vs its displayed prescription; consulted once, at the first future
  // (unlocked) week — see the anchor below. A completed week at/above the
  // trigger, or none at all, leaves the plan byte-identical.
  let lastDone: { actual: number; prescribed: number } | null = null;
  let reentryApplied = false;
  // Returns the completed-week record (or null for a still-running week); the
  // caller assigns it so TS control-flow analysis sees the mutation.
  const doneRecord = (weekStart: string, cfg: WeekConfig) =>
    addDaysStr(weekStart, 6) < today
      ? { actual: weekActualMiles(cfg, weekStart, runState), prescribed: configTotal(cfg) }
      : null;

  for (let i = 0; i < weeksN; i++) {
    const weekStart = addDaysStr(eff.startDate, i * 7);
    const locked = isWeekLocked(weekStart, runState, today);

    const thisSeason = currentSeason(eff, weekStart);
    if (prevSeason && !thisSeason && !resumeApplied
        && prevSeason.endDate && prevSeason.endDate <= today) {
      const anchor = seasonResumeTraj(runState, eff, today);
      // null = no logged weeks = UNKNOWN → keep the frozen trajectory untouched.
      if (anchor != null) carry = { ...carry, traj: anchor };
      resumeApplied = true;
    }
    prevSeason = thisSeason;
    // A postponement marker OVERRIDES the static splice for the weeks it
    // touches (the postponed origin and its landing). The static scaffold has
    // its down weeks in fixed slots, so once the athlete moves one, splicing
    // WEEK_CONFIGS[i] would show the OLD down week the moment the origin week
    // locks — the postponement would silently vanish mid-week. Touched weeks
    // are instead engine-generated even while locked (identity mod, same as
    // every locked week in the reseeded case): markers are only settable while
    // the week is future or still a blank Monday, so the engine deterministically
    // reproduces exactly what the athlete committed to, all week long.
    const idDownEvery = Math.max(2, Math.round(eff.downEvery));
    const slotHere = downSlot(i, idDownEvery, eff);
    const markerTouched = slotHere === 'postponed' || slotHere === 'landing';

    // The static WEEK_CONFIGS scaffold is the frozen "originally prescribed"
    // value ONLY for the canonical plan whose start aligns with PLAN_START_DATE.
    // Once settings reseed the start date (Return-from-break re-anchors it to a
    // future Monday), the summer block no longer maps to these calendar weeks —
    // splicing WEEK_CONFIGS[i] there would overwrite a conservative return-to-
    // running seed (e.g. 8 mi) with the original 20 mi Week 1 and propagate that
    // trajectory upward. In the reseeded case a locked week instead keeps the
    // value the settings engine generates for it (the reseeded baseline), never
    // the display-index static fallback.
    const staticCfg = !markerTouched && eff.startDate === PLAN_START_DATE ? WEEK_CONFIGS[i] : undefined;

    // Break Mode cuts UNLOCKED future weeks first — a paused plan projects
    // nothing past breakStart, accepted or not (break flows also clear
    // acceptedWeeks; this guards resurrected drafts too). Locked weeks
    // (past/current or logged) always render so history is never dropped.
    if (!locked && opts?.breakStart && weekStart >= opts.breakStart) break;

    // Missed-week RE-ENTRY anchor (downward-only), applied at most once, at the
    // FIRST future (unlocked) week. When the most recent completed week ran
    // below MISSED.REENTRY_TRIGGER of its prescription, the build does not leap
    // back to the paper trajectory — it re-enters at
    //   max(actual × WEEKLY_GROWTH_MAX, trajectory × REENTRY_FLOOR)
    // (the published ~70–90% re-entry band; +10% over actuals when even that is
    // lower), min'd with the existing trajectory so this can only ever LOWER a
    // week. Missed easy days are never made up — this is the other half of that
    // rule: after a substantially missed week, the resume is stepped, not a
    // spike. An explicitly ACCEPTED first week is the athlete's confirmed
    // prescription and is respected untouched (the attempt is still consumed —
    // the shortfall informs exactly one boundary, never a later surprise).
    if (!locked && !reentryApplied) {
      reentryApplied = true;
      if (!accepted?.[weekStart]?.length && lastDone && lastDone.prescribed > 0
          && lastDone.actual / lastDone.prescribed < TUNABLES.MISSED.REENTRY_TRIGGER) {
        const anchor = Math.max(
          lastDone.actual * TUNABLES.WEEKLY_GROWTH_MAX,
          carry.traj * TUNABLES.MISSED.REENTRY_FLOOR,
        );
        carry = { ...carry, traj: Math.min(carry.traj, anchor) };
      }
    }

    // A confirmed accepted week is the authoritative displayed prescription
    // for its week — it was what the athlete explicitly confirmed (and, for a
    // locked week, what they actually trained under). The volume/long-run
    // carry continues THROUGH it so following settings weeks ladder from the
    // accepted values. Down-week detection reuses the shared scheduled-cut
    // rule so an accepted absorption week never re-baselines the trajectory.
    const accCfg = accepted?.[weekStart] ? acceptedConfig(accepted[weekStart]) : null;
    if (accCfg) {
      const total = configTotal(accCfg);
      const isDown = total <= carry.traj * (1 - TUNABLES.SCHEDULED_DOWN_CUT) + TUNABLES.HALF_STEP + 1e-9;
      configs.push({ ...accCfg, isDownWeek: isDown });
      startDates.push(weekStart);
      carry = { long: acceptedLong(accCfg), traj: isDown ? carry.traj : total };
      weekSource.set(weekStart, 'accepted');
      lastDone = doneRecord(weekStart, accCfg) ?? lastDone;
      continue;
    }

    if (locked && staticCfg) {
      // Keep the completed/current week exactly as originally prescribed, and
      // carry its long run forward so the next settings week continues the
      // ladder from here instead of restarting it. Advance the build trajectory
      // only when the locked week was a build — a locked DOWN week must not
      // re-baseline the trajectory downward (the settings weeks that follow
      // resume from the last real build level, the same rule stepWeek applies).
      configs.push(staticCfg);
      startDates.push(weekStart);
      carry = {
        long: configLong(staticCfg),
        traj: staticCfg.isDownWeek ? carry.traj : configTotal(staticCfg),
      };
      weekSource.set(weekStart, 'static');
      lastDone = doneRecord(weekStart, staticCfg) ?? lastDone;
      continue;
    }

    // Individual adaptation applies ONLY to future/unlocked weeks; a locked week
    // reflects what was actually run, so it's generated at identity (no mod).
    const { config, long, traj } = stepWeek(i, carry, eff, locked ? null : opts?.modulation);
    configs.push(config);
    startDates.push(weekStart);
    carry = { long, traj };
    weekSource.set(weekStart, 'settings');
    lastDone = doneRecord(weekStart, config) ?? lastDone;
  }

  // buildPlan assumes contiguous weeks from eff.startDate. That still holds:
  // we only skipped the TAIL (weeks past breakStart), never a middle week.
  const plan = buildPlan(configs, eff.startDate);
  return { plan, weekSource, clamps };
}

// ── Postpone-a-down-week controls ─────────────────────────────
// Which displayed weeks may offer a down-week action right now. Offered ONLY on
// FUTURE, UNLOCKED, engine-generated weeks — with ONE exception: the week's own
// Monday, before anything is logged (isMondayReplannable), stays actionable, so
// waking up on the down week's first day and moving it is still possible. Never
// offered once a run is logged or the week was explicitly accepted:
//   'postpone' — an on-cadence scheduled down week that may move one week later
//                (its landing week must be equally free to receive the cut)
//   'undo'     — an origin week whose down was postponed; undo moves it back
// The action itself is just a settings edit (downPostponed); the engine applies
// markers deterministically, so history stays consistent once weeks lock.

export type DownAction = 'postpone' | 'undo';

export function downWeekControls(
  raw: RawSettings | null,
  runState: RunState,
  today: string,
  opts?: {
    count?: number;
    breakStart?: string | null;
    modulation?: AdaptiveModulation | null;
    acceptedWeeks?: Record<string, ProposedDay[]> | null;
  },
): Map<string, DownAction> {
  const out = new Map<string, DownAction>();
  if (!raw) return out;
  const { eff } = effectiveSettings(raw, runState, today);
  const weeksN = clampWeeksShown(opts?.count ?? eff.weeksShown);
  const mod = opts?.modulation ?? null;
  // Same cadence resolution as stepWeek: adaptation may only tighten (min).
  const downEvery = Math.max(2, Math.round(mod ? Math.min(eff.downEvery, mod.downEvery) : eff.downEvery));
  const accepted = opts?.acceptedWeeks ?? null;

  for (let i = 0; i < weeksN; i++) {
    const ws = addDaysStr(eff.startDate, i * 7);
    if (opts?.breakStart && ws >= opts.breakStart) break;
    const slot = downSlot(i, downEvery, eff);
    if (slot !== 'down' && slot !== 'postponed') continue;
    if (isWeekLocked(ws, runState, today) && !isMondayReplannable(ws, runState, today)) continue;
    if (accepted?.[ws]?.length) continue;
    if (slot === 'down') {
      const landing = addDaysStr(ws, 7);
      if (isWeekLocked(landing, runState, today)) continue;
      if (accepted?.[landing]?.length) continue;
      out.set(ws, 'postpone');
    } else {
      out.set(ws, 'undo');
    }
  }
  return out;
}

/** True when the athlete is currently on a training break (breakStart set). */
export function isOnBreak(breakStart: string | null | undefined, today: string): boolean {
  return !!breakStart && breakStart <= today;
}

/** Total prescribed miles across the resolved plan (for block progress copy). */
export function planTotalMiles(plan: BuiltPlan): number {
  return plan.weeks.reduce((s, w) => s + w.totalPlanned, 0);
}

// Re-exported so callers have one import site for settings-derived plan config.
export { WEEK_CONFIGS, PLAN_START_DATE };
