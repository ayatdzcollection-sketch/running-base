// Where a week sits in the school year: in a coach-led season, on the
// short break after one, or building between seasons.
import { addDays, weekStart } from './dates.ts';
import { RULES } from './rules.ts';
import type { ISODate, Season } from './types.ts';

export type PhaseKind = 'coach' | 'break' | 'build';

export interface SeasonWindow {
  season: Season;
  start: ISODate;
  /** Last day, or null when the end isn't set and no later season closes it. */
  end: ISODate | null;
  /** True when the end came from the runner (a break follows it). */
  endKnown: boolean;
}

export function seasonWindows(seasons: Season[]): SeasonWindow[] {
  const sorted = [...seasons].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return sorted.map((s, i) => {
    const next = sorted[i + 1];
    if (s.endDate) return { season: s, start: s.startDate, end: s.endDate, endKnown: true };
    return { season: s, start: s.startDate, end: next ? addDays(next.startDate, -1) : null, endKnown: false };
  });
}

export interface WeekPhase {
  kind: PhaseKind;
  season?: Season;          // the season this week is in (coach) or just finished (break)
  nextSeason?: Season;      // the season a build is aiming at
  /** For a build that follows a finished season: the Monday that season's
   *  break began (or the week after it ended), to measure the level before. */
  afterSeasonFrom?: ISODate;
  /** First Monday of this phase, used to count weeks and down weeks. */
  since: ISODate;
}

/** A week belongs to a season when its Monday–Sunday overlaps the season. */
export function phaseOfWeek(monday: ISODate, seasons: Season[], planStart: ISODate): WeekPhase {
  const sunday = addDays(monday, 6);
  const windows = seasonWindows(seasons);
  const next = windows.find(w => w.start > sunday)?.season;

  for (const w of windows) {
    if (w.start <= sunday && (w.end === null || w.end >= monday)) {
      return { kind: 'coach', season: w.season, since: weekStart(w.start) };
    }
  }
  // Just after a season with a known end: a short break.
  for (const w of windows) {
    if (!w.end || !w.endKnown) continue;
    const breakFrom = addDays(weekStart(w.end), 7); // the Monday after the season's last week
    const breakTo = addDays(breakFrom, RULES.BREAK_WEEKS * 7 - 1);
    if (monday >= breakFrom && monday <= breakTo) {
      return { kind: 'break', season: w.season, nextSeason: next, since: breakFrom };
    }
  }
  // Otherwise build, starting after the last break/season before this week
  // (or at the plan start).
  let since = weekStart(planStart);
  let afterSeasonFrom: ISODate | undefined;
  for (const w of windows) {
    if (!w.end || w.end >= monday) continue;
    const seasonOver = addDays(weekStart(w.end), 7);
    const after = addDays(seasonOver, w.endKnown ? RULES.BREAK_WEEKS * 7 : 0);
    if (after <= monday && after > since) {
      since = after;
      afterSeasonFrom = seasonOver;
    }
  }
  return { kind: 'build', nextSeason: next, since, afterSeasonFrom };
}
