// ============================================================
// PHASE 2B — weekly check-ins wired into the adaptive engine.
//
// Proves the one-way safety contract for the composite recovery signal
// (sleep / soreness / energy / stress): a check-in can only HOLD / REDUCE /
// DELOAD the plan. A good week never speeds it up. Missing check-ins — and
// missing / out-of-range fields inside a check-in — are UNKNOWN and do nothing.
// One mildly rough field never overreacts; two bad fields, an extreme week, or
// repeated caution matter more. Weekly recovery compounds with the Phase 2A
// signals (RPE trend, pain drift) but a real pain breach stays stronger than
// all of it, and nothing here loosens a growth/long-run cap or touches a locked
// week. Clean check-ins are byte-identical to Phase 2A identity behavior.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  computeAdaptiveProfile, toModulation, weeklyRecoverySignal,
} from '../adaptive';
import { buildWeekConfigsFromSettings, defaultSettings } from '../settings';
import { resolveEffectivePlan } from '../planOverlay';
import { assessPeakFeasibility } from '../feasibility';
import { defaultGlobalState } from '../migrate';
import { nextLongFrom, addDaysStr, mondayOf } from '../metrics';
import { TUNABLES } from '../../config/tunables';
import { PLAN_START_DATE } from '../../config/plan';
import type { GlobalState, RawSettings, RunEntry, RunState, WeeklyCheckin } from '../types';
import type { WeekConfig } from '../../config/plan';

const A = TUNABLES.ADAPTIVE;
const R = TUNABLES.ADAPTIVE.RECOVERY;
const NOW = '2026-07-31T12:00:00Z';
const TODAY = '2026-07-31';

// Recent check-in week starts, derived (not hardcoded) so window math stays honest.
const CURR = mondayOf(TODAY);         // current (in-progress) week's Monday
const PREV = addDaysStr(CURR, -7);
const PREV2 = addDaysStr(CURR, -14);
const OLD = addDaysStr(CURR, -21);    // outside the 3-week lookback window

function globals(patch: Partial<GlobalState> = {}): GlobalState {
  return { ...defaultGlobalState(NOW), ...patch };
}
function run(date: string, miles: number, extra: Partial<RunEntry> = {}): RunEntry {
  return { date, done: true, miles_actual: miles, updated_at: date + 'T12:00:00Z', ...extra };
}
const total = (c: WeekConfig) => c.miles.reduce((a, b) => a + b, 0);
const long = (c: WeekConfig) => c.miles[c.miles.length - 1];

function settingsFor(patch: Partial<RawSettings> = {}): RawSettings {
  return {
    ...defaultSettings(NOW),
    startMpw: 20, peakMpw: 40, buildStep: 2, downEvery: 4, weeksShown: 12,
    trailingLongest: 4.5, ...patch,
  };
}

/** A clean weekly check-in (all fields in a good range → 0 flags → 'normal'). */
function ci(weekStart: string, p: Partial<WeeklyCheckin> = {}): WeeklyCheckin {
  return { weekStart, sleep: 3, soreness: 2, energy: 3, stress: 2, updated_at: weekStart + 'T00:00:00Z', ...p };
}
/** A check-in with arbitrary / missing fields (for the "unknown field" cases).
 *  Loose cast so we can omit fields the type declares as required numbers. */
function ciRaw(weekStart: string, fields: Record<string, unknown>): WeeklyCheckin {
  return { weekStart, updated_at: weekStart + 'T00:00:00Z', ...fields } as unknown as WeeklyCheckin;
}
function checkins(...cs: WeeklyCheckin[]): Record<string, WeeklyCheckin> {
  const r: Record<string, WeeklyCheckin> = {};
  for (const c of cs) r[c.weekStart] = c;
  return r;
}

/** N weeks of clean daily easy runs ending the week before TODAY. No rpe / pain,
 *  so on their own every Phase-2A signal is insufficient (identity). */
