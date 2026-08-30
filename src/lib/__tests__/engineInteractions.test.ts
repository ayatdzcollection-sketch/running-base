// ============================================================
// ENGINE INTERACTIONS — the seams between features.
//
// Each feature (postponed down weeks, missed-week re-entry, the Saturday
// catch-up, coach-season maintenance holds) is well covered on its own. These
// tests cover where two of them MEET, which is where the real defects lived:
// a hold wiped by an absorption week, a cut timed just before a season, a
// second season inheriting the first one's hold, a draft generator that
// contradicts the plan it is drafting into, and ✓-done days that one module
// counts and another cannot see.
// ============================================================

import { describe, it, expect } from 'vitest';
import { resolveEffectivePlan } from '../planOverlay';
import { assessMissedDays } from '../missedDays';
import { generateNextWeek } from '../generator';
import { weeklyActuals } from '../metrics';
import { defaultSettings } from '../settings';
import type { GlobalState, RawSettings, RunState } from '../types';

const NOW = '2026-06-01T12:00:00Z';

function run(date: string, miles: number | null, extra: Partial<RunState[string]> = {}): RunState[string] {
  return { date, done: miles != null, miles_actual: miles, updated_at: date + 'T12:00:00Z', ...extra };
}

function settings(patch: Partial<RawSettings> = {}): RawSettings {
  return {
    ...defaultSettings(NOW),
    startDate: '2026-06-22',            // non-canonical → every week engine-built
    startMpw: 20, peakMpw: 30, buildStep: 1.5,
    downEvery: 6, weeksShown: 14, daysPerWeek: 5, trailingLongest: 4.5,
    xcStartDate: '2027-06-28',          // far future unless a test overrides
    ...patch,
  };
}

/** Week of 6/22 run fully (20 mi); week of 6/29 barely run (4 mi) → a cut. */
const SHORTFALL: RunState = {
  '2026-06-22': run('2026-06-22', 4.0),
  '2026-06-23': run('2026-06-23', 4.0),
  '2026-06-24': run('2026-06-24', 4.0),
  '2026-06-25': run('2026-06-25', 3.5),
  '2026-06-26': run('2026-06-26', 4.5),
  '2026-06-29': run('2026-06-29', 4.0),
};

describe('re-entry cut × season entry', () => {
  it('a cut landing the week BEFORE a season still lets the season climb back', () => {
    // The cut lands on the week of 7/6; the season opens 7/13. The hold must be
    // what was EARNED before the cut, not the reduced level — otherwise a cut
    // timed one week early pins the whole season to it.
    const { plan } = resolveEffectivePlan(
      settings({ xcStartDate: '2026-07-13' }), SHORTFALL, '2026-07-06',
    );
    const season = plan.weeks.filter(w => w.startDate >= '2026-07-13' && w.note === 'maintain');
    expect(season.length).toBeGreaterThan(3);
    const first = season[0].totalPlanned;
    const last = season[season.length - 1].totalPlanned;
    expect(last).toBeGreaterThan(first);          // it climbs, it is not pinned
    expect(last).toBeGreaterThanOrEqual(21);      // back to the pre-cut level (~21.5)
  });

  it('the climb is monotonic and never exceeds the pre-cut hold', () => {
    const { plan } = resolveEffectivePlan(
      settings({ xcStartDate: '2026-07-13' }), SHORTFALL, '2026-07-06',
    );
    const season = plan.weeks.filter(w => w.startDate >= '2026-07-13' && !w.isDownWeek);
    for (let i = 1; i < season.length; i++) {
      expect(season[i].totalPlanned).toBeGreaterThanOrEqual(season[i - 1].totalPlanned - 1e-9);
      expect(season[i].totalPlanned).toBeLessThanOrEqual(22.5); // hold ≈21.5 + rounding
    }
  });
});

