import { describe, it, expect } from 'vitest';
import { canSetState, evaluateReadiness, typeStatus, SPEED_TYPES, validStrides, enforceGateConsistency } from '../speed';
import { defaultGlobalState } from '../migrate';
import { defaultSettings } from '../settings';
import type { GlobalState, RunState, SpeedStateNum, WeeklyCheckin } from '../types';

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

/** Full ADVANCED-tier evidence: 4 clean completed weeks of easy runs with a
 *  stable RPE, plus current-week runs. Pair with checkinsFor() on globals. */
function advancedLog(weeks = 4): RunState {
  const s: RunState = {};
  // TODAY is Tue 2026-07-07; current Monday is 2026-07-06.
  for (let w = 1; w <= weeks; w++) {
    for (const off of [0, 1, 2, 3, 4]) {
      const d = new Date('2026-07-06T12:00:00Z');
      d.setUTCDate(d.getUTCDate() - 7 * w + off);
      const date = d.toISOString().slice(0, 10);
      s[date] = run(date, { rpe: 4 });
    }
  }
  s['2026-07-06'] = run('2026-07-06', { rpe: 4 });
  return s;
}

function checkinsFor(...weekStarts: string[]): Record<string, WeeklyCheckin> {
  const out: Record<string, WeeklyCheckin> = {};
  for (const ws of weekStarts) {
    out[ws] = { weekStart: ws, sleep: 4, soreness: 2, energy: 4, stress: 2, updated_at: NOW };
  }
  return out;
}

