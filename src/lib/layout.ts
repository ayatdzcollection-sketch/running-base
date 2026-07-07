// ============================================================
// HOME LAYOUT — pure, immutable helpers over block-id lists.
//
// Stored order/hidden lists come from settings (untyped strings, possibly
// stale or hand-edited), so every read is sanitized against the registry:
// unknown ids dropped, duplicates removed, missing blocks appended in default
// order, non-hideable ids never hidden. All functions return NEW arrays and
// are idempotent — sanitize(sanitize(x)) === sanitize(x).
// ============================================================

import type { BlockId, BlockMeta } from '../config/homeBlocks';

/** Resolve the display order: known ids in stored order, then any registry
 *  blocks not yet present (new blocks appear at the bottom, never vanish). */
export function sanitizeOrder(stored: string[] | undefined, blocks: BlockMeta[]): BlockId[] {
  const known = new Set(blocks.map(b => b.id as string));
  const seen = new Set<string>();
  const order: BlockId[] = [];
  for (const id of stored ?? []) {
    if (known.has(id) && !seen.has(id)) { seen.add(id); order.push(id as BlockId); }
  }
  for (const b of blocks) {
    if (!seen.has(b.id)) { seen.add(b.id); order.push(b.id); }
  }
  return order;
}

/** Resolve the hidden set: keep only known, HIDEABLE ids (drops non-hideable
 *  and unknown — so a corrupted setting can never hide a safety block). */
export function sanitizeHidden(storedOff: string[] | undefined, blocks: BlockMeta[]): BlockId[] {
  const hideable = new Set(blocks.filter(b => b.hideable).map(b => b.id as string));
  const seen = new Set<string>();
  const out: BlockId[] = [];
  for (const id of storedOff ?? []) {
    if (hideable.has(id) && !seen.has(id)) { seen.add(id); out.push(id as BlockId); }
  }
  return out;
}

/** Move a block one slot up (-1) or down (+1). No-op at the ends / unknown id. */
export function moveBlock(order: BlockId[], id: BlockId, dir: -1 | 1): BlockId[] {
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return order.slice();
  const next = order.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Toggle a block's hidden state. Refuses non-hideable ids (returns unchanged). */
export function toggleHidden(off: BlockId[], id: BlockId, blocks: BlockMeta[]): BlockId[] {
  const meta = blocks.find(b => b.id === id);
  if (!meta || !meta.hideable) return off.slice();
  return off.includes(id) ? off.filter(x => x !== id) : [...off, id];
}
