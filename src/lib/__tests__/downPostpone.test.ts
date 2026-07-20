// ============================================================
// POSTPONE-A-DOWN-WEEK — the athlete may push one scheduled
// absorption week one week later (build before a trip, absorb
// during it). Contracts under test:
//   • identity: no marker / empty list / non-cadence markers = byte-identical
//   • the origin week BUILDS through; the landing week takes the cut off the
//     NEW (higher) trajectory — never the stale pre-origin one
//   • the build resumes ABOVE the origin build after the landing dip
//   • one-step only: a landing week can never itself be postponed
//   • other cadence occurrences stay exactly where they were
//   • adaptive tightening of downEvery makes markers inert (safety wins)
//   • downWeekControls offers postpone/undo ONLY on future, unlocked,
//     unaccepted weeks whose landing is equally free
//   • the from-actuals generator honors the same one-week shift, and a pain
//     spike always outranks a postponement
// ============================================================

import { describe, it, expect } from 'vitest';
import { buildWeekConfigsFromSettings, defaultSettings, downSlot } from '../settings';
import { resolveEffectivePlan, downWeekControls } from '../planOverlay';
import { generateNextWeek } from '../generator';
import { defaultGlobalState } from '../migrate';
import type { RawSettings, RunState } from '../types';
import type { WeekConfig } from '../../config/plan';

const NOW = '2026-06-01T12:00:00Z';

function raw(patch: Partial<RawSettings> = {}): RawSettings {
  return {
    ...defaultSettings(NOW),
    startDate: '2026-06-29',
    startMpw: 20,
    peakMpw: 30,
    buildStep: 1.5,
    downEvery: 4,
    weeksShown: 8,
    daysPerWeek: 5,
    trailingLongest: 4.5,
    xcStartDate: '2027-06-28', // far future — no maintenance interference
    ...patch,
  };
}

function totals(cfgs: WeekConfig[]): number[] {
  return cfgs.map(c => c.miles.reduce((a, b) => a + b, 0));
}
function downs(cfgs: WeekConfig[]): boolean[] {
  return cfgs.map(c => !!c.isDownWeek);
}

// Cadence with downEvery=4 from 2026-06-29: downs at idx 3 (2026-07-20) and
// idx 7 (2026-08-17).
const ORIGIN = '2026-07-20';   // idx 3 Monday
const LANDING = '2026-07-27';  // idx 4 Monday

describe('downSlot — the postponement-aware cadence', () => {
  it('classifies down / postponed / landing / none', () => {
    const eff = raw({ downPostponed: [ORIGIN] });
    expect(downSlot(2, 4, eff)).toBe('none');
    expect(downSlot(3, 4, eff)).toBe('postponed');
    expect(downSlot(4, 4, eff)).toBe('landing');
    expect(downSlot(5, 4, eff)).toBe('none');
    // Recovery-anchored cadence: the next down counts downEvery weeks from the
    // ACTUAL (moved) down week — idx 4 + 4 = idx 8, not the old grid's idx 7.
    expect(downSlot(7, 4, eff)).toBe('none');
    expect(downSlot(8, 4, eff)).toBe('down');
  });

  it('a marker on a non-cadence Monday is inert', () => {
    const eff = raw({ downPostponed: ['2026-07-13', LANDING] });
    expect(downSlot(2, 4, eff)).toBe('none');
    expect(downSlot(3, 4, eff)).toBe('down');   // origin unaffected
    expect(downSlot(4, 4, eff)).toBe('none');   // no landing without an origin marker
  });
});

