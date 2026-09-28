// Claude connector: a remote MCP server (Streamable HTTP, stateless JSON).
// The runner's personal link ends in their secret code:
//   https://<project>.supabase.co/functions/v1/mcp/bb_xxxxxxxx
// It runs the same engine as the app. Every change it makes is logged in
// bb_changes with before/after rows, so the runner (or Claude) can undo it.
import { adminClient, cors, json, tokenFrom, userForToken } from '../_shared/auth.ts';
import { loadRunner, localToday } from '../_shared/data.ts';
import {
  AREA_LABEL, ENGINE_VERSION, QUESTIONS, RULES, addDays, auditEngine, fmtRange, planWeek, previewChanges,
  snapshot, traceWeek, triage, weekFacts, weekStart,
  type InjuryArea, type ProposedChange, type RunnerData, type Snapshot,
} from '../_shared/engine/index.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const PROTOCOL = '2025-06-18';
const INSTRUCTIONS = `Bulletproof Base is a high school runner's training app. You can read their plan and the engine's reasoning, log runs, add notes, change the plan, and find problems.
Tone: calm and encouraging. A day with no data is unknown, never "missed". Never scold.
Logging: log only what the runner actually said; ask before guessing a distance.
Plan changes: ALWAYS call preview_plan_change first, show the runner the before/after in plain words, get a clear yes, then call apply_plan_change with the same changes. Changes that add miles past the engine's limits are refused; explain the reason instead of trying to get around it.
Injuries: when they mention pain, run injury_questions then injury_check (it routes, it does not diagnose). "stop" means see an athletic trainer or doctor. Only use injury_update clinician_cleared when the runner says a trainer or doctor cleared them.
Engine bugs: if a number looks wrong, use trace_week and audit_plan; if it's the engine's fault, report_problem with what you saw.
Every change is logged; undo_last_change reverses the most recent one. Dates are the runner's local dates (YYYY-MM-DD).`;

const ISO = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const AREAS = Object.keys(AREA_LABEL);
const KINDS = ['easy', 'long', 'workout', 'race', 'cross', 'other'];
const RO = { readOnlyHint: true };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const CHANGE = obj({
  date: ISO, kind: { type: 'string', enum: ['easy', 'long', 'rest', 'cross', 'workout'] },
  miles: { type: 'number', exclusiveMinimum: 0, maximum: 30 }, note: { type: 'string', maxLength: 300 },
}, ['date', 'kind']);

