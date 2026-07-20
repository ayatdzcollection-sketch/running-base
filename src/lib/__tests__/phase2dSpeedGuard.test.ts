// ============================================================
// PHASE 2D — speed guard, hard budget, missing-data rule, plan
// add-ons, and earned-trust clarity/cooldown (Evidence Spec §3–§10).
//
// The stored tier is the HIGHEST EARNED rung; the guard computes what is
// usable TODAY. Every rule here is downward-only, and a 2A/2B warning
// suppresses advanced speed WITHOUT erasing earned basic progress.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  evaluateSpeedGuard, hardUnitsForDays, returnFromBreakSpeedPatch, racesInWeek,
} from '../speedGuard';
import { computeTodaySpeed, weeklyTouches, recentTouches, SKIP_CONDITIONS } from '../todaySpeed';
import { generateNextWeek } from '../generator';
import { assessEarnedTrust, computeAdaptiveProfile } from '../adaptive';
import { defaultGlobalState } from '../migrate';
import { getPlan } from '../../config/plan';
import { addDaysStr, mondayOf } from '../metrics';
import { TUNABLES } from '../../config/tunables';
import type { GlobalState, ProposedDay, RaceResult, RunState, WeeklyCheckin } from '../types';

const NOW = '2026-07-07T12:00:00Z';
const TODAY = '2026-07-07';        // Tuesday; current week Monday = 2026-07-06
const plan = getPlan();

function run(date: string, miles = 4, extra: Partial<RunState[string]> = {}): RunState[string] {
  return { date, done: true, miles_actual: miles, updated_at: date + 'T12:00:00Z', ...extra };
}
function globals(patch: Partial<GlobalState> = {}): GlobalState {
  return { ...defaultGlobalState(NOW), ...patch };
}
/** Mon–Fri easy weeks (4 mi) for `weeks` full weeks before the current one,
 *  plus Monday of the current week; optional per-run extras (e.g. rpe). */
function weeklyLog(weeks: number, extra: Partial<RunState[string]> = {}): RunState {
  const s: RunState = {};
  for (let w = 1; w <= weeks; w++) {
    for (const off of [0, 1, 2, 3, 4]) {
      const d = addDaysStr('2026-07-06', -7 * w + off);
      s[d] = run(d, 4, extra);
    }
  }
  s['2026-07-06'] = run('2026-07-06', 4, extra);
  return s;
}
function ci(weekStart: string, p: Partial<WeeklyCheckin> = {}): WeeklyCheckin {
  return { weekStart, sleep: 4, soreness: 2, energy: 4, stress: 2, updated_at: NOW, ...p };
}
function race(date: string): RaceResult {
  return { id: 'r' + date, date, distanceMi: 3.1, timeSec: 1200, updated_at: NOW };
}

const DATA = { checkins: { '2026-07-06': ci('2026-07-06') } };

