// ============================================================
// PLAN OVERLAY — reconciles the static plan, settings-derived
// weeks, and locked/completed weeks into the plan actually shown.
//
// Hard rules:
//  • settings === null → the pure static plan, byte-identical to getPlan().
//  • Regeneration replaces only FUTURE, UNLOCKED weeks. A locked week (past,
//    current, or any week with a logged run) keeps its original prescription.
//  • Full reset (typed confirmation in the UI) regenerates every week's
//    prescription — but NEVER touches bb_run_state; logged actuals are
//    per-date and independent of the prescription shown.
// ============================================================

import type { BuiltPlan, WeekConfig } from '../config/plan';
import { buildPlan, getPlan, WEEK_CONFIGS, PLAN_START_DATE } from '../config/plan';
import type { RawSettings, RunState } from './types';
import { mondayOf, addDaysStr } from './metrics';
import {
  effectiveSettings, stepWeek, clampBlockWeeks, type ClampNote,
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

export interface ResolvedPlan {
  plan: BuiltPlan;
  /** weekStart → whether that week came from the static plan or settings. */
  weekSource: Map<string, 'static' | 'settings'>;
  clamps: ClampNote[];
}

function configTotal(cfg: WeekConfig): number {
  return cfg.miles.reduce((a, b) => a + b, 0);
}
function configLong(cfg: WeekConfig): number {
  return cfg.miles[cfg.miles.length - 1];
}

/**
 * Resolve the plan to display. With no settings, this is the static plan.
 * With settings, weeks are built in one continuous forward pass: a LOCKED week
 * keeps its original static prescription, an unlocked week is regenerated from
 * settings — and crucially the volume/long-run ladder carries across the
 * boundary, so a settings week that follows a locked week never jumps the long
 * run (it continues from the locked week's long run, ≤110%).
 */
export function resolveEffectivePlan(
  raw: RawSettings | null,
  runState: RunState,
  today: string,
  opts?: { fullReset?: boolean },
): ResolvedPlan {
  const staticPlan = getPlan();
  const weekSource = new Map<string, 'static' | 'settings'>();

  if (!raw) {
    for (const w of staticPlan.weeks) weekSource.set(w.startDate, 'static');
    return { plan: staticPlan, weekSource, clamps: [] };
  }

  const { eff, clamps } = effectiveSettings(raw, runState, today);
  const weeksN = clampBlockWeeks(eff.blockWeeks);
  const configs: WeekConfig[] = [];
  let prevTotal = eff.startMpw;
  let prevLong = eff.trailingLongest;

  for (let i = 0; i < weeksN; i++) {
    const weekStart = addDaysStr(eff.startDate, i * 7);
    const staticCfg = WEEK_CONFIGS[i];
    const locked = !opts?.fullReset && isWeekLocked(weekStart, runState, today);

    if (locked && staticCfg) {
      // Keep the completed/current week exactly as originally prescribed, and
      // carry its total/long forward so the next settings week continues the
      // ladder from here instead of restarting it.
      configs.push(staticCfg);
      prevTotal = configTotal(staticCfg);
      prevLong = configLong(staticCfg);
      weekSource.set(weekStart, 'static');
    } else {
      const { config, total, long } = stepWeek(i, weeksN, prevTotal, prevLong, eff);
      configs.push(config);
      prevTotal = total;
      prevLong = long;
      weekSource.set(weekStart, 'settings');
    }
  }

  const plan = buildPlan(configs, eff.startDate);
  return { plan, weekSource, clamps };
}

/** Total prescribed miles across the resolved plan (for block progress copy). */
export function planTotalMiles(plan: BuiltPlan): number {
  return plan.weeks.reduce((s, w) => s + w.totalPlanned, 0);
}

// Re-exported so callers have one import site for settings-derived plan config.
export { WEEK_CONFIGS, PLAN_START_DATE };
