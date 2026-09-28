// Checking a proposed plan change before it's saved. Moving days, swapping
// them, and cutting miles are always fine. Adding miles past the engine's
// own limits is refused with the reason. An injury always wins.
import { addDays, dayName, fmtShort, weekStart } from './dates.ts';
import { injuryStatus } from './injury.ts';
import { planWeek, type PlannedDay } from './plan.ts';
import { RULES } from './rules.ts';
import type { ISODate, PlanOverride, RunnerData } from './types.ts';

export interface ProposedChange {
  date: ISODate;
  kind: PlanOverride['kind'];
  miles?: number | null;
  note?: string | null;
}

export interface ChangePreview {
  ok: boolean;
  errors: string[];
  warnings: string[];
  weeks: {
    start: ISODate;
    before: { total: number | null; days: string[] };
    after: { total: number | null; days: string[] };
  }[];
  overrides: PlanOverride[];
}

const dayText = (d: PlannedDay) =>
  `${dayName(d.date)} ${fmtShort(d.date)}: ${d.label}${d.miles ? ` ${d.miles} mi` : ''}${d.override ? ' (changed)' : ''}`;
const total = (days: PlannedDay[]) => Math.round(days.reduce((s, d) => s + (d.kind === 'cross' ? 0 : d.miles ?? 0), 0) * 10) / 10;
const HARD = new Set(['long', 'workout', 'team', 'meet']);

export function previewChanges(data: RunnerData, today: ISODate, changes: ProposedChange[], source: 'app' | 'claude'): ChangePreview {
  const errors: string[] = [];
  const warnings: string[] = [];
  const horizon = addDays(today, 7 * 8);
  const active = data.injuries.find(i => i.status === 'active');
  const inj = active ? injuryStatus(active, data.checkins, today) : null;

  for (const c of changes) {
    if (c.date < today) errors.push(`${fmtShort(c.date)} is in the past. Past days are what you actually ran; log or fix runs instead.`);
    if (c.date > horizon) errors.push(`${fmtShort(c.date)} is more than 8 weeks away. Change it closer to the day.`);
    if ((c.kind === 'easy' || c.kind === 'long' || c.kind === 'workout') && c.miles != null && !(c.miles > 0)) errors.push(`${fmtShort(c.date)}: miles must be more than 0.`);
    if (inj && (inj.mode === 'paused' || inj.mode === 'cross' || inj.mode === 'comeback') && c.kind !== 'rest' && c.kind !== 'cross') {
      errors.push(`${fmtShort(c.date)}: ${inj.headline.toLowerCase()} is active, so only rest or cross-training can be planned. The injury plan comes first.`);
    }
    if (c.kind === 'workout' && data.speedLevel < 3 && !data.seasons.some(s => s.startDate <= c.date && (!s.endDate || s.endDate >= c.date))) {
      errors.push(`${fmtShort(c.date)}: workouts unlock at speed level 3. Right now it's level ${data.speedLevel}.`);
    }
  }

  const merged = new Map((data.overrides ?? []).map(o => [o.date, o]));
  for (const c of changes) merged.set(c.date, { date: c.date, kind: c.kind, miles: c.miles ?? null, note: c.note ?? null, source });
  const after: RunnerData = { ...data, overrides: [...merged.values()] };

  const weeks = [...new Set(changes.map(c => weekStart(c.date)))].sort();
  const out: ChangePreview['weeks'] = [];
  for (const w of weeks) {
    const b = planWeek(data, w, today);
    const a = planWeek(after, w, today);
    for (const d of a.days) {
      if (!changes.some(c => c.date === d.date)) continue;
      if ((d.miles ?? 0) > a.longCap) errors.push(`${fmtShort(d.date)}: ${d.miles} mi is longer than your long-run limit this week (${a.longCap} mi, about 10% past your longest recent run).`);
    }
    const base = b.baseTarget ?? b.target;
    const limit = base == null ? null : b.phase.kind === 'coach' ? Math.round(base * 1.1 * 2) / 2 : base;
    const newTotal = total(a.days);
    if (limit != null && newTotal > limit + 0.5) {
      errors.push(`Week of ${fmtShort(w)}: ${newTotal} mi is more than the plan allows (${limit} mi). Move miles between days or cut some instead.`);
    }
    for (let i = 1; i < a.days.length; i++) {
      const x = a.days[i - 1], y = a.days[i];
      if (HARD.has(x.kind) && HARD.has(y.kind) && (changes.some(c => c.date === x.date) || changes.some(c => c.date === y.date))) {
        warnings.push(`${dayName(x.date)} and ${dayName(y.date)} are both hard days. Back-to-back hard days raise injury risk.`);
      }
    }
    const runs = a.days.filter(d => d.miles && d.kind !== 'cross').length;
    if (runs > data.profile.daysPerWeek) warnings.push(`Week of ${fmtShort(w)} now has ${runs} runs; you usually run ${data.profile.daysPerWeek} days.`);
    out.push({
      start: w,
      before: { total: b.target, days: b.days.map(dayText) },
      after: { total: a.target, days: a.days.map(dayText) },
    });
  }
  const small = changes.filter(c => c.miles != null && c.miles < RULES.MIN_RUN_MI && c.kind !== 'rest' && c.kind !== 'cross');
  if (small.length) warnings.push('Runs under 2 miles are fine, but a rest day might do more good.');
  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], weeks: out, overrides: changes.map(c => merged.get(c.date)!) };
}
