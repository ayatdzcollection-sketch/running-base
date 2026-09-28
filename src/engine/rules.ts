// Every number the engine uses, in one place, with the reason for it.
// Changing a value here changes the plan for every runner, so each one
// says where it comes from.

export const RULES = {
  /** Weekly mileage grows at most this fraction per build week. The common
   *  "about 10%" guideline; the evidence is modest, but for teenagers a
   *  gradual build is the consistent recommendation. */
  BUILD_PCT: 0.1,
  /** …and by no more than this many miles in one week, so a 40-mile runner
   *  doesn't jump by 4. */
  BUILD_ABS_MAX: 3,
  /** Smallest step worth prescribing. */
  BUILD_ABS_MIN: 1,
  /** After this many build weeks, one lighter week (4 up, 1 down). */
  BUILDS_BEFORE_DOWN: 4,
  /** A lighter week is this share of the week before it. */
  DOWN_FACTOR: 0.85,
  /** A week the runner really completed at this share of the target (or
   *  more) lets the plan keep building. Below it, the next week starts from
   *  what they actually ran: a fact, never a guess about missing days. */
  ON_TRACK: 0.85,
  /** Never plan more than this multiple of the last verified week. */
  MAX_OVER_VERIFIED: 1.15,

  /** Long run: at most this share of the week (3–4 run days get a little
   *  more room because there are fewer runs to spread over). */
  LONG_SHARE: 0.3,
  LONG_SHARE_FEW_DAYS: 0.35,
  /** …and at most 10% (or half a mile) longer than the longest run in the
   *  last 30 days. */
  LONG_GROWTH: 1.1,
  LONG_GROWTH_MIN_MI: 0.5,
  /** Shortest easy run worth prescribing; below it the day becomes rest. */
  MIN_RUN_MI: 2,

  /** A week counts as fully known when at least this many days have data
   *  (a run or an explicit rest/skip), counted against planned run days. */
  KNOWN_SLACK_DAYS: 1,
  /** Coach mode "usual week" is the median of this many recent known weeks. */
  USUAL_WEEKS: 3,
  /** Weeks scanned when checking recent verified weeks (plan caps). */
  LOOKBACK_WEEKS: 6,
  /** Weeks scanned to find the last few known weeks for the usual week. */
  USUAL_SEARCH_WEEKS: 26,

  /** After a season with an end date, this many easy weeks off. */
  BREAK_WEEKS: 2,
  /** Coming back from a break or an injury starts at this share of the
   *  level before it. */
  RETURN_FACTOR: 0.6,

  /** Default ceiling when the runner didn't set one, by years running. */
  PEAK_BY_EXPERIENCE: [
    { minYears: 0, mpw: 25 },
    { minYears: 1, mpw: 35 },
    { minYears: 3, mpw: 45 },
  ],
  PEAK_HARD_MAX: 60,

  /** Pain-monitoring model: during a run, pain at or below this is OK. */
  PAIN_OK: 3,
  /** A check-in at or below this counts as pain-free for the speed ladder. */
  PAIN_FREE: 2,
  /** Pain-free check-ins needed at a speed level before the next unlocks. */
  SPEED_CHECKINS: 4,
  /** Comeback: good days needed to move up a stage. */
  COMEBACK_GOOD_DAYS: 2,

  /** Issue thresholds (what Claude and the app flag). */
  SPIKE: 1.3,               // a week this much bigger than usual
  LONG_SHARE_WARN: 0.4,     // a long run this big a share of its week
  SINGLE_RUN_WARN: 1.25,    // a run this much longer than the 30-day longest
  GAP_DAYS: 5,              // this many days in a row with no data
} as const;

export function peakFor(years: number | null | undefined, goal: number | null | undefined): number {
  if (goal && goal > 0) return Math.min(goal, RULES.PEAK_HARD_MAX);
  const y = years ?? 0;
  let peak: number = RULES.PEAK_BY_EXPERIENCE[0].mpw;
  for (const p of RULES.PEAK_BY_EXPERIENCE) if (y >= p.minYears) peak = p.mpw;
  return peak;
}
