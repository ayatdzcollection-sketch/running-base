// Speed ladder: faster running is added one step at a time, and each step
// is earned with pain-free check-ins at the step before it.
import { RULES } from './rules.ts';
import type { CheckIn, ISODate } from './types.ts';

export const LEVELS = [
  { n: 0, name: 'Easy running only', detail: 'Build your base first.' },
  { n: 1, name: 'Strides', detail: 'Short, relaxed speed-ups: 4–6 × 20 seconds after an easy run.' },
  { n: 2, name: 'Hill strides', detail: '6 × 10–15 seconds up a gentle hill, walk down.' },
  { n: 3, name: 'Fartlek', detail: '6–8 × 1 minute a bit faster inside an easy run.' },
  { n: 4, name: 'Cruise intervals', detail: '3–4 × 5 minutes at a comfortably hard pace.' },
  { n: 5, name: 'Tempo run', detail: '15–20 minutes at a comfortably hard pace.' },
  { n: 6, name: 'Intervals', detail: '5–6 × 3 minutes hard, easy jog between.' },
  { n: 7, name: 'Race-pace work', detail: 'Workouts at goal race pace.' },
] as const;

export interface SpeedStatus {
  level: number;
  name: string;
  next: { n: number; name: string; detail: string } | null;
  progress: number;          // pain-free check-ins since this level began
  needed: number;
  eligible: boolean;         // can move up now
  blockedBy: string | null;  // why not, in plain words
  inSeasonNote: string | null;
}

export function speedStatus(opts: {
  level: number;
  since: ISODate | null | undefined;
  checkins: CheckIn[];
  injuryActive: boolean;
  inSeason: boolean;
  usualMpw: number | null;
}): SpeedStatus {
  const level = Math.max(0, Math.min(7, opts.level));
  const since = opts.since ?? '0000-01-01';
  const painFree = new Set(
    opts.checkins
      .filter(c => c.moment === 'post_run' && c.date >= since && c.pain != null && c.pain <= RULES.PAIN_FREE)
      .map(c => c.date),
  ).size;
  const next = level < 7 ? LEVELS[level + 1] : null;
  let blockedBy: string | null = null;
  // In season the coach owns hard running; the app only adds strides.
  const seasonCap = 1;
  if (!next) blockedBy = null;
  else if (opts.injuryActive) blockedBy = 'Paused while you’re coming back from an injury.';
  else if (opts.inSeason && next.n > seasonCap) blockedBy = 'In season your coach sets the hard workouts.';
  else if (next.n >= 3 && (opts.usualMpw ?? 0) < 20) blockedBy = 'Unlocks once your usual week is 20 miles or more.';
  else if (painFree < RULES.SPEED_CHECKINS) blockedBy = `${RULES.SPEED_CHECKINS - painFree} more pain-free check-ins to unlock.`;
  return {
    level,
    name: LEVELS[level].name,
    next: next ? { n: next.n, name: next.name, detail: next.detail } : null,
    progress: Math.min(painFree, RULES.SPEED_CHECKINS),
    needed: RULES.SPEED_CHECKINS,
    eligible: !!next && blockedBy === null,
    blockedBy,
    inSeasonNote: opts.inSeason ? 'In season, hard workouts come from your coach. Strides on easy days are fine.' : null,
  };
}