describe('adjacent seasons', () => {
  const SEASONS: Partial<RawSettings> = {
    seasons: [
      { id: 'xc', label: 'XC', startDate: '2026-07-06', endDate: null },  // implicitly closes 9/6
      { id: 'track', label: 'Track', startDate: '2026-09-07', endDate: null },
    ],
  };
  /** Steady 26-ish mi/wk actually logged all through the XC season AND the
   *  first Track week (an unlogged week is a genuine shortfall and would earn
   *  its own re-entry cut, which is not what this test is about). */
  function seasonLog(): RunState {
    const rs: RunState = { ...SHORTFALL };
    for (let w = 0; w < 10; w++) {
      for (let d = 0; d < 5; d++) {
        const date = new Date(Date.parse('2026-07-06T12:00:00Z') + (w * 7 + d) * 86_400_000)
          .toISOString().slice(0, 10);
        rs[date] = run(date, 5.2);
      }
    }
    return rs;
  }

  it('a second season re-anchors to ACTUALS instead of inheriting the first hold', () => {
    // XC closes 9/6 and Track opens 9/7 with no gap between them, so "left a
    // season" must be detected by season IDENTITY, not by a no-season week.
    const { plan } = resolveEffectivePlan(
      settings({ ...SEASONS, weeksShown: 20 }), seasonLog(), '2026-09-14',
    );
    const track = plan.weeks.filter(w => w.startDate >= '2026-09-07' && w.note === 'maintain');
    expect(track.length).toBeGreaterThan(0);
    // Logged XC volume was ~26/wk; the frozen pre-XC trajectory was ~21.5.
    // Track must hold near what was actually being run, not the stale value.
    expect(track[0].totalPlanned).toBeGreaterThanOrEqual(24);
  });

  it('a past season boundary is stable: later logging does not rewrite it', () => {
    // The re-anchor is evaluated AS OF the boundary, so weeks around it keep
    // their numbers as time passes and more runs are logged after it.
    const base = seasonLog();
    const later: RunState = { ...base };
    for (let d = 0; d < 5; d++) {
      const date = new Date(Date.parse('2026-09-14T12:00:00Z') + d * 86_400_000)
        .toISOString().slice(0, 10);
      later[date] = run(date, 9.0);   // a big week logged AFTER the boundary
    }
    const at = (rs: RunState, today: string) =>
      resolveEffectivePlan(settings({ ...SEASONS, weeksShown: 20 }), rs, today)
        .plan.weeks.find(w => w.startDate === '2026-09-07')!.totalPlanned;
    expect(at(later, '2026-09-21')).toBeCloseTo(at(base, '2026-09-14'), 5);
  });
});

describe('missed-day card agrees with the engine', () => {
  const staticPlan = (rs: RunState, today: string) => resolveEffectivePlan(null, rs, today);

  it('a lightly-missed down week is still reassuring', () => {
    // Static W4 (Jul 20) is a 21 mi down week. Missing one 4 mi day leaves 81%,
    // above the re-entry trigger — nothing is cut, so "that's fine" is true.
    const rs: RunState = {
      '2026-07-20': run('2026-07-20', 4.0),
      '2026-07-22': run('2026-07-22', 4.0),
    };
    const week = staticPlan(rs, '2026-07-23').plan.dateToWeek.get('2026-07-23')!;
    expect(week.isDownWeek).toBe(true);
    expect(assessMissedDays(week, rs, '2026-07-23', { flare: false })!.kind).toBe('downweek');
  });

  it('a heavily-missed down week does NOT promise "nothing to make up"', () => {
    // Same down week, but only 4.5 of 21 run (21%) — the re-entry anchor WILL
    // cut the trajectory, so the card must not claim otherwise.
    const rs: RunState = { '2026-07-20': run('2026-07-20', 4.5) };
    const week = staticPlan(rs, '2026-07-24').plan.dateToWeek.get('2026-07-24')!;
    expect(week.isDownWeek).toBe(true);
    const a = assessMissedDays(week, rs, '2026-07-24', { flare: false })!;
    expect(a.kind).not.toBe('downweek');
    expect(a.detail).not.toMatch(/nothing to make up/i);
  });
});

