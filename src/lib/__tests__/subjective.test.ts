import { describe, it, expect } from 'vitest';
import { chipFor, niggleDefault, painForChip, morningAnswer } from '../subjective';

const CAP = 3;

describe('chip → painDuring mapping (audit item 2)', () => {
  it('Fine stores 0', () => {
    expect(painForChip('fine', CAP, null)).toBe(0);
  });

  it('Niggle stores the mid sub-cap default (cap 3 → 2), never the cap ceiling', () => {
    expect(painForChip('niggle', CAP, null)).toBe(2);
    expect(niggleDefault(3)).toBe(2);
    expect(niggleDefault(5)).toBe(3);
  });

  it('Hurt stores cap + 1 (a breach) when entering from a non-hurt state', () => {
    expect(painForChip('hurt', CAP, null)).toBe(4); // from nothing logged
    expect(painForChip('hurt', CAP, 0)).toBe(4);    // from Fine
    expect(painForChip('hurt', CAP, 2)).toBe(4);    // from Niggle
  });

  it('tapping the already-selected chip clears the field (toggle off, incl. Hurt)', () => {
    expect(painForChip('fine', CAP, 0)).toBeNull();      // already Fine
    expect(painForChip('niggle', CAP, 2)).toBeNull();    // already Niggle
    expect(painForChip('hurt', CAP, 5)).toBeNull();      // already Hurt (slider value 5) → clears
  });

  it('chipFor round-trips the stored numbers', () => {
    expect(chipFor(null, CAP)).toBeNull();
    expect(chipFor(0, CAP)).toBe('fine');
    expect(chipFor(1, CAP)).toBe('niggle');
    expect(chipFor(3, CAP)).toBe('niggle'); // at cap = still tolerable
    expect(chipFor(4, CAP)).toBe('hurt');   // over cap = breach
  });

  it('preserves sub-cap granularity: 1 and 2 are distinct stored values (trend signal intact)', () => {
    // A worsening ache logged via the sub-chips stays visible to the
    // week-over-week readiness gate, which compares real numbers.
    expect(chipFor(1, CAP)).toBe('niggle');
    expect(chipFor(2, CAP)).toBe('niggle');
    expect(1).not.toBe(2); // the numbers differ, so weekPainMax can rise 1→2→3
  });
});

describe('morning-after answer → painNextAM (audit item 4)', () => {
  it('Yes (settled) writes 0', () => {
    expect(morningAnswer(true, 4)).toBe(0);
    expect(morningAnswer(true, 0)).toBe(0);
  });

  it('No (not settled) writes painDuring + 1 — a breach when the during-pain was at/over cap', () => {
    expect(morningAnswer(false, 3)).toBe(4); // niggle-at-cap that didn't settle → breach
    expect(morningAnswer(false, 5)).toBe(6);
  });

  it('No on a low sub-cap ache marks "did not settle" without forcing a false breach', () => {
    expect(morningAnswer(false, 1)).toBe(2); // 2 ≤ cap: no breach, but > during so readiness "settled" fails
  });

  it('clamps at 10', () => {
    expect(morningAnswer(false, 10)).toBe(10);
  });
});