const TOOLS = [
  // ── read ──
  { name: 'get_today', description: "Today's plan: what to run, why, this week so far, active injury, and anything needing attention.", inputSchema: obj({}), annotations: RO },
  { name: 'get_status', description: 'Full picture: phase, usual week, this week, next 4 weeks, 16 weeks of history, long-run limit, speed ladder, injury, shoes, issues, recent notes.', inputSchema: obj({}), annotations: RO },
  { name: 'get_week', description: 'The plan and what happened for the week containing a date, day by day, with the reasoning.', inputSchema: obj({ date: ISO }, ['date']), annotations: RO },
  { name: 'weekly_review', description: 'Review a finished week: planned vs run, check-ins, pain, notes, issues, and what next week looks like. Defaults to last week.', inputSchema: obj({ date: ISO }), annotations: RO },
  { name: 'list_runs', description: 'Runs between two dates (inclusive) with ids, plus day marks.', inputSchema: obj({ from: ISO, to: ISO }, ['from', 'to']), annotations: RO },
  { name: 'list_notes', description: 'Notes, optionally in a date range or matching words.', inputSchema: obj({ from: ISO, to: ISO, query: { type: 'string' } }), annotations: RO },
  { name: 'list_changes', description: 'Recent changes made through this connector (newest first), with ids and whether they were undone.', inputSchema: obj({ limit: { type: 'integer', minimum: 1, maximum: 50 } }), annotations: RO },
  { name: 'explain_rules', description: 'How the engine decides numbers: build rate, lighter weeks, long-run limit, coach mode, missing data, plan changes, speed ladder, injury rules.', inputSchema: obj({}), annotations: RO },
  // ── engine debugging ──
  { name: 'trace_week', description: "Show exactly how a build week's number was decided: starting level, every week's target, the facts, which caps fired, and the decision each week.", inputSchema: obj({ date: ISO }, ['date']), annotations: RO },
  { name: 'audit_plan', description: "Run the engine's self-checks on this runner's real data (days add up, long-run limits, no cuts from missing data, no jumps over 15%, ...). Findings mean an engine bug.", inputSchema: obj({}), annotations: RO },
  { name: 'report_problem', description: 'Save a problem report for the developer (engine bug, wrong number, confusing screen). Includes the engine version and a snapshot automatically.', inputSchema: obj({ title: { type: 'string', maxLength: 200 }, detail: { type: 'string', maxLength: 4000 } }, ['title', 'detail']) },
  // ── plan ──
  { name: 'preview_plan_change', description: 'Check a plan change WITHOUT saving: returns before/after days and totals, errors (refused) and warnings. Always show this to the runner first.', inputSchema: obj({ changes: { type: 'array', minItems: 1, maxItems: 14, items: CHANGE } }, ['changes']), annotations: RO },
  { name: 'apply_plan_change', description: 'Save a plan change the runner agreed to (same input as the preview). Refused if the checks fail.', inputSchema: obj({ changes: { type: 'array', minItems: 1, maxItems: 14, items: CHANGE } }, ['changes']) },
  { name: 'reset_plan_days', description: 'Put days back to what the engine planned (removes plan changes).', inputSchema: obj({ dates: { type: 'array', minItems: 1, maxItems: 31, items: ISO } }, ['dates']) },
  { name: 'update_settings', description: 'Change training settings: run days a week (3–7), long run day (0 = Mon … 6 = Sun), weekly ceiling in miles (10–60), easy heart-rate limit.', inputSchema: obj({ days_per_week: { type: 'integer', minimum: 3, maximum: 7 }, long_run_day: { type: 'integer', minimum: 0, maximum: 6 }, goal_mpw: { type: ['number', 'null'], minimum: 10, maximum: 60 }, hr_easy_max: { type: ['integer', 'null'], minimum: 120, maximum: 210 } }) },
  // ── logging ──
  { name: 'log_runs', description: 'Add runs the runner told you about. kind "workout" for team workouts, "race" for meets. Effort (1–10) and pain (0–10) are optional check-ins.',
    inputSchema: obj({ runs: { type: 'array', minItems: 1, maxItems: 30, items: obj({
      date: ISO, miles: { type: 'number', exclusiveMinimum: 0, maximum: 60 }, minutes: { type: 'number', minimum: 0, maximum: 600 },
      kind: { type: 'string', enum: KINDS }, effort: { type: 'integer', minimum: 1, maximum: 10 },
      pain: { type: 'integer', minimum: 0, maximum: 10 }, pain_area: { type: 'string', enum: AREAS }, notes: { type: 'string', maxLength: 500 },
    }, ['date', 'miles']) } }, ['runs']) },
  { name: 'log_race', description: 'Log a race result: distance, finish time, and name.', inputSchema: obj({ date: ISO, miles: { type: 'number', exclusiveMinimum: 0 }, time: { type: 'string', description: 'mm:ss or h:mm:ss' }, name: { type: 'string' } }, ['date', 'miles', 'time']) },
  { name: 'update_run', description: 'Fix a run (id from list_runs).', inputSchema: obj({ id: { type: 'string' }, date: ISO, miles: { type: 'number', exclusiveMinimum: 0 }, minutes: { type: 'number' }, kind: { type: 'string', enum: KINDS }, effort: { type: 'integer', minimum: 1, maximum: 10 }, notes: { type: 'string' } }, ['id']) },
  { name: 'delete_run', description: 'Delete a run logged by mistake. Confirm with the runner first. Can be undone.', inputSchema: obj({ id: { type: 'string' } }, ['id']), annotations: { destructiveHint: true } },
  { name: 'mark_days', description: 'Mark days with no run as rest, skipped, sick, injured or travel, so they count as known.', inputSchema: obj({ from: ISO, to: ISO, status: { type: 'string', enum: ['rest', 'skipped', 'sick', 'injured', 'travel'] } }, ['from', 'to', 'status']) },
  { name: 'check_in', description: 'Record how something feels after a run (post_run) or in the morning. Pain 0–10.', inputSchema: obj({ date: ISO, moment: { type: 'string', enum: ['post_run', 'morning'] }, pain: { type: 'integer', minimum: 0, maximum: 10 }, pain_area: { type: 'string', enum: AREAS }, effort: { type: 'integer', minimum: 1, maximum: 10 } }, ['date', 'moment', 'pain']) },
  // ── notes ──
  { name: 'add_note', description: 'Add a note to a day (how they felt, sleep, travel, what the coach said, ...).', inputSchema: obj({ date: ISO, text: { type: 'string', minLength: 1, maxLength: 4000 } }, ['date', 'text']) },
  { name: 'delete_note', description: 'Delete a note by id. Can be undone.', inputSchema: obj({ id: { type: 'string' } }, ['id']), annotations: { destructiveHint: true } },
  // ── injury ──
  { name: 'injury_questions', description: 'The questions for an injury check in one body area. Ask them one at a time in plain words.', inputSchema: obj({ area: { type: 'string', enum: AREAS } }, ['area']), annotations: RO },
  { name: 'injury_check', description: 'Score an injury check: run / easy / cross / stop, the likely common cause, and red flags. save=true records it and adjusts the plan.', inputSchema: obj({ area: { type: 'string', enum: AREAS }, answers: { type: 'object' }, save: { type: 'boolean' } }, ['area', 'answers']) },
  { name: 'injury_update', description: 'Move an active injury along: advance (next comeback stage), resolve (healed), or clinician_cleared (only when the runner says a trainer or doctor cleared them; include their words).', inputSchema: obj({ action: { type: 'string', enum: ['advance', 'resolve', 'clinician_cleared'] }, statement: { type: 'string' } }, ['action']) },
  // ── calendar & gear ──
  { name: 'set_season', description: "Add a season or change one. workout_days are the coach's hard days, 0 = Mon.", inputSchema: obj({ id: { type: 'string' }, kind: { type: 'string', enum: ['xc', 'indoor', 'outdoor', 'other'] }, label: { type: 'string' }, start_date: ISO, end_date: { anyOf: [ISO, { type: 'null' }] }, workout_days: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 } } }) },
  { name: 'delete_season', description: 'Remove a season. Can be undone.', inputSchema: obj({ id: { type: 'string' } }, ['id']), annotations: { destructiveHint: true } },
  { name: 'add_meet', description: 'Put a meet or race on the calendar.', inputSchema: obj({ date: ISO, name: { type: 'string' }, miles: { type: 'number' } }, ['date']) },
  { name: 'delete_meet', description: 'Remove a meet from the calendar.', inputSchema: obj({ id: { type: 'string' } }, ['id']), annotations: { destructiveHint: true } },
  { name: 'manage_shoes', description: 'Add a pair of shoes (miles count from today) or retire one.', inputSchema: obj({ action: { type: 'string', enum: ['add', 'retire', 'list'] }, name: { type: 'string' }, id: { type: 'string' }, retire_at: { type: 'number', minimum: 100, maximum: 800 } }, ['action']) },
  // ── undo ──
  { name: 'undo_last_change', description: 'Undo the most recent change made through this connector (or a specific change id from list_changes).', inputSchema: obj({ id: { type: 'string' } }) },
];

