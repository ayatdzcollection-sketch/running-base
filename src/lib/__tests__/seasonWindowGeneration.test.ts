// ============================================================
// SEASON WINDOW + GENERATION CONTEXT — regression guards.
//
// Three defects are locked down here. Each test below FAILS against the
// pre-fix code:
//
//  1. generateWeeks skipped already-accepted weeks WITHOUT seeding its chaining
//     context, so weeklyActuals (which omits empty weeks rather than zeroing
//     them) never saw them. The next proposal took the "you missed last week"
//     branch and resumed FLAT instead of building.
//  2. Planned weeks were written into the SAME log the safety reads consult.
//     painFreeStreak counts any entry with `done || miles_actual != null`,
//     treats unlogged pain as pain-free, and has no upper date bound — so
//     simulated future weeks manufactured a pain-free streak and unlocked
//     strides that the athlete's real history had not earned.
//  3. The XC season was a ONE-WAY DOOR (`date >= xcStartDate`), so once it
//     opened the plan maintained forever and never resumed building.
// ============================================================

import { describe, it, expect } from 'vitest';
import { generateWeeks, generateNextWeek } from '../generator';
import { defaultGlobalState } from '../migrate';
import {
  defaultSettings, buildWeekConfigsFromSettings, seasonResumeTraj, isSeasonWeek, seasonTransition,
} from '../settings';
import { resolveEffectivePlan } from '../planOverlay';
import { inSeason, evaluateSpeedGuard } from '../speedGuard';
import {
  normalizedSeasons, isSeasonDate, addDaysStr, currentSeason, nextSeasonStart, lastEndedSeason,
} from '../metrics';
import { TUNABLES } from '../../config/tunables';
import type { GlobalState, ProposedDay, RawSettings, RunState } from '../types';

const NOW = '2026-07-07T12:00:00Z';
const TODAY = '2026-07-07'; // Tuesday

function run(date: string, miles: number, extra: Partial<RunState[string]> = {}): RunState[string] {
  return { date, done: true, miles_actual: miles, updated_at: date + 'T12:00:00Z', ...extra };
}
function globals(patch: Partial<GlobalState> = {}): GlobalState {
  return { ...defaultGlobalState(NOW), ...patch };
}
function raw(patch: Partial<RawSettings> = {}): RawSettings {
  return { ...defaultSettings(NOW), ...patch };
}

/** Week 1 complete (~20.2 mi), week 2 has one run logged. */
const LOG: RunState = {
  '2026-06-26': run('2026-06-26', 3.0),
  '2026-06-29': run('2026-06-29', 4.0),
  '2026-06-30': run('2026-06-30', 4.0),
  '2026-07-01': run('2026-07-01', 4.0),
  '2026-07-02': run('2026-07-02', 3.7),
  '2026-07-03': run('2026-07-03', 4.5),
  '2026-07-06': run('2026-07-06', 4.5),
};

/** A confirmed week for the upcoming Monday, at a clearly higher volume. */
function acceptedWeek(weekStart: string, easy: number, long: number): ProposedDay[] {
  const days: ProposedDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysStr(weekStart, i);
    if (i < 4) days.push({ date, dayLabel: 'D', kind: 'easy', miles: easy, why: 'x' });
    else if (i === 4) days.push({ date, dayLabel: 'D', kind: 'long', miles: long, why: 'x' });
    else days.push({ date, dayLabel: 'D', kind: 'rest', miles: null, why: 'x' });
  }
  return days;
}

// ── 1. Accepted weeks are CONTEXT for the next proposal ──────

