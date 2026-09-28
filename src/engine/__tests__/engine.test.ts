import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  addDays, planWeek, snapshot, splitWeek, triage, injuryStatus, speedStatus, usualWeek, weekFacts, phaseOfWeek,
  type Activity, type RunnerData,
} from '../index.ts';

// ── helpers ──────────────────────────────────────────────────────────
const base = (over: Partial<RunnerData> = {}): RunnerData => ({
  profile: { displayName: 'T', daysPerWeek: 5, longRunDay: 5, startMpw: 20, startLongest: 5, planStart: '2026-01-05', experienceYears: 2 },
  seasons: [], meets: [], activities: [], days: [], checkins: [], injuries: [], shoes: [],
  speedLevel: 0, ...over,
});
let n = 0;
const run = (date: string, mi: number, extra: Partial<Activity> = {}): Activity =>
  ({ id: `a${n++}`, date, distanceMi: mi, kind: 'easy', source: 'manual', ...extra });

/** Run `plan` exactly: fills each week's run days with the planned miles. */
function followPlan(data: RunnerData, from: string, weeks: number, share = 1): RunnerData {
  let d = data;
  for (let i = 0; i < weeks; i++) {
    const monday = addDays(from, 7 * i);
    const p = planWeek(d, monday, monday);
    const acts = p.days.filter(x => x.miles).map(x => run(x.date, Math.round(x.miles! * share * 10) / 10));
    d = { ...d, activities: [...d.activities, ...acts] };
  }
  return d;
}
const sum = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);

// ── splitting a week ─────────────────────────────────────────────────
describe('splitWeek', () => {
  it('lands on the target, long run on its day, rest after it', () => {
    const days = splitWeek('2026-01-05', 25, 5, 5, 99);
    expect(sum(days.map(d => d.miles))).toBe(25);
    expect(days[5].kind).toBe('long');
    expect(days[6].kind).toBe('rest'); // day after the long run
    expect(days.filter(d => d.miles).length).toBe(5);
  });
  it('keeps the long run within 30% of the week and under the cap', () => {
    const days = splitWeek('2026-01-05', 40, 5, 5, 99);
    expect(days[5].miles!).toBeLessThanOrEqual(12);
    const capped = splitWeek('2026-01-05', 40, 5, 5, 8);
    expect(capped[5].miles).toBe(8);
  });
  it('drops run days rather than prescribe tiny runs', () => {
    const days = splitWeek('2026-01-05', 8, 6, 5, 99);
    for (const d of days) if (d.miles) expect(d.miles).toBeGreaterThanOrEqual(2);
  });
  it('never calls a run "long" when it is not longer than the easy days', () => {
    const days = splitWeek('2026-01-05', 20, 5, 5, 3.5);
    expect(days[5].kind).toBe('easy');
  });
});

// ── build trajectory ─────────────────────────────────────────────────
describe('build weeks', () => {
  it('a new runner builds ~10% a week with a lighter 5th week', () => {
    const d = base();
    const targets = [0, 1, 2, 3, 4].map(i => planWeek(d, addDays('2026-01-05', 7 * i), '2026-01-05').target);
    expect(targets).toEqual([20, 22, 24, 26, 22]);
  });
  it('keeps building when the runner does the plan', () => {
    const d = followPlan(base(), '2026-01-05', 5);
    const next = planWeek(d, '2026-02-09', '2026-02-09');
    expect(next.target).toBeGreaterThan(26);
    expect(next.isDown).toBe(false);
  });
  it('never climbs past the ceiling', () => {
    const d = followPlan(base({ profile: { ...base().profile, goalMpw: 24 } }), '2026-01-05', 8);
    for (let i = 0; i < 10; i++) expect(planWeek(d, addDays('2026-01-05', 7 * i), '2026-03-02').target!).toBeLessThanOrEqual(24);
  });
  it('restarts from the facts after a fully known short week (once, not compounding)', () => {
    let d = followPlan(base(), '2026-01-05', 2);         // 20, 22 done
    d = { ...d, activities: [...d.activities, ...['2026-01-19', '2026-01-20', '2026-01-22', '2026-01-23'].map(x => run(x, 3))] }; // 12 of 24
    const w4 = planWeek(d, '2026-01-26', '2026-01-26');
    expect(w4.target).toBe(12);
    const w5 = planWeek(d, '2026-02-02', '2026-01-26');
    expect(w5.target).toBeGreaterThan(12);               // grows again, no second cut
  });
  it('MISSING DATA NEVER CUTS: unknown weeks hold the plan', () => {
    const d = followPlan(base(), '2026-01-05', 3);         // 20, 22, 24, then silence
    const held = [3, 4, 5, 6].map(i => planWeek(d, addDays('2026-01-05', 7 * i), addDays('2026-01-05', 7 * i)).target!);
    for (const t of held) expect(t).toBeGreaterThanOrEqual(20);
    expect(Math.min(...held)).toBeGreaterThanOrEqual(22); // lighter week at most, never a slide
  });
  it('a partly logged week that met the target still counts as on track', () => {
    let d = followPlan(base(), '2026-01-05', 1);
    d = { ...d, activities: [...d.activities, run('2026-01-12', 12), run('2026-01-17', 11)] }; // 23 in 2 runs
    expect(weekFacts(d, '2026-01-12', '2026-01-19').reliability).toBe('partial');
    expect(planWeek(d, '2026-01-19', '2026-01-19').target).toBe(24);
  });
  it('a short partly logged week before the start never shrinks week 1', () => {
    const d = base({ activities: [run('2026-01-02', 3)] }); // one bonus run the Friday before
    expect(planWeek(d, '2026-01-05', '2026-01-05').target).toBe(20);
  });
  it('caps the plan at 15% over the biggest recent verified week', () => {
    const d = { ...base(), profile: { ...base().profile, startMpw: 40 } };
    const easy = ['2026-01-05', '2026-01-06', '2026-01-08', '2026-01-09', '2026-01-10'].map(x => run(x, 4)); // 20 verified
    const w2 = planWeek({ ...d, activities: easy }, '2026-01-12', '2026-01-12');
    expect(w2.target!).toBeLessThanOrEqual(23);
  });
});

