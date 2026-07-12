// ============================================================
// PLAN-FOLLOWS-ITSELF — the engine must recognize its own output.
//
// Pre-stabilization, two guards misread the rolling plan's own prescriptions:
//  • speedGuard.weeklyJump compared a resumed build week only against the
//    reduced down week, flagging every scheduled down → resume as a jump;
//  • the generator's ~20% down-week detector could not see the plan's own
//    ~15% scheduled cut, so it re-fired the cadence immediately after a real
//    down week (stacked down weeks) and re-baselined off the dip.
//
// These tests log the rolling plan's prescriptions as completed actuals and
// assert the guards stay quiet, the cadence never stacks, and the build
// resumes from the pre-down trajectory — while genuine jumps still flag.
// ============================================================

import { describe, it, expect } from 'vitest';
import { evaluateSpeedGuard } from '../speedGuard';
import { generateNextWeek, generateWeeks } from '../generator';
import { buildWeekConfigsFromSettings, defaultSettings, effectiveSettings } from '../settings';
import { defaultGlobalState } from '../migrate';
import { addDaysStr, isReducedWeek } from '../metrics';
import type { GlobalState, RunState } from '../types';

const NOW = '2026-06-28T12:00:00Z';
const START = '2026-06-29'; // Monday

function run(date: string, miles: number): RunState[string] {
  return { date, done: true, miles_actual: miles, updated_at: date + 'T12:00:00Z' };
}

function guardGlobals(patch: Partial<GlobalState> = {}): GlobalState {
  return {
    ...defaultGlobalState(NOW),
    painTrackingSince: '2026-06-01',
    speedState: 4, hipSafeFlag: true, ptClearedSpeed: true,
    ...patch,
  };
}

/** Log one week's prescribed miles as completed actuals (Mon-first). */
function logWeek(log: RunState, monday: string, miles: number[]): void {
  miles.forEach((m, i) => {
    const date = addDaysStr(monday, i);
    log[date] = run(date, m);
  });
}

const loadKeys = (g: ReturnType<typeof evaluateSpeedGuard>) =>
  g.blockers.map(b => b.key).filter(k => k === 'mileageJump' || k === 'mileageSpike');

describe('H1/H2 property — following the rolling plan exactly', () => {
  // A realistic settings ramp with down weeks on cadence. The pre-plan 4.5 mi
  // run matches the trailingLongest seed (the setting mirrors a real run).
  const raw = {
    ...defaultSettings(NOW),
    startDate: START, startMpw: 20, peakMpw: 40, buildStep: 1.5,
    downEvery: 4, daysPerWeek: 5, weeksShown: 12,
    xcStartDate: '2027-03-01', trailingLongest: 4.5,
  };
  const seed: RunState = { '2026-06-26': run('2026-06-26', 4.5) };
  const eff = effectiveSettings(raw, seed, '2026-06-28').eff;
  const configs = buildWeekConfigsFromSettings(eff, 10);

  it('(1,3) logging 10 plan weeks as prescribed triggers no load/speed guards, never stacks down weeks, and resumes the trajectory', () => {
    const log: RunState = { ...seed };
    const g = guardGlobals();
    const totals: number[] = [];
    const downs: boolean[] = [];

    for (let w = 0; w < 10; w++) {
      const monday = addDaysStr(START, w * 7);
      logWeek(log, monday, configs[w].miles);
      totals.push(configs[w].miles.reduce((a, b) => a + b, 0));
      downs.push(!!configs[w].isDownWeek);
      // Evaluated the Monday after the completed week — exactly when the
      // athlete opens the app to start the next one.
      expect(loadKeys(evaluateSpeedGuard(log, g, addDaysStr(monday, 7)))).toEqual([]);
    }

    // The cadence produced real down weeks…
    expect(downs.some(Boolean)).toBe(true);
    // …never two in a row…
    for (let w = 1; w < downs.length; w++) {
      expect(downs[w] && downs[w - 1]).toBe(false);
    }
    // …and each resume returns to at least the pre-down build level
    // (trajectory carry; 1.5 mi headroom for splitWeek half-step rounding).
    for (let w = 1; w + 1 < totals.length; w++) {
      if (downs[w]) {
        expect(totals[w + 1]).toBeGreaterThan(totals[w]);
        expect(totals[w + 1]).toBeGreaterThanOrEqual(totals[w - 1] - 1.5);
      }
    }
  });

  it('(1) a scheduled down → resume toward the pre-down trajectory is NOT a weekly jump', () => {
    const log: RunState = {};
    logWeek(log, '2026-06-15', [4.5, 5, 4.5, 4, 6]);      // 24 — build
    logWeek(log, '2026-06-22', [4, 4, 4, 2.5, 6]);        // 20.5 — scheduled-style down (~85%), long held
    logWeek(log, '2026-06-29', [5, 5, 4.5, 4.5, 6.5]);    // 25.5 — resume, +6% over the 24 trajectory
    const guard = evaluateSpeedGuard(log, guardGlobals(), '2026-07-06');
    expect(guard.blockers.map(b => b.key)).not.toContain('mileageJump');
  });

  it('(2) a genuine leap PAST the pre-down trajectory still flags mileageJump', () => {
    const log: RunState = {};
    logWeek(log, '2026-06-15', [4.5, 5, 4.5, 4, 6]);      // 24 — build
    logWeek(log, '2026-06-22', [4, 4, 4, 2.5, 6]);        // 20.5 — down
    logWeek(log, '2026-06-29', [6.5, 6.5, 6.5, 6.5, 7]);  // 33.5 — way past the 24 trajectory
    const guard = evaluateSpeedGuard(log, guardGlobals(), '2026-07-06');
    expect(guard.blockers.map(b => b.key)).toContain('mileageJump');
  });

  it('(2) a genuine build-to-build jump (no down week involved) still flags mileageJump', () => {
    const log: RunState = {};
    logWeek(log, '2026-06-29', [4, 4, 4, 3.5, 4.5]);      // 20
    logWeek(log, '2026-07-06', [5, 5.5, 5.5, 5.5, 5.5]);  // 27 — +35% build-to-build
    const guard = evaluateSpeedGuard(log, guardGlobals(), '2026-07-13');
    expect(guard.blockers.map(b => b.key)).toContain('mileageJump');
  });

  it('the single-session spike guard is unweakened (one over-ceiling run still flags)', () => {
    const log: RunState = {};
    logWeek(log, '2026-06-29', [4, 4, 4, 3.5, 4.5]);      // 20, longest 4.5
    log['2026-07-06'] = run('2026-07-06', 8);             // 8 mi ≫ 110% of 4.5
    const guard = evaluateSpeedGuard(log, guardGlobals(), '2026-07-07');
    expect(guard.blockers.map(b => b.key)).toContain('mileageSpike');
  });
});

