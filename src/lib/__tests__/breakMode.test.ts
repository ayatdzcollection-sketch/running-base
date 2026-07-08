// ============================================================
// BREAK MODE — pause the rolling plan; length-aware conservative
// resume. The only reset-style action after Phase 1. Never
// touches the run log; completed weeks stay locked.
// ============================================================

import { describe, it, expect } from 'vitest';
import { resolveEffectivePlan, isOnBreak } from '../planOverlay';
import { defaultSettings, returnFromBreak } from '../settings';
import { addDaysStr } from '../metrics';
import type { RawSettings, RunState } from '../types';

const NOW = '2026-07-08T12:00:00Z';
const TODAY = '2026-07-08';
const BREAK_START = '2026-07-13'; // next Monday

function raw(patch: Partial<RawSettings> = {}): RawSettings {
  return { ...defaultSettings(NOW), ...patch };
}
function scenarioLog(): RunState {
  return {
    '2026-06-29': { date: '2026-06-29', done: true, miles_actual: 4.2, updated_at: NOW },
    '2026-06-30': { date: '2026-06-30', done: true, miles_actual: 4.0, updated_at: NOW },
    '2026-07-01': { date: '2026-07-01', done: true, miles_actual: 4.0, updated_at: NOW },
    '2026-07-02': { date: '2026-07-02', done: true, miles_actual: 3.5, updated_at: NOW },
    '2026-07-03': { date: '2026-07-03', done: true, miles_actual: 4.5, updated_at: NOW },
    '2026-07-06': { date: '2026-07-06', done: true, miles_actual: 4.5, updated_at: NOW },
  };
}
function s(patch: Partial<RawSettings> = {}): RawSettings {
  return raw({ startMpw: 20, peakMpw: 30, buildStep: 1, downEvery: 4, weeksShown: 12, trailingLongest: 4.5, ...patch });
}

// ── isOnBreak ────────────────────────────────────────────────

describe('isOnBreak', () => {
  it('null / undefined / empty means not on break', () => {
    expect(isOnBreak(null, TODAY)).toBe(false);
    expect(isOnBreak(undefined, TODAY)).toBe(false);
  });
  it('true when breakStart has already occurred', () => {
    expect(isOnBreak('2026-07-01', TODAY)).toBe(true);
    expect(isOnBreak(TODAY, TODAY)).toBe(true);
  });
  it('a future breakStart date does not count yet', () => {
    expect(isOnBreak('2026-08-01', TODAY)).toBe(false);
  });
});

// ── resolveEffectivePlan cutoff during a break ───────────────

describe('resolveEffectivePlan pauses future generation during a break', () => {
  it('with no break: settings weeks generate up to the visible window', () => {
    const noBreak = resolveEffectivePlan(s({ weeksShown: 7 }), scenarioLog(), TODAY).plan.weeks;
    expect(noBreak.length).toBe(7);
  });

  it('with a breakStart in the middle of the window, weeks on/after that date are omitted', () => {
    // W1 (2026-06-29) and W2 (2026-07-06) are LOCKED past weeks (real logs).
    // BREAK_START = 2026-07-13 = start of W3. So W3..W7 should not generate.
    const withBreak = resolveEffectivePlan(s({ weeksShown: 7 }), scenarioLog(), TODAY, { breakStart: BREAK_START }).plan.weeks;
    // Only the 2 locked weeks remain — the rest of the window is paused.
    expect(withBreak.length).toBe(2);
    for (const w of withBreak) expect(w.startDate < BREAK_START).toBe(true);
  });

  it('locked past weeks are still shown during a break (history remains visible)', () => {
    const withBreak = resolveEffectivePlan(s({ weeksShown: 7 }), scenarioLog(), TODAY, { breakStart: BREAK_START }).plan.weeks;
    // W1 = 20.0, W2 = 22.0 from the static config.
    expect(withBreak[0].totalPlanned).toBeCloseTo(20, 0);
    expect(withBreak[1].totalPlanned).toBeCloseTo(22, 0);
  });

  it('a break at the current week boundary still shows locked history but no future settings weeks', () => {
    // BREAK_START at current week's Monday (W2). W1 is locked history (past),
    // W2 is locked (current), W3+ are future settings weeks — those get paused.
    const currentMonday = '2026-07-06';
    const weeks = resolveEffectivePlan(s({ weeksShown: 7 }), scenarioLog(), TODAY, { breakStart: currentMonday }).plan.weeks;
    // Locked weeks (W1 & W2) still show; future settings weeks (W3..W7) do not.
    for (const w of weeks) {
      // Either the week starts before break, OR it's a locked past/current week.
      const isLocked = w.startDate <= currentMonday;
      expect(isLocked).toBe(true);
    }
  });

  it('a breakStart that never intersects the window leaves the plan unchanged', () => {
    const noEffect = resolveEffectivePlan(s({ weeksShown: 4 }), scenarioLog(), TODAY, { breakStart: '2027-01-01' }).plan.weeks;
    expect(noEffect.length).toBe(4);
  });

  it('runState is never mutated by resolving during a break', () => {
    const log = scenarioLog();
    const before = JSON.stringify(log);
    resolveEffectivePlan(s(), log, TODAY, { breakStart: BREAK_START });
    expect(JSON.stringify(log)).toBe(before);
  });
});

