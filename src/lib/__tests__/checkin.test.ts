import { describe, it, expect } from 'vitest';
import { summarizeCheckins, freshnessScore } from '../checkin';
import type { WeeklyCheckin } from '../types';

function c(weekStart: string, p: Partial<WeeklyCheckin> = {}): WeeklyCheckin {
  return { weekStart, sleep: 3, soreness: 2, energy: 3, stress: 2, updated_at: weekStart + 'T00:00:00Z', ...p };
}

describe('freshnessScore', () => {
  it('is high when sleep/energy are high and soreness/stress low', () => {
    expect(freshnessScore(c('2026-07-06', { sleep: 5, energy: 5, soreness: 1, stress: 1 }))).toBeGreaterThan(85);
  });
  it('is low when sore, stressed, and tired', () => {
    expect(freshnessScore(c('2026-07-06', { sleep: 1, energy: 1, soreness: 5, stress: 5 }))).toBeLessThan(15);
  });
});

describe('summarizeCheckins', () => {
  it('returns nulls for an empty log', () => {
    const s = summarizeCheckins({});
    expect(s.latest).toBeNull();
    expect(s.suggestion).toBeNull();
  });

  it('detects a rising-soreness trend across the two most recent weeks', () => {
    const s = summarizeCheckins({
      '2026-06-29': c('2026-06-29', { soreness: 2 }),
      '2026-07-06': c('2026-07-06', { soreness: 4 }),
    });
    expect(s.latest?.weekStart).toBe('2026-07-06');
    expect(s.previous?.weekStart).toBe('2026-06-29');
    expect(s.sorenessTrend).toBe('up');
    expect(s.suggestion).toMatch(/easier week|rest day/i);
  });

  it('suggests taking it easy when recovery is very low', () => {
    const s = summarizeCheckins({
      '2026-07-06': c('2026-07-06', { sleep: 1, energy: 1, soreness: 5, stress: 5 }),
    });
    expect(s.freshness).toBeLessThan(30);
    expect(s.suggestion).toBeTruthy();
  });

  it('stays quiet (no suggestion) on a healthy week', () => {
    const s = summarizeCheckins({
      '2026-06-29': c('2026-06-29', { soreness: 2 }),
      '2026-07-06': c('2026-07-06', { sleep: 4, energy: 4, soreness: 2, stress: 1 }),
    });
    expect(s.sorenessTrend).toBe('flat');
    expect(s.suggestion).toBeNull();
  });
});
