import { describe, it, expect } from 'vitest';
import { canSetState, evaluateReadiness, typeStatus, SPEED_TYPES, validStrides, enforceGateConsistency } from '../speed';
import { defaultGlobalState } from '../migrate';
import { defaultSettings } from '../settings';
import type { GlobalState, RunState, SpeedStateNum } from '../types';

const NOW = '2026-07-07T12:00:00Z';
const TODAY = '2026-07-07';

function run(date: string, extra: Partial<RunState[string]> = {}): RunState[string] {
  return { date, done: true, miles_actual: 4, updated_at: date + 'T12:00:00Z', ...extra };
}

/** N consecutive pain-free completed runs ending yesterday. */
function painFreeRuns(n: number): RunState {
  const state: RunState = {};
  for (let i = 1; i <= n; i++) {
    const d = new Date('2026-07-07T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    state[date] = run(date);
  }
  return state;
}

function globals(patch: Partial<GlobalState> = {}): GlobalState {
  return { ...defaultGlobalState(NOW), ...patch };
}

describe('state machine (§4)', () => {
  it('downward transitions are always allowed', () => {
    expect(canSetState(1, {}, globals({ speedState: 6 }), TODAY).allowed).toBe(true);
    expect(canSetState(8, {}, globals({ speedState: 2 }), TODAY).allowed).toBe(true);
  });

  it('upward requires readiness all-green (empty log blocks: streak 0)', () => {
    expect(canSetState(2, {}, globals(), TODAY).allowed).toBe(false);
  });

  it('upward allowed with a sufficient pain-free streak', () => {
    expect(canSetState(2, painFreeRuns(4), globals(), TODAY).allowed).toBe(true);
  });

  it('cannot skip states upward', () => {
    const res = canSetState(4, painFreeRuns(10), globals({ speedState: 1 }), TODAY);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/one state at a time/);
  });

  it('delayUntil in the future blocks upward, not downward', () => {
    const g = globals({ speedState: 2, delayUntil: '2026-08-01' });
    expect(canSetState(3, painFreeRuns(10), g, TODAY).allowed).toBe(false);
    expect(canSetState(1, painFreeRuns(10), g, TODAY).allowed).toBe(true);
  });

  it('delayUntil in the past no longer blocks', () => {
    const g = globals({ speedState: 2, delayUntil: '2026-07-01' });
    expect(canSetState(3, painFreeRuns(10), g, TODAY).allowed).toBe(true);
  });

  it('4→5 (hills) requires hipSafeFlag AND ptClearedSpeed', () => {
    const base = { speedState: 4 as SpeedStateNum };
    expect(canSetState(5, painFreeRuns(10), globals(base), TODAY).allowed).toBe(false);
    expect(canSetState(5, painFreeRuns(10), globals({ ...base, hipSafeFlag: true }), TODAY).allowed).toBe(false);
    expect(canSetState(5, painFreeRuns(10), globals({ ...base, ptClearedSpeed: true }), TODAY).allowed).toBe(false);
    expect(
      canSetState(5, painFreeRuns(10), globals({ ...base, hipSafeFlag: true, ptClearedSpeed: true }), TODAY).allowed,
    ).toBe(true);
  });

  it('6→7 (structured) requires ptClearedIntensity', () => {
    const base = { speedState: 6 as SpeedStateNum };
    expect(canSetState(7, painFreeRuns(10), globals(base), TODAY).allowed).toBe(false);
    expect(canSetState(7, painFreeRuns(10), globals({ ...base, ptClearedIntensity: true }), TODAY).allowed).toBe(true);
  });

  it('an active flare blocks any upward move', () => {
    const state = {
      ...painFreeRuns(0),
      '2026-07-05': run('2026-07-05', { painDuring: 5 }),
      '2026-07-06': run('2026-07-06', { painNextAM: 6 }),
    };
    expect(canSetState(2, state, globals(), TODAY).allowed).toBe(false);
  });

  it('a recent pain breach blocks via last-pain and streak checks', () => {
    const state = { '2026-07-06': run('2026-07-06', { painDuring: 5 }) };
    const report = evaluateReadiness(2, state, globals(), TODAY);
    expect(report.allGreen).toBe(false);
    expect(report.items.find(i => i.key === 'lastPain')?.ok).toBe(false);
  });
});