describe('postponing a scheduled down week (engine)', () => {
  const base = buildWeekConfigsFromSettings(raw());

  it('identity: absent, empty, and inert markers are byte-identical', () => {
    for (const downPostponed of [undefined, [], ['2026-07-13'], [LANDING]]) {
      const cfgs = buildWeekConfigsFromSettings(raw({ downPostponed }));
      expect(totals(cfgs)).toEqual(totals(base));
      expect(downs(cfgs)).toEqual(downs(base));
      expect(cfgs.map(c => c.note)).toEqual(base.map(c => c.note));
    }
  });

  it('baseline sanity: downs at idx 3 and 7', () => {
    expect(downs(base)).toEqual([false, false, false, true, false, false, false, true]);
  });

  it('the origin week builds through and the landing week takes the cut', () => {
    const cfgs = buildWeekConfigsFromSettings(raw({ downPostponed: [ORIGIN] }));
    const t = totals(cfgs);
    const tb = totals(base);

    expect(downs(cfgs)).toEqual([false, false, false, false, true, false, false, false]);
    expect(cfgs[4].note).toBe('down week');

    // Origin builds past the prior build week.
    expect(t[3]).toBeGreaterThan(t[2]);
    // The landing dip is cut off the NEW trajectory (~85% of the origin build,
    // within display rounding) — deeper in absolute miles than the original
    // down week would have been, exactly because the base underneath is higher.
    expect(t[4]).toBeGreaterThan(tb[3] - 0.001);            // never below the un-postponed down
    expect(t[4]).toBeLessThan(t[3]);                         // a real dip
    expect(Math.abs(t[4] - 0.85 * t[3])).toBeLessThanOrEqual(1.2);
    // The week after the landing resumes ABOVE the origin build (trajectory
    // survived the dip — no re-baselining).
    expect(t[5]).toBeGreaterThan(t[3]);
    // Recovery-anchored: the NEXT down counts 4 weeks from the moved down week
    // (idx 4 → idx 8), giving one 5-week cycle then normal 4-week cycles.
    const longer = buildWeekConfigsFromSettings(raw({ downPostponed: [ORIGIN] }), 13);
    expect(downs(longer)).toEqual(
      [false, false, false, false, true, false, false, false, true, false, false, false, true],
    );
  });

  it('one-step only: marking the landing too changes nothing further', () => {
    const once = buildWeekConfigsFromSettings(raw({ downPostponed: [ORIGIN] }));
    const twice = buildWeekConfigsFromSettings(raw({ downPostponed: [ORIGIN, LANDING] }));
    expect(totals(twice)).toEqual(totals(once));
    expect(downs(twice)).toEqual(downs(once));
  });

  it('each occurrence postpones independently (on the shifted cadence)', () => {
    // After postponing idx 3 → 4, the next cycle's down is idx 8 (2026-08-24).
    // Postponing THAT one too moves it to idx 9; the cycle after counts from 9.
    const cfgs = buildWeekConfigsFromSettings(raw({ downPostponed: [ORIGIN, '2026-08-24'] }), 12);
    expect(downs(cfgs)).toEqual(
      [false, false, false, false, true, false, false, false, false, true, false, false],
    );
    // A marker on the OLD grid's idx 7 Monday (2026-08-17) is no longer a
    // scheduled down under the shifted cadence → inert.
    const stale = buildWeekConfigsFromSettings(raw({ downPostponed: [ORIGIN, '2026-08-17'] }), 12);
    const justOne = buildWeekConfigsFromSettings(raw({ downPostponed: [ORIGIN] }), 12);
    expect(downs(stale)).toEqual(downs(justOne));
  });

  it('body-signal easing withholds the postpone offer (undo stays available)', () => {
    const TODAY = '2026-07-08';
    const future = raw({ startDate: '2026-07-13', weeksShown: 6 });
    const easing = { growthFactor: 0.85, downEvery: 4 };
    // Clean signals → postpone offered; easing signals → withheld.
    expect(downWeekControls(future, {}, TODAY, { modulation: { growthFactor: 1, downEvery: 4 } }).get('2026-08-03')).toBe('postpone');
    expect(downWeekControls(future, {}, TODAY, { modulation: easing }).get('2026-08-03')).toBeUndefined();
    // Undo only ADDS recovery, so it survives an easing signal.
    const marked = raw({ startDate: '2026-07-13', weeksShown: 6, downPostponed: ['2026-08-03'] });
    expect(downWeekControls(marked, {}, TODAY, { modulation: easing }).get('2026-08-03')).toBe('undo');
  });

  it('adaptive tightening of the cadence makes markers inert (safety wins)', () => {
    const mod = { growthFactor: 1, downEvery: 3 };
    const withMarker = buildWeekConfigsFromSettings(raw({ downPostponed: [ORIGIN] }), undefined, mod);
    const without = buildWeekConfigsFromSettings(raw(), undefined, mod);
    expect(totals(withMarker)).toEqual(totals(without));
    expect(downs(withMarker)).toEqual(downs(without));
    // Tightened cadence: downs every 3rd week, marker Monday no longer on cadence.
    expect(downs(without)).toEqual([false, false, true, false, false, true, false, false]);
  });
});