describe('H2 — Generate-a-week after a down week', () => {
  const g0 = () => ({ ...defaultGlobalState(NOW), painTrackingSince: '2026-06-01' });

  /** Builds 23 → 24 → 25, then a scheduled-style ~15% down week (21.25). */
  function downLog(): RunState {
    const log: RunState = {};
    logWeek(log, '2026-06-08', [4.5, 4.5, 4.5, 4, 5.5]);  // 23
    logWeek(log, '2026-06-15', [4.5, 5, 4.5, 4.5, 5.5]);  // 24
    logWeek(log, '2026-06-22', [5, 5, 4.5, 4.5, 6]);      // 25
    logWeek(log, '2026-06-29', [4, 4, 4, 3.25, 6]);       // 21.25 — the plan's own ~15% cut
    return log;
  }

  it('(4) recognizes the scheduled ~15% cut as a down week — the cadence never stacks another one', () => {
    const p = generateNextWeek({ runState: downLog(), globals: g0(), today: '2026-07-05' });
    expect(p.isDownWeek).toBe(false);
  });

  it('(4) the shared detector sees the scheduled cut (and the old ~20% blind spot is gone)', () => {
    const down = { weekStart: '2026-06-29', miles: 21.25, runCount: 5 };
    const build = { weekStart: '2026-06-22', miles: 25, runCount: 5 };
    expect(isReducedWeek(down, build)).toBe(true);
    // 15% cut sat ABOVE the old 20% threshold — this is what used to be missed.
    expect(down.miles > build.miles * 0.8).toBe(true);
  });

  it('(5) resumes the build from the pre-down trajectory, capped at +10% over it', () => {
    const p = generateNextWeek({ runState: downLog(), globals: g0(), today: '2026-07-05' });
    expect(p.notes.join(' ')).toMatch(/pre-down trajectory/i);
    expect(p.totalMiles).toBeGreaterThan(24);                    // back above the dip, near the 25 trajectory
    expect(p.totalMiles).toBeLessThanOrEqual(25 * 1.1 + 1.0);    // ≤ +10% over the trajectory (+half-step day rounding)
  });

  it('(6) a deeper crash/deload week still rebuilds gradually from what was actually run', () => {
    const log: RunState = {};
    logWeek(log, '2026-06-08', [4.5, 4.5, 4.5, 4, 5.5]);  // 23
    logWeek(log, '2026-06-15', [4.5, 5, 4.5, 4.5, 5.5]);  // 24
    logWeek(log, '2026-06-22', [5, 5, 4.5, 4.5, 6]);      // 25
    logWeek(log, '2026-06-29', [3.5, 3.5, 3.5, 3, 3.5]);  // 17 — deeper than a deload cut (< 72.5%)
    const p = generateNextWeek({ runState: log, globals: g0(), today: '2026-07-05' });
    expect(p.isDownWeek).toBe(false);                            // cadence reset — no stacked down
    expect(p.notes.join(' ')).not.toMatch(/pre-down trajectory/i);
    expect(p.totalMiles).toBeLessThanOrEqual(17 * 1.1 + 0.5);    // gentle rebuild, not a leap to 25+
  });

  it('(3) multi-week chains never stack cadence down weeks, and growth stays ≤ +10% of the trajectory', () => {
    const { proposals } = generateWeeks({ runState: downLog(), globals: g0(), today: '2026-07-05', count: 8 });
    for (let i = 1; i < proposals.length; i++) {
      expect(proposals[i].isDownWeek && proposals[i - 1].isDownWeek).toBe(false);
    }
    // +1.0 headroom: each easy day rounds to the nearest half-step, so a
    // displayed total can sit ~0.5–1.0 above/below the pre-rounding target.
    let traj = 0;
    for (const p of proposals) {
      if (p.isDownWeek) {
        expect(p.totalMiles).toBeLessThan(traj);                 // a dip off the trajectory
        continue;
      }
      if (traj > 0) expect(p.totalMiles).toBeLessThanOrEqual(traj * 1.1 + 1.0);
      traj = p.totalMiles;
    }
    // At least one down week fired across 8 weeks (cadence still works).
    expect(proposals.some(p => p.isDownWeek)).toBe(true);
    // And the week after each down week climbs back toward the trajectory.
    for (let i = 1; i + 1 < proposals.length; i++) {
      if (proposals[i].isDownWeek) {
        expect(proposals[i + 1].totalMiles).toBeGreaterThan(proposals[i].totalMiles);
      }
    }
  });
});
