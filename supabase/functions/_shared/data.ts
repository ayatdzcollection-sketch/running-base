// Loads one runner's rows and shapes them for the engine. Every query is
// filtered by user_id: the service role bypasses RLS, so this is the guard.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { RunnerData } from './engine/index.ts';

export const num = (v: unknown) => (v == null ? null : Number(v));

export function localToday(tz: string | undefined): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts; // en-CA formats as YYYY-MM-DD
}

export async function loadRunner(db: SupabaseClient, userId: string): Promise<{ data: RunnerData; tz: string }> {
  const q = <T>(table: string, cols = '*') => db.from(table).select(cols).eq('user_id', userId) as unknown as Promise<{ data: T[] | null; error: unknown }>;
  const [p, seasons, meets, acts, days, checkins, injuries, shoes, state, tokens] = await Promise.all([
    db.from('bb_profiles').select('*').eq('user_id', userId).single(),
    q<Record<string, unknown>>('bb_seasons'),
    q<Record<string, unknown>>('bb_meets'),
    q<Record<string, unknown>>('bb_activities'),
    q<Record<string, unknown>>('bb_days'),
    q<Record<string, unknown>>('bb_checkins'),
    q<Record<string, unknown>>('bb_injuries'),
    q<Record<string, unknown>>('bb_shoes'),
    db.from('bb_state').select('*').eq('user_id', userId).maybeSingle(),
    db.from('bb_tokens').select('last_used_at').eq('user_id', userId).eq('kind', 'shortcut').is('revoked_at', null),
  ]);
  const prof = p.data as Record<string, unknown>;
  if (!prof) throw new Error('No profile for this runner');
  const settings = (prof.settings ?? {}) as Record<string, unknown>;
  const tz = (settings.timezone as string) || 'America/New_York';
  const lastWatch = (acts.data ?? []).filter(a => a.source === 'watch').map(a => String(a.date)).sort().pop();
  const today = localToday(tz);
  const watchConnected = !!lastWatch && (Date.parse(today) - Date.parse(lastWatch)) / 86_400_000 <= 14
    && (tokens.data ?? []).length > 0;

  const data: RunnerData = {
    profile: {
      displayName: String(prof.display_name ?? ''),
      birthYear: num(prof.birth_year),
      experienceYears: num(prof.experience_years),
      daysPerWeek: Number(prof.days_per_week),
      longRunDay: Number(prof.long_run_day),
      startMpw: Number(prof.start_mpw),
      startLongest: Number(prof.start_longest),
      goalMpw: num(prof.goal_mpw),
      hrEasyMax: num(prof.hr_easy_max),
      planStart: String(prof.plan_start),
    },
    seasons: (seasons.data ?? []).map(s => ({
      id: String(s.id), kind: s.kind as never, label: String(s.label ?? ''), startDate: String(s.start_date),
      endDate: (s.end_date as string) ?? null, workoutDays: (s.workout_days as number[]) ?? [],
    })),
    meets: (meets.data ?? []).map(m => ({ id: String(m.id), date: String(m.date), name: String(m.name ?? ''), distanceMi: num(m.distance_mi) })),
    activities: (acts.data ?? []).map(a => ({
      id: String(a.id), date: String(a.date), distanceMi: Number(a.distance_mi), durationS: num(a.duration_s),
      avgHr: num(a.avg_hr), maxHr: num(a.max_hr), kind: a.kind as never, source: a.source as never,
      distanceEstimated: !!a.distance_estimated, rpe: num(a.rpe), notes: (a.notes as string) ?? null,
    })),
    days: (days.data ?? []).map(d => ({ date: String(d.date), status: d.status as never })),
    checkins: (checkins.data ?? []).map(c => ({ date: String(c.date), moment: c.moment as never, pain: num(c.pain), painArea: (c.pain_area as string) ?? null, rpe: num(c.rpe) })),
    injuries: (injuries.data ?? []).map(i => ({
      id: String(i.id), area: i.area as never, startedOn: String(i.started_on), outcome: i.outcome as never,
      likely: (i.likely as string) ?? null, status: i.status as never, stage: Number(i.stage),
      stageSince: (i.stage_since as string) ?? null, clearedByClinician: !!i.cleared_by_clinician,
    })),
    shoes: (shoes.data ?? []).map(s => ({
      id: String(s.id), name: String(s.name), startDate: String(s.start_date), baseMiles: Number(s.base_miles),
      retireAt: Number(s.retire_at), retiredAt: (s.retired_at as string) ?? null,
    })),
    speedLevel: Number(state.data?.speed_level ?? 0),
    speedLevelSince: (state.data?.speed_level_since as string) ?? null,
    watchConnected,
  };
  return { data, tz };
}