describe('postponement through resolveEffectivePlan + downWeekControls', () => {
  const TODAY = '2026-07-08';
  // All-future plan: startDate is the Monday after TODAY, so every week is
  // unlocked and settings-generated.
  const future = (patch: Partial<RawSettings> = {}) =>
    raw({ startDate: '2026-07-13', weeksShown: 6, ...patch });
  const DOWN_MON = '2026-08-03';    // idx 3 from 2026-07-13
  const LAND_MON = '2026-08-10';    // idx 4

  it('resolved plan shifts the down week and labels the landing', () => {
    const before = resolveEffectivePlan(future(), {}, TODAY).plan.weeks;
    const after = resolveEffectivePlan(future({ downPostponed: [DOWN_MON] }), {}, TODAY).plan.weeks;
    expect(before[3].isDownWeek).toBe(true);
    expect(after[3].isDownWeek).toBe(false);
    expect(after[4].isDownWeek).toBe(true);
    expect(after[4].note).toBe('down week');
    expect(after[3].totalPlanned).toBeGreaterThan(before[3].totalPlanned);
  });

  it('offers postpone on a future scheduled down week, undo once postponed', () => {
    expect(downWeekControls(future(), {}, TODAY).get(DOWN_MON)).toBe('postpone');
    const after = downWeekControls(future({ downPostponed: [DOWN_MON] }), {}, TODAY);
    expect(after.get(DOWN_MON)).toBe('undo');
    expect(after.get(LAND_MON)).toBeUndefined();
  });

  it('no postpone when the landing week is locked by a logged run', () => {
    const runState: RunState = {
      '2026-08-12': { date: '2026-08-12', done: true, miles_actual: 4, updated_at: NOW },
    };
    expect(downWeekControls(future(), runState, TODAY).get(DOWN_MON)).toBeUndefined();
  });

  it('no postpone when origin or landing is an accepted week', () => {
    const day = { date: DOWN_MON, dayLabel: 'Mon', kind: 'easy' as const, miles: 4, why: '' };
    expect(
      downWeekControls(future(), {}, TODAY, { acceptedWeeks: { [DOWN_MON]: [day] } }).get(DOWN_MON),
    ).toBeUndefined();
    expect(
      downWeekControls(future(), {}, TODAY, {
        acceptedWeeks: { [LAND_MON]: [{ ...day, date: LAND_MON }] },
      }).get(DOWN_MON),
    ).toBeUndefined();
  });

  it('no controls on break or without settings', () => {
    expect(downWeekControls(future(), {}, TODAY, { breakStart: '2026-07-20' }).size).toBe(0);
    expect(downWeekControls(null, {}, TODAY).size).toBe(0);
  });

  it('no controls on locked (past/current) weeks', () => {
    // Canonical plan started 6/29; by 7/08 weeks 1–2 are locked. The idx-3 down
    // week (7/20) is future → still offered; nothing before it is.
    const controls = downWeekControls(raw({ weeksShown: 7 }), {}, TODAY);
    expect([...controls.keys()]).toEqual(['2026-07-20']);
  });
});

describe('the blank-Monday exception (postpone on the down week\'s own Monday)', () => {
  const future = (patch: Partial<RawSettings> = {}) =>
    raw({ startDate: '2026-07-13', weeksShown: 6, ...patch });
  const DOWN_MON = '2026-08-03'; // idx 3 from 2026-07-13

  it('still offers postpone on that Monday while nothing is logged', () => {
    expect(downWeekControls(future(), {}, DOWN_MON).get(DOWN_MON)).toBe('postpone');
    // …and undo, if it was already postponed.
    expect(
      downWeekControls(future({ downPostponed: [DOWN_MON] }), {}, DOWN_MON).get(DOWN_MON),
    ).toBe('undo');
  });

  it('the window closes the moment a run is logged, or the day passes', () => {
    const logged: RunState = {
      [DOWN_MON]: { date: DOWN_MON, done: true, miles_actual: 4, updated_at: NOW },
    };
    expect(downWeekControls(future(), logged, DOWN_MON).get(DOWN_MON)).toBeUndefined();
    expect(downWeekControls(future(), {}, '2026-08-04').get(DOWN_MON)).toBeUndefined();
  });

  // Canonical plan (startDate = PLAN_START_DATE): locked weeks normally splice
  // the STATIC scaffold, whose down week sits in the fixed W4 slot — so the
  // marker must override the splice or the postponement would vanish the moment
  // the origin week locks.
  const W123_DONE: RunState = Object.fromEntries(
    [
      ['2026-06-29', 4.0], ['2026-06-30', 4.0], ['2026-07-01', 4.0], ['2026-07-02', 3.5], ['2026-07-03', 4.5],
      ['2026-07-06', 4.5], ['2026-07-07', 4.5], ['2026-07-08', 4.0], ['2026-07-09', 4.0], ['2026-07-10', 5.0],
      ['2026-07-13', 5.0], ['2026-07-14', 5.0], ['2026-07-15', 5.0], ['2026-07-16', 4.5], ['2026-07-17', 5.5],
    ].map(([d, m]) => [d, { date: d as string, done: true, miles_actual: m as number, updated_at: NOW }]),
  );
  const MONDAY = '2026-07-20'; // W4's own Monday — the canonical cadence down week

  it('a marker set on the blank Monday reshapes the CURRENT (locked) week', () => {
    const before = resolveEffectivePlan(raw({ weeksShown: 7 }), W123_DONE, MONDAY).plan.weeks;
    expect(before[3].isDownWeek).toBe(true); // static W4 down splice

    const after = resolveEffectivePlan(
      raw({ weeksShown: 7, downPostponed: [MONDAY] }), W123_DONE, MONDAY,
    ).plan.weeks;
    expect(after[3].isDownWeek).toBe(false);
    expect(after[3].totalPlanned).toBeGreaterThan(25); // builds past locked W3
    expect(after[4].isDownWeek).toBe(true);            // landing takes the cut
    expect(after[4].totalPlanned).toBeLessThan(after[3].totalPlanned);
  });

  it('the postponed shape survives once runs are logged (marker permanence)', () => {
    const rs: RunState = {
      ...W123_DONE,
      [MONDAY]: { date: MONDAY, done: true, miles_actual: 5.5, updated_at: NOW },
    };
    const weeks = resolveEffectivePlan(
      raw({ weeksShown: 7, downPostponed: [MONDAY] }), rs, '2026-07-21',
    ).plan.weeks;
    expect(weeks[3].isDownWeek).toBe(false); // still the build the athlete committed to
    expect(weeks[4].isDownWeek).toBe(true);
    // …but the control is gone: the decision is locked in.
    expect(
      downWeekControls(raw({ weeksShown: 7, downPostponed: [MONDAY] }), rs, '2026-07-21').get(MONDAY),
    ).toBeUndefined();
  });
});

