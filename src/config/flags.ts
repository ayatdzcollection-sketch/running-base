// ============================================================
// FEATURE FLAGS — compile-time constants only.
//
// There is deliberately NO runtime/localStorage flag store: a
// mutable flag would be an attack surface on the safety gates.
// Flip a value here and rebuild to change what ships.
//
// Safety note: no flag can raise HR caps, long-run caps, speed
// permission, or intensity. The guarded features below are
// display-only or additive; the engine gates are unconditional.
// ============================================================

export const FLAGS = {
  /** Settings modal + plan regeneration from settings (Stage B). */
  SETTINGS_UI: true,
  /** todaySpeed daily prescription row on the Today card (Stage D). */
  TODAY_SPEED: true,
  /** Multi-week draft generation + accepted-week conflict checks (Stage E). */
  MULTI_WEEK_GENERATE: true,
  /**
   * Individual adaptive engine: personalizes the RATE of progression to the
   * runner's own response (flare history, pain-settle time, adherence). Safe by
   * construction — it can only slow the build for a fragile responder, never
   * exceed the population-capped rate, and never touches the long-run cap, HR
   * ceiling, pain gate, or speed ladder.
   */
  ADAPTIVE_ENGINE: true,
  /** Race log + Riegel projection card (Stage F) — DISPLAY ONLY. */
  RACE_LOG: true,
  /**
   * Race-adaptive TRAINING (paces feeding prescriptions). HARD OFF this base
   * block. Note: `settings.adaptive` is a persisted user PREFERENCE only — no
   * engine path reads it, so race data cannot affect training regardless of
   * this flag. When a post-base block is built, it must gate on this flag AND
   * keep the same safety gates: race paces may inform easy/workout paces in
   * that later block, never raise a cap or unlock a speed state.
   */
  RACE_ADAPTIVE_TRAINING: false,

  // ── Proposed home blocks (Stage H) — stubs only, no functionality. ──
  // Each row is still shown in Settings → Home layout (greyed, "SOON").
  // Flipping one to true reveals its polished stub card; none is interactive.
  dailyNotes: false,
  weeklyCheckin: false,
  shoeMileage: false,
  coachThread: false,
  heatEffort: false,
} as const;

export type FlagKey = keyof typeof FLAGS;

export function flagEnabled(k: FlagKey): boolean {
  return FLAGS[k];
}
