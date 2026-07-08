// ============================================================
// SAFETY TUNABLES — every adjustable threshold lives here.
// Change numbers in this file; never edit UI code to retune.
// ============================================================

export const TUNABLES = {
  // ── Pain governor ──────────────────────────────────────────
  /** Default pain ceiling (0–10). Research ceiling is 5/10 (Silbernagel 2007,
   *  Achilles/patellar, extrapolated to iliopsoas) — we deliberately run
   *  tighter at 3/10 for a reactive hip flexor. */
  PAIN_CAP_DEFAULT: 3,
  /** A flare = this many pain-cap-breach days inside any window below. */
  FLARE_COUNT: 2,
  FLARE_WINDOW_DAYS: 7,

  // ── Single-session long-run cap (Frandsen 2025, MODERATE) ─
  /** No single run beyond this × trailing-30-day longest. Ceiling, not mandate. */
  CAP_FACTOR: 1.1,
  /** Round the cap down to this natural step so numbers read sensibly. */
  HALF_STEP: 0.5,
  TRAILING_WINDOW_DAYS: 30,
  /** Fallback when no runs are logged in the trailing window. */
  TRAILING_FALLBACK: 4.5,

  // ── Weekly volume shaping (generator) ─────────────────────
  /** Max week-over-week growth vs the last sustained week. */
  WEEKLY_GROWTH_MAX: 1.1,
  /** Flag (never block) a long run above this share of the projected week.
   *  Weak-evidence heuristic — warn and let the user override. */
  LONG_RUN_WEEK_PCT_FLAG: 0.3,
  /** Auto-insert a down week after this many consecutive build weeks. */
  DOWN_WEEK_AFTER_BUILDS: 3,
  /** Pain-driven / generator deload cut (~25–30%), long run held. Deliberately
   *  the DEEPER of the two down-week cuts: an emergency deload after a pain
   *  spike prioritises recovery, so it stays conservative. */
  DOWN_WEEK_CUT: 0.275,
  /** Scheduled base-block absorption week cut (~15%: the down week lands at ~85%
   *  of the prior BUILD week — the UPPER end of the standard 75–85% deload band).
   *  A planned base down week is a temporary dip, not an emergency, and — unlike a
   *  pain deload — the plan resumes its build trajectory the following week, so a
   *  shallow cut keeps the block progressing without re-baselining downward.
   *  Contrast the DEEPER pain-driven DOWN_WEEK_CUT above, which prioritises
   *  recovery after an actual pain spike. */
  SCHEDULED_DOWN_CUT: 0.15,
  /** Peak-seeking reference horizon (weeks). Each build week closes ~1/N of the
   *  remaining gap to peakMpw, so raising/lowering the peak visibly reshapes the
   *  future — but this N is a FIXED constant, NOT the display window, so
   *  `weeksShown` never affects the training slope (no horizon compression).
   *  buildStep is the floor and +10%/wk the ceiling, so the seek only accelerates
   *  a climb toward a distant peak; a near peak still moves at buildStep. */
  PEAK_RAMP_WEEKS: 4,

  // ── Speed permission machine ───────────────────────────────
  /** Pain-free easy-run streak required to step INTO each state (key = target). */
  REQUIRED_STREAK: { 2: 3, 3: 3, 4: 4, 5: 4, 6: 4, 7: 4 } as Record<number, number>,
  /** Strides below this state are never offered by the generator. */
  STRIDES_MIN_STATE: 3,
  /** Stride validity — anything outside this is a hidden anaerobic session. */
  STRIDES: {
    MAX_REPS: 8,
    MAX_DURATION_S: 35,
    MIN_RECOVERY_S: 60,
  },
  /** Threshold work capped at this share of weekly miles. */
  THRESHOLD_MAX_WEEK_PCT: 0.1,
  /** Never place a fast session within this many hours of the long run. */
  FAST_LONG_SPACING_H: 48,
} as const;