function adheredLog(weeks: number): RunState {
  const s: RunState = {};
  for (let w = 1; w <= weeks; w++) {
    for (const off of [0, 1, 2, 3, 4]) {
      const d = addDaysStr(TODAY, -w * 7 + off);
      s[d] = run(d, 4);
    }
  }
  return s;
}
function rpeRuns(rpes: number[]): RunState {
  const s: RunState = {};
  const n = rpes.length;
  for (let i = 0; i < n; i++) {
    const d = addDaysStr(TODAY, -(n - i) * 3);
    s[d] = run(d, 4, { rpe: rpes[i] });
  }
  return s;
}
function painRuns(vals: Array<number | null>): RunState {
  const s: RunState = {};
  const n = vals.length;
  for (let i = 0; i < n; i++) {
    const d = addDaysStr(TODAY, -(n - i) * 4);
    s[d] = run(d, 4, { painDuring: 0, painNextAM: vals[i] });
  }
  return s;
}

const base = settingsFor();
const identity = buildWeekConfigsFromSettings(base);
const modOf = (log: RunState, g: GlobalState = globals()) =>
  toModulation(computeAdaptiveProfile(log, g, TODAY, base));
const RECOVERY_REASON = /cautionary|recovery was poor|recovery has stayed low|shallow down week/i;

// ════════════════════════════════════════════════════════════
// weeklyRecoverySignal — the pure composite detector
// ════════════════════════════════════════════════════════════
describe('weeklyRecoverySignal — composite recovery status', () => {
  it('no check-ins at all → insufficient (missing = unknown)', () => {
    expect(weeklyRecoverySignal(undefined, TODAY).status).toBe('insufficient');
    expect(weeklyRecoverySignal({}, TODAY).status).toBe('insufficient');
  });

  it('a check-in with every field missing → insufficient (all-unknown = skipped)', () => {
    expect(weeklyRecoverySignal(checkins(ciRaw(CURR, {})), TODAY).status).toBe('insufficient');
    // out-of-range / zero values are unknown too, never a rating
    expect(weeklyRecoverySignal(checkins(ciRaw(CURR, { sleep: 0, soreness: 9, energy: null, stress: NaN })), TODAY).status)
      .toBe('insufficient');
  });

  it('a clean week (all good) → normal', () => {
    expect(weeklyRecoverySignal(checkins(ci(CURR)), TODAY).status).toBe('normal');
  });

  it('one bad field (a single flag) → normal (a note only, no easing)', () => {
    expect(weeklyRecoverySignal(checkins(ci(CURR, { soreness: 4 })), TODAY).status).toBe('normal');
    // one bad field with the rest MISSING is still only a note
    expect(weeklyRecoverySignal(checkins(ciRaw(CURR, { sleep: 1 })), TODAY).status).toBe('normal');
  });

  it('two bad fields → caution', () => {
    const s = weeklyRecoverySignal(checkins(ci(CURR, { sleep: 2, energy: 2 })), TODAY);
    expect(s.status).toBe('caution');
    expect(s.latestFlags).toEqual({ sleepLow: true, energyLow: true, sorenessHigh: false, stressHigh: false });
  });

  it('two EXTREME fields → poor even on its own (one rough week)', () => {
    expect(weeklyRecoverySignal(checkins(ci(CURR, { soreness: 5, stress: 5 })), TODAY).status).toBe('poor');
  });

  it('three bad fields → poor', () => {
    expect(weeklyRecoverySignal(checkins(ci(CURR, { sleep: 2, energy: 2, soreness: 4 })), TODAY).status).toBe('poor');
  });

  it('repeated caution across recent weeks escalates to poor + repeated', () => {
    const s = weeklyRecoverySignal(checkins(
      ci(PREV, { sleep: 2, energy: 2 }),
      ci(CURR, { sleep: 2, energy: 2 }),
    ), TODAY);
    expect(s.status).toBe('poor');
    expect(s.repeated).toBe(true);
    expect(s.cautionWeeks).toBe(2);
  });

  it('a poor week OUTSIDE the lookback window is ignored', () => {
    expect(weeklyRecoverySignal(checkins(ci(OLD, { soreness: 5, stress: 5 })), TODAY).status).toBe('insufficient');
  });

  it('a good latest week is normal even if an older week was rough (recovered)', () => {
    const s = weeklyRecoverySignal(checkins(
      ci(PREV2, { soreness: 5, stress: 5 }), // rough two weeks ago
      ci(CURR, { sleep: 4, energy: 4, soreness: 1, stress: 1 }), // fine now
    ), TODAY);
    expect(s.status).toBe('normal');
  });
});

