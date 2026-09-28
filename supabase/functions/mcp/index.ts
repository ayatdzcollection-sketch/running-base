// Claude connector: a remote MCP server (Streamable HTTP, stateless JSON).
// The runner's personal link ends in their secret code, e.g.
//   https://<project>.supabase.co/functions/v1/mcp/bb_xxxxxxxx
// Claude reads the plan and the engine's reasoning, logs runs and
// check-ins, and flags problems, all through the same engine as the app.
import { adminClient, cors, json, tokenFrom, userForToken } from '../_shared/auth.ts';
import { loadRunner, localToday } from '../_shared/data.ts';
import {
  AREA_LABEL, QUESTIONS, RULES, addDays, snapshot, triage,
  type InjuryArea, type Snapshot,
} from '../_shared/engine/index.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const PROTOCOL = '2025-06-18';
const INSTRUCTIONS = `Bulletproof Base is a high school runner's training app. Use these tools to see their plan and log what they tell you.
Rules: a day with no data is unknown, never "missed"; never scold. Log only what the runner actually said; ask before guessing a distance.
When they mention pain, run injury_check (it routes, it does not diagnose). Anything flagged "stop" means: see an athletic trainer or doctor.
Dates are the runner's local dates (YYYY-MM-DD). "today" comes back in every result.`;

const ISO = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const AREAS = Object.keys(AREA_LABEL);
const KINDS = ['easy', 'long', 'workout', 'race', 'cross', 'other'];

const TOOLS = [
  { name: 'get_today', description: "Today's plan for the runner: what to run, why, this week so far, and anything that needs attention.",
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'get_status', description: 'Full picture: phase (coach mode / break / build), usual week, this week day by day, next 4 weeks, 16 weeks of history, long-run cap, speed ladder, injury, shoes, issues.',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'list_runs', description: 'Runs between two dates (inclusive), with ids, distances, source and any day marks.',
    inputSchema: { type: 'object', properties: { from: ISO, to: ISO }, required: ['from', 'to'] }, annotations: { readOnlyHint: true } },
  { name: 'log_runs', description: 'Add one or more runs the runner told you about. Use kind "workout" for team workouts, "race" for meets. Pain and effort are optional check-ins.',
    inputSchema: { type: 'object', properties: { runs: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', properties: {
      date: ISO, miles: { type: 'number', exclusiveMinimum: 0, maximum: 60 }, minutes: { type: 'number', minimum: 0 },
      kind: { type: 'string', enum: KINDS }, effort: { type: 'integer', minimum: 1, maximum: 10, description: 'RPE 1–10' },
      pain: { type: 'integer', minimum: 0, maximum: 10 }, pain_area: { type: 'string', enum: AREAS }, notes: { type: 'string' },
    }, required: ['date', 'miles'] } } }, required: ['runs'] } },
  { name: 'update_run', description: 'Fix a run (use list_runs for the id).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, date: ISO, miles: { type: 'number', exclusiveMinimum: 0 }, minutes: { type: 'number' },
      kind: { type: 'string', enum: KINDS }, effort: { type: 'integer', minimum: 1, maximum: 10 }, notes: { type: 'string' } }, required: ['id'] } },
  { name: 'delete_run', description: 'Delete a run that was logged by mistake. Confirm with the runner first.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, annotations: { destructiveHint: true } },
  { name: 'mark_days', description: 'Mark days with no run as rest, skipped, sick, injured or travel. This makes them known, so the plan stops treating them as unknown.',
    inputSchema: { type: 'object', properties: { from: ISO, to: ISO, status: { type: 'string', enum: ['rest', 'skipped', 'sick', 'injured', 'travel'] } }, required: ['from', 'to', 'status'] } },
  { name: 'check_in', description: 'Record how something feels: after a run (post_run) or in the morning. Pain 0–10.',
    inputSchema: { type: 'object', properties: { date: ISO, moment: { type: 'string', enum: ['post_run', 'morning'] }, pain: { type: 'integer', minimum: 0, maximum: 10 },
      pain_area: { type: 'string', enum: AREAS }, effort: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['date', 'moment', 'pain'] } },
  { name: 'injury_questions', description: 'The questions for an injury check in one body area. Ask them one at a time, in plain words.',
    inputSchema: { type: 'object', properties: { area: { type: 'string', enum: AREAS } }, required: ['area'] }, annotations: { readOnlyHint: true } },
  { name: 'injury_check', description: 'Score an injury check. Returns run / easy / cross / stop, the likely common cause, and red flags. save=true records it and adjusts the plan.',
    inputSchema: { type: 'object', properties: { area: { type: 'string', enum: AREAS }, answers: { type: 'object', description: 'question id → answer (true/false, 0–10, or a choice value)' },
      save: { type: 'boolean' } }, required: ['area', 'answers'] } },
  { name: 'find_issues', description: 'Check the training for problems: data gaps, spikes, long-run jumps, worn shoes, pain trends, easy runs too hard, missing season dates.',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'explain_rules', description: 'How the plan decides numbers (build rate, lighter weeks, long-run cap, coach mode, missing data, speed ladder, injury rules).',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'set_season', description: "Add a season or update one's dates. workout_days: the coach's hard days, 0 = Mon.",
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'omit to add a new season' }, kind: { type: 'string', enum: ['xc', 'indoor', 'outdoor', 'other'] },
      label: { type: 'string' }, start_date: ISO, end_date: { anyOf: [ISO, { type: 'null' }] }, workout_days: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 } } } } },
  { name: 'add_meet', description: 'Put a meet or race on the calendar.',
    inputSchema: { type: 'object', properties: { date: ISO, name: { type: 'string' }, miles: { type: 'number' } }, required: ['date'] } },
];