// ── returnFromBreak: length-aware conservative reseed ────────

describe('returnFromBreak', () => {
  it('very short break (< 7 days): 100% resume — startMpw = pre-break volume', () => {
    // Break of 4 days: today = 2026-07-10 (Fri), break started Monday.
    const today = '2026-07-10';
    const breakStart = '2026-07-06';
    const { settings, breakDays, seedFactor } = returnFromBreak(s(), scenarioLog(), today, breakStart, NOW);
    expect(breakDays).toBe(4);
    expect(seedFactor).toBe(1.0);
    // Pre-break sustained (last complete week BEFORE breakStart) = W1 = 20.2.
    expect(settings.startMpw).toBeGreaterThanOrEqual(20);
  });

  it('short break (7–13 days): ~90% resume', () => {
    const today = '2026-07-16'; // 10 days after breakStart 2026-07-06
    const { seedFactor, breakDays } = returnFromBreak(s(), scenarioLog(), today, '2026-07-06', NOW);
    expect(breakDays).toBe(10);
    expect(seedFactor).toBe(0.90);
  });

  it('standard break (14–20 days): 75% conservative reseed', () => {
    const today = '2026-07-24'; // 18 days after 2026-07-06
    const { seedFactor, breakDays } = returnFromBreak(s(), scenarioLog(), today, '2026-07-06', NOW);
    expect(breakDays).toBe(18);
    expect(seedFactor).toBe(0.75);
  });

  it('long break (21–41 days): 60% conservative ramp — detraining is real', () => {
    const today = '2026-08-06'; // 31 days after 2026-07-06
    const { seedFactor, breakDays } = returnFromBreak(s(), scenarioLog(), today, '2026-07-06', NOW);
    expect(breakDays).toBe(31);
    expect(seedFactor).toBe(0.60);
  });

  it('very long break (≥ 42 days): 45% floor — treat as fresh base', () => {
    const today = '2026-09-01'; // 57 days after 2026-07-06
    const { seedFactor, breakDays } = returnFromBreak(s(), scenarioLog(), today, '2026-07-06', NOW);
    expect(breakDays).toBe(57);
    expect(seedFactor).toBe(0.45);
  });

  it('startDate advances to next Monday from today; xcStartDate is pushed past the fresh window', () => {
    const today = '2026-08-20'; // Thursday
    const { settings: s2 } = returnFromBreak(s({ weeksShown: 8 }), scenarioLog(), today, '2026-07-06', NOW);
    expect(s2.startDate).toBe(addDaysStr(today, 4)); // next Monday = 2026-08-24
    expect(s2.xcStartDate).toBe(addDaysStr(s2.startDate, 8 * 7));
    expect(s2.xcStartDate > s2.startDate).toBe(true);
  });

  it('a runner with NO pre-break history still gets a sensible floor (no zero-mpw seed)', () => {
    const empty: RunState = {};
    const { settings: s2 } = returnFromBreak(s({ startMpw: 20 }), empty, '2026-08-01', '2026-07-01', NOW);
    expect(s2.startMpw).toBeGreaterThanOrEqual(6);
    expect(s2.startMpw).toBeLessThanOrEqual(20);
  });

  it('the run log is NEVER mutated (returnFromBreak is pure w.r.t. runState)', () => {
    const log = scenarioLog();
    const before = JSON.stringify(log);
    returnFromBreak(s(), log, '2026-08-01', '2026-07-06', NOW);
    expect(JSON.stringify(log)).toBe(before);
  });

  it('preferences carry over — goal, days/week, planning window, HR governors, layout', () => {
    const custom = raw({ goalMiles: 200, daysPerWeek: 4, weeksShown: 10, capPct: 108, hrHardCap: 152 });
    const { settings: s2 } = returnFromBreak(custom, {}, '2026-09-01', '2026-07-01', NOW);
    expect(s2.goalMiles).toBe(200);
    expect(s2.daysPerWeek).toBe(4);
    expect(s2.weeksShown).toBe(10);
    expect(s2.capPct).toBe(108);
    expect(s2.hrHardCap).toBe(152);
  });

  it('seeded startMpw ≤ peakMpw after return (peak is bumped if the floor exceeds it)', () => {
    // A runner returning after a very short break with big pre-break volume.
    const heavy: RunState = {};
    for (let d = 0; d < 5; d++) {
      const date = addDaysStr('2026-06-29', d);
      heavy[date] = { date, done: true, miles_actual: 12, updated_at: NOW };  // 60mi week
    }
    const { settings: s2 } = returnFromBreak(s({ peakMpw: 30 }), heavy, '2026-07-10', '2026-07-06', NOW);
    expect(s2.peakMpw).toBeGreaterThanOrEqual(s2.startMpw);
  });
});