describe('generateWeeks uses accepted weeks as volume context', () => {
  it('does NOT emit "missed last week" for the week after a confirmed week', () => {
    const ws = '2026-07-13';
    const g = globals({ acceptedWeeks: { [ws]: acceptedWeek(ws, 5, 6) } });
    const { proposals } = generateWeeks({ runState: LOG, globals: g, today: TODAY, count: 3 });

    // The accepted week is skipped (never re-proposed) …
    expect(proposals.some(p => p.weekStart === ws)).toBe(false);
    // … but the week AFTER it must not think training stopped.
    const next = proposals.find(p => p.weekStart === '2026-07-20');
    expect(next).toBeDefined();
    expect(next!.notes.join(' ')).not.toMatch(/missed last week/i);
  });

  it('builds FROM the accepted week rather than flattening back to the last logged week', () => {
    const ws = '2026-07-13';
    // Accepted week ≈ 26 mi, well above the ~20 mi actually logged.
    const g = globals({ acceptedWeeks: { [ws]: acceptedWeek(ws, 5, 6) } });
    const withAccepted = generateWeeks({ runState: LOG, globals: g, today: TODAY, count: 3 })
      .proposals.find(p => p.weekStart === '2026-07-20')!;
    const without = generateWeeks({ runState: LOG, globals: globals(), today: TODAY, count: 3 })
      .proposals.find(p => p.weekStart === '2026-07-20')!;

    // With a 26 mi week confirmed in between, the following week must be larger
    // than the one produced when nothing was confirmed. Pre-fix these were equal
    // (the accepted week was invisible), which is the bug.
    expect(withAccepted.totalMiles).toBeGreaterThan(without.totalMiles);
  });

  it('ladders the long run FROM the confirmed week, not from the last logged run', () => {
    const ws = '2026-07-13';
    const g = globals({ acceptedWeeks: { [ws]: acceptedWeek(ws, 5, 6) } });
    const longOf = (gg: GlobalState) =>
      generateWeeks({ runState: LOG, globals: gg, today: TODAY, count: 3 })
        .proposals.find(p => p.weekStart === '2026-07-20')!
        .days.find(d => d.kind === 'long')!.miles!;

    // Differential: the confirmed week's 6.0 mi long run becomes the ladder base,
    // so the following week steps above it — strictly further than when no week
    // was confirmed and the ladder restarts from the 4.5 mi actually logged.
    expect(longOf(g)).toBeGreaterThan(longOf(globals()));
    expect(longOf(g)).toBeGreaterThanOrEqual(6);
  });
});

// ── 2. Plan context is NOT training evidence ─────────────────

describe('planned weeks never count as training evidence', () => {
  it('does not manufacture a pain-free streak that unlocks strides', () => {
    // Real history: a pain breach 2 days ago, so the live pain-free streak is
    // SHORT and strides must stay off for the whole batch. Pre-fix, each
    // simulated week added ~5 fake pain-free runs to the scratch log, so by
    // week 2-3 the streak cleared STRIDES_MIN_STREAK and strides appeared.
    const painful: RunState = {
      ...LOG,
      '2026-07-06': run('2026-07-06', 4.5, { painDuring: 5, painNextAM: 4 }),
    };
    const g = globals({
      speedState: 3,                       // strides tier unlocked …
      painTrackingSince: '2026-06-01',
      hipSafeFlag: true,
    });
    const { proposals } = generateWeeks({ runState: painful, globals: g, today: TODAY, count: 4 });

    for (const p of proposals) {
      expect(p.days.every(d => !d.strides)).toBe(true);
    }
  });

  it('leaves the caller run log unmutated', () => {
    const ws = '2026-07-13';
    const g = globals({ acceptedWeeks: { [ws]: acceptedWeek(ws, 5, 6) } });
    const snapshot = JSON.stringify(LOG);
    generateWeeks({ runState: LOG, globals: g, today: TODAY, count: 4 });
    expect(JSON.stringify(LOG)).toBe(snapshot);
  });

  it('planContext changes volume but never the safety-gated stride decision', () => {
    const g = globals({ speedState: 3, painTrackingSince: '2026-06-01', hipSafeFlag: true });
    const plain = generateNextWeek({ runState: LOG, globals: g, today: TODAY });
    const withCtx = generateNextWeek({
      runState: LOG,
      planContext: { ...LOG, '2026-07-08': run('2026-07-08', 6), '2026-07-09': run('2026-07-09', 6) },
      globals: g, today: TODAY,
    });
    // Same real evidence → same stride verdict, regardless of plan context.
    expect(withCtx.days.some(d => !!d.strides)).toBe(plain.days.some(d => !!d.strides));
  });
});

// ── 3. The season is a WINDOW, not a one-way door ────────────

