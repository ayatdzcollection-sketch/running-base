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

import type { BuiltPlan } from '../config/plan';
import { buildPlan, getPlan, WEEK_CONFIGS, PLAN_START_DATE } from '../config/plan';
import type { PlanWeek, RawSettings, RunState } from './types';
import { mondayOf, addDaysStr } from './metrics';
import {
  effectiveSettings, buildWeekConfigsFromSettings, type ClampNote,
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

/**
 * Resolve the plan to display. With no settings, this is the static plan.
 * With settings, future unlocked weeks are regenerated (safety-clamped) while
 * locked weeks keep their static prescription.
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
  const settingsPlan = buildPlan(buildWeekConfigsFromSettings(eff), eff.startDate);

  // Index static/original weeks by start date so a locked week keeps whatever
  // it was originally prescribed (static config).
  const staticByStart = new Map<string, PlanWeek>();
  for (const w of staticPlan.weeks) staticByStart.set(w.startDate, w);

  const mergedWeeks: PlanWeek[] = settingsPlan.weeks.map((sw, i) => {
    const locked = !opts?.fullReset && isWeekLocked(sw.startDate, runState, today);
    if (locked) {
      // Prefer the original week with the same start date; fall back to the
      // same ordinal position (handles a shifted start date).
      const original = staticByStart.get(sw.startDate) ?? staticPlan.weeks[i];
      if (original) {
        weekSource.set(sw.startDate, 'static');
        // Re-key the original to this week number/date so the calendar stays
        // consistent even if the ordinal shifted.
        return original.startDate === sw.startDate ? original : { ...original, weekNum: sw.weekNum };
      }
    }
    weekSource.set(sw.startDate, 'settings');
    return sw;
  });

  const plan = assemble(mergedWeeks, staticPlan);
  return { plan, weekSource, clamps };
}

/** Reassemble the BuiltPlan lookups from a merged week list. */
function assemble(weeks: PlanWeek[], staticPlan: BuiltPlan): BuiltPlan {
  const allRunDates = new Set<string>();
  const allDates = new Set<string>();
  const dateToWeek = new Map<string, PlanWeek>();
  const dateToDay = new Map<string, typeof staticPlan.bonusDay>();

  allDates.add(staticPlan.bonusDay.date);
  dateToDay.set(staticPlan.bonusDay.date, staticPlan.bonusDay);

  for (const week of weeks) {
    for (const day of week.allDays) {
      allDates.add(day.date);
      dateToDay.set(day.date, day);
      dateToWeek.set(day.date, week);
      if (day.type === 'run') allRunDates.add(day.date);
    }
  }
  return { bonusDay: staticPlan.bonusDay, weeks, allRunDates, allDates, dateToWeek, dateToDay };
}

/** Total prescribed miles across the resolved plan (for block progress copy). */
export function planTotalMiles(plan: BuiltPlan): number {
  return plan.weeks.reduce((s, w) => s + w.totalPlanned, 0);
}

// Re-exported so callers have one import site for settings-derived plan config.
export { WEEK_CONFIGS, PLAN_START_DATE };
