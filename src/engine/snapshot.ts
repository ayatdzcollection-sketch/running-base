// One call that answers everything the app and Claude need for a day.
import { addDays, daysBetween, dow, fmtRange, fmtShort, half, round1, weekStart } from './dates.ts';
import { byDate, currentGap, longRunBase, trailingLongest, usualWeek, weekFacts, type Reliability } from './facts.ts';
import { injuryStatus, type InjuryStatus } from './injury.ts';
import { planWeek, type DayKind, type PlannedDay, type WeekPlan } from './plan.ts';
import { RULES } from './rules.ts';
import { speedStatus, type SpeedStatus } from './speed.ts';
import type { Activity, ISODate, RunnerData } from './types.ts';

export type DayState = 'done' | 'today' | 'planned' | 'rest' | 'unknown' | 'skipped' | 'marked';

export interface DayView {
  date: ISODate;
  planned: PlannedDay;
  actualMiles: number;
  activities: Activity[];
  state: DayState;
  mark?: string;
}

export interface TodayView {
  date: ISODate;
  kind: DayKind | 'comeback' | 'paused' | 'cross';
  miles: number | null;
  minutes: number | null;
  title: string;
  guidance: string;
  why: string[];
  done: Activity[];
}

export interface Issue {
  id: string;
  level: 'info' | 'watch' | 'warn';
  title: string;
  detail: string;
}

export interface Snapshot {
  today: ISODate;
  phase: { kind: 'coach' | 'break' | 'build'; label: string; seasonLabel: string | null; week: number; nextSeason: { label: string; startDate: ISODate } | null };
  usualMpw: number | null;
  week: { start: ISODate; label: string; target: number | null; actual: number; isDown: boolean; days: DayView[]; why: string[] };
  todayPlan: TodayView;
  upcoming: { start: ISODate; label: string; target: number | null; isDown: boolean; kind: string; meets: string[] }[];
  history: { start: ISODate; miles: number; estimatedMiles: number; reliability: Reliability }[];
  gap: { from: ISODate; to: ISODate; days: number } | null;
  longRun: { trailing30: number | null; nextCap: number };
  speed: SpeedStatus;
  injury: InjuryStatus | null;
  shoes: { id: string; name: string; miles: number; retireAt: number; over: boolean }[];
  issues: Issue[];
}

const SEASON_NAME: Record<string, string> = { xc: 'XC', indoor: 'Indoor', outdoor: 'Outdoor track', other: 'Season' };

function dayViews(data: RunnerData, plan: WeekPlan, today: ISODate, runsByDate: Map<ISODate, Activity[]>): DayView[] {
  const marks = new Map(data.days.map(d => [d.date, d.status]));
  return plan.days.map(pd => {
    const acts = (runsByDate.get(pd.date) ?? []).filter(a => a.kind !== 'cross');
    const miles = round1(acts.reduce((s, a) => s + a.distanceMi, 0));
    const mark = marks.get(pd.date);
    let state: DayState;
    if (acts.length) state = 'done';
    else if (pd.date === today) state = 'today';
    else if (pd.date > today) state = pd.kind === 'rest' ? 'rest' : 'planned';
    else if (mark === 'skipped') state = 'skipped';
    else if (mark) state = 'marked';
    else if (pd.kind === 'rest' || pd.kind === 'free') state = 'rest';
    else state = data.watchConnected ? 'rest' : 'unknown';
    return { date: pd.date, planned: pd, actualMiles: miles, activities: acts, state, mark };
  });
}

