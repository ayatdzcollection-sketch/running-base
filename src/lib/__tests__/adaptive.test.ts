import { describe, it, expect } from 'vitest';
import { computeAdaptiveProfile, toModulation } from '../adaptive';
import { generateNextWeek } from '../generator';
import { defaultGlobalState } from '../migrate';
import type { GlobalState, RunState } from '../types';

const NOW = '2026-07-07T12:00:00Z';
const TODAY = '2026-07-07';

function globals(patch: Partial<GlobalState> = {}): GlobalState {
  return { ...defaultGlobalState(NOW), ...patch };
}
function run(date: string, miles: number, extra: Partial<RunState[string]> = {}): RunState[string] {
  return { date, done: true, miles_actual: miles, updated_at: date + 'T12:00:00Z', ...extra };
}

/** N weeks of clean, adhered running ending just before TODAY. */
function cleanLog(weeks: number): RunState {
  const s: RunState = {};
  for (let w = 1; w <= weeks; w++) {
    for (const off of [0, 1, 2, 3, 4]) {
      const d = new Date('2026-07-06T12:00:00Z'); // last Monday
      d.setUTCDate(d.getUTCDate() - w * 7 + off);
      const date = d.toISOString().slice(0, 10);
      s[date] = run(date, 4);
    }
  }
  return s;
}

const CURRENT_LOG: RunState = {
  '2026-06-29': run('2026-06-29', 4), '2026-06-30': run('2026-06-30', 4),
  '2026-07-01': run('2026-07-01', 4), '2026-07-02': run('2026-07-02', 3.7),
  '2026-07-03': run('2026-07-03', 4.5), '2026-07-06': run('2026-07-06', 4.5),
};

describe('computeAdaptiveProfile — individual signals', () => {
  it('a robust responder (clean, adhered, no pain) gets the full safe rate (factor 1.0)', () => {
    const p = computeAdaptiveProfile(cleanLog(6), globals(), TODAY);
    expect(p.growthFactor).toBe(1.0);
    expect(p.readiness).toBe('building');
    expect(p.breachDays90).toBe(0);
    expect(p.cleanWeeks).toBeGreaterThanOrEqual(3);
  });

  it('a recent pain flare eases the build (factor well below 1)', () => {
    const flared: RunState = { ...cleanLog(6), '2026-07-06': run('2026-07-06', 4.5, { painDuring: 6 }) };
    const p = computeAdaptiveProfile(flared, globals({ painCap: 3 }), TODAY);
    expect(p.growthFactor).toBeLessThan(0.6);
    expect(['cautious', 'hold']).toContain(p.readiness);
    expect(p.reasons.join(' ')).toMatch(/pain day in the last two weeks/i);
  });

  it('slow-to-settle pain lowers the factor once there are enough comparable days', () => {
    // Three SUB-CAP runs whose pain came back worse by morning (unsettled) —
    // below the breach cap, so this isolates the overnight-settle signal, not
    // the breach path. Needs UNSETTLED_MIN_SAMPLES (3) comparable pain days
    // before the rate is trusted (isolated-sample overreaction fix).
    const slow: RunState = {
      ...cleanLog(6),
      '2026-06-19': run('2026-06-19', 4, { painDuring: 1, painNextAM: 2 }),
      '2026-06-26': run('2026-06-26', 4, { painDuring: 1, painNextAM: 2 }),
      '2026-07-03': run('2026-07-03', 4, { painDuring: 1, painNextAM: 2 }),
    };
    const p = computeAdaptiveProfile(slow, globals({ painCap: 3 }), TODAY);
    expect(p.breachDays90).toBe(0);                 // sub-cap: not breaches
    expect(p.unsettledRate).toBeGreaterThan(0.3);
    expect(p.growthFactor).toBeLessThan(1.0);
    expect(p.growthFactor).toBeGreaterThan(0.6);    // modest ease, milder than a breach
  });

  it('low recent adherence eases the build', () => {
    // only one run in the last 14 days
    const sparse: RunState = { '2026-07-02': run('2026-07-02', 4) };
    const p = computeAdaptiveProfile(sparse, globals(), TODAY);
    expect(p.adherence).toBeLessThan(0.7);
    expect(p.growthFactor).toBeLessThan(1.0);
  });

  it('more frequent down weeks for a fragile responder, never less frequent', () => {
    const flared: RunState = {
      ...cleanLog(6),
      '2026-06-25': run('2026-06-25', 4, { painDuring: 6 }),
      '2026-07-02': run('2026-07-02', 4, { painDuring: 6 }),
    };
    const p = computeAdaptiveProfile(flared, globals({ painCap: 3 }), TODAY);
    expect(p.downEvery).toBeLessThanOrEqual(4);
    expect(p.downEvery).toBeLessThanOrEqual(3); // 2+ breaches → tightened to 3
  });
});