// ════════════════════════════════════════════════════════════
// Folding into computeAdaptiveProfile (the 20 required scenarios)
// ════════════════════════════════════════════════════════════
describe('computeAdaptiveProfile — weekly check-in folding (downward-only)', () => {
  it('(1) missing weekly check-ins do not affect the plan', () => {
    const p = computeAdaptiveProfile(adheredLog(3), globals(), TODAY, base);
    expect(p.recovery.status).toBe('insufficient');
    expect(p.growthFactor).toBe(1);
    expect(p.downEvery).toBe(base.downEvery);
    expect(buildWeekConfigsFromSettings(base, undefined, toModulation(p))).toEqual(identity);
    // an explicitly empty checkins map behaves identically
    expect(computeAdaptiveProfile(adheredLog(3), globals({ checkins: {} }), TODAY, base).growthFactor).toBe(1);
  });

  it('(2) missing fields inside a check-in are treated as unknown', () => {
    const allMissing = globals({ checkins: checkins(ciRaw(CURR, {})) });
    expect(computeAdaptiveProfile(adheredLog(3), allMissing, TODAY, base).growthFactor).toBe(1);
    // one bad field present, the rest missing → a note only → no easing, no scary copy
    const oneField = globals({ checkins: checkins(ciRaw(CURR, { sleep: 1 })) });
    const p = computeAdaptiveProfile(adheredLog(3), oneField, TODAY, base);
    expect(p.recovery.status).toBe('normal');
    expect(p.growthFactor).toBe(1);
    expect(p.reasons.join(' ')).not.toMatch(RECOVERY_REASON);
  });

  it('(3) normal / good weekly check-ins do not make the plan more aggressive', () => {
    const good = globals({ checkins: checkins(ci(CURR, { sleep: 5, energy: 5, soreness: 1, stress: 1 })) });
    const p = computeAdaptiveProfile(adheredLog(3), good, TODAY, base);
    expect(p.growthFactor).toBe(1); // never above the population rate
    expect(p.downEvery).toBe(base.downEvery);
    expect(buildWeekConfigsFromSettings(base, undefined, toModulation(p))).toEqual(identity);
  });

  it('(4) one mildly bad check-in does not overreact', () => {
    const mild = globals({ checkins: checkins(ci(CURR, { soreness: 4 })) }); // one flag only
    const p = computeAdaptiveProfile(adheredLog(3), mild, TODAY, base);
    expect(p.recovery.status).toBe('normal'); // a note, internally — no easing
    expect(p.growthFactor).toBe(1);
    expect(p.reasons.join(' ')).not.toMatch(RECOVERY_REASON);
  });

  it('(5) one extreme poor check-in can hold/reduce (but does not deload the cadence alone)', () => {
    const extreme = globals({ checkins: checkins(ci(CURR, { sleep: 1, energy: 1 })) }); // two extreme-low fields
    const p = computeAdaptiveProfile(adheredLog(3), extreme, TODAY, base);
    expect(p.recovery.status).toBe('poor');
    expect(p.recovery.repeated).toBe(false);
    expect(p.growthFactor).toBeCloseTo(R.POOR_EASE, 5);
    expect(p.downEvery).toBe(base.downEvery); // single extreme = hold/reduce, not a deload
    expect(p.reasons.join(' ')).toMatch(/recovery was poor/i);
  });

  it('(6) repeated poor check-ins hold AND take a shallow deload', () => {
    const rep = globals({ checkins: checkins(
      ci(PREV, { soreness: 5, stress: 5 }),
      ci(CURR, { soreness: 5, stress: 5 }),
    ) });
    const p = computeAdaptiveProfile(adheredLog(3), rep, TODAY, base);
    expect(p.recovery.status).toBe('poor');
    expect(p.recovery.repeated).toBe(true);
    expect(p.growthFactor).toBeCloseTo(R.POOR_EASE, 5);
    expect(p.downEvery).toBeLessThanOrEqual(R.POOR_DOWNEVERY);
    expect(p.downEvery).toBeLessThan(base.downEvery); // 4 → 3, more frequent absorption week
    expect(p.reasons.join(' ')).toMatch(/shallow down week/i);
  });

  it('(7) low sleep + low energy reduce the growth factor (caution)', () => {
    const g = globals({ checkins: checkins(ci(CURR, { sleep: 2, energy: 2 })) });
    const p = computeAdaptiveProfile(adheredLog(3), g, TODAY, base);
    expect(p.recovery.status).toBe('caution');
    expect(p.growthFactor).toBeCloseTo(R.CAUTION_EASE, 5);
    expect(p.growthFactor).toBeLessThan(1);
    expect(p.reasons.join(' ')).toMatch(/low sleep and low energy/i);
  });

  it('(8) high soreness + high stress trigger a hold/shallow deload', () => {
    const g = globals({ checkins: checkins(ci(CURR, { soreness: 5, stress: 5 })) });
    const p = computeAdaptiveProfile(adheredLog(3), g, TODAY, base);
    expect(p.recovery.status).toBe('poor');
    expect(p.growthFactor).toBeLessThan(1);
    expect(p.growthFactor).toBeCloseTo(R.POOR_EASE, 5);
    expect(p.reasons.join(' ')).toMatch(/high soreness and high life stress/i);
  });

  it('(9) recovery combines with rising RPE for a stronger cautious response', () => {
    const g = globals({ checkins: checkins(ci(CURR, { soreness: 5, stress: 5 })) });
    const both = computeAdaptiveProfile({ ...adheredLog(3), ...rpeRuns([3, 3, 4, 5, 6, 6]) }, g, TODAY, base);
    const rpeOnly = computeAdaptiveProfile({ ...adheredLog(3), ...rpeRuns([3, 3, 4, 5, 6, 6]) }, globals(), TODAY, base);
    const recOnly = computeAdaptiveProfile(adheredLog(3), g, TODAY, base);
    expect(both.growthFactor).toBeLessThan(rpeOnly.growthFactor);
    expect(both.growthFactor).toBeLessThan(recOnly.growthFactor);
    expect(both.growthFactor).toBeCloseTo(A.RPE_EASE * R.POOR_EASE, 5); // 0.85 × 0.7
    expect(both.reasons.join(' ')).toMatch(/easing the build more than either signal/i);
  });

  it('(10) recovery combines with pain drift but never overrides pain-breach severity', () => {
    const g = globals({ painCap: 3, checkins: checkins(ci(CURR, { soreness: 5, stress: 5 })) });
    const both = computeAdaptiveProfile({ ...adheredLog(3), ...painRuns([0, 0, 1, 2, 2]) }, g, TODAY, base);
    const driftOnly = computeAdaptiveProfile({ ...adheredLog(3), ...painRuns([0, 0, 1, 2, 2]) }, globals({ painCap: 3 }), TODAY, base);
    expect(both.growthFactor).toBeLessThan(driftOnly.growthFactor); // stronger together
    expect(both.reasons.join(' ')).toMatch(/next-morning soreness is creeping up/i);
    // a REAL breach (above the cap) is stronger than sub-threshold drift + recovery combined
    const breachLog = { ...adheredLog(3), [addDaysStr(TODAY, -3)]: run(addDaysStr(TODAY, -3), 4, { painDuring: 6 }) };
    const breach = computeAdaptiveProfile(breachLog, globals({ painCap: 3 }), TODAY, base);
    expect(breach.growthFactor).toBeLessThan(both.growthFactor);
  });

  it('(11) a real pain breach remains stronger than any weekly check-in logic', () => {
    const repeatedPoor = computeAdaptiveProfile(
      adheredLog(3),
      globals({ checkins: checkins(ci(PREV, { soreness: 5, stress: 5 }), ci(CURR, { soreness: 5, stress: 5 })) }),
      TODAY, base,
    );
    const breachLog = { ...adheredLog(3), [addDaysStr(TODAY, -3)]: run(addDaysStr(TODAY, -3), 4, { painDuring: 6 }) };
    const breach = computeAdaptiveProfile(breachLog, globals({ painCap: 3 }), TODAY, base);
    expect(breach.growthFactor).toBeLessThan(repeatedPoor.growthFactor);
  });

  it('(20) clean check-ins are byte-identical to no-check-in (Phase 2A identity)', () => {
    const cleanMod = modOf(adheredLog(3), globals({ checkins: checkins(ci(CURR), ci(PREV), ci(PREV2)) }));
    const noneMod = modOf(adheredLog(3), globals());
    expect(cleanMod).toEqual(noneMod);
    expect(cleanMod).toEqual({ growthFactor: 1, downEvery: base.downEvery, holdLong: false });
    expect(buildWeekConfigsFromSettings(base, undefined, cleanMod)).toEqual(identity);
  });
});