// ── seasons ──────────────────────────────────────────────────────────
describe('school seasons', () => {
  const xc = { id: 'xc', kind: 'xc' as const, label: 'XC', startDate: '2026-08-20', endDate: '2026-11-14', workoutDays: [1, 3] };
  it('is coach mode inside the season, then a 2-week break, then builds', () => {
    expect(phaseOfWeek('2026-08-17', [xc], '2026-06-01').kind).toBe('coach'); // Thursday start counts
    expect(phaseOfWeek('2026-11-09', [xc], '2026-06-01').kind).toBe('coach');
    expect(phaseOfWeek('2026-11-16', [xc], '2026-06-01').kind).toBe('break');
    expect(phaseOfWeek('2026-11-23', [xc], '2026-06-01').kind).toBe('break');
    expect(phaseOfWeek('2026-11-30', [xc], '2026-06-01').kind).toBe('build');
  });
  it('an open-ended season stays in coach mode until the next season starts', () => {
    const open = { ...xc, endDate: null };
    const track = { id: 't', kind: 'outdoor' as const, label: 'Track', startDate: '2027-03-01', endDate: null, workoutDays: [1, 3] };
    expect(phaseOfWeek('2027-01-04', [open, track], '2026-06-01').kind).toBe('coach');
    expect(phaseOfWeek('2027-03-01', [open, track], '2026-06-01').season?.label).toBe('Track');
  });
  it('coach mode: team days, meets, no app lighter weeks, aim = usual week', () => {
    const acts: Activity[] = [];
    for (const w of ['2026-08-24', '2026-08-31', '2026-09-07']) for (const k of [0, 1, 3, 4, 5]) acts.push(run(addDays(w, k), 6));
    const d = base({ seasons: [xc], activities: acts, meets: [{ id: 'm', date: '2026-09-19', name: 'Invite' }],
      profile: { ...base().profile, planStart: '2026-06-01' } });
    const p = planWeek(d, '2026-09-14', '2026-09-14');
    expect(p.phase.kind).toBe('coach');
    expect(p.target).toBe(30);
    expect(p.isDown).toBe(false);
    expect(p.days[1].kind).toBe('team');
    expect(p.days[5].kind).toBe('meet');
  });
  it('after the break the build starts at ~60% of the in-season week', () => {
    const acts: Activity[] = [];
    for (let w = '2026-10-19'; w <= '2026-11-09'; w = addDays(w, 7)) for (const k of [0, 1, 3, 4, 5]) acts.push(run(addDays(w, k), 6));
    const d = base({ seasons: [xc], activities: acts, profile: { ...base().profile, planStart: '2026-06-01' } });
    expect(planWeek(d, '2026-11-30', '2026-11-30').target).toBe(18);
  });
});

// ── usual week ───────────────────────────────────────────────────────
describe('usual week', () => {
  it('is the median of the last 3 known weeks, and silence does not move it', () => {
    const acts = [
      ...[0, 1, 3, 4, 5].map(k => run(addDays('2026-02-02', k), 6)),  // 30
      ...[0, 1, 3, 4].map(k => run(addDays('2026-02-09', k), 3)),     // 12
      ...[0, 1, 3, 4, 5].map(k => run(addDays('2026-02-16', k), 5.6)),// 28
    ];
    const d = base({ activities: acts });
    expect(usualWeek(d, '2026-02-23', '2026-02-23').mpw).toBe(28);
    expect(usualWeek(d, '2026-02-23', '2026-05-01').mpw).toBe(28);
  });
});

