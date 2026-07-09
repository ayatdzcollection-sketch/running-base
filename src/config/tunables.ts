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

  // ── Speed permission machine (Phase 2D ladder, Evidence Spec §5) ──
  /** Pain-free easy-run streak required to step INTO each tier (key = target).
   *  Tiers: 1 buildups · 2 short strides · 3 flat strides · 4 hill strides ·
   *  5 light fartlek · 6 cruise/threshold · 7 continuous tempo · 8 VO₂/race. */
  REQUIRED_STREAK: { 1: 3, 2: 3, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4 } as Record<number, number>,
  /** Strides below this tier are never offered by the generator (tier 2 = short strides). */
  STRIDES_MIN_STATE: 2,
  /** Live pain-free streak (runs) required before strides are offered/kept. */
  STRIDES_MIN_STREAK: 3,
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

  // ── Phase 2D speed guard (blockers, missing-data rule, hard budget) ──
  // Evidence Spec §3/§8/§10. Every rule here is downward-only: it can suppress,
  // hold, downgrade, or relock speed — never unlock or accelerate anything.
  SPEED: {
    /** Tiers at/above this are ADVANCED (light fartlek and up): they require
     *  recent check-in + RPE data and earned evidence; basic tiers 1–4 stay
     *  available on pain-free stable training alone (missing-data rule). */
    ADVANCED_MIN_TIER: 5,
    /** Recent readable weekly check-ins required before an advanced tier can
     *  unlock or be prescribed. Missing data = capped at tier 4, never punished. */
    ADVANCED_MIN_CHECKIN_WEEKS: 1,
    /** Morning-pain blocker: any next-AM pain ≥ this (or worse than during-run
     *  pain) inside the window below holds hard work 24–48h. */
    MORNING_PAIN_MIN: 2,
    MORNING_PAIN_WINDOW_DAYS: 2,
    /** Hold the ladder (no new unlocks) for this many days after the XC/coach
     *  season starts — the transition into daily practice is itself a load
     *  spike (volume+intensity+terrain; Spike25). */
    SEASON_TRANSITION_HOLD_DAYS: 14,
    /** Tier 8 (VO₂/race) may only unlock in-season or within this many days
     *  before the season start ("in/near season"). */
    NEAR_SEASON_DAYS: 21,
    /** Weekly hard-effort budget (Bucket-C units). Races count 1 unit each;
     *  light fartlek counts FARTLEK_UNITS; neuromuscular touches count 0. */
    HARD_BUDGET_BASE: 1,
    HARD_BUDGET_SEASON: 2,
    FARTLEK_UNITS: 0.5,
    FARTLEK: { SURGES: 5, DURATION_S: 45 },
  },

  // ── Phase 2A body-response signals (adaptive.ts) ───────────
  // Every one of these can only HOLD, REDUCE, or DELOAD the plan — never loosen
  // a cap, raise the peak, or accelerate the build. Conservative on purpose:
  // trends need multiple comparable data points, sparse/missing data does
  // nothing, and a real pain breach (FLARE_* above) always stays stronger than
  // any sub-threshold drift here.
  ADAPTIVE: {
    // Easy-run RPE fatigue trend. An "easy/base run" is a logged run whose RPE
    // is recorded and ≤ RPE_EASY_MAX; RPE ≥ RPE_EASY_MAX+1 (8–10) is treated as
    // an intentional hard session / race and excluded so a planned workout can't
    // masquerade as accumulating easy-run fatigue.
    RPE_EASY_MAX: 7,
    /** Comparable easy runs required before a trend is trusted (anti-overreaction). */
    RPE_MIN_SAMPLES: 4,
    /** Look-back window (days) for the easy-run RPE trend. */
    RPE_WINDOW_DAYS: 21,
    /** Recent-half mean minus older-half mean ≥ this = rising (fatigue). */
    RPE_RISE_MIN: 1.0,
    /** growthFactor multiplier when easy-run RPE is trending up. */
    RPE_EASE: 0.85,

    // Sub-threshold next-morning pain DRIFT (0→1→2 below the hard pain cap).
    // Milder than a real breach; missing painNextAM is UNKNOWN, never zero.
    /** Next-AM pain readings (≤ cap) required before trusting a drift. */
    PAIN_DRIFT_MIN_SAMPLES: 3,
    /** Look-back window (days) for the next-AM pain drift. */
    PAIN_DRIFT_WINDOW_DAYS: 28,
    /** Recent-half mean minus older-half mean ≥ this = drifting up. */
    PAIN_DRIFT_RISE_MIN: 1.0,
    /** growthFactor multiplier when sub-threshold pain is drifting up. */
    PAIN_DRIFT_EASE: 0.85,
    /** Tighten the absorption cadence to at most this when pain is drifting. */
    PAIN_DRIFT_DOWNEVERY: 3,

    // Long-run readiness gate. Before the long run steps UP, look at how the last
    // logged long run actually felt. Any of these → hold the long-run ladder (a
    // session-specific hold; weekly mileage may still progress modestly). These
    // sit BELOW the pain cap on purpose: a long run can feel bad without breaching.
    /** Last long run RPE ≥ this = poor readiness → hold the long-run step. */
    LR_RPE_HIGH: 7,
    /** Pain DURING the last long run ≥ this = hold. */
    LR_PAIN_DURING_HIGH: 2,
    /** Next-morning pain after the last long run ≥ this = hold. */
    LR_PAIN_NEXTAM_HIGH: 2,
    /** Only a long run this recent (days) informs the readiness gate. */
    LR_LOOKBACK_DAYS: 21,

    // ── Phase 2B: weekly check-in recovery signal ─────────────
    // A composite, DETERMINISTIC recovery read from the weekly check-in
    // (sleep / soreness / energy / stress, each 1–5). Like every adaptive
    // signal it can only HOLD / REDUCE / DELOAD — a good week never speeds the
    // plan up. A missing check-in, or a field that is missing / out of the 1–5
    // range, is UNKNOWN: it is skipped, never read as good, bad, or zero. One
    // mildly rough field is a note only; it takes two bad fields (or a genuinely
    // extreme week, or repetition across weeks) to move the plan.
    RECOVERY: {
      // "Low" applies to sleep & energy (5 = best); "high" to soreness & stress
      // (5 = worst). A field at/inside these bounds is one caution "flag".
      SLEEP_LOW: 2,
      ENERGY_LOW: 2,
      SORENESS_HIGH: 4,
      STRESS_HIGH: 4,
      // The very-worst end of each field. Two+ of these IN ONE check-in makes an
      // extreme-poor week that can hold on its own, even without repetition.
      SLEEP_MIN: 1,
      ENERGY_MIN: 1,
      SORENESS_MAX: 5,
      STRESS_MAX: 5,
      /** ≥ this many caution flags in ONE check-in = a cautionary week. */
      CAUTION_MIN_FLAGS: 2,
      /** ≥ this many caution flags in ONE check-in = a poor week. */
      POOR_MIN_FLAGS: 3,
      /** ≥ this many EXTREME-end fields in one check-in = poor even alone. */
      EXTREME_MIN_FLAGS: 2,
      /** Recent check-ins (by weekStart) considered for repetition. */
      LOOKBACK_WEEKS: 3,
      /** ≥ this many cautionary-or-worse recent weeks = repeated poor
       *  (escalates a cautionary latest week to poor + a shallow deload). */
      REPEAT_MIN: 2,
      /** growthFactor multiplier for a cautionary week (shallow ease). */
      CAUTION_EASE: 0.85,
      /** growthFactor multiplier for a poor week (deeper, still bounded). */
      POOR_EASE: 0.7,
      /** Tighten the absorption cadence to at most this on REPEATED poor weeks
       *  (a shallow deload). Only ever shortens the cadence, never loosens it. */
      POOR_DOWNEVERY: 3,
    },

    // ── Phase 2C: earned-trust growth (the ONLY upward signal) ─────────────
    // The first — and deliberately most tightly constrained — place the app may
    // build FASTER than the population default. It never loosens a hard safety
    // constraint (long-run cap, pain gate, peak ceiling, completed-week lock);
    // it only widens the week-over-week VOLUME growth ceiling a little, and only
    // when recent training is provably clean.
    //
    //   Asymmetric by construction: earned SLOWLY (needs several clean completed
    //   weeks with strong adherence AND present, good body signals), revoked
    //   INSTANTLY (any one warning below disables it for that computation). It is
    //   grounded in ACTUAL logged evidence, never in the absence of data — a
    //   missing RPE history or missing check-in is UNKNOWN, so it can neither
    //   grant nor block trust; it simply leaves the plan on the default cap.
    EARNED_TRUST: {
      /** Master switch. false → every consumer is byte-identical to Phase 2B
       *  (earnedGrowthMax is never emitted, so the default +10%/wk cap binds). */
      ENABLED: true,
      /** Consecutive clean completed weeks (no pain breach, real running, inside
       *  the pain-tracking era) required before trust is earned. Earn slowly —
       *  one good day/week is never enough. */
      MIN_CLEAN_WEEKS: 3,
      /** Minimum recent adherence (completed vs a modest planned baseline) to
       *  earn trust. Stricter than the 0.7 floor that merely AVOIDS an ease. */
      MIN_ADHERENCE: 0.85,
      /** Minimum readable, good recent weekly check-ins required as corroborating
       *  evidence. Missing check-ins → unknown → trust is simply not earned. */
      MIN_CHECKIN_WEEKS: 2,
      /** The earned weekly-growth cap (multiplier). Modestly above the +10%/wk
       *  default. Conservative first pass; tune upward only with evidence. */
      GROWTH_MAX: 1.12,
      /** ABSOLUTE hard ceiling on the earned cap — no matter how GROWTH_MAX is
       *  later retuned, no consumer may ever exceed this. Structural guarantee,
       *  re-enforced by a clamp at every consumption site. */
      HARD_CEILING: 1.15,
      /** Phase 2D cooldown: after ANY revocation (veto), trust stays paused for
       *  this many days after the warning clears before it can re-activate —
       *  so earned-trust never flickers on/off across a boundary signal. */
      COOLDOWN_DAYS: 7,
    },
  },
} as const;