type Ctx = { db: SupabaseClient; userId: string };
type Args = Record<string, unknown>;
type Op = { table: string; op: 'insert' | 'update' | 'delete' | 'upsert'; match: Record<string, unknown>; before: Record<string, unknown> | null; after: Record<string, unknown> | null };

// ── helpers ─────────────────────────────────────────────────────────
async function load(ctx: Ctx) {
  const { data, tz } = await loadRunner(ctx.db, ctx.userId);
  const today = localToday(tz);
  return { data, today, snap: snapshot(data, today) };
}
function fail(msg: string): never { throw new Error(msg); }
const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => { if (r.error) fail(r.error.message); return r.data as T; };

async function record(ctx: Ctx, tool: string, summary: string, ops: Op[]) {
  if (!ops.length) return null;
  const r = await ctx.db.from('bb_changes').insert({ user_id: ctx.userId, tool, summary, ops }).select('id').single();
  return r.data?.id ?? null;
}

function brief(s: Snapshot, data?: RunnerData) {
  return {
    today: s.today,
    phase: s.phase,
    usual_week_mi: s.usualMpw,
    today_plan: {
      title: s.todayPlan.title, miles: s.todayPlan.miles, minutes: s.todayPlan.minutes, guidance: s.todayPlan.guidance, why: s.todayPlan.why,
      done: s.todayPlan.done.map(a => ({ miles: a.distanceMi, source: a.source })),
    },
    this_week: {
      dates: s.week.label, target_mi: s.week.target, so_far_mi: s.week.actual,
      days: s.week.days.map(d => ({
        date: d.date, plan: d.planned.label + (d.planned.miles ? ` ${d.planned.miles} mi` : ''), state: d.state,
        ran_mi: d.actualMiles || undefined, changed: d.planned.override ? { by: d.planned.override.source, note: d.planned.override.note } : undefined,
      })),
    },
    injury: s.injury && { headline: s.injury.headline, mode: s.injury.mode, stage: s.injury.stage, detail: s.injury.detail },
    issues: s.issues,
    notes_today: data?.notes?.filter(n => n.date === s.today).map(n => n.body),
  };
}

function parseTime(t: string): number | null {
  const p = t.trim().split(':').map(Number);
  if (p.some(Number.isNaN) || p.length < 2 || p.length > 3) return null;
  return p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2];
}