// ════════════════════════════════════════════════════════════
// Blockers (§8) — each suppresses without erasing the stored tier
// ════════════════════════════════════════════════════════════
describe('speed blockers (§8) — suppression, most-severe-wins', () => {
  it('clean log + full data → no blockers, effective tier = stored tier', () => {
    const g = globals({ speedState: 6, ...DATA });
    const guard = evaluateSpeedGuard(weeklyLog(4, { rpe: 4 }), g, TODAY);
    expect(guard.blockers).toEqual([]);
    expect(guard.effectiveTier).toBe(6);
    expect(guard.holdTier).toBe(false);
  });

  it('pain during run (cap breach this week) → hard lock to tier ≤1', () => {
    const log = { ...weeklyLog(2, { rpe: 4 }), '2026-07-06': run('2026-07-06', 4, { rpe: 4, painDuring: 5 }) };
    const guard = evaluateSpeedGuard(log, globals({ speedState: 6, ...DATA }), TODAY);
    expect(guard.blockers.map(b => b.key)).toContain('painDuringRun');
    expect(guard.effectiveTier).toBeLessThanOrEqual(1);
    expect(guard.holdTier).toBe(true);
  });

  it('pain next morning → no hills / no hard until it settles (cap 3)', () => {
    const log = { ...weeklyLog(2, { rpe: 4 }), '2026-07-06': run('2026-07-06', 4, { rpe: 4, painDuring: 1, painNextAM: 2 }) };
    const guard = evaluateSpeedGuard(log, globals({ speedState: 6, ...DATA }), TODAY);
    expect(guard.blockers.map(b => b.key)).toContain('painNextAM');
    expect(guard.effectiveTier).toBeLessThanOrEqual(3);
  });

  it('sub-cap pain DRIFT (2A) suppresses advanced speed but does NOT relock the stored tier', () => {
    const log = weeklyLog(4, { rpe: 4 });
    log['2026-06-16'] = run('2026-06-16', 4, { rpe: 4, painNextAM: 0 });
    log['2026-06-18'] = run('2026-06-18', 4, { rpe: 4, painNextAM: 0 });
    log['2026-06-29'] = run('2026-06-29', 4, { rpe: 4, painNextAM: 2 });
    log['2026-07-01'] = run('2026-07-01', 4, { rpe: 4, painNextAM: 2 });
    const guard = evaluateSpeedGuard(log, globals({ speedState: 6, ...DATA }), TODAY);
    const drift = guard.blockers.find(b => b.key === 'painDrift');
    expect(drift).toBeDefined();
    expect(drift!.action).not.toBe('RELOCK');           // nuance: 2A never erases progress
    expect(guard.effectiveTier).toBeLessThanOrEqual(4); // advanced is off
    expect(guard.effectiveTier).toBeGreaterThanOrEqual(3); // basic touches survive
  });

  it('rising easy-run RPE (with enough samples) blocks hard work and holds the ladder', () => {
    const log: RunState = {};
    for (const off of [0, 1, 2, 3, 4]) { const d = addDaysStr('2026-06-22', off); log[d] = run(d, 4, { rpe: 4 }); }
    for (const off of [0, 1, 2, 3, 4]) { const d = addDaysStr('2026-06-29', off); log[d] = run(d, 4, { rpe: 6 }); }
    log['2026-07-06'] = run('2026-07-06', 4, { rpe: 6 });
    const guard = evaluateSpeedGuard(log, globals({ speedState: 6, ...DATA }), TODAY);
    expect(guard.blockers.map(b => b.key)).toContain('risingRpe');
    expect(guard.effectiveTier).toBeLessThanOrEqual(4);
  });

  it('too few RPE samples → NO rising-RPE blocker (missing data is unknown, never caution)', () => {
    const log = weeklyLog(3); // no rpe at all
    log['2026-07-01'] = run('2026-07-01', 4, { rpe: 6 });
    log['2026-07-02'] = run('2026-07-02', 4, { rpe: 6 });
    const guard = evaluateSpeedGuard(log, globals({ speedState: 3 }), TODAY);
    expect(guard.blockers.map(b => b.key)).not.toContain('risingRpe');
    expect(guard.effectiveTier).toBe(3); // basic tier untouched
  });

  it('poor weekly recovery (2B) suppresses advanced speed; basic tiers survive', () => {
    const g = globals({
      speedState: 6,
      checkins: { '2026-07-06': ci('2026-07-06', { sleep: 1, soreness: 5, energy: 1, stress: 5 }) },
    });
    const guard = evaluateSpeedGuard(weeklyLog(3, { rpe: 4 }), g, TODAY);
    const rec = guard.blockers.find(b => b.key === 'poorRecovery');
    expect(rec).toBeDefined();
    expect(rec!.action).not.toBe('RELOCK');
    expect(guard.effectiveTier).toBeLessThanOrEqual(4);
    expect(guard.effectiveTier).toBeGreaterThanOrEqual(3);
  });

  it('a poorly-tolerated last long run blocks hard work near it', () => {
    const log = weeklyLog(3, { rpe: 4 });
    log['2026-07-03'] = run('2026-07-03', 4.5, { rpe: 8 }); // longest recent run, felt awful
    const guard = evaluateSpeedGuard(log, globals({ speedState: 6, ...DATA }), TODAY);
    expect(guard.blockers.map(b => b.key)).toContain('longRunReadiness');
    expect(guard.effectiveTier).toBeLessThanOrEqual(4);
  });

  it('break mode locks everything (tier 0, zero budget)', () => {
    const guard = evaluateSpeedGuard(weeklyLog(2), globals({ speedState: 5, breakStart: '2026-07-01' }), TODAY);
    expect(guard.blockers.map(b => b.key)).toContain('breakMode');
    expect(guard.effectiveTier).toBe(0);
    expect(guard.hardBudget).toBe(0);
  });

  it('a single-session mileage spike (Spike25) → no new speed, no hard work', () => {
    const log = weeklyLog(3, { rpe: 4 });
    log['2026-07-04'] = run('2026-07-04', 8); // 8 mi vs a 4-mi trailing longest
    const guard = evaluateSpeedGuard(log, globals({ speedState: 6, ...DATA }), TODAY);
    expect(guard.blockers.map(b => b.key)).toContain('mileageSpike');
    expect(guard.effectiveTier).toBeLessThanOrEqual(4);
    expect(guard.holdTier).toBe(true);
  });

  it('down week: ladder frozen, Bucket C budget = 0, strides-only cap', () => {
    const guard = evaluateSpeedGuard(weeklyLog(3, { rpe: 4 }), globals({ speedState: 6, ...DATA }), TODAY, { isDownWeek: true });
    expect(guard.blockers.map(b => b.key)).toContain('downWeek');
    expect(guard.effectiveTier).toBeLessThanOrEqual(3);
    expect(guard.hardBudget).toBe(0);
    expect(guard.holdTier).toBe(true);
  });

  it('race week: taper — strides only, race counts as the hard unit', () => {
    const g = globals({ speedState: 6, ...DATA, races: [race('2026-07-08')] });
    const guard = evaluateSpeedGuard(weeklyLog(3, { rpe: 4 }), g, TODAY);
    expect(guard.blockers.map(b => b.key)).toContain('raceWeek');
    expect(guard.effectiveTier).toBeLessThanOrEqual(3);
    expect(guard.hardUnitsUsed).toBe(1);
  });

  it('a PAST race (outside this week) has zero effect — downward-only, display otherwise', () => {
    const g = globals({ speedState: 3, races: [race('2026-06-20')] });
    const guard = evaluateSpeedGuard(weeklyLog(3), g, TODAY);
    expect(guard.blockers.map(b => b.key)).not.toContain('raceWeek');
    expect(racesInWeek(g.races, TODAY)).toEqual([]);
  });

  it('season transition: ladder holds for the first two weeks of XC', () => {
    const settings = { xcStartDate: '2026-07-01' } as GlobalState['settings'];
    const g = globals({ speedState: 4, hipSafeFlag: true, ptClearedSpeed: true, settings: settings ?? null });
    const guard = evaluateSpeedGuard(weeklyLog(3, { rpe: 4 }), g, TODAY); // day 6 of season
    expect(guard.seasonMode).toBe(true);
    expect(guard.blockers.map(b => b.key)).toContain('seasonTransition');
    expect(guard.holdTier).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// Missing-data rule (§8) — basic protected, advanced gated
// ════════════════════════════════════════════════════════════
describe('missing-data rule', () => {
  it('no RPE / no check-ins: basic tier 3 is completely untouched (no blockers, no punishment)', () => {
    const guard = evaluateSpeedGuard(weeklyLog(3), globals({ speedState: 3 }), TODAY);
    expect(guard.blockers).toEqual([]);
    expect(guard.effectiveTier).toBe(3);
  });

  it('no RPE / no check-ins: an ADVANCED stored tier is capped at 4 for prescription', () => {
    const guard = evaluateSpeedGuard(weeklyLog(4), globals({ speedState: 8, ptClearedIntensity: true }), TODAY);
    expect(guard.advancedDataOk).toBe(false);
    expect(guard.blockers.map(b => b.key)).toContain('missingData');
    expect(guard.effectiveTier).toBe(4);
  });

  it('with data present, the advanced tier is usable again', () => {
    const guard = evaluateSpeedGuard(weeklyLog(4, { rpe: 4 }), globals({ speedState: 5, ...DATA }), TODAY);
    expect(guard.advancedDataOk).toBe(true);
    expect(guard.effectiveTier).toBe(5);
  });
});

// ════════════════════════════════════════════════════════════
// Hard budget (§10) + no-mileage-increase (§9)
// ════════════════════════════════════════════════════════════
describe('hard budget + volume neutrality', () => {
  it('budget: base 1 unit, season 2 units, down week 0', () => {
    expect(evaluateSpeedGuard(weeklyLog(2), globals(), TODAY).hardBudget).toBe(1);
    const season = globals({ settings: { xcStartDate: '2026-06-01' } as GlobalState['settings'] & object });
    expect(evaluateSpeedGuard(weeklyLog(2), season, TODAY).hardBudget).toBe(2);
    expect(evaluateSpeedGuard(weeklyLog(2), globals(), TODAY, { isDownWeek: true }).hardBudget).toBe(0);
  });

  it('hardUnitsForDays: threshold 1 + fartlek 0.5 + race 1 = 2.5', () => {
    const days: ProposedDay[] = [
      { date: '2026-07-13', dayLabel: 'Mon', kind: 'threshold', miles: 4, why: 'x' },
      { date: '2026-07-14', dayLabel: 'Tue', kind: 'easy', miles: 4, fartlek: { surges: 5, durationS: 45 }, why: 'x' },
      { date: '2026-07-17', dayLabel: 'Fri', kind: 'long', miles: 5, why: 'x' },
    ];
    expect(hardUnitsForDays(days, [race('2026-07-15')], '2026-07-13')).toBe(2.5);
  });

  it('speed touches never change weekly mileage: identical totals at tier 0 vs tier 2 vs tier 5', () => {
    const log = weeklyLog(3, { rpe: 4 });
    const p0 = generateNextWeek({ runState: log, globals: globals({ speedState: 0 }), today: TODAY });
    const p2 = generateNextWeek({ runState: log, globals: globals({ speedState: 2 }), today: TODAY });
    const p5 = generateNextWeek({ runState: log, globals: globals({ speedState: 5, ...DATA }), today: TODAY });
    expect(p2.totalMiles).toBe(p0.totalMiles);
    expect(p5.totalMiles).toBe(p0.totalMiles);
    expect(p2.days.some(d => d.strides)).toBe(true);   // touches present…
    expect(p5.days.some(d => d.fartlek)).toBe(true);
    expect(p2.days.map(d => d.miles)).toEqual(p0.days.map(d => d.miles)); // …miles unchanged
  });
});

// ════════════════════════════════════════════════════════════
// Return from break (§8) — downgrade by break length
// ════════════════════════════════════════════════════════════
describe('return-from-break speed downgrade', () => {
  it('≥21 days: full relock to tier 0 with clearances reset', () => {
    const patch = returnFromBreakSpeedPatch(30, globals({ speedState: 6, hipSafeFlag: true, ptClearedSpeed: true }), TODAY);
    expect(patch.speedState).toBe(0);
    expect(patch.hipSafeFlag).toBe(false);
    expect(patch.ptClearedSpeed).toBe(false);
    expect(patch.speedStateSince).toBe(TODAY);
  });
  it('7–20 days: one tier down, streak baseline restamped', () => {
    const patch = returnFromBreakSpeedPatch(10, globals({ speedState: 5 }), TODAY);
    expect(patch.speedState).toBe(4);
    expect(patch.speedStateSince).toBe(TODAY);
  });
  it('<7 days: no change (a rest week is not detraining)', () => {
    expect(returnFromBreakSpeedPatch(3, globals({ speedState: 5 }), TODAY)).toEqual({});
  });
  it('never goes below 0', () => {
    expect(returnFromBreakSpeedPatch(10, globals({ speedState: 0 }), TODAY)).toEqual({});
  });
});

// ════════════════════════════════════════════════════════════
// Weekly speed touches (§9, reworked): a weekly AIM + a per-day log,
// replacing the old two-fixed-days add-on placement.
// ════════════════════════════════════════════════════════════
describe('weekly speed touches', () => {
  const args = (runState: RunState, g: GlobalState) =>
    ({ runState, globals: g, today: TODAY, plan, acceptedWeeks: g.acceptedWeeks });

  it('tier 0 (locked): no weekly target at all', () => {
    expect(weeklyTouches(args(weeklyLog(3), globals({ speedState: 0 })))).toBeNull();
  });

  it('tier 1: names buildups, aims for the tunable target, counts nothing yet', () => {
    const w = weeklyTouches(args(weeklyLog(3), globals({ speedState: 1 })))!;
    expect(w.key).toBe('buildups');
    expect(w.target).toBe(TUNABLES.SPEED.TOUCHES_PER_WEEK);
    expect(w.done).toBe(0);
    expect(w.detail).toMatch(/buildups/i);
  });

  it('counts didStrides days from THIS calendar week only', () => {
    const log = weeklyLog(3);
    // Last week Tuesday: logged a touch — must NOT count this week.
    const lastTue = addDaysStr('2026-07-06', -6);
    log[lastTue] = run(lastTue, 4, { didStrides: true });
    // This week Monday: counts.
    log['2026-07-06'] = run('2026-07-06', 4, { didStrides: true });
    const w = weeklyTouches(args(log, globals({ speedState: 1 })))!;
    expect(w.done).toBe(1);
    expect(w.doneDates).toEqual(['2026-07-06']);
  });

  it('falls back to buildups when the stride streak has slipped', () => {
    // Tier 3 earned, but a recent breach broke the live pain-free streak.
    const log = weeklyLog(3);
    log['2026-07-06'] = run('2026-07-06', 4, { painDuring: 5 });
    const w = weeklyTouches(args(log, globals({ speedState: 3 })));
    // A breach this week also raises guard blockers capping the tier at 1 —
    // either way the named touch must be buildups, never strides.
    if (w) expect(w.key).toBe('buildups');
  });

  it('flare kills the weekly target entirely', () => {
    const flared = {
      ...weeklyLog(2),
      '2026-07-05': run('2026-07-05', 4, { painDuring: 5 }),
      '2026-07-06': run('2026-07-06', 4, { painNextAM: 6 }),
    };
    expect(weeklyTouches(args(flared, globals({ speedState: 3 })))).toBeNull();
  });

  it('the Today row is loggable (canLog) on an easy run day, never on the long run', () => {
    const easy = computeTodaySpeed(args(weeklyLog(3), globals({ speedState: 1 })));
    expect(easy?.canLog).toBe(true);
    expect(easy?.skip).toBe(SKIP_CONDITIONS);
    // Friday = long-run day → explicit no-strides row, not loggable.
    const friday = computeTodaySpeed({
      runState: weeklyLog(3), globals: globals({ speedState: 1 }),
      today: '2026-07-10', plan, acceptedWeeks: {},
    });
    expect(friday?.dose).toBe('none');
    expect(friday?.canLog).toBeFalsy();
  });

  it('recentTouches lists logged touches newest first (the speed log)', () => {
    const log = weeklyLog(2);
    log['2026-07-01'] = run('2026-07-01', 4, { didStrides: true });
    log['2026-07-06'] = run('2026-07-06', 4.5, { didStrides: true });
    const touches = recentTouches(log, TODAY);
    expect(touches.map(t => t.date)).toEqual(['2026-07-06', '2026-07-01']);
    expect(touches[0].miles).toBe(4.5);
  });
});

// ════════════════════════════════════════════════════════════
// Earned-trust clarity + cooldown (Phase 2C→2D)
// ════════════════════════════════════════════════════════════
describe('earned-trust clarity + cooldown', () => {
  const RPE_STABLE = { status: 'stable' as const, samples: 5, olderMean: 4, recentMean: 4, delta: 0 };
  const RPE_NONE = { status: 'insufficient' as const, samples: 1, olderMean: 0, recentMean: 0, delta: 0 };
  const DRIFT_FLAT = { status: 'stable' as const, samples: 3, olderMean: 0, recentMean: 0, delta: 0 };
  const REC_NORMAL = { status: 'normal' as const, weeksConsidered: 2, cautionWeeks: 0, repeated: false, latestFlags: null };
  const REC_NONE = { status: 'insufficient' as const, weeksConsidered: 0, cautionWeeks: 0, repeated: false, latestFlags: null };
  const clean = {
    onBreak: false, cleanWeeks: 4, adherence: 0.9, growthFactor: 1, holdLong: false,
    breachDays90: 0, unsettledRate: 0, rpeTrend: RPE_STABLE, painDrift: DRIFT_FLAT, recovery: REC_NORMAL,
  };

  it('active trust reports empty missing[] and no cooldown', () => {
    const e = assessEarnedTrust(clean);
    expect(e.active).toBe(true);
    expect(e.missing).toEqual([]);
    expect(e.cooldownDaysLeft).toBeNull();
  });

  it('"not yet earned" names each concrete missing requirement', () => {
    const e = assessEarnedTrust({
      ...clean, cleanWeeks: 1, adherence: 0.5, rpeTrend: RPE_NONE, recovery: REC_NONE,
    });
    expect(e.active).toBe(false);
    expect(e.blockedBy).toBeNull();
    expect(e.missing.join(' | ')).toMatch(/clean weeks 1 of 3/);
    expect(e.missing.join(' | ')).toMatch(/adherence 50%/);
    expect(e.missing.join(' | ')).toMatch(/RPE samples 1 of/);
    expect(e.missing.join(' | ')).toMatch(/check-ins 0 of/);
  });

  it('a vetoed state reports the pause reason, not a missing list', () => {
    const e = assessEarnedTrust({ ...clean, breachDays90: 1, growthFactor: 0.85 });
    expect(e.blockedBy).toMatch(/pain-cap breach/);
    expect(e.missing).toEqual([]);
  });

  it('cooldown: a recent (cleared) veto keeps trust paused with a countdown — no flicker', () => {
    const e = assessEarnedTrust({ ...clean, recentVetoDaysAgo: 3 });
    expect(e.active).toBe(false);
    expect(e.blockedBy).toBeNull();
    expect(e.cooldownDaysLeft).toBe(TUNABLES.ADAPTIVE.EARNED_TRUST.COOLDOWN_DAYS - 3 + 1);
    expect(e.reason).toMatch(/re-earning/i);
  });

  it('a veto older than the cooldown window no longer pauses trust', () => {
    const e = assessEarnedTrust({ ...clean, recentVetoDaysAgo: TUNABLES.ADAPTIVE.EARNED_TRUST.COOLDOWN_DAYS + 1 });
    expect(e.active).toBe(true);
  });

  it('integration: a caution check-in LAST week keeps trust cooling down THIS week', () => {
    // 4 clean weeks with stable RPE; last week's check-in was cautionary, this
    // week's is fine. Yesterday-ish the veto was still active (latest readable
    // check-in was the caution one), so today trust must be re-earning, not
    // instantly flipped back on.
    const log = weeklyLog(4, { rpe: 4 });
    const g = globals({
      checkins: {
        '2026-06-29': ci('2026-06-29', { sleep: 2, soreness: 4 }),  // caution (2 flags)
        '2026-07-06': ci('2026-07-06'),                              // fine
      },
    });
    const p = computeAdaptiveProfile(log, g, TODAY, null);
    expect(p.earnedTrust.active).toBe(false);
    expect(p.earnedTrust.cooldownDaysLeft).not.toBeNull();
    expect(p.earnedTrust.reason).toMatch(/re-earning/i);
  });
});

// ════════════════════════════════════════════════════════════
// 2A/2B overrides speed AND earned-trust together (req. 24)
// ════════════════════════════════════════════════════════════
describe('2A/2B caution overrides speed and earned-trust', () => {
  it('rising RPE: trust revoked + hard tiers suppressed + basic strides survive', () => {
    const log: RunState = {};
    for (let w = 4; w >= 2; w--) {
      for (const off of [0, 1, 2, 3, 4]) { const d = addDaysStr('2026-07-06', -7 * w + off); log[d] = run(d, 4, { rpe: 4 }); }
    }
    for (const off of [0, 1, 2, 3, 4]) { const d = addDaysStr('2026-06-29', off); log[d] = run(d, 4, { rpe: 6 }); }
    log['2026-07-06'] = run('2026-07-06', 4, { rpe: 6 });
    const g = globals({ speedState: 6, checkins: { '2026-07-06': ci('2026-07-06'), '2026-06-29': ci('2026-06-29') } });

    const profile = computeAdaptiveProfile(log, g, TODAY, null);
    expect(profile.rpeTrend.status).toBe('rising');
    expect(profile.earnedTrust.active).toBe(false);            // trust revoked

    const guard = evaluateSpeedGuard(log, g, TODAY);
    expect(guard.effectiveTier).toBeLessThanOrEqual(4);        // advanced suppressed
    expect(g.speedState).toBe(6);                              // stored tier NOT erased

    const row = computeTodaySpeed({ runState: log, globals: g, today: TODAY, plan, acceptedWeeks: {} });
    expect(row).not.toBeNull();                                // basic touch still offered
    expect(['Buildups', 'Short strides', 'Flat strides']).toContain(row!.name);
  });
});

// ════════════════════════════════════════════════════════════
// Fartlek on the Today card — budget-gated (§5 tier 5)
// ════════════════════════════════════════════════════════════
describe('today-card light fartlek (tier 5)', () => {
  it('tier 5 with data on a plain easy day → fartlek suggestion with skip line', () => {
    const g = globals({ speedState: 5, ...DATA });
    const row = computeTodaySpeed({ runState: weeklyLog(4, { rpe: 4 }), globals: g, today: TODAY, plan, acceptedWeeks: {} });
    expect(row!.name).toBe('Light fartlek');
    expect(row!.optional).toBe(true);
    expect(row!.skip).toBe(SKIP_CONDITIONS);
  });

  it('an accepted threshold this week spends the budget → fartlek falls back to strides', () => {
    const monday = mondayOf(TODAY);
    const acceptedWeeks = {
      [monday]: [
        { date: '2026-07-08', dayLabel: 'Wed', kind: 'threshold', miles: 4, why: 'x' } as ProposedDay,
      ],
    };
    const g = globals({ speedState: 5, ...DATA });
    const row = computeTodaySpeed({ runState: weeklyLog(4, { rpe: 4 }), globals: g, today: TODAY, plan, acceptedWeeks });
    expect(row!.name).not.toBe('Light fartlek');
    expect(['Buildups', 'Short strides', 'Flat strides']).toContain(row!.name);
  });

  it('a race this week suppresses the fartlek (race week caps at strides)', () => {
    const g = globals({ speedState: 5, ...DATA, races: [race('2026-07-08')] });
    const row = computeTodaySpeed({ runState: weeklyLog(4, { rpe: 4 }), globals: g, today: TODAY, plan, acceptedWeeks: {} });
    expect(row!.name).not.toBe('Light fartlek');
  });
});