describe('season window', () => {
  it('a blank end date is open-ended (byte-identical to the old behavior)', () => {
    const s = { xcStartDate: '2026-08-17', xcEndDate: null };
    expect(isSeasonDate(s, '2026-08-16')).toBe(false);
    expect(isSeasonDate(s, '2026-08-17')).toBe(true);
    expect(isSeasonDate(s, '2027-06-01')).toBe(true); // forever, as before
  });

  it('closes the season after the end date', () => {
    const s = { xcStartDate: '2026-08-17', xcEndDate: '2026-11-07' };
    expect(isSeasonDate(s, '2026-08-17')).toBe(true);
    expect(isSeasonDate(s, '2026-11-07')).toBe(true);   // inclusive
    expect(isSeasonDate(s, '2026-11-08')).toBe(false);  // resumed
  });

  it('ignores an end date typed BEFORE the start rather than cancelling the season', () => {
    const s = { xcStartDate: '2026-08-17', xcEndDate: '2026-01-01' };
    expect(normalizedSeasons(s)[0].endDate).toBeNull();
    expect(isSeasonDate(s, '2026-09-01')).toBe(true); // still in season
  });

  it('no start date = no season at all', () => {
    expect(isSeasonDate({ xcStartDate: '', xcEndDate: '2026-11-07' }, '2026-09-01')).toBe(false);
    expect(normalizedSeasons(null)).toHaveLength(0);
  });

  it('speedGuard.inSeason honors the window', () => {
    const settings = raw({ xcStartDate: '2026-08-17', xcEndDate: '2026-11-07' });
    expect(inSeason(settings, '2026-09-01')).toBe(true);
    expect(inSeason(settings, '2026-11-20')).toBe(false);
  });
});

describe('the plan resumes building after the season ends', () => {
  const START = '2026-07-06';

  it('stops maintaining once the window closes', () => {
    const eff = raw({
      startDate: START, startMpw: 20, peakMpw: 34, buildStep: 1.5, weeksShown: 24,
      xcStartDate: '2026-08-17', xcEndDate: '2026-10-05',
    });
    const cfgs = buildWeekConfigsFromSettings(eff);
    const noteAt = (weekStart: string) =>
      cfgs[Math.round((Date.parse(weekStart) - Date.parse(START)) / (7 * 86_400_000))]?.note;

    expect(noteAt('2026-08-17')).toBe('maintain');  // in season
    expect(noteAt('2026-09-28')).toBe('maintain');  // still in season
    // First Monday after the close: no longer maintaining.
    expect(noteAt('2026-10-12')).not.toBe('maintain');
  });

  it('never leaves every post-season week frozen at the same total (the one-way-door bug)', () => {
    const eff = raw({
      startDate: START, startMpw: 20, peakMpw: 34, buildStep: 1.5, weeksShown: 24,
      xcStartDate: '2026-08-17', xcEndDate: '2026-10-05',
    });
    const cfgs = buildWeekConfigsFromSettings(eff);
    const total = (c: (typeof cfgs)[number]) => c.miles.reduce((a, b) => a + b, 0);
    const post = cfgs.slice(15).map(total);          // weeks well past the close
    expect(new Set(post).size).toBeGreaterThan(1);   // it moves again
  });

  it('open-ended season never resumes building (unchanged behavior)', () => {
    const eff = raw({
      startDate: START, startMpw: 20, peakMpw: 34, buildStep: 1.5, weeksShown: 24,
      xcStartDate: '2026-08-17', xcEndDate: null,
    });
    const cfgs = buildWeekConfigsFromSettings(eff);
    const seasonIdx = Math.round(
      (Date.parse('2026-08-17') - Date.parse(START)) / (7 * 86_400_000),
    );
    // Every week from the season start onward is a hold: either 'maintain', or a
    // scheduled absorption week (isDown wins over isMaint in stepWeek). What must
    // NEVER appear is a plain BUILD week (note undefined) or a new 'peak'.
    for (const c of cfgs.slice(seasonIdx)) {
      expect(['maintain', 'down week']).toContain(c.note);
    }
  });
});

// ── 3b. Multiple seasons: XC → break → build → track ─────────

