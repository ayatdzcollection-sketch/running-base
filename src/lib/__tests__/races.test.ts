import { describe, it, expect } from 'vitest';
import { riegelPredict, predictionTable, mergeRaces, RIEGEL_EXPONENT } from '../races';
import { generateNextWeek } from '../generator';
import { canSetState, evaluateReadiness, typeStatus, SPEED_TYPES } from '../speed';
import { computeTodaySpeed } from '../todaySpeed';
import { migrateGlobalState, defaultGlobalState } from '../migrate';
import { getPlan } from '../../config/plan';
import type { GlobalState, RaceResult, RunState } from '../types';

const NOW = '2026-07-07T12:00:00Z';
const TODAY = '2026-07-07';
const plan = getPlan();

function globals(patch: Partial<GlobalState> = {}): GlobalState {
  return { ...defaultGlobalState(NOW), ...patch };
}
function run(date: string, miles: number, extra: Partial<RunState[string]> = {}): RunState[string] {
  return { date, done: true, miles_actual: miles, updated_at: date + 'T12:00:00Z', ...extra };
}
const LOG: RunState = {
  '2026-06-29': run('2026-06-29', 4), '2026-06-30': run('2026-06-30', 4),
  '2026-07-01': run('2026-07-01', 4), '2026-07-02': run('2026-07-02', 3.7),
  '2026-07-03': run('2026-07-03', 4.5), '2026-07-06': run('2026-07-06', 4.5),
};
const race = (id: string, distanceMi: number, timeSec: number, date: string, updated_at = NOW): RaceResult =>
  ({ id, date, distanceMi, timeSec, updated_at });

describe('Riegel projection math', () => {
  it('projects 5K → 10K with exponent 1.06 (~80% model)', () => {
    // 5K in 25:00 → 10K ≈ 52:07.
    const t = riegelPredict(1500, 3.10686, 6.21371);
    expect(Math.round(t)).toBeGreaterThanOrEqual(3120);
    expect(Math.round(t)).toBeLessThanOrEqual(3135);
  });
  it('is monotonic — a longer distance always projects a longer time', () => {
    expect(riegelPredict(300, 1, 2)).toBeGreaterThan(300);
    expect(riegelPredict(300, 2, 1)).toBeLessThan(300);
  });
  it('uses 1.06 as the default exponent', () => {
    expect(RIEGEL_EXPONENT).toBe(1.06);
    expect(riegelPredict(600, 1, 2)).toBeCloseTo(600 * Math.pow(2, 1.06), 5);
  });
  it('predictionTable is empty with no races and marks the logged row', () => {
    expect(predictionTable([])).toEqual([]);
    const table = predictionTable([race('a', 3.10686, 1170, '2026-06-20')]); // a 5K
    expect(table.find(p => p.key === '5k')!.logged).toBe(true);
    expect(table.find(p => p.key === 'mile')!.logged).toBe(false);
  });
});

describe('mergeRaces', () => {
  it('merges by id, newest updated_at wins, keeps device-only entries', () => {
    const local = [race('a', 1, 300, '2026-06-01', '2026-06-02T00:00:00Z'), race('b', 1, 310, '2026-05-01')];
    const remote = [race('a', 1, 295, '2026-06-01', '2026-06-03T00:00:00Z'), race('c', 1, 320, '2026-04-01')];
    const merged = mergeRaces(local, remote);
    expect(merged.map(r => r.id).sort()).toEqual(['a', 'b', 'c']);
    expect(merged.find(r => r.id === 'a')!.timeSec).toBe(295); // newer wins
  });
});

describe('migration fills races: [] and never seeds a race', () => {
  it('defaults to an empty race list', () => {
    expect(migrateGlobalState({ speedState: 2 }, NOW).races).toEqual([]);
  });
});

// ── The safety-critical guarantee: races cannot escalate anything ──
describe('no-escalation proofs — a fast race changes NOTHING in the engine', () => {
  const fast = [race('pr', 3.10686, 900, '2026-07-01')]; // a blazing 15:00 5K
  const g0 = globals({ speedState: 4 });
  const gRace = globals({ speedState: 4, races: fast });
  const gRaceAdaptive = globals({ speedState: 4, races: fast, settings: { adaptive: true } as never });

  it('generateNextWeek output is identical with vs without a race', () => {
    const a = generateNextWeek({ runState: LOG, globals: g0, today: TODAY });
    const b = generateNextWeek({ runState: LOG, globals: gRace, today: TODAY });
    const c = generateNextWeek({ runState: LOG, globals: gRaceAdaptive, today: TODAY });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('canSetState / evaluateReadiness / typeStatus are identical with vs without a race', () => {
    expect(canSetState(5, LOG, gRace, TODAY)).toEqual(canSetState(5, LOG, g0, TODAY));
    expect(evaluateReadiness(5, LOG, gRace, TODAY)).toEqual(evaluateReadiness(5, LOG, g0, TODAY));
    for (const t of SPEED_TYPES) {
      expect(typeStatus(t, gRace, TODAY)).toBe(typeStatus(t, g0, TODAY));
    }
  });

  it('computeTodaySpeed is identical with vs without a race', () => {
    const args0 = { runState: LOG, globals: g0, today: TODAY, plan, acceptedWeeks: {} };
    const argsR = { runState: LOG, globals: gRace, today: TODAY, plan, acceptedWeeks: {} };
    expect(computeTodaySpeed(argsR)).toEqual(computeTodaySpeed(args0));
  });
});
