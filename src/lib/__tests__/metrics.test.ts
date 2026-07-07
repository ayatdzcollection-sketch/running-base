import { describe, it, expect } from 'vitest';
import {
  floorToHalf, nextLongFrom, trailing30Longest, nextLong,
  painFreeStreak, flareActive, recentBreach, nextMonday, mondayOf,
  weeklyActuals,
} from '../metrics';
import type { RunState } from '../types';

function run(date: string, miles: number | null, extra: Partial<RunState[string]> = {}): RunState[string] {
  return { date, done: true, miles_actual: miles, updated_at: date + 'T12:00:00Z', ...extra };
}

describe('nextLong ladder (§2)', () => {
  it('reproduces the existing ladder exactly: 4.5→5.0→5.5→6.0→6.5', () => {
    expect(nextLongFrom(4.5)).toBe(5.0);
    expect(nextLongFrom(5.0)).toBe(5.5);
    expect(nextLongFrom(5.5)).toBe(6.0);
    expect(nextLongFrom(6.0)).toBe(6.5);
  });

  it('uses the minimum half-step at low mileage (intended >110% edge)', () => {
    // floor(1.1*4.0)=4.0 ≤ 4.0 → min step applies: 4.0 → 4.5 (12.5%, trivial absolute spike)
    expect(nextLongFrom(4.0)).toBe(4.5);
  });

  it('binds to 110% at higher mileage', () => {
    // 1.1*10 = 11.0 → floorToHalf = 11.0 (a 0.5 step would be 5%, cap binds at 110%)
    expect(nextLongFrom(10)).toBe(11.0);
    expect(nextLongFrom(8.0)).toBe(8.5); // floor(8.8) = 8.5
  });

  it('floorToHalf picks the largest 0.5 step at or below', () => {
    expect(floorToHalf(4.95)).toBe(4.5);
    expect(floorToHalf(5.0)).toBe(5.0);
    expect(floorToHalf(6.05)).toBe(6.0);
  });

  it('clamps down automatically after missed volume', () => {
    // Longest in last 30 days is only 3.0 → ceiling drops to 3.5, not the old ladder
    const state: RunState = { '2026-07-01': run('2026-07-01', 3.0) };
    expect(nextLong(state, '2026-07-07')).toBe(3.5);
  });
});

describe('trailing30Longest', () => {
  it('takes the max actual within the window, ignoring older runs', () => {
    const state: RunState = {
      '2026-05-01': run('2026-05-01', 10),  // outside window
      '2026-06-20': run('2026-06-20', 4.0),
      '2026-07-03': run('2026-07-03', 4.5),
    };
    expect(trailing30Longest(state, '2026-07-07')).toBe(4.5);
  });

  it('falls back to 4.5 with no logged runs', () => {
    expect(trailing30Longest({}, '2026-07-07')).toBe(4.5);
  });

  it('ignores future-dated entries', () => {
    const state: RunState = { '2026-07-10': run('2026-07-10', 9) };
    expect(trailing30Longest(state, '2026-07-07')).toBe(4.5);
  });

  it("with includeEnd=false, today's own log cannot raise today's ceiling", () => {
    const state: RunState = {
      '2026-07-06': run('2026-07-06', 4.5),
      '2026-07-07': run('2026-07-07', 6.0), // today's over-cap run
    };
    expect(trailing30Longest(state, '2026-07-07', false)).toBe(4.5);
    expect(trailing30Longest(state, '2026-07-07')).toBe(6.0); // future ceilings do count it
  });
});

describe('pain governor (§3)', () => {
  const CAP = 3;

  it('pain-free runs build the streak; unlogged pain counts as pain-free', () => {
    const state: RunState = {
      '2026-07-01': run('2026-07-01', 4),
      '2026-07-02': run('2026-07-02', 4, { painDuring: 1 }),
      '2026-07-03': run('2026-07-03', 4),
    };
    expect(painFreeStreak(state, CAP)).toBe(3);
  });

  it('a pain-cap breach resets the streak to 0', () => {
    const state: RunState = {
      '2026-07-01': run('2026-07-01', 4),
      '2026-07-03': run('2026-07-03', 4, { painDuring: 5 }),
    };
    expect(painFreeStreak(state, CAP)).toBe(0);
  });

  it('streak counts runs after the last breach', () => {
    const state: RunState = {
      '2026-07-01': run('2026-07-01', 4, { painNextAM: 6 }),
      '2026-07-02': run('2026-07-02', 4),
      '2026-07-03': run('2026-07-03', 4),
    };
    expect(painFreeStreak(state, CAP)).toBe(2);
  });

  it('one breach in 7 days: banner but no flare', () => {
    const state: RunState = { '2026-07-05': run('2026-07-05', 4, { painDuring: 4 }) };
    expect(recentBreach(state, '2026-07-07', CAP)).toBe(true);
    expect(flareActive(state, '2026-07-07', CAP)).toBe(false);
  });

  it('two breaches in any 7-day window = flare', () => {
    const state: RunState = {
      '2026-07-02': run('2026-07-02', 4, { painDuring: 4 }),
      '2026-07-06': run('2026-07-06', 4, { painNextAM: 5 }),
    };
    expect(flareActive(state, '2026-07-07', CAP)).toBe(true);
  });

  it('breaches further apart than the window do not flare', () => {
    const state: RunState = {
      '2026-06-20': run('2026-06-20', 4, { painDuring: 4 }),
      '2026-07-06': run('2026-07-06', 4, { painDuring: 4 }),
    };
    expect(flareActive(state, '2026-07-07', CAP)).toBe(false);
  });

  it('pain at exactly the cap is tolerable (Silbernagel-style ≤)', () => {
    const state: RunState = { '2026-07-06': run('2026-07-06', 4, { painDuring: 3 }) };
    expect(recentBreach(state, '2026-07-07', CAP)).toBe(false);
  });
});

describe('date helpers', () => {
  it('nextMonday is strictly after today', () => {
    expect(nextMonday('2026-07-07')).toBe('2026-07-13'); // Tue → next Mon
    expect(nextMonday('2026-07-13')).toBe('2026-07-20'); // Mon → following Mon
    expect(nextMonday('2026-07-12')).toBe('2026-07-13'); // Sun → next day
  });

  it('mondayOf finds the week start', () => {
    expect(mondayOf('2026-07-07')).toBe('2026-07-06');
    expect(mondayOf('2026-07-06')).toBe('2026-07-06');
    expect(mondayOf('2026-07-12')).toBe('2026-07-06'); // Sunday belongs to the same week
  });
});

describe('weeklyActuals', () => {
  it('groups actuals by calendar week ascending', () => {
    const state: RunState = {
      '2026-06-29': run('2026-06-29', 4),
      '2026-07-03': run('2026-07-03', 4.5),
      '2026-07-06': run('2026-07-06', 4.5),
    };
    const weeks = weeklyActuals(state, '2026-07-07');
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toEqual({ weekStart: '2026-06-29', miles: 8.5, runCount: 2 });
    expect(weeks[1]).toEqual({ weekStart: '2026-07-06', miles: 4.5, runCount: 1 });
  });
});