// ── tools ───────────────────────────────────────────────────────────
async function call(ctx: Ctx, name: string, a: Args): Promise<unknown> {
  const db = ctx.db, uid = ctx.userId;
  switch (name) {
    case 'get_today': { const { snap, data } = await load(ctx); return brief(snap, data); }
    case 'get_status': {
      const { snap, data } = await load(ctx);
      return { ...brief(snap, data), engine_version: ENGINE_VERSION, upcoming: snap.upcoming, history_last_16: snap.history.slice(-16),
        long_run: snap.longRun, speed: snap.speed, shoes: snap.shoes, recent_notes: (data.notes ?? []).slice(-5) };
    }
    case 'get_week': {
      const { data, today } = await load(ctx);
      const w = weekStart(String(a.date));
      const p = planWeek(data, w, today);
      const f = weekFacts(data, w, today);
      const byDate = new Map<string, number>();
      for (const x of data.activities) if (x.date >= w && x.date <= addDays(w, 6)) byDate.set(x.date, (byDate.get(x.date) ?? 0) + x.distanceMi);
      return {
        week: fmtRange(w, addDays(w, 6)), phase: p.phase.kind, target_mi: p.target, engine_target_mi: p.baseTarget, lighter_week: p.isDown,
        long_run_limit_mi: p.longCap, why: p.why, ran_mi: f.miles, data_completeness: f.reliability,
        days: p.days.map(d => ({ date: d.date, plan: d.label + (d.miles ? ` ${d.miles} mi` : ''), ran_mi: byDate.get(d.date), changed: d.override ?? undefined })),
      };
    }
    case 'weekly_review': {
      const { data, today, snap } = await load(ctx);
      const w = weekStart(String(a.date ?? addDays(today, -7)));
      const p = planWeek(data, w, today);
      const f = weekFacts(data, w, today);
      const inWeek = (d: string) => d >= w && d <= addDays(w, 6);
      const next = planWeek(data, addDays(w, 7), today);
      return {
        week: fmtRange(w, addDays(w, 6)), planned_mi: p.target, ran_mi: f.miles, runs: f.runs, longest_mi: f.longest, data_completeness: f.reliability,
        by_day: p.days.map(d => ({ date: d.date, plan: d.label + (d.miles ? ` ${d.miles}` : ''),
          ran: data.activities.filter(x => x.date === d.date).map(x => `${x.distanceMi} mi ${x.kind}${x.rpe ? ` effort ${x.rpe}` : ''}`) })),
        check_ins: data.checkins.filter(c => inWeek(c.date)),
        notes: (data.notes ?? []).filter(n => inWeek(n.date)),
        issues_now: snap.issues,
        next_week: { dates: fmtRange(next.start, addDays(next.start, 6)), target_mi: next.target, why: next.why },
      };
    }
    case 'list_runs': {
      const [r, d] = await Promise.all([
        db.from('bb_activities').select('id,date,distance_mi,duration_s,avg_hr,kind,source,distance_estimated,rpe,notes').eq('user_id', uid).gte('date', a.from).lte('date', a.to).order('date'),
        db.from('bb_days').select('date,status').eq('user_id', uid).gte('date', a.from).lte('date', a.to),
      ]);
      return { runs: r.data, day_marks: d.data };
    }
    case 'list_notes': {
      let q = db.from('bb_notes').select('id,date,body,source').eq('user_id', uid).order('date', { ascending: false }).limit(100);
      if (a.from) q = q.gte('date', a.from);
      if (a.to) q = q.lte('date', a.to);
      if (a.query) q = q.ilike('body', `%${String(a.query).replace(/[%_]/g, '')}%`);
      return { notes: must(await q) };
    }
    case 'list_changes': {
      return { changes: must(await db.from('bb_changes').select('id,at,tool,summary,undone_at').eq('user_id', uid).order('at', { ascending: false }).limit(Number(a.limit ?? 10))) };
    }
    case 'explain_rules': return {
      engine_version: ENGINE_VERSION,
      build: `Up about ${RULES.BUILD_PCT * 100}% a week (whole miles, ${RULES.BUILD_ABS_MIN}–${RULES.BUILD_ABS_MAX} mi), then a lighter week at ${RULES.DOWN_FACTOR * 100}% after every ${RULES.BUILDS_BEFORE_DOWN} build weeks.`,
      facts: `A day with no data is unknown, never zero. A week run at ${RULES.ON_TRACK * 100}%+ of plan keeps the build going; a fully known week well under it restarts from what was run, once. Partly known or empty weeks hold.`,
      caps: `Never more than ${Math.round((RULES.MAX_OVER_VERIFIED - 1) * 100)}% above the biggest recent known week. No run longer than the long-run limit (about 10% past the longest run in the last 30 days); weeks that can't fit under it come out smaller. Ceiling by experience, lower for runners 15 and under.`,
      long_run: `At most ${RULES.LONG_SHARE * 100}% of the week.`,
      coach_mode: 'In season the coach owns hard days; the app keeps easy days near the usual week (median of the last 3 fully known weeks) and adds no lighter weeks.',
      break: `${RULES.BREAK_WEEKS} weeks with no plan after a season with an end date, then a build from about ${RULES.RETURN_FACTOR * 100}% of the in-season week.`,
      plan_changes: 'Future days only. Moving, swapping and cutting are fine; adding miles past the week target or the long-run limit is refused; during an injury only rest or cross-training. A changed week counts as its new total.',
      speed: `${RULES.SPEED_CHECKINS} pain-free check-ins (pain ≤ ${RULES.PAIN_FREE}) unlock each level; in season only strides; paused during injuries.`,
      injury: 'Red flags (one sharp spot on a bone, pain when hopping, pain at night, limping, a pop, numbness) → stop and see someone. Otherwise pain ≤3 that eases → run or run easy; 5+ or worse as you warm up → cross-train.',
    };
    case 'trace_week': {
      const { data, today } = await load(ctx);
      const t = traceWeek(data, weekStart(String(a.date)), today);
      if (t.phase.kind !== 'build') return { phase: t.phase.kind, note: t.phase.kind === 'coach' ? 'Coach mode: the week is your usual week (median of the last 3 fully known weeks); see get_week.' : 'Break: no plan.' };
      return { phase: 'build', block_started: t.phase.since, ceiling_mi: t.peak, weeks: t.rows };
    }
    case 'audit_plan': {
      const { data, today } = await load(ctx);
      const r = auditEngine(data, today, 16, 6);
      return { ...r, verdict: r.findings.length ? 'The engine broke a rule on this data. Report it with report_problem.' : 'All checks passed.' };
    }
    case 'report_problem': {
      const { snap } = await load(ctx);
      const r = must(await db.from('bb_feedback').insert({ user_id: uid, title: a.title, detail: a.detail, engine_version: ENGINE_VERSION,
        snapshot: { today: snap.today, phase: snap.phase, usual: snap.usualMpw, week: snap.week, upcoming: snap.upcoming, issues: snap.issues } }).select('id').single());
      return { saved: true, id: (r as { id: string }).id };
    }
    case 'preview_plan_change': {
      const { data, today } = await load(ctx);
      const p = previewChanges(data, today, a.changes as ProposedChange[], 'claude');
      return { ok: p.ok, errors: p.errors, warnings: p.warnings, weeks: p.weeks, next_step: p.ok ? 'Show this to the runner. If they say yes, call apply_plan_change with the same changes.' : 'Explain the errors; suggest a change that fits.' };
    }
    case 'apply_plan_change': {
      const { data, today } = await load(ctx);
      const p = previewChanges(data, today, a.changes as ProposedChange[], 'claude');
      if (!p.ok) fail(p.errors.join(' '));
      const dates = p.overrides.map(o => o.date);
      const before = must(await db.from('bb_plan_overrides').select('*').eq('user_id', uid).in('date', dates)) as Record<string, unknown>[];
      const rows = p.overrides.map(o => ({ user_id: uid, date: o.date, kind: o.kind, miles: o.miles ?? null, note: o.note ?? null, source: 'claude' }));
      must(await db.from('bb_plan_overrides').upsert(rows, { onConflict: 'user_id,date' }));
      const id = await record(ctx, 'apply_plan_change', `Changed ${dates.length} day(s): ${dates.join(', ')}`, rows.map(r => ({
        table: 'bb_plan_overrides', op: 'upsert', match: { date: r.date }, before: before.find(b => b.date === r.date) ?? null, after: r,
      })));
      return { saved: true, change_id: id, weeks: p.weeks.map(w => ({ start: w.start, now: w.after })) };
    }
    case 'reset_plan_days': {
      const dates = a.dates as string[];
      const before = must(await db.from('bb_plan_overrides').select('*').eq('user_id', uid).in('date', dates)) as Record<string, unknown>[];
      if (!before.length) return { reset: [], note: 'Those days had no changes.' };
      must(await db.from('bb_plan_overrides').delete().eq('user_id', uid).in('date', dates));
      await record(ctx, 'reset_plan_days', `Reset ${before.length} day(s) to the engine's plan`, before.map(b => ({ table: 'bb_plan_overrides', op: 'delete', match: { date: b.date }, before: b, after: null })));
      return { reset: before.map(b => b.date) };
    }
    case 'update_settings': {
      const patch: Args = {};
      for (const k of ['days_per_week', 'long_run_day', 'goal_mpw', 'hr_easy_max']) if (a[k] !== undefined) patch[k] = a[k];
      if (!Object.keys(patch).length) fail('Nothing to change.');
      const before = must(await db.from('bb_profiles').select(Object.keys(patch).join(',')).eq('user_id', uid).single()) as Record<string, unknown>;
      must(await db.from('bb_profiles').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', uid));
      await record(ctx, 'update_settings', `Settings: ${Object.entries(patch).map(([k, v]) => `${k} ${before[k]} → ${v}`).join(', ')}`, [{ table: 'bb_profiles', op: 'update', match: {}, before, after: patch }]);
      const { snap } = await load(ctx);
      return { saved: patch, this_week: brief(snap).this_week };
    }
    case 'log_runs': {
      const runs = (a.runs as Args[]) ?? [];
      const { today } = await load(ctx);
      if (runs.some(r => String(r.date) > today)) fail('One of those dates is in the future.');
      const rows = runs.map(r => ({ user_id: uid, date: r.date, distance_mi: r.miles, duration_s: r.minutes ? Math.round(Number(r.minutes) * 60) : null,
        kind: r.kind ?? 'easy', source: 'claude', rpe: r.effort ?? null, notes: r.notes ?? null }));
      const ins = must(await db.from('bb_activities').insert(rows).select('*')) as Record<string, unknown>[];
      const checks = runs.map((r, i) => ({ r, id: ins[i].id })).filter(x => x.r.pain != null || x.r.effort != null)
        .map(x => ({ user_id: uid, date: x.r.date, activity_id: x.id, moment: 'post_run', pain: x.r.pain ?? null, pain_area: x.r.pain_area ?? null, rpe: x.r.effort ?? null }));
      const insC = checks.length ? must(await db.from('bb_checkins').insert(checks).select('*')) as Record<string, unknown>[] : [];
      const marks = must(await db.from('bb_days').select('*').eq('user_id', uid).in('date', runs.map(r => r.date as string))) as Record<string, unknown>[];
      if (marks.length) must(await db.from('bb_days').delete().eq('user_id', uid).in('date', marks.map(m => m.date as string)));
      await record(ctx, 'log_runs', `Logged ${ins.length} run(s): ${ins.map(r => `${r.date} ${r.distance_mi} mi`).join(', ')}`, [
        ...ins.map(r => ({ table: 'bb_activities', op: 'insert' as const, match: { id: r.id }, before: null, after: r })),
        ...insC.map(r => ({ table: 'bb_checkins', op: 'insert' as const, match: { id: r.id }, before: null, after: r })),
        ...marks.map(m => ({ table: 'bb_days', op: 'delete' as const, match: { date: m.date }, before: m, after: null })),
      ]);
      const { snap } = await load(ctx);
      return { saved: ins.map(r => ({ id: r.id, date: r.date, miles: r.distance_mi })), week: brief(snap).this_week, issues: snap.issues };
    }
    case 'log_race': {
      const secs = parseTime(String(a.time));
      if (!secs) fail('Time should look like 18:42 or 1:02:10.');
      const row = { user_id: uid, date: a.date, distance_mi: a.miles, duration_s: secs, kind: 'race', source: 'claude', notes: a.name ?? null };
      const r = must(await db.from('bb_activities').insert(row).select('*').single()) as Record<string, unknown>;
      await record(ctx, 'log_race', `Race ${a.date}: ${a.miles} mi in ${a.time}`, [{ table: 'bb_activities', op: 'insert', match: { id: r.id }, before: null, after: r }]);
      const pace = secs / Number(a.miles);
      return { saved: true, id: r.id, pace_per_mi: `${Math.floor(pace / 60)}:${String(Math.round(pace % 60)).padStart(2, '0')}` };
    }
    case 'update_run': {
      const before = must(await db.from('bb_activities').select('*').eq('user_id', uid).eq('id', a.id).maybeSingle()) as Record<string, unknown> | null;
      if (!before) fail('No run with that id.');
      const patch: Args = { updated_at: new Date().toISOString() };
      if (a.date) patch.date = a.date;
      if (a.miles) { patch.distance_mi = a.miles; patch.distance_estimated = false; }
      if (a.minutes != null) patch.duration_s = Math.round(Number(a.minutes) * 60);
      if (a.kind) patch.kind = a.kind;
      if (a.effort) patch.rpe = a.effort;
      if (a.notes != null) patch.notes = a.notes;
      const after = must(await db.from('bb_activities').update(patch).eq('user_id', uid).eq('id', a.id).select('*').single()) as Record<string, unknown>;
      await record(ctx, 'update_run', `Fixed run ${before.date}`, [{ table: 'bb_activities', op: 'update', match: { id: a.id }, before, after }]);
      return { updated: { id: after.id, date: after.date, miles: after.distance_mi, kind: after.kind } };
    }
    case 'delete_run': {
      const before = must(await db.from('bb_activities').select('*').eq('user_id', uid).eq('id', a.id).maybeSingle()) as Record<string, unknown> | null;
      if (!before) fail('No run with that id.');
      must(await db.from('bb_activities').delete().eq('user_id', uid).eq('id', a.id));
      const id = await record(ctx, 'delete_run', `Deleted run ${before.date} ${before.distance_mi} mi`, [{ table: 'bb_activities', op: 'delete', match: { id: a.id }, before, after: null }]);
      return { deleted: { date: before.date, miles: before.distance_mi }, change_id: id, undo: 'undo_last_change restores it' };
    }
    case 'mark_days': {
      const from = String(a.from), to = String(a.to);
      if (to < from || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 62) fail('Use a range of at most 2 months.');
      const runsOn = new Set((must(await db.from('bb_activities').select('date').eq('user_id', uid).gte('date', from).lte('date', to)) as { date: string }[]).map(r => r.date));
      const prev = must(await db.from('bb_days').select('*').eq('user_id', uid).gte('date', from).lte('date', to)) as Record<string, unknown>[];
      const rows = [];
      for (let d = from; d <= to; d = addDays(d, 1)) if (!runsOn.has(d)) rows.push({ user_id: uid, date: d, status: a.status, updated_at: new Date().toISOString() });
      if (rows.length) must(await db.from('bb_days').upsert(rows, { onConflict: 'user_id,date' }));
      await record(ctx, 'mark_days', `Marked ${rows.length} day(s) ${a.status}`, rows.map(r => ({ table: 'bb_days', op: 'upsert', match: { date: r.date }, before: prev.find(p => p.date === r.date) ?? null, after: r })));
      return { marked: rows.map(r => r.date), days_with_runs_left_alone: [...runsOn] };
    }
    case 'check_in': {
      const r = must(await db.from('bb_checkins').insert({ user_id: uid, date: a.date, moment: a.moment, pain: a.pain, pain_area: a.pain_area ?? null, rpe: a.effort ?? null }).select('*').single()) as Record<string, unknown>;
      await record(ctx, 'check_in', `Check-in ${a.date}: pain ${a.pain}`, [{ table: 'bb_checkins', op: 'insert', match: { id: r.id }, before: null, after: r }]);
      const { snap } = await load(ctx);
      return { saved: true, injury: brief(snap).injury, issues: snap.issues };
    }
    case 'add_note': {
      const r = must(await db.from('bb_notes').insert({ user_id: uid, date: a.date, body: a.text, source: 'claude' }).select('*').single()) as Record<string, unknown>;
      await record(ctx, 'add_note', `Note on ${a.date}`, [{ table: 'bb_notes', op: 'insert', match: { id: r.id }, before: null, after: r }]);
      return { saved: true, id: r.id };
    }
    case 'delete_note': {
      const before = must(await db.from('bb_notes').select('*').eq('user_id', uid).eq('id', a.id).maybeSingle()) as Record<string, unknown> | null;
      if (!before) fail('No note with that id.');
      must(await db.from('bb_notes').delete().eq('user_id', uid).eq('id', a.id));
      await record(ctx, 'delete_note', `Deleted a note from ${before.date}`, [{ table: 'bb_notes', op: 'delete', match: { id: a.id }, before, after: null }]);
      return { deleted: true };
    }
    case 'injury_questions': {
      const area = a.area as InjuryArea;
      return { area: AREA_LABEL[area], questions: QUESTIONS[area] };
    }
    case 'injury_check': {
      const area = a.area as InjuryArea;
      const result = triage(area, (a.answers as Record<string, never>) ?? {});
      if (a.save && result.outcome !== 'run') {
        const { today } = await load(ctx);
        const prev = must(await db.from('bb_injuries').select('*').eq('user_id', uid).eq('status', 'active')) as Record<string, unknown>[];
        if (prev.length) must(await db.from('bb_injuries').update({ status: 'resolved', updated_at: new Date().toISOString() }).eq('user_id', uid).eq('status', 'active'));
        const r = must(await db.from('bb_injuries').insert({ user_id: uid, area, started_on: today, answers: a.answers ?? {}, outcome: result.outcome, likely: result.likely, stage: 0, stage_since: today }).select('*').single()) as Record<string, unknown>;
        await record(ctx, 'injury_check', `Injury check (${AREA_LABEL[area]}): ${result.outcome}`, [
          ...prev.map(p => ({ table: 'bb_injuries', op: 'update' as const, match: { id: p.id }, before: p, after: { status: 'resolved' } })),
          { table: 'bb_injuries', op: 'insert', match: { id: r.id }, before: null, after: r },
        ]);
      }
      return { ...result, saved: !!a.save && result.outcome !== 'run', note: 'This is a check-in, not a diagnosis.' };
    }
    case 'injury_update': {
      const { today, snap } = await load(ctx);
      const inj = must(await db.from('bb_injuries').select('*').eq('user_id', uid).eq('status', 'active').order('started_on', { ascending: false }).limit(1).maybeSingle()) as Record<string, unknown> | null;
      if (!inj) fail('No active injury.');
      let patch: Args;
      if (a.action === 'resolve') patch = { status: 'resolved' };
      else if (a.action === 'advance') {
        if (inj.outcome === 'stop' && !inj.cleared_by_clinician) fail('Running is paused until a trainer or doctor clears it.');
        if (!snap.injury?.shouldAdvance && Number(inj.stage) > 0) fail(`Not yet: the next stage needs ${RULES.COMEBACK_GOOD_DAYS} good days (pain 3 or less, fine the next morning). ${snap.injury?.goodDays ?? 0} so far.`);
        patch = { stage: Math.min(6, Number(inj.stage) + 1), stage_since: today };
      } else {
        const said = String(a.statement ?? '').trim();
        if (said.length < 8) fail('Include what the runner said, e.g. "My athletic trainer cleared me to start running today."');
        patch = { cleared_by_clinician: true, stage: 1, stage_since: today, answers: { ...(inj.answers as object), clearance: { said, on: today } } };
      }
      must(await db.from('bb_injuries').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', uid).eq('id', inj.id));
      await record(ctx, 'injury_update', `Injury: ${a.action}`, [{ table: 'bb_injuries', op: 'update', match: { id: inj.id }, before: inj, after: patch }]);
      const after = await load(ctx);
      return { updated: a.action, injury: brief(after.snap).injury, today: after.snap.todayPlan };
    }
    case 'set_season': {
      const row: Args = { user_id: uid, updated_at: new Date().toISOString() };
      for (const k of ['kind', 'label', 'start_date', 'end_date', 'workout_days']) if (a[k] !== undefined) row[k] = a[k];
      if (a.id) {
        const before = must(await db.from('bb_seasons').select('*').eq('user_id', uid).eq('id', a.id).maybeSingle()) as Record<string, unknown> | null;
        if (!before) fail('No season with that id.');
        const after = must(await db.from('bb_seasons').update(row).eq('user_id', uid).eq('id', a.id).select('*').single()) as Record<string, unknown>;
        await record(ctx, 'set_season', `Season ${after.label}: ${after.start_date} → ${after.end_date ?? 'no end'}`, [{ table: 'bb_seasons', op: 'update', match: { id: a.id }, before, after }]);
        return { season: after };
      }
      if (!a.start_date) fail('A new season needs a start date.');
      const r = must(await db.from('bb_seasons').insert({ kind: 'other', label: '', workout_days: [1, 3], ...row }).select('*').single()) as Record<string, unknown>;
      await record(ctx, 'set_season', `Added season ${r.label}`, [{ table: 'bb_seasons', op: 'insert', match: { id: r.id }, before: null, after: r }]);
      return { season: r };
    }
    case 'delete_season': {
      const before = must(await db.from('bb_seasons').select('*').eq('user_id', uid).eq('id', a.id).maybeSingle()) as Record<string, unknown> | null;
      if (!before) fail('No season with that id.');
      must(await db.from('bb_seasons').delete().eq('user_id', uid).eq('id', a.id));
      await record(ctx, 'delete_season', `Removed season ${before.label}`, [{ table: 'bb_seasons', op: 'delete', match: { id: a.id }, before, after: null }]);
      return { deleted: before.label };
    }
    case 'add_meet': {
      const r = must(await db.from('bb_meets').insert({ user_id: uid, date: a.date, name: a.name ?? '', distance_mi: a.miles ?? null }).select('*').single()) as Record<string, unknown>;
      await record(ctx, 'add_meet', `Meet ${a.date} ${a.name ?? ''}`, [{ table: 'bb_meets', op: 'insert', match: { id: r.id }, before: null, after: r }]);
      return { meet: r };
    }
    case 'delete_meet': {
      const before = must(await db.from('bb_meets').select('*').eq('user_id', uid).eq('id', a.id).maybeSingle()) as Record<string, unknown> | null;
      if (!before) fail('No meet with that id.');
      must(await db.from('bb_meets').delete().eq('user_id', uid).eq('id', a.id));
      await record(ctx, 'delete_meet', `Removed meet ${before.date}`, [{ table: 'bb_meets', op: 'delete', match: { id: a.id }, before, after: null }]);
      return { deleted: true };
    }
    case 'manage_shoes': {
      if (a.action === 'list') {
        const { snap } = await load(ctx);
        const all = must(await db.from('bb_shoes').select('id,name,start_date,retire_at,retired_at').eq('user_id', uid)) as Record<string, unknown>[];
        return { shoes: all.map(s => ({ ...s, miles: snap.shoes.find(x => x.id === s.id)?.miles ?? null })) };
      }
      const { today } = await load(ctx);
      if (a.action === 'add') {
        if (!a.name) fail('Give the shoe a name.');
        const r = must(await db.from('bb_shoes').insert({ user_id: uid, name: a.name, start_date: today, retire_at: a.retire_at ?? 300 }).select('*').single()) as Record<string, unknown>;
        await record(ctx, 'manage_shoes', `Added shoe ${a.name}`, [{ table: 'bb_shoes', op: 'insert', match: { id: r.id }, before: null, after: r }]);
        return { added: r };
      }
      const before = must(await db.from('bb_shoes').select('*').eq('user_id', uid).eq('id', a.id).maybeSingle()) as Record<string, unknown> | null;
      if (!before) fail('No shoe with that id (use action list).');
      must(await db.from('bb_shoes').update({ retired_at: today, updated_at: new Date().toISOString() }).eq('user_id', uid).eq('id', a.id));
      await record(ctx, 'manage_shoes', `Retired shoe ${before.name}`, [{ table: 'bb_shoes', op: 'update', match: { id: a.id }, before, after: { retired_at: today } }]);
      return { retired: before.name };
    }
    case 'undo_last_change': {
      let q = db.from('bb_changes').select('*').eq('user_id', uid).is('undone_at', null).order('at', { ascending: false }).limit(1);
      if (a.id) q = db.from('bb_changes').select('*').eq('user_id', uid).eq('id', a.id).is('undone_at', null).limit(1);
      const ch = (must(await q) as Record<string, unknown>[])[0];
      if (!ch) fail('Nothing to undo.');
      for (const op of [...(ch.ops as Op[])].reverse()) {
        const t = db.from(op.table);
        const scope = (x: ReturnType<typeof t.delete> | ReturnType<typeof t.update>) => {
          let y = x.eq('user_id', uid);
          for (const [k, v] of Object.entries(op.match)) y = y.eq(k, v as string);
          return y;
        };
        if (op.op === 'insert') must(await scope(db.from(op.table).delete()));
        else if (op.op === 'delete') must(await db.from(op.table).insert(op.before!));
        else if (op.op === 'update') must(await scope(db.from(op.table).update(op.before!)));
        else if (op.op === 'upsert') {
          if (op.before) must(await db.from(op.table).upsert(op.before));
          else must(await scope(db.from(op.table).delete()));
        }
      }
      must(await db.from('bb_changes').update({ undone_at: new Date().toISOString() }).eq('id', ch.id));
      return { undone: ch.summary };
    }
  }
  fail(`Unknown tool ${name}`);
}

async function handle(ctx: Ctx | null, msg: { id?: unknown; method?: string; params?: Args }) {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
  switch (msg.method) {
    case 'initialize': return reply({
      protocolVersion: (msg.params?.protocolVersion as string) ?? PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'bulletproof-base', title: 'Bulletproof Base', version: ENGINE_VERSION },
      instructions: INSTRUCTIONS,
    });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      if (!ctx) return err(-32001, 'This connector link is no longer valid. Make a new one in the app (You → Claude).');
      const name = String(msg.params?.name ?? '');
      try {
        const prof = await ctx.db.from('bb_profiles').select('user_id').eq('user_id', ctx.userId).maybeSingle();
        if (!prof.data) fail('This account has not finished setup in the app.');
        const out = await call(ctx, name, (msg.params?.arguments as Args) ?? {});
        return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out, isError: false });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true });
      }
    }
    default:
      if (msg.id === undefined) return null;
      return err(-32601, `Method not found: ${msg.method}`);
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method === 'GET') return new Response('Bulletproof Base connector. Add this link in Claude as a custom connector.', { status: 405, headers: { ...cors, allow: 'POST' } });
  if (req.method === 'DELETE') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const db = adminClient();
  const userId = await userForToken(db, tokenFrom(req), 'mcp');
  const ctx = userId ? { db, userId } : null;
  let body: unknown;
  try { body = await req.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  const batch = Array.isArray(body);
  const out = (await Promise.all((batch ? body : [body]).map(m => handle(ctx, m as never)))).filter(Boolean);
  if (!out.length) return new Response(null, { status: 202, headers: cors });
  return json(batch ? out : out[0]);
});
