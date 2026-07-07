// ============================================================
// SUBJECTIVE-LOG PRESETS — pure mapping between the one-tap UI
// (chips / morning prompt) and the real numeric painDuring /
// painNextAM fields the safety gates read. Kept here, separate
// from the component, so the mapping is unit-testable.
// ============================================================

export type Chip = 'fine' | 'niggle' | 'hurt';

/** Which chip a stored painDuring corresponds to (null = nothing logged). */
export function chipFor(painDuring: number | null | undefined, cap: number): Chip | null {
  if (painDuring == null) return null;
  if (painDuring <= 0) return 'fine';
  if (painDuring <= cap) return 'niggle';
  return 'hurt';
}

/** Default sub-cap level when Niggle is first tapped (refinable to 1..cap). */
export function niggleDefault(cap: number): number {
  return Math.max(1, Math.round(cap / 2)); // cap 3 → 2
}

/**
 * painDuring to store when a chip is tapped.
 *   fine   → 0
 *   niggle → mid sub-cap default (then refine to 1..cap via sub-chips)
 *   hurt   → cap + 1 (a breach; then refine upward via the slider)
 * Tapping the already-selected chip clears the field (returns null). The exact
 * over-cap value is set by the slider's direct write, not by this function.
 */
export function painForChip(
  chip: Chip,
  cap: number,
  current: number | null | undefined,
): number | null {
  if (chip === chipFor(current, cap)) return null; // toggle off
  if (chip === 'fine') return 0;
  if (chip === 'niggle') return niggleDefault(cap);
  return cap + 1;
}

/**
 * painNextAM to store from the one-tap morning prompt.
 *   settled (Yes) → 0
 *   not settled (No) → painDuring + 1 (marks "did not settle"; becomes a
 *     breach only if that exceeds the cap — same value a user would type).
 */
export function morningAnswer(settled: boolean, painDuring: number): number {
  return settled ? 0 : Math.min(10, painDuring + 1);
}