// ════════════════════════════════════════════════════════════
// Plan-level: recovery only ever holds/reduces, never loosens a cap
// ════════════════════════════════════════════════════════════
describe('rolling plan — weekly recovery is one-way at the plan level', () => {
  const poorG = globals({ checkins: checkins(ci(CURR, { soreness: 5, stress: 5 })) });

  it('(12) recovery never produces a larger week and never loosens the +10%/wk cap', () => {
    const eased = buildWeekConfigsFromSettings(base, undefined, modOf(adheredLog(3), poorG));
    let anyReduced = false;
    for (let i = 0; i < identity.length; i++) {
      expect(total(eased[i])).toBeLessThanOrEqual(total(identity[i]) + 1e-9);
      if (total(eased[i]) < total(identity[i]) - 1e-9) anyReduced = true;
    }
    expect(anyReduced).toBe(true);
    // +10%/week growth cap still binds under the eased plan
    let lastBuild = total(eased[0]);
    for (let i = 1; i < eased.length; i++) {
      if (eased[i].isDownWeek) continue;
      expect(total(eased[i])).toBeLessThanOrEqual(lastBuild * TUNABLES.WEEKLY_GROWTH_MAX + 0.5 + 1e-9);
      lastBuild = total(eased[i]);
    }
  });

  it('(13) recovery never loosens the long-run 110% ladder', () => {
    const cfgs = buildWeekConfigsFromSettings(base, undefined, modOf(adheredLog(3), poorG));
    let prev = base.trailingLongest;
    for (const c of cfgs) {
      expect(long(c)).toBeLessThanOrEqual(nextLongFrom(prev) + 1e-9);
      if (!c.isDownWeek) prev = long(c);
    }
  });

  it('(16) weeksShown stays display-only under a recovery modulation', () => {
    const mod = modOf(adheredLog(3), poorG);
    const short = buildWeekConfigsFromSettings(base, 7, mod);
    const long20 = buildWeekConfigsFromSettings(base, 20, mod);
    for (let i = 0; i < 7; i++) expect(long20[i]).toEqual(short[i]);
  });

  it('no fake taper appears under a recovery modulation', () => {
    const cfgs = buildWeekConfigsFromSettings(base, 12, modOf(adheredLog(3), poorG));
    expect(cfgs.every(c => c.note !== 'taper')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// Preservation: locked weeks, logged runs, check-ins (14, 15)
// ════════════════════════════════════════════════════════════
describe('resolveEffectivePlan — preservation under a recovery modulation', () => {
  // startDate = PLAN_START_DATE so W1/W2 lock against the static scaffold.
  const lockBase = settingsFor({ startDate: PLAN_START_DATE, xcStartDate: addDaysStr(PLAN_START_DATE, 20 * 7) });
  const LOCK_TODAY = addDaysStr(PLAN_START_DATE, 8); // inside week 2
  const CUR_WK = mondayOf(LOCK_TODAY);
  const LOG: RunState = {
    [PLAN_START_DATE]: run(PLAN_START_DATE, 4),
    [addDaysStr(PLAN_START_DATE, 1)]: run(addDaysStr(PLAN_START_DATE, 1), 4),
    [addDaysStr(PLAN_START_DATE, 7)]: run(addDaysStr(PLAN_START_DATE, 7), 4),
  };
  const poorCheckins = globals({ checkins: checkins(ci(CUR_WK, { soreness: 5, stress: 5 })) });
  const poorMod = toModulation(computeAdaptiveProfile(LOG, poorCheckins, LOCK_TODAY, lockBase));

  it('the modulation is genuinely non-identity (so the test bites)', () => {
    expect(poorMod.growthFactor).toBeLessThan(1);
  });

  it('(14) locked weeks are identical with or without the recovery modulation', () => {
    const plain = resolveEffectivePlan(lockBase, LOG, LOCK_TODAY);
    const eased = resolveEffectivePlan(lockBase, LOG, LOCK_TODAY, { modulation: poorMod });
    for (const ws of [PLAN_START_DATE, addDaysStr(PLAN_START_DATE, 7)]) {
      const a = plain.plan.weeks.find(w => w.startDate === ws)!;
      const b = eased.plan.weeks.find(w => w.startDate === ws)!;
      expect(b.totalPlanned).toBe(a.totalPlanned);
      expect(b.runDays.map(d => d.prescribed)).toEqual(a.runDays.map(d => d.prescribed));
    }
  });

  it('(14) future unlocked weeks are eased (≤ identity) while locked weeks are untouched', () => {
    const plain = resolveEffectivePlan(lockBase, LOG, LOCK_TODAY);
    const eased = resolveEffectivePlan(lockBase, LOG, LOCK_TODAY, { modulation: poorMod });
    const futStart = addDaysStr(PLAN_START_DATE, 6 * 7);
    const a = plain.plan.weeks.find(w => w.startDate === futStart)!;
    const b = eased.plan.weeks.find(w => w.startDate === futStart)!;
    expect(b.totalPlanned).toBeLessThanOrEqual(a.totalPlanned + 1e-9);
  });

  it('(15) the run log is never mutated by plan resolution', () => {
    const snapshot = JSON.parse(JSON.stringify(LOG));
    resolveEffectivePlan(lockBase, LOG, LOCK_TODAY, { modulation: poorMod });
    expect(LOG).toEqual(snapshot);
  });

  it('(15) the check-in log is never mutated by profile computation', () => {
    const g = globals({ checkins: checkins(ci(CURR, { soreness: 5, stress: 5 }), ci(PREV, { sleep: 2, energy: 2 })) });
    const before = JSON.parse(JSON.stringify(g.checkins));
    computeAdaptiveProfile(adheredLog(3), g, TODAY, base);
    expect(g.checkins).toEqual(before);
  });
});

// ════════════════════════════════════════════════════════════
// Break Mode & Return-From-Break (17, 18) unaffected by recovery
// ════════════════════════════════════════════════════════════
describe('break mode & return-from-break under a recovery modulation', () => {
  const brBase = settingsFor({ startDate: PLAN_START_DATE, xcStartDate: addDaysStr(PLAN_START_DATE, 20 * 7) });
  const TODAY_BR = addDaysStr(PLAN_START_DATE, 8); // week 2
  const CUR_WK = mondayOf(TODAY_BR);
  const LOG: RunState = {
    [PLAN_START_DATE]: run(PLAN_START_DATE, 4),
    [addDaysStr(PLAN_START_DATE, 7)]: run(addDaysStr(PLAN_START_DATE, 7), 4),
  };
  const poorMod = toModulation(computeAdaptiveProfile(
    LOG, globals({ checkins: checkins(ci(CUR_WK, { soreness: 5, stress: 5 })) }), TODAY_BR, brBase,
  ));

  it('(17) break mode still pauses future weeks regardless of the recovery modulation', () => {
    const breakStart = addDaysStr(PLAN_START_DATE, 4 * 7); // week 5
    const plain = resolveEffectivePlan(brBase, LOG, TODAY_BR, { breakStart });
    const eased = resolveEffectivePlan(brBase, LOG, TODAY_BR, { breakStart, modulation: poorMod });
    // no settings-projected week appears on/after the break start
    expect(eased.plan.weeks.every(w => w.startDate < breakStart)).toBe(true);
    // break truncation is identical with and without the modulation
    expect(eased.plan.weeks.map(w => w.startDate)).toEqual(plain.plan.weeks.map(w => w.startDate));
  });

  it('(18) a reseeded (return-from-break) start does not re-baseline to the old static plan', () => {
    // startDate ≠ PLAN_START_DATE → the summer WEEK_CONFIGS scaffold must NOT be spliced.
    const reseedStart = addDaysStr(PLAN_START_DATE, 30 * 7);
    const TODAY_RS = addDaysStr(reseedStart, -3); // Friday before the reseeded start (all weeks unlocked)
    const reseed = settingsFor({
      startDate: reseedStart, startMpw: 8, peakMpw: 30, trailingLongest: 4,
      xcStartDate: addDaysStr(reseedStart, 20 * 7),
    });
    // A body-adjusted (poor-recovery) modulation, as toModulation would produce.
    const bodyMod = { growthFactor: R.POOR_EASE, downEvery: reseed.downEvery, holdLong: false };
    const plain = resolveEffectivePlan(reseed, {}, TODAY_RS);
    const eased = resolveEffectivePlan(reseed, {}, TODAY_RS, { modulation: bodyMod });
    const w0Plain = plain.plan.weeks[0];
    const w0Eased = eased.plan.weeks[0];
    // Week 0 seeds from the conservative reseeded startMpw (~8), NOT the static 20.
    expect(w0Plain.totalPlanned).toBeLessThan(15);
    expect(w0Eased.totalPlanned).toBe(w0Plain.totalPlanned); // startMpw seed is mod-independent
    // A later build week under the body modulation is ≤ the plain plan (downward-only).
    const fut = 6;
    expect(eased.plan.weeks[fut].totalPlanned).toBeLessThanOrEqual(plain.plan.weeks[fut].totalPlanned + 1e-9);
  });
});

// ════════════════════════════════════════════════════════════
// Feasibility (19): body-adjusted plan copy still flags an unreachable peak
// ════════════════════════════════════════════════════════════
describe('peak feasibility under a recovery modulation (19)', () => {
  const feasBase = settingsFor({ startMpw: 20, peakMpw: 35, buildStep: 2, xcStartDate: '2026-09-14' });

  it('an unreachable peak stays flagged; the safe ceiling is the UNMODULATED value', () => {
    const bodyMod = toModulation(computeAdaptiveProfile(
      adheredLog(3), globals({ checkins: checkins(ci(CURR, { soreness: 5, stress: 5 })) }), TODAY, feasBase,
    ));
    expect(bodyMod.growthFactor).toBeLessThan(1); // the plan copy really is body-adjusted
    const plain = assessPeakFeasibility(feasBase);
    const eased = assessPeakFeasibility(feasBase, bodyMod);
    expect(eased.maxSafeReachable).toBe(plain.maxSafeReachable);         // safety ceiling unchanged
    expect(eased.reachedByPlan).toBeLessThanOrEqual(plain.reachedByPlan + 1e-9); // body-adjusted reaches ≤
  });
});
