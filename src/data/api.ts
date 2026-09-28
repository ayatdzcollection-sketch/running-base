// Supabase access for the signed-in runner. RLS limits every table to the
// runner's own rows; the user_id filters here are for clarity, not safety.
import { createClient, type Session } from '@supabase/supabase-js';
import type { RunnerData } from '../engine/index.ts';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const db = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'bb-auth' } });
export const FUNCTIONS_URL = `${url}/functions/v1`;

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface ProfileRow {
  user_id: string; display_name: string; birth_year: number | null; experience_years: number | null;
  days_per_week: number; long_run_day: number; start_mpw: number; start_longest: number; goal_mpw: number | null;
  hr_easy_max: number | null; plan_start: string; onboarded: boolean; settings: Record<string, unknown>;
}
export interface SeasonRow { id: string; kind: string; label: string; start_date: string; end_date: string | null; workout_days: number[] }
export interface ShoeRow { id: string; name: string; start_date: string; base_miles: number; retire_at: number; retired_at: string | null }
export interface TokenRow { id: string; kind: 'shortcut' | 'mcp'; hint: string; created_at: string; last_used_at: string | null; revoked_at: string | null }
export interface ActivityRow {
  id: string; date: string; distance_mi: number; duration_s: number | null; avg_hr: number | null; max_hr: number | null;
  kind: string; source: string; distance_estimated: boolean; rpe: number | null; notes: string | null; start_at: string | null;
}

export interface Loaded {
  profile: ProfileRow;
  seasons: SeasonRow[];
  shoes: ShoeRow[];
  tokens: TokenRow[];
  activities: ActivityRow[];
  runner: RunnerData;
  invite: string | null;
}

const n = (v: unknown) => (v == null ? null : Number(v));

export async function loadAll(uid: string, today: string): Promise<Loaded | null> {
  const p = await db.from('bb_profiles').select('*').eq('user_id', uid).maybeSingle();
  if (!p.data) return null;
  const [seasons, meets, acts, days, checkins, injuries, shoes, state, tokens, invite] = await Promise.all([
    db.from('bb_seasons').select('*').eq('user_id', uid).order('start_date'),
    db.from('bb_meets').select('*').eq('user_id', uid),
    db.from('bb_activities').select('*').eq('user_id', uid).order('date'),
    db.from('bb_days').select('*').eq('user_id', uid),
    db.from('bb_checkins').select('*').eq('user_id', uid),
    db.from('bb_injuries').select('*').eq('user_id', uid),
    db.from('bb_shoes').select('*').eq('user_id', uid).order('start_date'),
    db.from('bb_state').select('*').eq('user_id', uid).maybeSingle(),
    db.from('bb_tokens').select('id,kind,hint,created_at,last_used_at,revoked_at').eq('user_id', uid).is('revoked_at', null),
    db.rpc('bb_my_invite'),
  ]);
  const err = [seasons, meets, acts, days, checkins, injuries, shoes, tokens].find(r => r.error)?.error;
  if (err) throw new Error(err.message);
  const prof = p.data as ProfileRow;
  const activities = (acts.data ?? []) as ActivityRow[];
  const lastWatch = activities.filter(a => a.source === 'watch').map(a => a.date).sort().pop();
  const watchConnected = !!lastWatch && (Date.parse(today) - Date.parse(lastWatch)) / 86_400_000 <= 14
    && (tokens.data ?? []).some(t => t.kind === 'shortcut');

  const runner: RunnerData = {
    profile: {
      displayName: prof.display_name, birthYear: prof.birth_year, experienceYears: n(prof.experience_years),
      daysPerWeek: prof.days_per_week, longRunDay: prof.long_run_day, startMpw: Number(prof.start_mpw),
      startLongest: Number(prof.start_longest), goalMpw: n(prof.goal_mpw), hrEasyMax: prof.hr_easy_max, planStart: prof.plan_start,
    },
    seasons: ((seasons.data ?? []) as SeasonRow[]).map(s => ({ id: s.id, kind: s.kind as never, label: s.label, startDate: s.start_date, endDate: s.end_date, workoutDays: s.workout_days ?? [] })),
    meets: (meets.data ?? []).map(m => ({ id: m.id, date: m.date, name: m.name ?? '', distanceMi: n(m.distance_mi) })),
    activities: activities.map(a => ({
      id: a.id, date: a.date, distanceMi: Number(a.distance_mi), durationS: a.duration_s, avgHr: a.avg_hr, maxHr: a.max_hr,
      kind: a.kind as never, source: a.source as never, distanceEstimated: a.distance_estimated, rpe: a.rpe, notes: a.notes,
    })),
    days: (days.data ?? []).map(d => ({ date: d.date, status: d.status })),
    checkins: (checkins.data ?? []).map(c => ({ date: c.date, moment: c.moment, pain: c.pain, painArea: c.pain_area, rpe: c.rpe })),
    injuries: (injuries.data ?? []).map(i => ({
      id: i.id, area: i.area, startedOn: i.started_on, outcome: i.outcome, likely: i.likely, status: i.status,
      stage: i.stage, stageSince: i.stage_since, clearedByClinician: i.cleared_by_clinician,
    })),
    shoes: ((shoes.data ?? []) as ShoeRow[]).map(s => ({ id: s.id, name: s.name, startDate: s.start_date, baseMiles: Number(s.base_miles), retireAt: Number(s.retire_at), retiredAt: s.retired_at })),
    speedLevel: Number(state.data?.speed_level ?? 0),
    speedLevelSince: state.data?.speed_level_since ?? null,
    watchConnected,
  };
  return {
    profile: prof, seasons: (seasons.data ?? []) as SeasonRow[], shoes: (shoes.data ?? []) as ShoeRow[],
    tokens: (tokens.data ?? []) as TokenRow[], activities, runner, invite: (invite.data as string | null) ?? null,
  };
}