// ── injury check ─────────────────────────────────────────────────────
describe('injury triage', () => {
  it('red flags always stop running', () => {
    expect(triage('shin', { pain: 2, spot: true }).outcome).toBe('stop');
    expect(triage('shin', { pain: 1, hop: true }).outcome).toBe('stop');
    expect(triage('hip', { pain: 3, groin: true, hop: true }).likely).toMatch(/stress fracture/);
    expect(triage('ankle', { pain: 2, walk4: false }).outcome).toBe('stop');
    expect(triage('back', { pain: 2, nerve: true }).outcome).toBe('stop');
    expect(triage('other', { pain: 8 }).outcome).toBe('stop');
  });
  it('follows the pain-monitoring rule without red flags', () => {
    expect(triage('shin', { pain: 1, spot: false, hop: false, warm: 'better', morning: false }).outcome).toBe('run');
    expect(triage('shin', { pain: 3, spot: false, hop: false, warm: 'better' }).outcome).toBe('easy');
    expect(triage('shin', { pain: 4, spot: false, hop: false, warm: 'better' }).outcome).toBe('easy');
    expect(triage('shin', { pain: 5, spot: false, hop: false }).outcome).toBe('cross');
    expect(triage('knee', { pain: 2, where: 'front', warm: 'worse' }).outcome).toBe('cross');
    expect(triage('shin', { pain: 4, spot: false, hop: false, warm: 'better' }).likely).toBe('Shin splints');
  });
  it('comeback moves up only after 2 good days', () => {
    const inj = { id: 'i', area: 'shin' as const, startedOn: '2026-03-01', outcome: 'cross' as const, status: 'active' as const, stage: 2, stageSince: '2026-03-05' };
    expect(injuryStatus(inj, [{ date: '2026-03-05', moment: 'post_run', pain: 2 }], '2026-03-06').shouldAdvance).toBe(false);
    const ok = injuryStatus(inj, [
      { date: '2026-03-05', moment: 'post_run', pain: 2 }, { date: '2026-03-07', moment: 'post_run', pain: 3 },
    ], '2026-03-08');
    expect(ok.shouldAdvance).toBe(true);
    const sore = injuryStatus(inj, [
      { date: '2026-03-05', moment: 'post_run', pain: 2 }, { date: '2026-03-06', moment: 'morning', pain: 5 },
      { date: '2026-03-07', moment: 'post_run', pain: 3 },
    ], '2026-03-08');
    expect(sore.goodDays).toBe(1);
  });
  it('a "stop" pauses running until a clinician clears it', () => {
    const inj = { id: 'i', area: 'hip' as const, startedOn: '2026-03-01', outcome: 'stop' as const, status: 'active' as const, stage: 0 };
    const s = snapshot(base({ injuries: [inj], activities: [run('2026-02-25', 4)] }), '2026-03-02');
    expect(s.todayPlan.kind).toBe('paused');
    expect(s.todayPlan.miles).toBeNull();
  });
});

// ── speed ladder ─────────────────────────────────────────────────────
describe('speed ladder', () => {
  const four = ['2026-03-01', '2026-03-02', '2026-03-04', '2026-03-05'].map(date => ({ date, moment: 'post_run' as const, pain: 1 }));
  it('needs 4 pain-free check-ins; unlogged pain never counts', () => {
    expect(speedStatus({ level: 0, since: null, checkins: four.slice(0, 3), injuryActive: false, inSeason: false, usualMpw: 25 }).eligible).toBe(false);
    expect(speedStatus({ level: 0, since: null, checkins: four, injuryActive: false, inSeason: false, usualMpw: 25 }).eligible).toBe(true);
  });
  it('in season only strides are added by the app; injuries pause it', () => {
    expect(speedStatus({ level: 1, since: null, checkins: four, injuryActive: false, inSeason: true, usualMpw: 30 }).eligible).toBe(false);
    expect(speedStatus({ level: 0, since: null, checkins: four, injuryActive: true, inSeason: false, usualMpw: 30 }).eligible).toBe(false);
  });
});

// ── the real log (private fixture, not committed) ────────────────────
const FIXTURE = new URL('./fixtures/private/youcef.json', import.meta.url);
describe.runIf(existsSync(FIXTURE))('real log regression', () => {
  const data = () => JSON.parse(readFileSync(FIXTURE, 'utf8')) as RunnerData;
  it('history matches the imported weeks exactly', () => {
    const s = snapshot(data(), '2026-09-28');
    const got = Object.fromEntries(s.history.map(h => [h.start, h.miles]));
    expect(got).toMatchObject({ '2026-07-06': 22.8, '2026-07-13': 25.9, '2026-07-20': 28, '2026-07-27': 23.8, '2026-08-03': 27.4,
      '2026-08-10': 20, '2026-08-17': 14, '2026-08-24': 28, '2026-08-31': 12.1, '2026-09-07': 32, '2026-09-14': 8 });
  });
  it('the Sep 16+ gap cuts nothing: coach mode holds his usual 28 for months', () => {
    for (const today of ['2026-09-28', '2026-10-16', '2026-11-20']) {
      const s = snapshot(data(), today);
      expect(s.phase.kind).toBe('coach');
      expect(s.usualMpw).toBe(28);
      expect(s.week.target).toBe(28);
      expect(s.longRun.nextCap).toBe(8.5);
    }
  });
  it('flags what needs attention, calmly', () => {
    const ids = snapshot(data(), '2026-09-28').issues.map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining(['gap', 'season-end', 'shoe-asics']));
    expect(ids).not.toContain('spike');
  });
});