describe('multi-season (XC + track)', () => {
  const TWO = {
    seasons: [
      { id: 'xc', label: 'XC', startDate: '2026-08-17', endDate: '2026-11-07' },
      { id: 'tr', label: 'Track', startDate: '2027-03-01', endDate: '2027-05-22' },
    ],
  };

  it('is in season during each window and building between them', () => {
    expect(currentSeason(TWO, '2026-09-01')?.label).toBe('XC');
    expect(currentSeason(TWO, '2026-12-15')).toBeNull();      // building
    expect(currentSeason(TWO, '2027-04-01')?.label).toBe('Track');
  });

  it('exposes the NEXT season start as the build deadline', () => {
    expect(nextSeasonStart(TWO, '2026-11-20')).toBe('2027-03-01');
    expect(nextSeasonStart(TWO, '2027-06-01')).toBeNull();    // nothing scheduled
  });

  it('an OPEN-ENDED season implicitly closes the day before the next starts', () => {
    const openXc = {
      seasons: [
        { id: 'xc', label: 'XC', startDate: '2026-08-17', endDate: null },
        { id: 'tr', label: 'Track', startDate: '2027-03-01', endDate: null },
      ],
    };
    // Without the implicit close, an open-ended XC would swallow track forever.
    expect(normalizedSeasons(openXc)[0].endDate).toBe('2027-02-28');
    expect(currentSeason(openXc, '2027-04-01')?.label).toBe('Track');
  });

  it('clamps an explicit end that overruns the next season start', () => {
    const overlap = {
      seasons: [
        { id: 'xc', label: 'XC', startDate: '2026-08-17', endDate: '2027-06-01' },
        { id: 'tr', label: 'Track', startDate: '2027-03-01', endDate: null },
      ],
    };
    expect(normalizedSeasons(overlap)[0].endDate).toBe('2027-02-28');
  });

  it('sorts out-of-order seasons', () => {
    const reversed = {
      seasons: [
        { id: 'tr', label: 'Track', startDate: '2027-03-01', endDate: '2027-05-22' },
        { id: 'xc', label: 'XC', startDate: '2026-08-17', endDate: '2026-11-07' },
      ],
    };
    expect(normalizedSeasons(reversed).map(s => s.label)).toEqual(['XC', 'Track']);
  });

  it('reports the season that just ended (drives the break prompt)', () => {
    expect(lastEndedSeason(TWO, '2026-11-12')?.label).toBe('XC');
    expect(lastEndedSeason(TWO, '2026-09-01')).toBeNull();    // XC still running
  });

  it('legacy xcStartDate/xcEndDate still works when no list is set', () => {
    const legacy = { xcStartDate: '2026-08-17', xcEndDate: '2026-11-07' };
    expect(currentSeason(legacy, '2026-09-01')?.label).toBe('XC');
    expect(currentSeason(legacy, '2026-11-20')).toBeNull();
  });
});

describe('post-season break advice', () => {
  const s = () => raw({
    seasons: [
      { id: 'xc', label: 'XC', startDate: '2026-08-17', endDate: '2026-11-07' },
      { id: 'tr', label: 'Track', startDate: '2027-03-01', endDate: '2027-05-22' },
    ],
  });

  it('recommends a break right after a season ends, and names the next one', () => {
    const t = seasonTransition(s(), '2026-11-09', null)!;
    expect(t).not.toBeNull();
    expect(t.endedLabel).toBe('XC');
    expect(t.daysOff).toBe(TUNABLES.SEASON_BREAK_DAYS_OFF);
    expect(t.nextLabel).toBe('Track');
    expect(t.buildWeeks).toBeGreaterThan(10);   // Nov → Mar runway
    expect(t.message).toMatch(/Track/);
  });

  it('stays quiet during the season', () => {
    expect(seasonTransition(s(), '2026-09-15', null)).toBeNull();
  });

  it('stays quiet once a break is already underway', () => {
    expect(seasonTransition(s(), '2026-11-09', '2026-11-08')).toBeNull();
  });

  it('stops nagging after the prompt window passes', () => {
    expect(seasonTransition(s(), '2027-01-15', null)).toBeNull();
  });
});

// ── 4. Coach-led work becomes visible via RPE ────────────────

