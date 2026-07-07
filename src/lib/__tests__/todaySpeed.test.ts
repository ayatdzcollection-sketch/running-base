import { describe, it, expect } from 'vitest';
import { computeTodaySpeed } from '../todaySpeed';
import { getPlan } from '../../config/plan';
import { defaultGlobalState } from '../migrate';
import type { GlobalState, ProposedDay, RunState } from '../types';

const NOW = '2026-07-07T12:00:00Z';
const plan = getPlan();

function globals(patch: Partial<GlobalState> = {}): GlobalState {
  return { ...defaultGlobalState(NOW), ...patch };
}
function run(date: string, extra: Partial<RunState[string]> = {}): RunState[string] {
  return { date, done: true, miles_actual: 4, updated_at: date + 'T12:00:00Z', ...extra };
}
function painFreeRuns(n: number, end = '2026-07-07'): RunState {
  const s: RunState = {};
  for (let i = 1; i <= n; i++) {
    const d = new Date(end + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    s[date] = run(date);
  }
  return s;
}

// Plan calendar: Week 2 is Jul 6–10; Tue Jul 7 is an easy day, Fri Jul 10 is long.
const EASY_DAY = '2026-07-07';
const LONG_DAY = '2026-07-10';
const REST_DAY = '2026-07-11';

const base = { plan, acceptedWeeks: {} as GlobalState['acceptedWeeks'] };

describe('computeTodaySpeed — suppression rules', () => {
  it('long-run day → explicit "no strides" row (dose none)', () => {
    const row = computeTodaySpeed({ runState: painFreeRuns(6), globals: globals({ speedState: 3 }), today: LONG_DAY, ...base });
    expect(row).not.toBeNull();
    expect(row!.dose).toBe('none');
    expect(row!.name).toMatch(/no strides/i);
  });

  it('flare (state 8) → no row', () => {
    const row = computeTodaySpeed({ runState: painFreeRuns(6), globals: globals({ speedState: 8 }), today: EASY_DAY, ...base });
    expect(row).toBeNull();
  });

  it('an active pain flare → no row even at a normal state', () => {
    const flared: RunState = {
      ...painFreeRuns(6),
      '2026-07-05': run('2026-07-05', { painDuring: 5 }),
      '2026-07-06': run('2026-07-06', { painNextAM: 6 }),
    };
    expect(computeTodaySpeed({ runState: flared, globals: globals({ speedState: 3 }), today: EASY_DAY, ...base })).toBeNull();
  });

  it('delayUntil in the future → no row', () => {
    const g = globals({ speedState: 3, delayUntil: '2026-09-01' });
    expect(computeTodaySpeed({ runState: painFreeRuns(6), globals: g, today: EASY_DAY, ...base })).toBeNull();
  });

  it('a rest day → no row', () => {
    expect(computeTodaySpeed({ runState: painFreeRuns(6), globals: globals({ speedState: 3 }), today: REST_DAY, ...base })).toBeNull();
  });

  it('an accepted-week long day suppresses (sourced from acceptedWeeks, not the plan)', () => {
    const acceptedWeeks = {
      '2026-07-13': [
        { date: '2026-07-14', dayLabel: 'Tue', kind: 'long', miles: 6, why: 'x' } as ProposedDay,
      ],
    };
    const row = computeTodaySpeed({ runState: painFreeRuns(6), globals: globals({ speedState: 3 }), today: '2026-07-14', plan, acceptedWeeks });
    expect(row?.dose).toBe('none');
  });

  it('an accepted-week threshold day → no add-on (the workout is the speed)', () => {
    const acceptedWeeks = {
      '2026-07-13': [
        { date: '2026-07-14', dayLabel: 'Tue', kind: 'threshold', miles: 4, why: 'x' } as ProposedDay,
      ],
    };
    expect(computeTodaySpeed({ runState: painFreeRuns(6), globals: globals({ speedState: 6 }), today: '2026-07-14', plan, acceptedWeeks })).toBeNull();
  });
});

describe('computeTodaySpeed — which low-dose rung by state', () => {
  it('state 1 (base only) → no add-on', () => {
    expect(computeTodaySpeed({ runState: painFreeRuns(6), globals: globals({ speedState: 1 }), today: EASY_DAY, ...base })).toBeNull();
  });

  it('state 2 → buildups', () => {
    const row = computeTodaySpeed({ runState: painFreeRuns(6), globals: globals({ speedState: 2 }), today: EASY_DAY, ...base });
    expect(row!.name).toBe('Buildups');
    expect(row!.optional).toBe(true);
  });

  it('state 3 with a pain-free streak → short strides', () => {
    const row = computeTodaySpeed({ runState: painFreeRuns(6), globals: globals({ speedState: 3 }), today: EASY_DAY, ...base });
    expect(row!.name).toBe('Short strides');
  });

  it('state 4 → flat strides', () => {
    const row = computeTodaySpeed({ runState: painFreeRuns(6), globals: globals({ speedState: 4 }), today: EASY_DAY, ...base });
    expect(row!.name).toBe('Flat neuromuscular strides');
  });

  it('strides fall back to buildups when the live streak has slipped below 3', () => {
    // At state 3 but only 1 clean run since a recent breach → not enough for strides.
    const state: RunState = {
      '2026-07-06': run('2026-07-06', { painDuring: 5 }), // breach resets the streak
    };
    const row = computeTodaySpeed({ runState: state, globals: globals({ speedState: 3, painCap: 3 }), today: EASY_DAY, ...base });
    // one breach in 7 isn't a flare (needs 2), so a row still shows — as buildups.
    expect(row?.name).toBe('Buildups');
  });

  it('hills/threshold never surface as the daily add-on (always low-dose)', () => {
    const g = globals({ speedState: 6 }); // threshold unlocked
    const row = computeTodaySpeed({ runState: painFreeRuns(6), globals: g, today: EASY_DAY, ...base });
    expect(row!.dose).toBe('low');
    expect(['Buildups', 'Short strides', 'Flat neuromuscular strides']).toContain(row!.name);
  });
});

describe('computeTodaySpeed — race/award are not inputs', () => {
  it('identical output regardless of logged races on globals', () => {
    const g1 = globals({ speedState: 3 });
    const g2 = globals({ speedState: 3, races: [{ id: 'a', date: '2026-06-20', distanceMi: 3.1, timeSec: 1000, updated_at: NOW }] });
    const a = computeTodaySpeed({ runState: painFreeRuns(6), globals: g1, today: EASY_DAY, ...base });
    const b = computeTodaySpeed({ runState: painFreeRuns(6), globals: g2, today: EASY_DAY, ...base });
    expect(a).toEqual(b);
  });
});