describe('✓-done days are visible to every consumer', () => {
  it('weeklyActuals credits a done day at its prescription when a lookup is given', () => {
    const rs: RunState = {
      '2026-07-06': run('2026-07-06', null, { done: true }),
      '2026-07-07': run('2026-07-07', 4.5),
    };
    expect(weeklyActuals(rs, '2026-07-10')[0].miles).toBeCloseTo(4.5, 5);      // actuals only
    expect(weeklyActuals(rs, '2026-07-10', () => 4)[0].miles).toBeCloseTo(8.5, 5);
    expect(weeklyActuals(rs, '2026-07-10', () => 4)[0].runCount).toBe(2);
  });

  it('a week logged entirely with ✓ is not read as "you missed last week"', () => {
    const globals = { painCap: 3, speedState: 0, acceptedWeeks: {}, painTrackingSince: null,
      delayUntil: null, races: [] } as unknown as GlobalState;
    const rs: RunState = {};
    for (let d = 0; d < 5; d++) {
      const date = new Date(Date.parse('2026-07-06T12:00:00Z') + d * 86_400_000)
        .toISOString().slice(0, 10);
      rs[date] = run(date, null, { done: true });     // ticked, never typed
    }
    const blind = generateNextWeek({ runState: rs, globals, today: '2026-07-12' });
    const seeing = generateNextWeek({
      runState: rs, globals, today: '2026-07-12', prescribedFor: () => 4.4,
    });
    // Blind: the ticked week is invisible, so it falls back to the no-history
    // floor. Seeing: the week counts and volume is built from it.
    expect(blind.notes.some(n => /No logged history/i.test(n))).toBe(true);
    expect(seeing.notes.some(n => /No logged history/i.test(n))).toBe(false);
    expect(seeing.notes.some(n => /built from your actuals/i.test(n))).toBe(true);
    expect(seeing.totalMiles).toBeGreaterThan(blind.totalMiles);
  });
});

describe('drafts never contradict the plan', () => {
  const globals = { painCap: 3, speedState: 0, acceptedWeeks: {}, painTrackingSince: null,
    delayUntil: null, races: [] } as unknown as GlobalState;
  function log(): RunState {
    const rs: RunState = {};
    for (let w = 0; w < 3; w++) for (let d = 0; d < 5; d++) {
      const date = new Date(Date.parse('2026-06-29T12:00:00Z') + (w * 7 + d) * 86_400_000)
        .toISOString().slice(0, 10);
      rs[date] = run(date, 5.2);      // ~26 mi/wk, trending up
    }
    return rs;
  }

  it('a draft is capped at the plan target for that week (a season hold binds)', () => {
    const p = generateNextWeek({
      runState: log(), globals, today: '2026-07-19',
      settings: settings({ xcStartDate: '2026-06-29' }),
      planTarget: 24,
    });
    expect(p.totalMiles).toBeLessThanOrEqual(24 + 1e-9);
    expect(p.notes.some(n => /plan's target for this week/i.test(n))).toBe(true);
  });

  it('the plan\'s down-week verdict decides the draft\'s cadence', () => {
    const base = { runState: log(), globals, today: '2026-07-19', settings: settings() };
    expect(generateNextWeek({ ...base, planIsDownWeek: true }).isDownWeek).toBe(true);
    expect(generateNextWeek({ ...base, planIsDownWeek: false }).isDownWeek).toBe(false);
  });
});

describe('catch-up placement', () => {
  it('a 3-day week puts the catch-up on Saturday, not the day after the long run', () => {
    // Volumes chosen so the missed day is worth a run at all (a sub-1.5 mi
    // remainder is deliberately never suggested).
    const raw = settings({ daysPerWeek: 3, startMpw: 18, peakMpw: 20, trailingLongest: 5.5 });
    const rs: RunState = { '2026-07-06': run('2026-07-06', 6.0) };   // Tue missed
    const { plan } = resolveEffectivePlan(raw, rs, '2026-07-08');
    const week = plan.dateToWeek.get('2026-07-08')!;
    expect(week.runDays).toHaveLength(3);                            // Mon–Wed
    const a = assessMissedDays(week, rs, '2026-07-08', {
      flare: false, breach: false, inSeason: false, nextLong: 6,
    })!;
    expect(a.catchup?.dayLabel).toBe('Sat');
    expect(a.catchup?.date).toBe('2026-07-11');
  });
});