describe('in-season coach-work accounting', () => {
  // The app schedules ZERO hard sessions in season, so a coach workout is
  // invisible unless the athlete's own RPE reveals it.
  const WS = '2026-07-06'; // Monday of the week containing TODAY

  function guardWith(entries: RunState, patch: Partial<GlobalState> = {}) {
    return evaluateSpeedGuard(entries, globals(patch), TODAY);
  }

  it('counts a logged RPE >= 8 session as a spent hard unit', () => {
    const log: RunState = { [WS]: run(WS, 5, { rpe: 9 }) };
    expect(guardWith(log).hardUnitsUsed).toBe(1);
  });

  it('does not count easy running', () => {
    const log: RunState = { [WS]: run(WS, 5, { rpe: 4 }) };
    expect(guardWith(log).hardUnitsUsed).toBe(0);
  });

  it('treats a missing RPE as UNKNOWN — never assumed hard, never assumed easy', () => {
    const log: RunState = { [WS]: run(WS, 5) };
    expect(guardWith(log).hardUnitsUsed).toBe(0);
  });

  it('does not double-count a race that was also logged hard', () => {
    const log: RunState = { [WS]: run(WS, 5, { rpe: 10 }) };
    const g = globals({
      races: [{ id: 'r1', date: WS, distanceMi: 3.1, timeSec: 1080, updated_at: NOW }],
    });
    // 1 race + the same day logged at RPE 10 = ONE unit, not two.
    expect(evaluateSpeedGuard(log, g, TODAY).hardUnitsUsed).toBe(1);
  });

  it('only counts sessions inside the current week', () => {
    const log: RunState = { '2026-06-29': run('2026-06-29', 5, { rpe: 9 }) };
    expect(guardWith(log).hardUnitsUsed).toBe(0);
  });

  it('can only ever SPEND budget, never grant it', () => {
    const log: RunState = {
      [WS]: run(WS, 5, { rpe: 9 }),
      '2026-07-07': run('2026-07-07', 5, { rpe: 9 }),
      '2026-07-08': run('2026-07-08', 5, { rpe: 9 }),
    };
    const g = guardWith(log);
    expect(g.hardUnitsUsed).toBe(3);
    // Budget itself is untouched by logged work — accounting never raises it.
    expect(g.hardBudget).toBeLessThanOrEqual(TUNABLES.SPEED.HARD_BUDGET_SEASON);
  });
});

describe('season-end resume re-anchors to ACTUAL volume', () => {
  it('averages recent logged weeks and caps at peakMpw', () => {
    const log: RunState = {};
    // 4 completed weeks at ~30 mi (6 mi × 5 days), well above a 20 mi start.
    for (let w = 0; w < 4; w++) {
      const ws = addDaysStr('2026-06-08', w * 7);
      for (let d = 0; d < 5; d++) log[addDaysStr(ws, d)] = run(addDaysStr(ws, d), 6);
    }
    const eff = raw({ peakMpw: 34, startMpw: 20 });
    expect(seasonResumeTraj(log, eff, '2026-07-07')).toBeCloseTo(30, 1);

    // peakMpw is a hard ceiling on the anchor.
    expect(seasonResumeTraj(log, raw({ peakMpw: 25 }), '2026-07-07')).toBeCloseTo(25, 1);
  });

  it('returns null with no logged weeks (missing = UNKNOWN, keep the frozen trajectory)', () => {
    expect(seasonResumeTraj({}, raw(), '2026-07-07')).toBeNull();
  });

  it('resumes DOWN when in-season volume was lower than the frozen trajectory', () => {
    const log: RunState = {};
    for (let w = 0; w < 4; w++) {
      const ws = addDaysStr('2026-06-08', w * 7);
      for (let d = 0; d < 3; d++) log[addDaysStr(ws, d)] = run(addDaysStr(ws, d), 3);
    }
    // ~9 mi/wk actual — the anchor must follow reality downward, not resume high.
    expect(seasonResumeTraj(log, raw({ peakMpw: 34 }), '2026-07-07')!).toBeLessThan(12);
  });

  it('isSeasonWeek matches the window used by the plan', () => {
    const eff = raw({ xcStartDate: '2026-08-17', xcEndDate: '2026-10-05' });
    expect(isSeasonWeek('2026-08-17', eff)).toBe(true);
    expect(isSeasonWeek('2026-10-12', eff)).toBe(false);
  });

  it('resolveEffectivePlan still produces a contiguous plan across a season window', () => {
    const settings = raw({
      startDate: '2026-07-06', startMpw: 20, peakMpw: 30, weeksShown: 20,
      xcStartDate: '2026-08-17', xcEndDate: '2026-10-05',
    });
    const { plan } = resolveEffectivePlan(settings, LOG, TODAY);
    expect(plan.weeks.length).toBeGreaterThan(10);
    // Weeks stay contiguous, 7 days apart, with no gap at either boundary.
    for (let i = 1; i < plan.weeks.length; i++) {
      expect(plan.weeks[i].startDate).toBe(addDaysStr(plan.weeks[i - 1].startDate, 7));
    }
  });
});
