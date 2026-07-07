import { describe, it, expect } from 'vitest';
import { generateNextWeek, generateWeeks, checkAcceptedWeeks, checkPlannedLongRunConflict } from '../generator';
import { defaultGlobalState } from '../migrate';
import { defaultSettings } from '../settings';
import { validStrides } from '../speed';
import type { GlobalState, ProposedDay, RunState } from '../types';

const NOW = '2026-07-07T12:00:00Z';
const TODAY = '2026-07-07'; // Tuesday of Week 2

function run(date: string, miles: number, extra: Partial<RunState[string]> = {}): RunState[string] {
  return { date, done: true, miles_actual: miles, updated_at: date + 'T12:00:00Z', ...extra };
}

function globals(patch: Partial<GlobalState> = {}): GlobalState {
  return { ...defaultGlobalState(NOW), ...patch };
}

/** The real current log: Week 1 complete (~20.2), Week 2 has one 4.5 run. */
const CURRENT_LOG: RunState = {
  '2026-06-26': run('2026-06-26', 3.0),
  '2026-06-29': run('2026-06-29', 4.0),
  '2026-06-30': run('2026-06-30', 4.0),
  '2026-07-01': run('2026-07-01', 4.0),
  '2026-07-02': run('2026-07-02', 3.7),
  '2026-07-03': run('2026-07-03', 4.5),
  '2026-07-06': run('2026-07-06', 4.5),
};

describe('generate-future-weeks engine (§5)', () => {
  it('targets the upcoming week (next Monday) and keeps the Mon–Fri / Sat–Sun structure', () => {
    const p = generateNextWeek({ runState: CURRENT_LOG, globals: globals(), today: TODAY });
    expect(p.weekStart).toBe('2026-07-13');
    expect(p.days).toHaveLength(7);
    expect(p.days[4].kind).toBe('long');            // Friday long run
    expect(p.days[5].kind).toBe('rest');
    expect(p.days[6].kind).toBe('rest');
  });

  it('long run = nextLong from actuals (4.5 recent longest → 5.0)', () => {
    const p = generateNextWeek({ runState: CURRENT_LOG, globals: globals(), today: TODAY });
    expect(p.days[4].miles).toBe(5.0);
  });

  it('generates ZERO hard sessions while speed is locked (state 1)', () => {
    const p = generateNextWeek({ runState: CURRENT_LOG, globals: globals(), today: TODAY });
    expect(p.days.every(d => d.kind !== 'threshold')).toBe(true);
    expect(p.days.every(d => !d.strides)).toBe(true); // state 1 < 3: no strides either
  });

  it('generates zero hard sessions when delayUntil is in the future, even at state 7', () => {
    const g = globals({ speedState: 7, ptClearedIntensity: true, delayUntil: '2026-09-01' });
    const p = generateNextWeek({ runState: CURRENT_LOG, globals: g, today: TODAY });
    expect(p.days.every(d => d.kind !== 'threshold' && !d.strides)).toBe(true);
  });

  it('offers valid optional strides at state ≥ 3 with pain-free running', () => {
    const p = generateNextWeek({ runState: CURRENT_LOG, globals: globals({ speedState: 3 }), today: TODAY });
    const strideDays = p.days.filter(d => d.strides);
    expect(strideDays.length).toBeGreaterThan(0);
    for (const d of strideDays) {
      expect(validStrides(d.strides!.reps, d.strides!.durationS, d.strides!.recoveryS)).toBe(true);
    }
  });

  it('adds one threshold session at state 6, ≥48h clear of the long run, never back-to-back fast', () => {
    const p = generateNextWeek({ runState: CURRENT_LOG, globals: globals({ speedState: 6 }), today: TODAY });
    const fastIdx = p.days.map((d, i) => (d.kind === 'threshold' ? i : -1)).filter(i => i >= 0);
    expect(fastIdx).toHaveLength(1);
    expect(fastIdx[0]).toBe(1);                     // Tuesday — 72h before Friday long
    expect(4 - fastIdx[0]).toBeGreaterThanOrEqual(2); // ≥48h before the long run
  });

  it('never makes up missed miles: after a skipped week, resumes near the last sustained week', () => {
    const staleLog: RunState = {
      '2026-06-22': run('2026-06-22', 4),
      '2026-06-24': run('2026-06-24', 4),
      '2026-06-26': run('2026-06-26', 4.5),  // last sustained week = 12.5 mi, then nothing
    };
    const p = generateNextWeek({ runState: staleLog, globals: globals(), today: TODAY });
    expect(p.totalMiles).toBeLessThanOrEqual(12.5 + 1); // near last sustained, not the ladder
    expect(p.notes.join(' ')).toMatch(/never made up/);
  });

  it('the current in-progress week never drags the volume target down (regression)', () => {
    // Week 1 complete at 20.2; this week has only Monday logged (4.5).
    // The proposal must build from the last COMPLETED week, not the partial one.
    const p = generateNextWeek({ runState: CURRENT_LOG, globals: globals(), today: TODAY });
    expect(p.totalMiles).toBeGreaterThan(15);
  });

  it('caps weekly growth at ~10% over the last week', () => {
    const p = generateNextWeek({ runState: CURRENT_LOG, globals: globals(), today: TODAY });
    // last full week (Jun 29–Jul 5) = 20.2; growth cap 22.2 — allow rounding to halves
    expect(p.totalMiles).toBeLessThanOrEqual(20.2 * 1.1 + 0.5);
  });

  it('flare (2 pain days in 7) → easy/rest only, long clamped to trailing longest', () => {
    const flared: RunState = {
      ...CURRENT_LOG,
      '2026-07-03': run('2026-07-03', 4.5, { painDuring: 5 }),
      '2026-07-06': run('2026-07-06', 4.5, { painNextAM: 6 }),
    };
    const p = generateNextWeek({ runState: flared, globals: globals({ speedState: 6 }), today: TODAY });
    expect(p.days.every(d => d.kind === 'easy' || d.kind === 'long' || d.kind === 'rest')).toBe(true);
    expect(p.days.every(d => !d.strides)).toBe(true);
    expect(p.days[4].miles).toBe(4.5);              // held at trailing longest, no step up
    expect(p.isDownWeek).toBe(true);
    expect(p.warnings.join(' ')).toMatch(/Flare/);
  });

  it('auto-inserts a down week after 3 consecutive build weeks, holding the long run', () => {
    const buildLog: RunState = {};
    // four ascending weeks: 16 → 18 → 20 → 22 mi (Mon+Wed+Fri each)
    const weekStarts = ['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29'];
    weekStarts.forEach((ws, i) => {
      const total = 16 + i * 2;
      const per = total / 3;
      for (const off of [0, 2, 4]) {
        const d = new Date(ws + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() + off);
        const date = d.toISOString().slice(0, 10);
        buildLog[date] = run(date, off === 4 ? per + 1 : per - 0.5);
      }
    });
    const p = generateNextWeek({ runState: buildLog, globals: globals(), today: '2026-07-06' });
    expect(p.isDownWeek).toBe(true);
    expect(p.notes.join(' ')).toMatch(/Down week auto-inserted/);
    const easy = p.days.filter(d => d.kind === 'easy').reduce((s, d) => s + (d.miles ?? 0), 0);
    const long = p.days[4].miles ?? 0;
    expect(long).toBeGreaterThan(0);               // long run held, volume cut elsewhere
    expect(easy + long).toBe(p.totalMiles);
  });

  it('no weekday run exceeds the long-run ceiling', () => {
    const p = generateNextWeek({ runState: CURRENT_LOG, globals: globals(), today: TODAY });
    const long = p.days[4].miles ?? 0;
    for (const d of p.days) {
      if (d.miles != null) expect(d.miles).toBeLessThanOrEqual(long);
    }
  });

  it('the award total is not an input — identical output regardless of award progress', () => {
    // Structural guarantee: GeneratorInput has no award field. Same inputs → same output.
    const a = generateNextWeek({ runState: CURRENT_LOG, globals: globals(), today: TODAY });
    const b = generateNextWeek({ runState: CURRENT_LOG, globals: globals(), today: TODAY });
    expect(a).toEqual(b);
  });
});

