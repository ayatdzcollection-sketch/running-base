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
// The one deliberate exception — athlete-requested — is the SATURDAY CATCH-UP:
// a single bounded make-up run on the week's first free rest day, offered only
// in the benign case (1–2 missed days, no pain signals, base phase, build
// week) and hard-capped so it can never become the load spike the evidence
// warns about (≤ largest planned easy day, ≤ the Frandsen single-session
// ceiling; a missed LONG run may move at its planned size — the one swap
// coaches endorse). Sunday always stays fully off. The default advice remains
// "skip it"; the catch-up is the informed opt-in, and logging the run is what
// commits it — this module still writes nothing.
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
  isLongRun: boolean;
}

export type MissedKind =
  | 'resume'    // 1–2 missed: skip them, plan continues as written
  | 'reentry'   // 3+ missed / most of the week: next week re-enters reduced
  | 'downweek'  // missed day on a down week: extra rest fits its purpose
  | 'flare';    // pain rules active: recovery first, miles are irrelevant

/** A bounded make-up run on the week's first free rest day (usually Saturday). */
export interface CatchupSuggestion {
  date: string;
  dayLabel: string;
  /** Suggested miles, half-step rounded, capped (never the raw missed total). */
  miles: number;
  /** Missed miles the cap could NOT lift — absorbed, exactly as before. */
  absorbed: number;
  /** What the week can still total: remaining planned days + the catch-up. */
  weekAfter: number;
  /** True when the missed day was the long run — the suggestion is the
   *  endorsed long-run swap, not an extra easy run. */
  longRunSwap: boolean;
}

export interface MissedAssessment {
  weekStart: string;
  missed: MissedDay[];
  missedMiles: number;
  /** Run days still ahead this week (today included if unlogged). */
  daysLeft: number;
  kind: MissedKind;
  headline: string;
  detail: string;
  /** Present only in the benign 'resume' case when a capped make-up run is
   *  available (see catchupFor). Advisory — logging the run is what commits it. */
  catchup?: CatchupSuggestion | null;
}

function roundHalf(x: number): number {
  return Math.round(x / TUNABLES.HALF_STEP) * TUNABLES.HALF_STEP;
}

/**
 * The bounded Saturday catch-up for a 'resume'-grade miss, or null when any
 * bound rules it out. Caps stack multiplicatively conservative:
 *   • only while ≤ RESUME_MAX_MISSED days are missed (callers gate on kind)
 *   • never with pain signals (flare handled upstream; recent breach here)
 *   • never in coach season (the coach owns the week's load)
 *   • the catch-up day is the FIRST rest day after the last planned run day,
 *     still ahead, unlogged — and at least one later rest day must remain in
 *     the week, so Sunday can never be spent
 *   • a missed LONG run moves at min(planned long, session ceiling) — the swap
 *   • missed easy miles are capped at min(largest planned easy day, ceiling)
 */
function catchupFor(
  week: PlanWeek,
  missed: MissedDay[],
  missedMiles: number,
  runState: RunState,
  today: string,
  opts: { breach: boolean; inSeason: boolean; nextLong: number },
): CatchupSuggestion | null {
  if (opts.breach || opts.inSeason) return null;

  // The LAST free rest day before the week's final rest day — Saturday for a
  // Mon-start week, whether the plan runs 5 days or 3. Sunday is never spent.
  // (Taking the FIRST free rest day put a 3-day week's catch-up on Thursday,
  // immediately after Wednesday's long run — the day-after-long stacking this
  // module argues against, and not the "Saturday" the feature promises.)
  const lastRun = week.runDays[week.runDays.length - 1];
  const restAfter = week.allDays
    .filter(d => d.type === 'rest' && d.date > lastRun.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (restAfter.length < 2) return null;
  const slot = restAfter[restAfter.length - 2];
  if (slot.date < today) return null;
  const slotEntry = runState[slot.date];
  if (slotEntry && (slotEntry.done || slotEntry.miles_actual != null)) return null;

  const longMissed = missed.find(m => m.isLongRun);
  const maxEasy = Math.max(
    0, ...week.runDays.filter(d => !d.isLongRun).map(d => d.prescribed ?? 0),
  );
  const cap = longMissed
    ? Math.min(longMissed.miles, opts.nextLong)
    : Math.min(maxEasy, opts.nextLong);
  // A long-run swap replaces the long run only; missed easy miles alongside it
  // are absorbed rather than stacked on top of an already-longest day.
  const wanted = longMissed ? longMissed.miles : missedMiles;
  const miles = roundHalf(Math.min(wanted, cap));
  if (miles < TUNABLES.MISSED.CATCHUP.MIN_SUGGEST) return null;

  return {
    date: slot.date,
    dayLabel: slot.dayLabel,
    miles,
    absorbed: Math.max(0, roundHalf(missedMiles - miles)),
    weekAfter: roundHalf(week.totalPlanned - missedMiles + miles),
    longRunSwap: !!longMissed,
  };
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
  opts: { flare: boolean; breach?: boolean; inSeason?: boolean; nextLong?: number },
): MissedAssessment | null {
  if (!week) return null;

  const missed: MissedDay[] = [];
  let daysLeft = 0;
  for (const d of week.runDays) {
    const e = runState[d.date];
    const logged = !!e && (e.done || e.miles_actual != null);
    if (d.date < today && !logged) {
      missed.push({ date: d.date, dayLabel: d.dayLabel, miles: d.prescribed ?? 0, isLongRun: d.isLongRun });
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
  let catchup: CatchupSuggestion | null = null;

  if (opts.flare) {
    kind = 'flare';
    headline = `Missed ${names} — and pain rules are active.`;
    detail =
      'Recovery outranks mileage right now. The missed miles stay missed, and that is the right call: '
      + 'flares settle with load reduction, not loading through.';
  } else if (week.isDownWeek
             && (week.totalPlanned <= 0
                 || (week.totalPlanned - missedMiles) / week.totalPlanned >= M.REENTRY_TRIGGER)) {
    // Only reassuring while the week still lands ABOVE the re-entry trigger.
    // A down week missed so heavily that it drops under the trigger IS judged
    // by the re-entry anchor like any other week, so promising "nothing to make
    // up" there would be the card contradicting the engine.
    kind = 'downweek';
    headline = `Missed ${names} on a down week — that's fine.`;
    detail =
      'A down week exists to absorb training, so extra rest fits its purpose. Nothing to make up; '
      + 'the build resumes from your pre-down trajectory next week as scheduled.';
  } else if (missed.length <= M.RESUME_MAX_MISSED) {
    kind = 'resume';
    catchup = catchupFor(week, missed, missedMiles, runState, today, {
      breach: opts.breach ?? false,
      inSeason: opts.inSeason ?? false,
      nextLong: opts.nextLong ?? Infinity,
    });
    headline = `Missed ${names} (${mi} mi). Skipping it costs nothing.`;
    detail =
      `Pick the plan back up from today — 1–2 missed easy days don't dent fitness (measurable detraining `
      + `takes 2–4 weeks off), and your remaining days stay exactly as planned. `
      + (catchup
        ? `If you'd rather keep the week's miles, there's one bounded option below.`
        : `Next week continues as written.`);
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

  return { weekStart: week.startDate, missed, missedMiles, daysLeft, kind, headline, detail, catchup };
}