describe('state machine (§4)', () => {
  it('downward transitions are always allowed', () => {
    expect(canSetState(0, {}, globals({ speedState: 6 }), TODAY).allowed).toBe(true);
    expect(canSetState(3, {}, globals({ speedState: 8 }), TODAY).allowed).toBe(true);
  });

  it('upward requires readiness all-green (empty log blocks: streak 0)', () => {
    expect(canSetState(1, {}, globals(), TODAY).allowed).toBe(false);
  });

  it('upward allowed with a sufficient pain-free streak', () => {
    expect(canSetState(1, painFreeRuns(4), globals(), TODAY).allowed).toBe(true);
  });

  it('cannot skip states upward', () => {
    const res = canSetState(3, painFreeRuns(10), globals({ speedState: 0 }), TODAY);
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

  it('3→4 (hill strides) requires hipSafeFlag AND ptClearedSpeed', () => {
    const base = { speedState: 3 as SpeedStateNum };
    expect(canSetState(4, painFreeRuns(10), globals(base), TODAY).allowed).toBe(false);
    expect(canSetState(4, painFreeRuns(10), globals({ ...base, hipSafeFlag: true }), TODAY).allowed).toBe(false);
    expect(canSetState(4, painFreeRuns(10), globals({ ...base, ptClearedSpeed: true }), TODAY).allowed).toBe(false);
    expect(
      canSetState(4, painFreeRuns(10), globals({ ...base, hipSafeFlag: true, ptClearedSpeed: true }), TODAY).allowed,
    ).toBe(true);
  });

  it('7→8 (VO₂/race) requires ptClearedIntensity + season + advanced evidence', () => {
    const log = advancedLog();
    const seasonSettings = { ...defaultSettings(NOW), xcStartDate: '2026-07-13' }; // near season
    const base = {
      speedState: 7 as SpeedStateNum,
      hipSafeFlag: true, ptClearedSpeed: true,
      checkins: checkinsFor('2026-07-06', '2026-06-29'),
    };
    // Everything present except the intensity clearance → blocked.
    expect(canSetState(8, log, globals(base), TODAY, seasonSettings).allowed).toBe(false);
    // With the clearance → allowed.
    expect(canSetState(8, log, globals({ ...base, ptClearedIntensity: true }), TODAY, seasonSettings).allowed).toBe(true);
    // Same but far from season → blocked (season gate).
    const offSeason = { ...defaultSettings(NOW), xcStartDate: '2026-12-01' };
    expect(canSetState(8, log, globals({ ...base, ptClearedIntensity: true }), TODAY, offSeason).allowed).toBe(false);
  });

  it('an active flare blocks any upward move', () => {
    const state = {
      ...painFreeRuns(0),
      '2026-07-05': run('2026-07-05', { painDuring: 5 }),
      '2026-07-06': run('2026-07-06', { painNextAM: 6 }),
    };
    expect(canSetState(1, state, globals(), TODAY).allowed).toBe(false);
  });

  it('pre-baseline unlogged runs do NOT satisfy the streak gate (the reported bug)', () => {
    // 10 completed runs, all dated before the pain-tracking baseline, none with
    // pain logged. They must NOT count as proven pain-free for progression.
    const preHistory: RunState = {};
    for (let i = 1; i <= 10; i++) {
      const d = new Date('2026-06-25T12:00:00Z');
      d.setUTCDate(d.getUTCDate() - i);
      const date = d.toISOString().slice(0, 10);
      preHistory[date] = run(date);
    }
    const g = globals({ painTrackingSince: '2026-07-01' });
    const report = evaluateReadiness(1, preHistory, g, TODAY);
    expect(report.items.find(i => i.key === 'streak')?.ok).toBe(false); // streak 0, not ready
    expect(canSetState(1, preHistory, g, TODAY).allowed).toBe(false);
  });

  it('a recent pain breach blocks via last-pain and streak checks', () => {
    const state = { '2026-07-06': run('2026-07-06', { painDuring: 5 }) };
    const report = evaluateReadiness(1, state, globals(), TODAY);
    expect(report.allGreen).toBe(false);
    expect(report.items.find(i => i.key === 'lastPain')?.ok).toBe(false);
  });
});

// ── Phase 2D: advanced tiers (5+) need evidence basic tiers never do ─────────
describe('advanced-tier readiness (missing-data rule, §8/§10)', () => {
  it('basic tiers (1–4) never carry check-in / RPE / clean-week items', () => {
    for (const target of [1, 2, 3, 4] as SpeedStateNum[]) {
      const report = evaluateReadiness(target, painFreeRuns(10), globals(), TODAY);
      const keys = report.items.map(i => i.key);
      expect(keys).not.toContain('checkinData');
      expect(keys).not.toContain('rpeData');
      expect(keys).not.toContain('cleanWeeks');
      expect(keys).not.toContain('season');
    }
  });

  it('tier 5 (light fartlek) blocks WITHOUT recent check-in data, even on a perfect streak', () => {
    const g = globals({ speedState: 4, hipSafeFlag: true, ptClearedSpeed: true });
    const report = evaluateReadiness(5, advancedLog(), g, TODAY);
    expect(report.items.find(i => i.key === 'checkinData')?.ok).toBe(false);
    expect(canSetState(5, advancedLog(), g, TODAY).allowed).toBe(false);
  });

  it('tier 5 blocks WITHOUT easy-run RPE samples (unknown ≠ good)', () => {
    // Same clean weeks but no rpe recorded on any run.
    const noRpe: RunState = {};
    for (const [k, v] of Object.entries(advancedLog())) noRpe[k] = { ...v, rpe: null };
    const g = globals({
      speedState: 4, hipSafeFlag: true, ptClearedSpeed: true,
      checkins: checkinsFor('2026-07-06'),
    });
    const report = evaluateReadiness(5, noRpe, g, TODAY);
    expect(report.items.find(i => i.key === 'rpeData')?.ok).toBe(false);
    expect(canSetState(5, noRpe, g, TODAY).allowed).toBe(false);
  });

  it('tier 5 unlocks with full evidence: clean weeks + RPE + check-ins', () => {
    const g = globals({
      speedState: 4, hipSafeFlag: true, ptClearedSpeed: true,
      checkins: checkinsFor('2026-07-06'),
      speedStateSince: '2026-06-01', // streak spans the logged runs
    });
    const res = canSetState(5, advancedLog(), g, TODAY);
    expect(res.allowed).toBe(true);
  });

  it('advanced tiers require strictly MORE than buildups/strides (stronger readiness)', () => {
    // The same minimal streak that unlocks tier 1 cannot unlock tier 5.
    const minimal = painFreeRuns(6);
    expect(canSetState(1, minimal, globals(), TODAY).allowed).toBe(true);
    const g5 = globals({ speedState: 4, hipSafeFlag: true, ptClearedSpeed: true });
    expect(canSetState(5, minimal, g5, TODAY).allowed).toBe(false);
  });
});

// ── The streak must be re-earned at each state (cascade bug fix) ──────────────
describe('readiness streak resets per state entry (§4 cascade fix)', () => {
  /** n consecutive pain-free runs starting AT startDate, going forward. */
  function runsFrom(startDate: string, n: number): RunState {
    const state: RunState = {};
    for (let i = 0; i < n; i++) {
      const d = new Date(startDate + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      state[date] = run(date);
    }
    return state;
  }

  it('a streak earned BEFORE the current state was entered does not count', () => {
    // Just advanced to tier 2 today; all 10 pain-free runs predate today.
    const g = globals({ speedState: 2, speedStateSince: TODAY });
    const report = evaluateReadiness(3, painFreeRuns(10), g, TODAY);
    expect(report.items.find(i => i.key === 'streak')?.detail).toBe('currently 0');
    expect(canSetState(3, painFreeRuns(10), g, TODAY).allowed).toBe(false);
  });

  it('one long streak cannot cascade up multiple states in a row', () => {
    // A fat pre-existing streak legitimately unlocks the FIRST advance (0→1)…
    const before = globals({ speedState: 0, speedStateSince: null });
    expect(canSetState(1, painFreeRuns(6), before, TODAY).allowed).toBe(true);
    // …but once tier 1 is entered TODAY, the SAME old runs no longer count, so
    // 1→2 is blocked until fresh pain-free runs accumulate at tier 1.
    const after = globals({ speedState: 1, speedStateSince: TODAY });
    expect(canSetState(2, painFreeRuns(6), after, TODAY).allowed).toBe(false);
  });

  it('a FRESH streak since state entry re-enables an advance', () => {
    // Entered tier 2 on 2026-07-01; four pain-free runs on/after that date.
    const g = globals({ speedState: 2, speedStateSince: '2026-07-01' });
    const fresh = runsFrom('2026-07-01', 4); // Jul 1–4, all ≥ speedStateSince
    expect(evaluateReadiness(3, fresh, g, TODAY).items.find(i => i.key === 'streak')?.ok).toBe(true);
    expect(canSetState(3, fresh, g, TODAY).allowed).toBe(true);
  });

  it('pain-tracking baseline still wins when it is later than state entry', () => {
    // Runs before painTrackingSince never count, even if speedStateSince is older.
    const g = globals({ speedState: 1, speedStateSince: '2026-06-20', painTrackingSince: '2026-07-05' });
    const oldRuns = runsFrom('2026-06-21', 6); // all before painTrackingSince
    expect(canSetState(2, oldRuns, g, TODAY).allowed).toBe(false);
  });

  it('absent speedStateSince is backward-compatible (uses the pain-tracking baseline)', () => {
    const g = globals({ speedState: 0 }); // speedStateSince defaults to null
    expect(canSetState(1, painFreeRuns(4), g, TODAY).allowed).toBe(true);
  });
});

describe('speed type gating', () => {
  const hills = SPEED_TYPES.find(t => t.key === 'hills')!;
  const fartlek = SPEED_TYPES.find(t => t.key === 'fartlek')!;
  const vo2 = SPEED_TYPES.find(t => t.key === 'vo2')!;
  const buildups = SPEED_TYPES.find(t => t.key === 'buildups')!;

  it('the ladder order matches the Evidence Spec (§5)', () => {
    expect(SPEED_TYPES.map(t => [t.key, t.unlockState])).toEqual([
      ['buildups', 1], ['shortStrides', 2], ['flatStrides', 3], ['hills', 4],
      ['fartlek', 5], ['cruise', 6], ['tempo', 7], ['vo2', 8], ['racePace', 8],
    ]);
  });

  it('bucket model: neuromuscular = 0 units, fartlek = 0.5, hard = 1 (§3)', () => {
    for (const t of SPEED_TYPES) {
      if (t.bucket === 'neuromuscular') expect(t.units).toBe(0);
      if (t.bucket === 'light') expect(t.units).toBe(0.5);
      if (t.bucket === 'hard') expect(t.units).toBe(1);
    }
    expect(fartlek.bucket).toBe('light');
    expect(hills.bucket).toBe('neuromuscular'); // hill strides never count as hard
  });

  it('hill strides stay locked at tier 4 without the hip-safe gate', () => {
    expect(typeStatus(hills, globals({ speedState: 4 }), TODAY)).toBe('locked');
    expect(
      typeStatus(hills, globals({ speedState: 4, hipSafeFlag: true, ptClearedSpeed: true }), TODAY),
    ).toBe('allowed');
  });

  it('VO₂ needs tier 8 + PT intensity clearance', () => {
    expect(typeStatus(vo2, globals({ speedState: 8 }), TODAY)).toBe('locked');
    expect(typeStatus(vo2, globals({ speedState: 8, ptClearedIntensity: true }), TODAY)).toBe('allowed');
  });

  it('delayUntil marks an unlocked type as delayed', () => {
    const g = globals({ speedState: 1, delayUntil: '2026-08-01' });
    expect(typeStatus(buildups, g, TODAY)).toBe('delayed');
  });

  it('the hills card carries the hip-flexor caution', () => {
    expect(hills.plain).toMatch(/iliopsoas/);
    expect(hills.plain).toMatch(/Yokozawa/);
    expect(hills.downgrade).toMatch(/drops to 3/);
  });
});

describe('gate consistency — downgrade when a clearance is revoked', () => {
  it('tier 4 → 3 when the hip clearance is incomplete', () => {
    expect(enforceGateConsistency(globals({ speedState: 4, hipSafeFlag: false, ptClearedSpeed: true }))).toEqual({ speedState: 3 });
    expect(enforceGateConsistency(globals({ speedState: 4, hipSafeFlag: true, ptClearedSpeed: false }))).toEqual({ speedState: 3 });
    expect(enforceGateConsistency(globals({ speedState: 4, hipSafeFlag: true, ptClearedSpeed: true }))).toBeNull();
  });
  it('tier 8 → 7 when only PT intensity clearance is missing', () => {
    expect(enforceGateConsistency(globals({
      speedState: 8, hipSafeFlag: true, ptClearedSpeed: true, ptClearedIntensity: false,
    }))).toEqual({ speedState: 7 });
  });
  it('tier 8 drops all the way to 3 if the hip clearance is missing', () => {
    expect(enforceGateConsistency(globals({
      speedState: 8, hipSafeFlag: false, ptClearedSpeed: true, ptClearedIntensity: true,
    }))).toEqual({ speedState: 3 });
  });
  it('never touches a consistent low tier', () => {
    expect(enforceGateConsistency(globals({ speedState: 3, hipSafeFlag: false }))).toBeNull();
    expect(enforceGateConsistency(globals({ speedState: 0 }))).toBeNull();
  });
});

describe('pfNeeded setting can only tighten the streak gate', () => {
  it('a stricter pfNeeded blocks an otherwise-ready upward move', () => {
    const strict = { ...defaultSettings(NOW), pfNeeded: 5 };
    expect(canSetState(1, painFreeRuns(4), globals(), TODAY).allowed).toBe(true);          // built-in (3)
    expect(canSetState(1, painFreeRuns(4), globals(), TODAY, strict).allowed).toBe(false); // needs 5
    expect(canSetState(1, painFreeRuns(5), globals(), TODAY, strict).allowed).toBe(true);  // meets 5
  });
  it('a laxer pfNeeded cannot drop below the built-in requirement', () => {
    const lax = { ...defaultSettings(NOW), pfNeeded: 1 };
    // Built-in requirement for tier 4 is 4; pfNeeded 1 cannot loosen it.
    const report = evaluateReadiness(4, painFreeRuns(2), globals({ speedState: 3 }), TODAY, lax);
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