export function snapshot(data: RunnerData, today: ISODate): Snapshot {
  const runsByDate = byDate(data);
  const monday = weekStart(today);
  const plan = planWeek(data, monday, today);
  const facts = weekFacts(data, monday, today, runsByDate);
  const usual = usualWeek(data, monday, today).mpw;

  // Injury first: it overrides today's plan.
  const active = data.injuries.filter(i => i.status === 'active').sort((a, b) => b.startedOn.localeCompare(a.startedOn))[0];
  const inj = active ? injuryStatus(active, data.checkins, today) : null;

  const days = dayViews(data, plan, today, runsByDate);
  const todayDay = days[dow(today)];
  const done = todayDay.activities;
  let todayPlan: TodayView = {
    date: today, kind: todayDay.planned.kind, miles: todayDay.planned.miles, minutes: null,
    title: todayDay.planned.label,
    guidance: todayDay.planned.kind === 'easy' || todayDay.planned.kind === 'long'
      ? data.profile.hrEasyMax ? `Talking pace. Heart rate under ${data.profile.hrEasyMax}.` : 'Talking pace: you could hold a conversation.'
      : todayDay.planned.kind === 'team' ? 'Follow your coach’s workout.' : todayDay.planned.kind === 'meet' ? 'Race day. Warm up well.' : todayDay.planned.kind === 'free' ? 'No plan today.' : 'Rest day. Sleep and eat well.',
    why: plan.why, done,
  };
  if (inj) {
    if (inj.mode === 'paused') todayPlan = { ...todayPlan, kind: 'paused', miles: null, title: 'No running today', guidance: inj.detail, why: [inj.headline] };
    else if (inj.mode === 'cross') todayPlan = { ...todayPlan, kind: 'cross', miles: null, minutes: 35, title: 'Cross-train', guidance: 'Bike, pool, or elliptical. Easy effort.', why: [inj.detail] };
    else if (inj.mode === 'easy' && todayPlan.miles) todayPlan = { ...todayPlan, miles: Math.max(RULES.MIN_RUN_MI, half(todayPlan.miles / 2)), title: 'Easy, shorter run', guidance: 'Flat ground. Stop if pain goes above 3.', why: [inj.detail] };
    else if (inj.mode === 'comeback' && inj.stage) todayPlan = { ...todayPlan, kind: 'comeback', miles: null, minutes: inj.stage.minutes, title: inj.stage.title, guidance: inj.stage.detail, why: [inj.detail] };
  }

  // Weeks ahead.
  const upcoming = [1, 2, 3, 4].map(i => {
    const s = addDays(monday, 7 * i);
    const p = planWeek(data, s, today);
    return {
      start: s, label: fmtRange(s, addDays(s, 6)), target: p.target, isDown: p.isDown,
      kind: p.phase.kind === 'coach' ? 'Coach mode' : p.phase.kind === 'break' ? 'Break' : p.isDown ? 'Lighter week' : 'Build',
      meets: p.days.filter(d => d.kind === 'meet').map(d => d.label),
    };
  });

  // History from the plan start.
  const history: Snapshot['history'] = [];
  for (let w = weekStart(data.profile.planStart); w < monday; w = addDays(w, 7)) {
    const f = weekFacts(data, w, today, runsByDate);
    history.push({ start: w, miles: f.miles, estimatedMiles: f.estimatedMiles, reliability: f.reliability });
  }

  const trailing = longRunBase(data, today);
  const nextCap = half(Math.max((trailing ?? data.profile.startLongest) * RULES.LONG_GROWTH, (trailing ?? data.profile.startLongest) + RULES.LONG_GROWTH_MIN_MI));

  const speed = speedStatus({
    level: data.speedLevel, since: data.speedLevelSince, checkins: data.checkins,
    injuryActive: !!inj, inSeason: plan.phase.kind === 'coach', usualMpw: usual,
  });

  const shoes = data.shoes.filter(s => !s.retiredAt).map(s => {
    const miles = s.baseMiles + data.activities
      .filter(a => a.kind !== 'cross' && a.date >= s.startDate)
      .reduce((t, a) => t + a.distanceMi, 0);
    return { id: s.id, name: s.name, miles: Math.round(miles), retireAt: s.retireAt, over: miles >= s.retireAt };
  });

  const gap = currentGap(data, today);
  const phase = plan.phase;
  const snap: Snapshot = {
    today,
    phase: {
      kind: phase.kind,
      label: phase.kind === 'coach' ? `${SEASON_NAME[phase.season?.kind ?? 'other']} · Coach mode` : phase.kind === 'break' ? 'Break' : 'Base · building',
      seasonLabel: phase.season?.label ?? null,
      week: Math.floor(daysBetween(phase.since, monday) / 7) + 1,
      nextSeason: phase.nextSeason ? { label: phase.nextSeason.label, startDate: phase.nextSeason.startDate } : null,
    },
    usualMpw: usual,
    week: { start: monday, label: fmtRange(monday, addDays(monday, 6)), target: plan.target, actual: facts.miles, isDown: plan.isDown, days, why: plan.why },
    todayPlan,
    upcoming,
    history,
    gap: gap && gap.days >= 2 ? gap : null,
    longRun: { trailing30: trailing, nextCap },
    speed,
    injury: inj,
    shoes,
    issues: [],
  };
  snap.issues = findIssues(data, snap);
  return snap;
}