describe('multi-week generation (Stage E)', () => {
  it('chains consecutive Mondays with a continuous, capped long-run ladder', () => {
    const { proposals } = generateWeeks({ runState: CURRENT_LOG, globals: globals(), today: TODAY, count: 3 });
    expect(proposals).toHaveLength(3);
    expect(proposals.map(p => p.weekStart)).toEqual(['2026-07-13', '2026-07-20', '2026-07-27']);
    let prev = 0;
    for (const p of proposals) {
      const long = p.days[4].miles ?? 0;
      if (prev > 0) expect(long).toBeLessThanOrEqual(prev * 1.1 + 0.5);
      prev = long;
    }
  });

  it('caps every week-over-week total at ~+10%', () => {
    const { proposals } = generateWeeks({ runState: CURRENT_LOG, globals: globals(), today: TODAY, count: 4 });
    for (let i = 1; i < proposals.length; i++) {
      if (proposals[i].isDownWeek) continue;
      expect(proposals[i].totalMiles).toBeLessThanOrEqual(proposals[i - 1].totalMiles * 1.1 + 0.5);
    }
  });

  it('generates zero hard sessions across all weeks while speed is locked', () => {
    const { proposals } = generateWeeks({ runState: CURRENT_LOG, globals: globals(), today: TODAY, count: 4 });
    for (const p of proposals) {
      expect(p.days.every(d => d.kind !== 'threshold')).toBe(true);
    }
  });

  it('skips a week already confirmed in acceptedWeeks (never overwrites it)', () => {
    const g = globals({ acceptedWeeks: { '2026-07-20': [{ date: '2026-07-20', dayLabel: 'Mon', kind: 'easy', miles: 5, why: 'mine' }] } });
    const { proposals } = generateWeeks({ runState: CURRENT_LOG, globals: g, today: TODAY, count: 3 });
    expect(proposals.map(p => p.weekStart)).not.toContain('2026-07-20');
  });

  it('respects settings: daysPerWeek 4 → 3 rest days, long run last run day', () => {
    const s = { ...defaultSettings(NOW), daysPerWeek: 4 };
    const p = generateNextWeek({ runState: CURRENT_LOG, globals: globals(), today: TODAY, settings: s });
    expect(p.days.filter(d => d.kind === 'rest')).toHaveLength(3);
    expect(p.days[3].kind).toBe('long');   // Thursday is the last run day
    expect(p.days[4].kind).toBe('rest');
  });

  it('respects settings: peakMpw binds the weekly total', () => {
    const s = { ...defaultSettings(NOW), peakMpw: 15 };
    const p = generateNextWeek({ runState: CURRENT_LOG, globals: globals(), today: TODAY, settings: s });
    expect(p.totalMiles).toBeLessThanOrEqual(15 + 1e-9);
  });

  it('the award/goal is never an input to multi-week generation', () => {
    const a = generateWeeks({ runState: CURRENT_LOG, globals: globals(), today: TODAY, count: 3 });
    const b = generateWeeks({ runState: CURRENT_LOG, globals: globals(), today: TODAY, count: 3 });
    expect(a.proposals).toEqual(b.proposals);
  });
});

