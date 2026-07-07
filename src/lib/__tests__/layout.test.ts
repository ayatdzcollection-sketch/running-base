import { describe, it, expect } from 'vitest';
import { sanitizeOrder, sanitizeHidden, moveBlock, toggleHidden } from '../layout';
import { HOME_BLOCKS, STUB_IDS, type BlockId } from '../../config/homeBlocks';

const B = HOME_BLOCKS;
const DEFAULT_ORDER = B.map(b => b.id);

describe('sanitizeOrder', () => {
  it('undefined → the full registry default order', () => {
    expect(sanitizeOrder(undefined, B)).toEqual(DEFAULT_ORDER);
  });

  it('drops unknown ids and dedupes, appending any missing in default order', () => {
    const stored = ['weeks', 'today', 'today', 'bogus', 'speed'];
    const out = sanitizeOrder(stored, B);
    expect(out.slice(0, 3)).toEqual(['weeks', 'today', 'speed']); // stored order kept
    expect(out).not.toContain('bogus' as BlockId);
    expect(new Set(out)).toEqual(new Set(DEFAULT_ORDER)); // every block present exactly once
    expect(out).toHaveLength(DEFAULT_ORDER.length);
  });

  it('appends a newly-added registry block at the bottom (never vanishes)', () => {
    const partial = DEFAULT_ORDER.slice(0, 5).map(String);
    const out = sanitizeOrder(partial, B);
    expect(out).toHaveLength(DEFAULT_ORDER.length);
    expect(out.slice(0, 5)).toEqual(DEFAULT_ORDER.slice(0, 5));
  });

  it('is idempotent', () => {
    const once = sanitizeOrder(['speed', 'today', 'x'], B);
    expect(sanitizeOrder(once.map(String), B)).toEqual(once);
  });
});

describe('sanitizeHidden', () => {
  it('keeps only known hideable ids', () => {
    expect(sanitizeHidden(['award', 'backup'], B)).toEqual(['award', 'backup']);
  });

  it('strips a NON-hideable (safety) id — corrupted settings can never hide it', () => {
    expect(sanitizeHidden(['today', 'award', 'hipspeed'], B)).toEqual(['award']);
  });

  it('strips unknown ids and dedupes; undefined → empty', () => {
    expect(sanitizeHidden(['award', 'award', 'nope'], B)).toEqual(['award']);
    expect(sanitizeHidden(undefined, B)).toEqual([]);
  });
});

describe('moveBlock', () => {
  const order = sanitizeOrder(undefined, B);
  it('moves up and down', () => {
    const down = moveBlock(order, 'today', 1);
    expect(down[1]).toBe('today');
    expect(down[0]).toBe('week');
    expect(moveBlock(down, 'today', -1)).toEqual(order);
  });
  it('no-op at the ends and for unknown ids, never mutates input', () => {
    const copy = order.slice();
    expect(moveBlock(order, order[0], -1)).toEqual(order);
    expect(moveBlock(order, order[order.length - 1], 1)).toEqual(order);
    expect(moveBlock(order, 'bogus' as BlockId, 1)).toEqual(order);
    expect(order).toEqual(copy);
  });
});

describe('toggleHidden', () => {
  it('adds then removes a hideable id', () => {
    const a = toggleHidden([], 'award', B);
    expect(a).toContain('award' as BlockId);
    expect(toggleHidden(a, 'award', B)).not.toContain('award' as BlockId);
  });
  it('refuses to hide a non-hideable (safety) block', () => {
    expect(toggleHidden([], 'today', B)).toEqual([]);
    expect(toggleHidden([], 'pain', B)).toEqual([]);
  });
});

describe('registry invariants (regression guard)', () => {
  it('every safety-critical block is non-hideable', () => {
    for (const b of B) if (b.safetyCritical) expect(b.hideable).toBe(false);
  });
  it('ids are unique and the default order contains each exactly once', () => {
    expect(new Set(DEFAULT_ORDER).size).toBe(DEFAULT_ORDER.length);
  });
  it('STUB_IDS are exactly the non-real blocks and all hideable', () => {
    expect(STUB_IDS).toEqual(B.filter(b => !b.real).map(b => b.id));
    for (const id of STUB_IDS) expect(B.find(b => b.id === id)!.hideable).toBe(true);
  });
});