type Ctx = { db: SupabaseClient; userId: string };
type Args = Record<string, unknown>;

function brief(s: Snapshot) {
  return {
    today: s.today,
    phase: s.phase,
    usual_week_mi: s.usualMpw,
    today_plan: { title: s.todayPlan.title, miles: s.todayPlan.miles, minutes: s.todayPlan.minutes, guidance: s.todayPlan.guidance, why: s.todayPlan.why,
      done: s.todayPlan.done.map(a => ({ miles: a.distanceMi, source: a.source })) },
    this_week: { dates: s.week.label, target_mi: s.week.target, so_far_mi: s.week.actual,
      days: s.week.days.map(d => ({ date: d.date, plan: d.planned.label + (d.planned.miles ? ` ${d.planned.miles} mi` : ''), state: d.state, ran_mi: d.actualMiles || undefined })) },
    injury: s.injury && { headline: s.injury.headline, mode: s.injury.mode, stage: s.injury.stage, detail: s.injury.detail },
    issues: s.issues,
  };
}

async function current(ctx: Ctx) {
  const { data, tz } = await loadRunner(ctx.db, ctx.userId);
  return { data, snap: snapshot(data, localToday(tz)) };
}

const hasProfile = async (ctx: Ctx) => !!(await ctx.db.from('bb_profiles').select('user_id').eq('user_id', ctx.userId).maybeSingle()).data;