export function findIssues(data: RunnerData, s: Snapshot): Issue[] {
  const out: Issue[] = [];
  if (s.gap && s.gap.days >= RULES.GAP_DAYS) {
    out.push({ id: 'gap', level: 'info', title: `No data for ${s.gap.days} days (${fmtRange(s.gap.from, s.gap.to)})`,
      detail: 'That never shrinks the plan. If you ran, add those runs so your usual week stays accurate.' });
  }
  const season = s.phase.kind === 'coach' ? data.seasons.find(x => x.label === s.phase.seasonLabel) : undefined;
  if (season && !season.endDate) {
    out.push({ id: 'season-end', level: 'info', title: `${season.label || 'Your season'} has no end date`,
      detail: 'Add it so the break and the next build line up.' });
  }
  const full = s.history.filter(h => h.reliability === 'full');
  if (full.length >= 2) {
    const last = full[full.length - 1];
    const before = full.slice(-4, -1).map(h => h.miles).sort((a, b) => a - b);
    const mid = before[Math.floor(before.length / 2)];
    if (mid > 0 && last.miles > mid * RULES.SPIKE && last.start === addDays(s.week.start, -7)) {
      out.push({ id: 'spike', level: 'warn', title: `Last week jumped to ${last.miles} mi`,
        detail: `That’s over 30% more than your usual ${mid}. Keep this week easy and watch for soreness.` });
    }
  }
  // Long run share and single-run jumps over the last 14 days.
  const recent = data.activities.filter(a => a.date >= addDays(s.today, -14) && a.date < s.today && a.kind !== 'cross');
  for (const a of recent) {
    const t30 = trailingLongest(data, a.date);
    if (t30 && a.distanceMi > t30 * RULES.SINGLE_RUN_WARN && a.distanceMi >= 6) {
      out.push({ id: `long-${a.date}`, level: 'watch', title: `${fmtShort(a.date)}: ${a.distanceMi} mi was a big jump`,
        detail: `Your longest run in the month before was ${t30} mi. Build long runs by about a mile at a time.` });
    }
  }
  for (const sh of s.shoes) if (sh.over) {
    out.push({ id: `shoe-${sh.id}`, level: 'info', title: `${sh.name} are at ${sh.miles} mi`,
      detail: `Past your ${sh.retireAt} mi limit. Worn shoes are a common cause of aches.` });
  }
  const pains = data.checkins.filter(c => c.date >= addDays(s.today, -7) && (c.pain ?? 0) >= 4);
  if (pains.length >= 2 && !s.injury) {
    out.push({ id: 'pain', level: 'warn', title: 'Pain showed up twice this week',
      detail: 'Do an injury check before your next run.' });
  }
  const easyHard = recent.filter(a => a.kind === 'easy' && (a.rpe ?? 0) >= 6);
  if (easyHard.length >= 3) {
    out.push({ id: 'easy-hard', level: 'watch', title: 'Easy runs are feeling hard',
      detail: 'Three easy runs rated 6+ in two weeks. Slow down, sleep more, and check in if something hurts.' });
  }
  const hrMax = data.profile.hrEasyMax;
  if (hrMax) {
    const hot = recent.filter(a => a.kind === 'easy' && (a.avgHr ?? 0) > hrMax + 5);
    if (hot.length >= 2) out.push({ id: 'easy-hr', level: 'watch', title: 'Easy runs are above your easy heart rate',
      detail: `${hot.length} easy runs averaged over ${hrMax} bpm. Slow the pace on easy days.` });
  }
  if (s.injury && s.injury.mode !== 'paused') {
    const last = data.checkins.filter(c => c.date >= s.injury!.injury.startedOn).map(c => c.date).sort().pop();
    if (!last || daysBetween(last, s.today) >= 3) out.push({ id: 'injury-checkin', level: 'watch', title: 'Check in on your injury',
      detail: 'No check-in for 3 days. The comeback plan moves only with check-ins.' });
  }
  return out;
}
