// ============================================================
// BUILD STEP CALIBRATION — the weekly build step is honored end
// to end, not silently eaten by splitWeek day-rounding.
//
// splitWeek must distribute the easy budget EXACTLY (largest-remainder
// half-steps), so a 1.0 / 1.5 / 2.0 mi build step shows up as a real
// week-over-week increase. Peak stays a ceiling; no easy day exceeds
// the long run; the day before the long run stays lightest.
// ============================================================

import { describe, it, expect } from 'vitest';
import { splitWeek, defaultSettings } from '../settings';
import { resolveEffectivePlan } from '../planOverlay';
import type { RawSettings, RunState } from '../types';

const NOW = '2026-07-08T12:00:00Z';
const TODAY = '2026-07-08';

function scenarioLog(): RunState {
  return {
    '2026-06-29': { date: '2026-06-29', done: true, miles_actual: 4.2, updated_at: NOW },
    '2026-06-30': { date: '2026-06-30', done: true, miles_actual: 4.0, updated_at: NOW },
    '2026-07-01': { date: '2026-07-01', done: true, miles_actual: 4.0, updated_at: NOW },
    '2026-07-02': { date: '2026-07-02', done: true, miles_actual: 3.5, updated_at: NOW },
    '2026-07-03': { date: '2026-07-03', done: true, miles_actual: 4.5, updated_at: NOW },
    '2026-07-06': { date: '2026-07-06', done: true, miles_actual: 4.5, updated_at: NOW },
    '2026-07-07': { date: '2026-07-07', done: true, miles_actual: 4.5, updated_at: NOW },
  };
}
function s(patch: Partial<RawSettings> = {}): RawSettings {
  return { ...defaultSettings(NOW), startMpw: 20, peakMpw: 30, downEvery: 4, weeksShown: 7, trailingLongest: 4.5, ...patch };
}
const totals = (ws: { totalPlanned: number }[]) => ws.map(w => w.totalPlanned);

// ── splitWeek: exact apportionment ───────────────────────────

describe('splitWeek distributes the easy budget EXACTLY (no silent round-down)', () => {
  // Feasible combos: total is reachable given daysPerWeek and the long run
  // (no easy day needs to exceed the long run).
  const cases: [number, number, number][] = [
    [23, 5.5, 5], [24, 5.5, 5], [25, 5.5, 5], [26, 6.0, 5], [28, 6.5, 5], [30, 7.0, 5],
    [22, 6.0, 4], [24, 6.5, 4], [18, 5.0, 6], [27, 6.5, 6],
  ];
  it('the run-day sum equals roundHalf(total) for every feasible combo', () => {
    for (const [total, long, days] of cases) {
      const parts = splitWeek(total, long, days);
      const sum = parts.reduce((a, b) => a + b, 0);
      expect(sum, `splitWeek(${total},${long},${days})`).toBeCloseTo(total, 5);
    }
  });

  it('every part is a half-step, no easy day exceeds the long run, long run is last', () => {
    for (const [total, long, days] of cases) {
      const parts = splitWeek(total, long, days);
      expect(parts.length).toBe(days);
      const longR = parts[parts.length - 1];
      for (const p of parts) {
        expect(Math.round(p / 0.5)).toBeCloseTo(p / 0.5, 9);  // multiple of 0.5
        expect(p).toBeLessThanOrEqual(longR + 1e-9);          // nothing above the long run
        expect(p).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('the day BEFORE the long run is the lightest easy day', () => {
    const parts = splitWeek(26, 6, 5); // [.., lastEasy, long]
    const easy = parts.slice(0, -1);
    const lastEasy = easy[easy.length - 1];
    for (const e of easy) expect(lastEasy).toBeLessThanOrEqual(e + 1e-9);
  });

  it('never EXCEEDS roundHalf(total) — peak stays a ceiling even when infeasible', () => {
    // 28 over 4 days with a 6.5 long can't be reached (easy days capped at the
    // long run) — the week falls SHORT, never over. That's the cap working.
    const parts = splitWeek(28, 6.5, 4);
    expect(parts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(28 + 1e-9);
  });
});

// ── build step honored in the rolling plan ───────────────────

describe('the weekly build step is honored in the displayed plan', () => {
  // buildStep is the MINIMUM weekly increase (a FLOOR). When the peak is close
  // the plan moves at exactly buildStep; when the peak is far the peak-seek term
  // can pull the climb faster (up to the +10%/wk cap), so raising the peak is
  // visible. These tests pin the floor + the calibrated buildStep=2/peak=30 case.

  it('buildStep=2.0 with peak 30 rises by exactly ~2.0/wk (the calibrated case)', () => {
    const weeks = resolveEffectivePlan(s({ buildStep: 2.0 }), scenarioLog(), TODAY).plan.weeks;
    const t = totals(weeks);
    // W2→W3 and W5→W6 are build-to-build steps (W4 is the down week). Here the
    // gap to peak is small enough that buildStep is the binding rate.
    expect(t[2] - t[1]).toBeCloseTo(2.0, 1);   // 22 → 24
    expect(t[5] - t[4]).toBeCloseTo(2.0, 1);   // 26 → 28
    expect(t[6]).toBeCloseTo(30, 1);           // reaches the peak by W7
  });

  it('buildStep is a FLOOR: every build week rises by at least buildStep (until it caps at peak)', () => {
    for (const bs of [1.0, 1.5, 2.0]) {
      const weeks = resolveEffectivePlan(s({ buildStep: bs, peakMpw: 40 }), scenarioLog(), TODAY).plan.weeks;
      const t = totals(weeks);
      let lastBuild = t[1]; // W2 locked (22)
      for (let i = 2; i < weeks.length; i++) {
        if (weeks[i].isDownWeek) continue;
        // grows by at least buildStep (minus a half-step of rounding slack) while below peak
        if (t[i] < 40 - 1e-9) expect(t[i] - lastBuild).toBeGreaterThanOrEqual(bs - 0.5 - 1e-9);
        lastBuild = t[i];
      }
    }
  });

  it('a bigger build step climbs at least as fast and reaches a higher terminal week', () => {
    const slow = totals(resolveEffectivePlan(s({ buildStep: 1.0 }), scenarioLog(), TODAY).plan.weeks);
    const fast = totals(resolveEffectivePlan(s({ buildStep: 2.0 }), scenarioLog(), TODAY).plan.weeks);
    expect(fast[6]).toBeGreaterThan(slow[6]);         // 30 vs ~27.5
    for (const v of fast) expect(v).toBeLessThanOrEqual(30 + 1e-9); // peak stays a ceiling
  });

  it('the build step never breaches the +10%/week safety cap', () => {
    // buildStep=4 requested, but +10% of ~20–26 mpw is ~2–2.6, so the cap binds.
    const weeks = resolveEffectivePlan(s({ buildStep: 4 }), scenarioLog(), TODAY).plan.weeks;
    const t = totals(weeks);
    let lastBuild = t[1]; // W2 (locked)
    for (let i = 2; i < weeks.length; i++) {
      if (weeks[i].isDownWeek) continue;
      expect(t[i]).toBeLessThanOrEqual(lastBuild * 1.1 + 0.5 + 1e-9);
      lastBuild = t[i];
    }
  });
});

describe('the calibrated default', () => {
  it('defaults buildStep to 1.5 (summer-base rate)', () => {
    expect(defaultSettings(NOW).buildStep).toBe(1.5);
  });
});
