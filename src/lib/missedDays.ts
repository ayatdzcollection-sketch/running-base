// ============================================================
// MISSED-DAY ASSESSMENT — what the plan does when run days are
// skipped, said out loud.
//
// The evidence here is unusually unanimous (Koop/CTS, RunnersConnect, CARA,
// Runnin' for Sweets, Trailrunner): missed EASY days in base building are
// absorbed, never repaid. Cramming the miles into the remaining days — or
// adding a make-up run on a rest day — is the classic injury vector, and a
// missed easy day costs essentially nothing (measurable detraining needs 2–4
// weeks off, not 2 days). So this module never proposes redistribution. It
// detects the miss, names the correct response, and points at the adaptation
// the engine already applies:
//   • 1–RESUME_MAX_MISSED missed days → resume as written, make up nothing.
//   • more than that → the week is substantially missed; when it completes,
//     the rolling plan re-enters reduced (planOverlay's re-entry anchor,
//     ~REENTRY_FLOOR of trajectory / +10% over actuals) and rebuilds — the
//     goal is recovered by the trajectory, not by a spike.
//   • a missed day on a DOWN week is simply extra absorption — nothing to do.
//   • during a flare, recovery outranks mileage entirely.
//
// Pure and display-only: nothing here writes state, changes a cap, or feeds a
// gate. It is a coach's voice, not a control surface.
// ============================================================

import type { PlanWeek, RunState } from './types';
import { TUNABLES } from '../config/tunables';

export interface MissedDay {
  date: string;
  dayLabel: string;
  miles: number;
}

export type MissedKind =
  | 'resume'    // 1–2 missed: skip them, plan continues as written
  | 'reentry'   // 3+ missed / most of the week: next week re-enters reduced
  | 'downweek'  // missed day on a down week: extra rest fits its purpose
  | 'flare';    // pain rules active: recovery first, miles are irrelevant

export interface MissedAssessment {
  weekStart: string;
  missed: MissedDay[];
  missedMiles: number;
  /** Run days still ahead this week (today included if unlogged). */
  daysLeft: number;
  kind: MissedKind;
  headline: string;
  detail: string;
}

/**
 * Assess the CURRENT week for missed run days. A day is missed when it is a
 * planned run day, strictly before today, and has no completed log (neither
 * `done` nor logged miles). Returns null when nothing is missed — the card
 * only exists while it has something true to say.
 */
export function assessMissedDays(
  week: PlanWeek | null,
  runState: RunState,
  today: string,
  opts: { flare: boolean },
): MissedAssessment | null {
  if (!week) return null;

  const missed: MissedDay[] = [];
  let daysLeft = 0;
  for (const d of week.runDays) {
    const e = runState[d.date];
    const logged = !!e && (e.done || e.miles_actual != null);
    if (d.date < today && !logged) {
      missed.push({ date: d.date, dayLabel: d.dayLabel, miles: d.prescribed ?? 0 });
    } else if (d.date >= today && !logged) {
      daysLeft++;
    }
  }
  if (missed.length === 0) return null;

  const missedMiles = missed.reduce((s, m) => s + m.miles, 0);
  const M = TUNABLES.MISSED;
  const names = missed.map(m => m.dayLabel).join(', ');
  const mi = missedMiles.toFixed(1);

  let kind: MissedKind;
  let headline: string;
  let detail: string;

  if (opts.flare) {
    kind = 'flare';
    headline = `Missed ${names} — and pain rules are active.`;
    detail =
      'Recovery outranks mileage right now. The missed miles stay missed, and that is the right call: '
      + 'flares settle with load reduction, not loading through.';
  } else if (week.isDownWeek) {
    kind = 'downweek';
    headline = `Missed ${names} on a down week — that's fine.`;
    detail =
      'A down week exists to absorb training, so extra rest fits its purpose. Nothing to make up; '
      + 'the build resumes from your pre-down trajectory next week as scheduled.';
  } else if (missed.length <= M.RESUME_MAX_MISSED) {
    kind = 'resume';
    headline = `Missed ${names} (${mi} mi). Skip it — don't make it up.`;
    detail =
      `Pick the plan back up from today. The evidence is unanimous: 1–2 missed easy days cost nothing `
      + `(measurable detraining takes 2–4 weeks off), while cramming the miles into the remaining days or a `
      + `rest day is the classic injury route. `
      + (daysLeft > 0
        ? `Your remaining ${daysLeft} run day${daysLeft === 1 ? '' : 's'} stay exactly as planned, and next week continues as written.`
        : `The week closes as it stands, and next week continues as written.`);
  } else {
    kind = 'reentry';
    headline = `Missed ${missed.length} days (${mi} mi) this week.`;
    detail =
      'Don\'t try to rescue the week — run the days that remain as planned and let it be small. '
      + `When it completes, the plan re-enters next week a step down (~${Math.round(M.REENTRY_FLOOR * 100)}% of `
      + 'your trajectory, or +10% over what you actually ran if that is lower) and rebuilds from there. '
      + 'That re-entry is automatic. If this gap is going to continue, use Break mode in Settings instead — '
      + 'it reseeds the return properly.';
  }

  return { weekStart: week.startDate, missed, missedMiles, daysLeft, kind, headline, detail };
}