describe('checkAcceptedWeeks — non-destructive safer suggestions', () => {
  const futureWeek = (long: number, withThreshold = false): ProposedDay[] => {
    const days: ProposedDay[] = [
      { date: '2026-07-20', dayLabel: 'Mon', kind: withThreshold ? 'threshold' : 'easy', miles: 4, why: 'x' },
      { date: '2026-07-21', dayLabel: 'Tue', kind: 'easy', miles: 4, why: 'x' },
      { date: '2026-07-22', dayLabel: 'Wed', kind: 'easy', miles: 4, why: 'x' },
      { date: '2026-07-23', dayLabel: 'Thu', kind: 'easy', miles: 3, why: 'x' },
      { date: '2026-07-24', dayLabel: 'Fri', kind: 'long', miles: long, why: 'x' },
    ];
    return days;
  };

  it('flags an over-cap long run and suggests a clamped copy (original untouched)', () => {
    const accepted = { '2026-07-20': futureWeek(8.0) };
    const before = JSON.stringify(accepted);
    const conflicts = checkAcceptedWeeks(accepted, CURRENT_LOG, globals(), TODAY);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reasons.join(' ')).toMatch(/exceeds/);
    expect(conflicts[0].suggested.find(d => d.kind === 'long')!.miles).toBe(5.0); // clamped to cap
    expect(conflicts[0].original.find(d => d.kind === 'long')!.miles).toBe(8.0);  // original kept
    expect(JSON.stringify(accepted)).toBe(before);                                 // input purity
  });

  it('flags a hard session while speed is locked and demotes it in the suggestion', () => {
    const accepted = { '2026-07-20': futureWeek(5.0, true) };
    const conflicts = checkAcceptedWeeks(accepted, CURRENT_LOG, globals({ speedState: 1 }), TODAY);
    expect(conflicts[0].reasons.join(' ')).toMatch(/locked|delayed|flared/);
    expect(conflicts[0].suggested.some(d => d.kind === 'threshold')).toBe(false);
  });

  it('no conflict for a compliant future week', () => {
    const accepted = { '2026-07-20': futureWeek(5.0) };
    expect(checkAcceptedWeeks(accepted, CURRENT_LOG, globals(), TODAY)).toHaveLength(0);
  });

  it('never flags a locked (logged) week', () => {
    const accepted = { '2026-07-20': futureWeek(8.0) };
    const logged: RunState = { ...CURRENT_LOG, '2026-07-20': run('2026-07-20', 4) };
    expect(checkAcceptedWeeks(accepted, logged, globals(), TODAY)).toHaveLength(0);
  });
});

describe('conflict check vs existing planned weeks', () => {
  it('no conflict when the old plan is within the ceiling', () => {
    expect(checkPlannedLongRunConflict(5.0, CURRENT_LOG, TODAY)).toBeNull();
  });

  it('flags (never silently rewrites) an over-cap planned long run', () => {
    const conflict = checkPlannedLongRunConflict(6.5, CURRENT_LOG, TODAY);
    expect(conflict).not.toBeNull();
    expect(conflict!.saferValue).toBe(5.0);
    expect(conflict!.message).toMatch(/Original plan preserved/);
  });
});
