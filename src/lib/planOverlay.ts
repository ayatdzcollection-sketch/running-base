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
  effectiveSettings, stepWeek, clampWeeksShown, clampResolveCount, seasonResumeTraj,
  downSlot,
  type ClampNote, type StepCarry, type EffectiveSettings,
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

/** One missed-week re-entry cut the anchor applied — kept so the UI can SAY
 *  why a week's number dropped instead of adapting silently. */
export interface ReentryRecord {
  /** The week whose prescription was re-anchored (where the cut landed). */
  weekStart: string;
  /** The completed shortfall week that was judged. */
  judgedWeekStart: string;
  actual: number;
  prescribed: number;
  /** Build trajectory before / after the cut. */
  from: number;
  to: number;
  /** The anchored week sits inside a coach season (it is the maintain hold). */
  maintain: boolean;
}

export interface ResolvedPlan {
  plan: BuiltPlan;
  /** weekStart → whether that week came from the static plan, settings, or a
   *  confirmed accepted (generated) week. */
  weekSource: Map<string, 'static' | 'settings' | 'accepted'>;
  clamps: ClampNote[];
  /** Every re-entry cut applied in this resolution (usually 0 or 1). */
  reentries: ReentryRecord[];
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

/** The season hold to carry THROUGH a week this overlay prescribes itself
 *  (accepted / locked-static), mirroring stepWeek: derived from the PRE-week
 *  trajectory while in season, and cleared outside one so a finished season's
 *  hold can never leak into the next. Without this an accepted or spliced week
 *  in the middle of a season would drop the hold, and the following maintenance
 *  week would re-derive it from a possibly-reduced trajectory. */
function holdThrough(
  weekStart: string,
  carry: StepCarry,
  eff: EffectiveSettings,
): number | undefined {
  const season = currentSeason(eff, weekStart);
  if (!season) return undefined;
  const carried = carry.seasonId === season.id ? carry.seasonHold : undefined;
  return Math.min(carried ?? Math.max(carry.traj, carry.preCutTraj ?? 0), eff.peakMpw);
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
      return { plan: staticPlan, weekSource, clamps: [], reentries: [] };
    }
    const cfgs = WEEK_CONFIGS.map((cfg, i) => {
      const ws = addDaysStr(PLAN_START_DATE, i * 7);
      const acc = accepted[ws] ? acceptedConfig(accepted[ws]) : null;
      weekSource.set(ws, acc ? 'accepted' : 'static');
      return acc ?? cfg;
    });
    return { plan: buildPlan(cfgs, PLAN_START_DATE), weekSource, clamps: [], reentries: [] };
  }

  const { eff, clamps } = effectiveSettings(raw, runState, today);
  const weeksN = opts?.count != null ? clampResolveCount(opts.count) : clampWeeksShown(eff.weeksShown);
  const configs: WeekConfig[] = [];
  const startDates: string[] = [];
  let carry: StepCarry = { long: eff.trailingLongest, traj: eff.startMpw };
  // Season-END re-anchor state. The trajectory is frozen for the whole season,
  // so it is stale by the close; at the boundary we resume from recent ACTUAL
  // volume instead (see seasonResumeTraj). It fires at EVERY season boundary
  // that lies in the past (an athlete with an XC season and a track season gets
  // one re-anchor each), and it is evaluated AS OF THAT BOUNDARY rather than as
  // of today — otherwise a months-old boundary would be recomputed from this
  // week's actuals and past weeks would silently re-render with new numbers
  // every week. A boundary whose season has NOT ended yet has no actuals to
  // anchor to, so those weeks keep projecting off the frozen trajectory.
  let prevSeason: Season | null = null;
  // Missed-week re-entry state. Each fully COMPLETED week is judged exactly
  // once — at the first engine-built week after it ends — and the judgment is
  // REPLAYED on every render, so an anchored week keeps its anchored numbers
  // forever (history never flip-flops when the live boundary moves on).
  // `judged` remembers which completed week the anchor last consumed, so a
  // shortfall can never re-cut the trajectory week after week (no 0.8× decay).
  let lastDone: { weekStart: string; actual: number; prescribed: number } | null = null;
  let judged: string | null = null;
  const reentries: ReentryRecord[] = [];
  // Returns the completed-week record (or null for a still-running week); the
  // caller assigns it so TS control-flow analysis sees the mutation.
  const doneRecord = (weekStart: string, cfg: WeekConfig) =>
    addDaysStr(weekStart, 6) < today
      ? { weekStart, actual: weekActualMiles(cfg, weekStart, runState), prescribed: configTotal(cfg) }
      : null;

  for (let i = 0; i < weeksN; i++) {
    const weekStart = addDaysStr(eff.startDate, i * 7);
    const locked = isWeekLocked(weekStart, runState, today);

    const thisSeason = currentSeason(eff, weekStart);
    // A boundary is any change of season identity — including season→season,
    // since an open-ended season implicitly closes the day before the next one
    // starts, so adjacent windows never pass through a "no season" week.
    const leftSeason = prevSeason != null && prevSeason.id !== (thisSeason?.id ?? null);
    if (leftSeason && prevSeason?.endDate && prevSeason.endDate <= today) {
      const anchor = seasonResumeTraj(runState, eff, weekStart);
      // null = no logged weeks = UNKNOWN → keep the frozen trajectory untouched.
      if (anchor != null) carry = { ...carry, traj: anchor, preCutTraj: undefined };
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
    // Same cadence resolution stepWeek uses — adaptation may only tighten it.
    // Reading the un-tightened setting here made a marker that stepWeek treats
    // as inert still suppress the static splice for that week.
    const modDownEvery = opts?.modulation?.downEvery;
    const idDownEvery = Math.max(2, Math.round(
      modDownEvery != null ? Math.min(eff.downEvery, modDownEvery) : eff.downEvery,
    ));
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

    // Missed-week RE-ENTRY anchor (downward-only). Every COMPLETED week is
    // judged exactly once, at the first engine-built week after it ends: when
    // it ran below MISSED.REENTRY_TRIGGER of its prescription, the build does
    // not leap back to the paper trajectory — it re-enters at
    //   max(actual × WEEKLY_GROWTH_MAX, trajectory × REENTRY_FLOOR)
    // (the published ~70–90% re-entry band; +10% over actuals when even that
    // is lower), min'd with the existing trajectory so it can only ever LOWER
    // a week. Because the judgment derives ONLY from completed weeks and is
    // replayed at the same position every render, it is stable: an engine-
    // built current week is anchored from its own Monday and renders
    // identically all week, and an anchored week KEEPS its anchored numbers
    // after it completes (history never flip-flops). `judged` guarantees one
    // cut per shortfall — never a compounding weekly decay. A canonical
    // static-spliced week stays frozen as originally prescribed and defers
    // the judgment to the first engine week after it; an explicitly ACCEPTED
    // week consumes the judgment untouched (the athlete's confirmed
    // prescription wins, and its own completion is judged in turn).
    if (lastDone && lastDone.weekStart !== judged && lastDone.prescribed > 0
        && !(locked && staticCfg)) {
      judged = lastDone.weekStart;
      if (!accepted?.[weekStart]?.length
          && lastDone.actual / lastDone.prescribed < TUNABLES.MISSED.REENTRY_TRIGGER) {
        const anchor = Math.max(
          lastDone.actual * TUNABLES.WEEKLY_GROWTH_MAX,
          carry.traj * TUNABLES.MISSED.REENTRY_FLOOR,
        );
        if (anchor < carry.traj - 1e-9) {
          const maintain = currentSeason(eff, weekStart) != null;
          // Record every real cut so the UI can explain the changed number —
          // a silent adaptation reads as a bug, however right it is.
          reentries.push({
            weekStart, judgedWeekStart: lastDone.weekStart,
            actual: lastDone.actual, prescribed: lastDone.prescribed,
            from: carry.traj, to: anchor,
            maintain,
          });
          carry = {
            ...carry,
            traj: anchor,
            // Remember what the athlete had actually EARNED before the cut. A
            // season entering at (or one week after) this point holds at that
            // level and climbs back to it — a cut must never become the
            // season's permanent ceiling, whether it lands on the first season
            // week or in the week just before it.
            preCutTraj: Math.max(carry.preCutTraj ?? 0, carry.traj),
          };
        }
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
      carry = {
        long: acceptedLong(accCfg),
        traj: isDown ? carry.traj : total,
        seasonHold: holdThrough(weekStart, carry, eff),
        seasonId: thisSeason?.id,
        preCutTraj: carry.preCutTraj,
      };
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
        seasonHold: holdThrough(weekStart, carry, eff),
        seasonId: thisSeason?.id,
        preCutTraj: carry.preCutTraj,
      };
      weekSource.set(weekStart, 'static');
      lastDone = doneRecord(weekStart, staticCfg) ?? lastDone;
      continue;
    }

    // Individual adaptation applies ONLY to future/unlocked weeks; a locked week
    // reflects what was actually run, so it's generated at identity (no mod).
    const { config, long, traj, seasonHold, seasonId, preCutTraj } =
      stepWeek(i, carry, eff, locked ? null : opts?.modulation);
    configs.push(config);
    startDates.push(weekStart);
    carry = { long, traj, seasonHold, seasonId, preCutTraj };
    weekSource.set(weekStart, 'settings');
    lastDone = doneRecord(weekStart, config) ?? lastDone;
  }

  // buildPlan assumes contiguous weeks from eff.startDate. That still holds:
  // we only skipped the TAIL (weeks past breakStart), never a middle week.
  const plan = buildPlan(configs, eff.startDate);
  return { plan, weekSource, clamps, reentries };
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
  const weeksN = opts?.count != null ? clampResolveCount(opts.count) : clampWeeksShown(eff.weeksShown);
  const mod = opts?.modulation ?? null;
  // Same cadence resolution as stepWeek: adaptation may only tighten (min).
  const downEvery = Math.max(2, Math.round(mod ? Math.min(eff.downEvery, mod.downEvery) : eff.downEvery));
  const accepted = opts?.acceptedWeeks ?? null;
  // Research guardrail: postponing is for LOGISTICS (a trip), never for pushing
  // through warnings. While any body-response signal is actively easing the
  // plan (growth eased, or the long-run ladder held), the postpone offer is
  // withheld — the athlete who most needs the absorption week cannot defer it.
  // UNDO stays available: restoring an earlier down week only adds recovery.
  const bodyEasing = !!mod && (mod.growthFactor < 1 - 1e-9 || mod.holdLong === true);

  for (let i = 0; i < weeksN; i++) {
    const ws = addDaysStr(eff.startDate, i * 7);
    if (opts?.breakStart && ws >= opts.breakStart) break;
    const slot = downSlot(i, downEvery, eff);
    if (slot !== 'down' && slot !== 'postponed') continue;
    if (isWeekLocked(ws, runState, today) && !isMondayReplannable(ws, runState, today)) continue;
    if (accepted?.[ws]?.length) continue;
    if (slot === 'down') {
      if (bodyEasing) continue;
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
