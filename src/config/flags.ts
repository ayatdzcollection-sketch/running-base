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
  /** Race log + Riegel projection card (Stage F) — DISPLAY ONLY. */
  RACE_LOG: true,
  /**
   * Race-adaptive TRAINING (paces feeding prescriptions). HARD OFF this base
   * block. Even when the user's `settings.adaptive` preference is on, effective
   * adaptive behavior = `adaptive && RACE_ADAPTIVE_TRAINING`, so it stays inert.
   * TODO(next block): only enable inside a post-base block that has its own
   * design + the same safety gates; never let it raise a cap or unlock speed.
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
