// Small id helper for locally-created records (shoes, PT notes, …).
// crypto.randomUUID when available; a timestamp+counter fallback otherwise so
// two ids minted in the same millisecond never collide.
let seq = 0;

export function newId(prefix = 'id'): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through to the deterministic-ish fallback */ }
  return `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
}