describe('speed type gating', () => {
  const hills = SPEED_TYPES.find(t => t.key === 'hills')!;
  const vo2 = SPEED_TYPES.find(t => t.key === 'vo2')!;
  const buildups = SPEED_TYPES.find(t => t.key === 'buildups')!;

  it('everything is locked in state 8 (flare supersedes all)', () => {
    const g = globals({ speedState: 8, hipSafeFlag: true, ptClearedSpeed: true, ptClearedIntensity: true });
    for (const t of SPEED_TYPES) expect(typeStatus(t, g, TODAY)).toBe('locked');
  });

  it('hills stay locked at state 5 without the hip-safe gate', () => {
    expect(typeStatus(hills, globals({ speedState: 5 }), TODAY)).toBe('locked');
    expect(
      typeStatus(hills, globals({ speedState: 5, hipSafeFlag: true, ptClearedSpeed: true }), TODAY),
    ).toBe('allowed');
  });

  it('VO₂ needs state 7 + PT intensity clearance', () => {
    expect(typeStatus(vo2, globals({ speedState: 7 }), TODAY)).toBe('locked');
    expect(typeStatus(vo2, globals({ speedState: 7, ptClearedIntensity: true }), TODAY)).toBe('allowed');
  });

  it('delayUntil marks an unlocked type as delayed', () => {
    const g = globals({ speedState: 2, delayUntil: '2026-08-01' });
    expect(typeStatus(buildups, g, TODAY)).toBe('delayed');
  });

  it('the hills card carries the hip-flexor caution', () => {
    expect(hills.plain).toMatch(/iliopsoas/);
    expect(hills.plain).toMatch(/Yokozawa/);
    expect(hills.downgrade).toMatch(/drops to 4/);
  });
});

describe('gate consistency — downgrade when a clearance is revoked', () => {
  it('state 5 → 4 when the hip clearance is incomplete', () => {
    expect(enforceGateConsistency(globals({ speedState: 5, hipSafeFlag: false, ptClearedSpeed: true }))).toEqual({ speedState: 4 });
    expect(enforceGateConsistency(globals({ speedState: 5, hipSafeFlag: true, ptClearedSpeed: false }))).toEqual({ speedState: 4 });
    expect(enforceGateConsistency(globals({ speedState: 5, hipSafeFlag: true, ptClearedSpeed: true }))).toBeNull();
  });
  it('state 7 → 6 when only PT intensity clearance is missing', () => {
    expect(enforceGateConsistency(globals({
      speedState: 7, hipSafeFlag: true, ptClearedSpeed: true, ptClearedIntensity: false,
    }))).toEqual({ speedState: 6 });
  });
  it('state 7 drops all the way to 4 if the hip clearance is missing', () => {
    expect(enforceGateConsistency(globals({
      speedState: 7, hipSafeFlag: false, ptClearedSpeed: true, ptClearedIntensity: true,
    }))).toEqual({ speedState: 4 });
  });
  it('never touches flare (state 8) or a consistent low state', () => {
    expect(enforceGateConsistency(globals({ speedState: 8, hipSafeFlag: false }))).toBeNull();
    expect(enforceGateConsistency(globals({ speedState: 3 }))).toBeNull();
  });
});

describe('pfNeeded setting can only tighten the streak gate', () => {
  it('a stricter pfNeeded blocks an otherwise-ready upward move', () => {
    const strict = { ...defaultSettings(NOW), pfNeeded: 5 };
    expect(canSetState(2, painFreeRuns(4), globals(), TODAY).allowed).toBe(true);          // built-in (3)
    expect(canSetState(2, painFreeRuns(4), globals(), TODAY, strict).allowed).toBe(false); // needs 5
    expect(canSetState(2, painFreeRuns(5), globals(), TODAY, strict).allowed).toBe(true);  // meets 5
  });
  it('a laxer pfNeeded cannot drop below the built-in requirement', () => {
    const lax = { ...defaultSettings(NOW), pfNeeded: 1 };
    // Built-in requirement for state 5 is 4; pfNeeded 1 cannot loosen it.
    const report = evaluateReadiness(5, painFreeRuns(2), globals({ speedState: 4 }), TODAY, lax);
    expect(report.items.find(i => i.key === 'streak')?.ok).toBe(false);
  });
});

describe('stride validity (hidden anaerobic session detector)', () => {
  it('accepts spec-valid strides', () => {
    expect(validStrides(6, 20, 90)).toBe(true);
    expect(validStrides(8, 35, 60)).toBe(true);
  });
  it('rejects too many reps, too long, or short recovery', () => {
    expect(validStrides(9, 20, 90)).toBe(false);   // reps > 8
    expect(validStrides(6, 40, 90)).toBe(false);   // > 35s
    expect(validStrides(6, 20, 30)).toBe(false);   // recovery < 60s
  });
});