// ── writes (each throws a readable Error on failure) ────────────────
const must = <T,>(r: { error: { message: string } | null; data?: T | null }) => { if (r.error) throw new Error(r.error.message); return r.data as T; };

export const api = {
  async sendCode(email: string) {
    must(await db.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true } }));
  },
  async verifyCode(email: string, token: string): Promise<Session | null> {
    const r = await db.auth.verifyOtp({ email: email.trim().toLowerCase(), token: token.trim(), type: 'email' });
    must(r);
    return r.data.session;
  },
  async redeem(code: string, name: string) { must(await db.rpc('bb_redeem_invite', { invite_code: code, name })); },
  async updateProfile(uid: string, patch: Partial<ProfileRow>) {
    must(await db.from('bb_profiles').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', uid));
  },
  async addRuns(uid: string, runs: { date: string; distance_mi: number; duration_s?: number | null; kind: string; rpe?: number | null; notes?: string | null }[]) {
    const rows = must<ActivityRow[]>(await db.from('bb_activities').insert(runs.map(r => ({ ...r, user_id: uid, source: 'manual' }))).select());
    await db.from('bb_days').delete().eq('user_id', uid).in('date', runs.map(r => r.date));
    return rows;
  },
  async updateRun(uid: string, id: string, patch: Partial<ActivityRow>) {
    must(await db.from('bb_activities').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', uid).eq('id', id));
  },
  async deleteRun(uid: string, id: string) { must(await db.from('bb_activities').delete().eq('user_id', uid).eq('id', id)); },
  async markDays(uid: string, dates: string[], status: string) {
    must(await db.from('bb_days').upsert(dates.map(date => ({ user_id: uid, date, status, updated_at: new Date().toISOString() })), { onConflict: 'user_id,date' }));
  },
  async checkIn(uid: string, c: { date: string; moment: 'post_run' | 'morning'; pain: number | null; pain_area?: string | null; rpe?: number | null; activity_id?: string | null }) {
    must(await db.from('bb_checkins').insert({ ...c, user_id: uid }));
  },
  async saveInjury(uid: string, row: { area: string; started_on: string; answers: unknown; outcome: string; likely: string | null }) {
    must(await db.from('bb_injuries').update({ status: 'resolved', updated_at: new Date().toISOString() }).eq('user_id', uid).eq('status', 'active'));
    must(await db.from('bb_injuries').insert({ ...row, user_id: uid, stage: 0, stage_since: row.started_on }));
  },
  async updateInjury(uid: string, id: string, patch: Record<string, unknown>) {
    must(await db.from('bb_injuries').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', uid).eq('id', id));
  },
  async saveSeason(uid: string, s: Partial<SeasonRow> & { start_date: string }) {
    const row = { ...s, user_id: uid, updated_at: new Date().toISOString() };
    must(s.id ? await db.from('bb_seasons').update(row).eq('user_id', uid).eq('id', s.id) : await db.from('bb_seasons').insert(row));
  },
  async deleteSeason(uid: string, id: string) { must(await db.from('bb_seasons').delete().eq('user_id', uid).eq('id', id)); },
  async addMeet(uid: string, m: { date: string; name: string; distance_mi: number | null }) { must(await db.from('bb_meets').insert({ ...m, user_id: uid })); },
  async saveShoe(uid: string, s: Partial<ShoeRow> & { name: string; start_date: string }) {
    const row = { ...s, user_id: uid, updated_at: new Date().toISOString() };
    must(s.id ? await db.from('bb_shoes').update(row).eq('user_id', uid).eq('id', s.id) : await db.from('bb_shoes').insert(row));
  },
  async setSpeedLevel(uid: string, level: number, since: string) {
    must(await db.from('bb_state').upsert({ user_id: uid, speed_level: level, speed_level_since: since, updated_at: new Date().toISOString() }));
  },
  async createToken(kind: 'shortcut' | 'mcp'): Promise<string> { return must<string>(await db.rpc('bb_create_token', { token_kind: kind })); },
  async revokeToken(uid: string, kind: 'shortcut' | 'mcp') {
    must(await db.from('bb_tokens').update({ revoked_at: new Date().toISOString() }).eq('user_id', uid).eq('kind', kind).is('revoked_at', null));
  },
  async exportAll(uid: string) {
    const tables = ['bb_profiles', 'bb_seasons', 'bb_meets', 'bb_activities', 'bb_days', 'bb_checkins', 'bb_injuries', 'bb_shoes', 'bb_state'];
    const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
    for (const t of tables) out[t] = (await db.from(t).select('*').eq('user_id', uid)).data;
    return out;
  },
};