describe('SAFETY INVARIANT — adaptation can only tighten, never loosen', () => {
  it('growthFactor is always within [0.4, 1.0] across many fixtures', () => {
    const fixtures: RunState[] = [
      {}, cleanLog(1), cleanLog(8), CURRENT_LOG,
      { ...cleanLog(4), '2026-07-06': run('2026-07-06', 4, { painDuring: 8 }) },
      { ...cleanLog(4), '2026-06-01': run('2026-06-01', 4, { painDuring: 5, painNextAM: 7 }) },
    ];
    for (const fx of fixtures) {
      const p = computeAdaptiveProfile(fx, globals({ painCap: 3 }), TODAY);
      expect(p.growthFactor).toBeGreaterThanOrEqual(0.4);
      expect(p.growthFactor).toBeLessThanOrEqual(1.0);
    }
  });
});

describe('generator honors adaptation (downward-only)', () => {
  it('a factor < 1 never produces a LARGER week than the population rate', () => {
    const noAdapt = generateNextWeek({ runState: CURRENT_LOG, globals: globals(), today: TODAY });
    const adapted = generateNextWeek({
      runState: CURRENT_LOG, globals: globals(), today: TODAY,
      adaptive: { growthFactor: 0.5, downEvery: 3 },
    });
    expect(adapted.totalMiles).toBeLessThanOrEqual(noAdapt.totalMiles + 1e-9);
  });

  it('a factor of 1.0 with the same cadence is identical to no adaptation', () => {
    const noAdapt = generateNextWeek({ runState: CURRENT_LOG, globals: globals(), today: TODAY });
    const same = generateNextWeek({
      runState: CURRENT_LOG, globals: globals(), today: TODAY,
      adaptive: { growthFactor: 1.0, downEvery: 3 },
    });
    expect(same.totalMiles).toBeCloseTo(noAdapt.totalMiles, 5);
  });

  it('adaptation NEVER changes the long run (the 110% ladder is untouched)', () => {
    const noAdapt = generateNextWeek({ runState: CURRENT_LOG, globals: globals(), today: TODAY });
    const adapted = generateNextWeek({
      runState: CURRENT_LOG, globals: globals(), today: TODAY,
      adaptive: { growthFactor: 0.4, downEvery: 3 },
    });
    expect(adapted.days[4].miles).toBe(noAdapt.days[4].miles);
  });

  it('adaptation never pushes a week below last week (it scales the increment, not the base)', () => {
    // last full week (Jun 29) = 20.2; an eased build must still be ≥ ~last week.
    const adapted = generateNextWeek({
      runState: CURRENT_LOG, globals: globals(), today: TODAY,
      adaptive: { growthFactor: 0.4, downEvery: 4 },
    });
    expect(adapted.totalMiles).toBeGreaterThanOrEqual(19.5);
  });

  it('toModulation carries the factor and cadence through', () => {
    const p = computeAdaptiveProfile(cleanLog(6), globals(), TODAY);
    const m = toModulation(p);
    expect(m.growthFactor).toBe(p.growthFactor);
    expect(m.downEvery).toBe(p.downEvery);
  });

  it('END TO END: recent pain makes the generated week no larger than a clean run', () => {
    const clean = CURRENT_LOG;
    const painful: RunState = { ...CURRENT_LOG, '2026-07-06': run('2026-07-06', 4.5, { painDuring: 6 }) };
    const cleanMod = toModulation(computeAdaptiveProfile(clean, globals({ painCap: 3 }), TODAY));
    const painMod = toModulation(computeAdaptiveProfile(painful, globals({ painCap: 3 }), TODAY));
    expect(painMod.growthFactor).toBeLessThan(cleanMod.growthFactor); // pain → more conservative
    const cleanWk = generateNextWeek({ runState: clean, globals: globals({ painCap: 3 }), today: TODAY, adaptive: cleanMod });
    const painWk = generateNextWeek({ runState: painful, globals: globals({ painCap: 3 }), today: TODAY, adaptive: painMod });
    expect(painWk.totalMiles).toBeLessThanOrEqual(cleanWk.totalMiles + 1e-9);
  });
});