describe('generator honors postponements (from-actuals proposals)', () => {
  function run(date: string, miles: number, extra: Partial<RunState[string]> = {}): RunState[string] {
    return { date, done: true, miles_actual: miles, updated_at: date + 'T12:00:00Z', ...extra };
  }
  // Five completed build weeks → the cadence down is due next week (downEvery 4).
  const FIVE_BUILDS: RunState = {
    '2026-06-22': run('2026-06-22', 9), '2026-06-26': run('2026-06-26', 9),
    '2026-06-29': run('2026-06-29', 10), '2026-07-03': run('2026-07-03', 10),
    '2026-07-06': run('2026-07-06', 11), '2026-07-10': run('2026-07-10', 11),
    '2026-07-13': run('2026-07-13', 12), '2026-07-17': run('2026-07-17', 12),
    '2026-07-20': run('2026-07-20', 13), '2026-07-24': run('2026-07-24', 13),
  };
  const SUNDAY = '2026-07-26'; // proposal targets 2026-07-27

  it('suppresses the cadence down on a postponed origin Monday', () => {
    const g = defaultGlobalState(NOW);
    const base = generateNextWeek({ runState: FIVE_BUILDS, globals: g, today: SUNDAY, settings: raw() });
    expect(base.weekStart).toBe('2026-07-27');
    expect(base.isDownWeek).toBe(true);

    const p = generateNextWeek({
      runState: FIVE_BUILDS, globals: g, today: SUNDAY,
      settings: raw({ downPostponed: ['2026-07-27'] }),
    });
    expect(p.isDownWeek).toBe(false);
    expect(p.notes.join(' ')).toMatch(/postponed/i);
  });

  it('forces the down on the landing Monday even before the cadence would fire', () => {
    // Only three completed builds (cadence not due), but last week was a
    // postponed origin → the landing takes the cut.
    const THREE_BUILDS: RunState = {
      '2026-07-06': run('2026-07-06', 11), '2026-07-10': run('2026-07-10', 11),
      '2026-07-13': run('2026-07-13', 12), '2026-07-17': run('2026-07-17', 12),
      '2026-07-20': run('2026-07-20', 13), '2026-07-24': run('2026-07-24', 13),
      '2026-07-27': run('2026-07-27', 14), '2026-07-31': run('2026-07-31', 14),
    };
    const g = defaultGlobalState(NOW);
    const base = generateNextWeek({ runState: THREE_BUILDS, globals: g, today: '2026-08-02', settings: raw() });
    expect(base.isDownWeek).toBe(false);

    const p = generateNextWeek({
      runState: THREE_BUILDS, globals: g, today: '2026-08-02',
      settings: raw({ downPostponed: ['2026-07-27'] }),
    });
    expect(p.weekStart).toBe('2026-08-03');
    expect(p.isDownWeek).toBe(true);
    expect(p.notes.join(' ')).toMatch(/moved here/i);
  });

  it('a pain spike always outranks a postponement', () => {
    const flared: RunState = {
      ...FIVE_BUILDS,
      '2026-07-24': run('2026-07-24', 13, { painDuring: 5 }),
      '2026-07-25': run('2026-07-25', 2, { painDuring: 5 }),
    };
    const p = generateNextWeek({
      runState: flared, globals: defaultGlobalState(NOW), today: SUNDAY,
      settings: raw({ downPostponed: ['2026-07-27'] }),
    });
    expect(p.isDownWeek).toBe(true); // deload happens anyway
  });
});