async function call(ctx: Ctx, name: string, a: Args): Promise<unknown> {
  const db = ctx.db, uid = ctx.userId;
  switch (name) {
    case 'get_today': return brief((await current(ctx)).snap);
    case 'get_status': {
      const { snap } = await current(ctx);
      return { ...brief(snap), upcoming: snap.upcoming, history_last_16: snap.history.slice(-16), long_run: snap.longRun, speed: snap.speed, shoes: snap.shoes };
    }
    case 'list_runs': {
      const [r, d] = await Promise.all([
        db.from('bb_activities').select('id,date,distance_mi,duration_s,avg_hr,kind,source,distance_estimated,rpe,notes').eq('user_id', uid).gte('date', a.from).lte('date', a.to).order('date'),
        db.from('bb_days').select('date,status').eq('user_id', uid).gte('date', a.from).lte('date', a.to),
      ]);
      return { runs: r.data, day_marks: d.data };
    }
    case 'log_runs': {
      const runs = (a.runs as Args[]) ?? [];
      const rows = runs.map(r => ({
        user_id: uid, date: r.date, distance_mi: r.miles, duration_s: r.minutes ? Math.round(Number(r.minutes) * 60) : null,
        kind: r.kind ?? 'easy', source: 'claude', rpe: r.effort ?? null, notes: r.notes ?? null,
      }));
      const ins = await db.from('bb_activities').insert(rows).select('id,date,distance_mi');
      if (ins.error) throw new Error(ins.error.message);
      const checks = runs.map((r, i) => ({ r, id: ins.data![i].id })).filter(x => x.r.pain != null || x.r.effort != null)
        .map(x => ({ user_id: uid, date: x.r.date, activity_id: x.id, moment: 'post_run', pain: x.r.pain ?? null, pain_area: x.r.pain_area ?? null, rpe: x.r.effort ?? null }));
      if (checks.length) await db.from('bb_checkins').insert(checks);
      // A run replaces an explicit "skipped/rest" mark on that day.
      await db.from('bb_days').delete().eq('user_id', uid).in('date', runs.map(r => r.date as string));
      const { snap } = await current(ctx);
      return { saved: ins.data, week: brief(snap).this_week, issues: snap.issues };
    }
    case 'update_run': {
      const patch: Args = { updated_at: new Date().toISOString() };
      if (a.date) patch.date = a.date;
      if (a.miles) { patch.distance_mi = a.miles; patch.distance_estimated = false; }
      if (a.minutes != null) patch.duration_s = Math.round(Number(a.minutes) * 60);
      if (a.kind) patch.kind = a.kind;
      if (a.effort) patch.rpe = a.effort;
      if (a.notes != null) patch.notes = a.notes;
      const r = await db.from('bb_activities').update(patch).eq('user_id', uid).eq('id', a.id).select('id,date,distance_mi,kind').maybeSingle();
      if (!r.data) throw new Error('No run with that id.');
      return { updated: r.data };
    }
    case 'delete_run': {
      const r = await db.from('bb_activities').delete().eq('user_id', uid).eq('id', a.id).select('id,date,distance_mi').maybeSingle();
      if (!r.data) throw new Error('No run with that id.');
      return { deleted: r.data };
    }
    case 'mark_days': {
      const from = String(a.from), to = String(a.to);
      if (to < from || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 62) throw new Error('Use a range of at most 2 months.');
      const runsOn = new Set(((await db.from('bb_activities').select('date').eq('user_id', uid).gte('date', from).lte('date', to)).data ?? []).map(r => String(r.date)));
      const rows = [];
      for (let d = from; d <= to; d = addDays(d, 1)) if (!runsOn.has(d)) rows.push({ user_id: uid, date: d, status: a.status, updated_at: new Date().toISOString() });
      if (rows.length) await db.from('bb_days').upsert(rows, { onConflict: 'user_id,date' });
      return { marked: rows.map(r => r.date), skipped_days_with_runs: [...runsOn] };
    }
    case 'check_in': {
      const r = await db.from('bb_checkins').insert({ user_id: uid, date: a.date, moment: a.moment, pain: a.pain, pain_area: a.pain_area ?? null, rpe: a.effort ?? null }).select('id').single();
      if (r.error) throw new Error(r.error.message);
      const { snap } = await current(ctx);
      return { saved: true, injury: brief(snap).injury, issues: snap.issues };
    }
    case 'injury_questions': {
      const area = a.area as InjuryArea;
      return { area: AREA_LABEL[area], questions: QUESTIONS[area] };
    }
    case 'injury_check': {
      const area = a.area as InjuryArea;
      const result = triage(area, (a.answers as Record<string, never>) ?? {});
      if (a.save && result.outcome !== 'run') {
        const today = localToday((await loadRunner(db, uid)).tz);
        await db.from('bb_injuries').insert({
          user_id: uid, area, started_on: today, answers: a.answers ?? {}, outcome: result.outcome, likely: result.likely,
          stage: 0, stage_since: today,
        });
      }
      return { ...result, note: 'This is a check-in, not a diagnosis.' };
    }
    case 'find_issues': {
      const { snap } = await current(ctx);
      return { today: snap.today, issues: snap.issues, gap: snap.gap, usual_week_mi: snap.usualMpw, recent_weeks: snap.history.slice(-6) };
    }
    case 'explain_rules': return {
      build: `Up about ${RULES.BUILD_PCT * 100}% a week (whole miles, ${RULES.BUILD_ABS_MIN}–${RULES.BUILD_ABS_MAX} mi), then a lighter week at ${RULES.DOWN_FACTOR * 100}% after every ${RULES.BUILDS_BEFORE_DOWN} build weeks.`,
      facts: `Only fully known weeks can pull the plan down. A day with no data is unknown, never zero. A week run at ${RULES.ON_TRACK * 100}%+ of plan keeps the build going; a fully known week well under it restarts from what was run, once.`,
      cap: `Never more than ${RULES.MAX_OVER_VERIFIED * 100 - 100}% above the biggest recent known week.`,
      long_run: `At most ${RULES.LONG_SHARE * 100}% of the week and about 10% longer than the longest run in the last 30 days.`,
      coach_mode: 'In season the coach owns hard days and the rhythm; the app keeps easy days near the usual week (median of the last 3 full weeks) and adds no lighter weeks.',
      break: `${RULES.BREAK_WEEKS} weeks with no plan after a season with an end date, then a build from about ${RULES.RETURN_FACTOR * 100}% of the in-season week.`,
      speed: `${RULES.SPEED_CHECKINS} pain-free check-ins (pain ≤ ${RULES.PAIN_FREE}) unlock each speed level; in season only strides; paused during injuries.`,
      injury: 'Red flags (one sharp spot on a bone, pain when hopping, pain at night, limping, pops, numbness) → stop and see someone. Otherwise pain ≤3 that eases → run or run easy; 5+ or worse as you warm up → cross-train.',
    };
    case 'set_season': {
      const row: Args = { user_id: uid, updated_at: new Date().toISOString() };
      for (const k of ['kind', 'label', 'start_date', 'end_date', 'workout_days']) if (a[k] !== undefined) row[k] = a[k];
      const r = a.id
        ? await db.from('bb_seasons').update(row).eq('user_id', uid).eq('id', a.id).select().maybeSingle()
        : await db.from('bb_seasons').insert({ kind: 'other', label: '', workout_days: [1, 3], ...row }).select().single();
      if (r.error || !r.data) throw new Error(r.error?.message ?? 'No season with that id.');
      return { season: r.data };
    }
    case 'add_meet': {
      const r = await db.from('bb_meets').insert({ user_id: uid, date: a.date, name: a.name ?? '', distance_mi: a.miles ?? null }).select().single();
      if (r.error) throw new Error(r.error.message);
      return { meet: r.data };
    }
  }
  throw new Error(`Unknown tool ${name}`);
}

async function handle(ctx: Ctx | null, msg: { id?: unknown; method?: string; params?: Args }) {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
  switch (msg.method) {
    case 'initialize': return reply({
      protocolVersion: (msg.params?.protocolVersion as string) ?? PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'bulletproof-base', title: 'Bulletproof Base', version: '2.0.0' },
      instructions: INSTRUCTIONS,
    });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      if (!ctx) return fail(-32001, 'This connector link is no longer valid. Make a new one in the app (You → Claude).');
      const name = String(msg.params?.name ?? '');
      try {
        if (!(await hasProfile(ctx))) throw new Error('This account has not finished setup in the app.');
        const out = await call(ctx, name, (msg.params?.arguments as Args) ?? {});
        return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out, isError: false });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true });
      }
    }
    default:
      if (msg.id === undefined) return null; // a notification: no reply
      return fail(-32601, `Method not found: ${msg.method}`);
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

