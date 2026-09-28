// Watch ingest: the iPhone Shortcut POSTs one finished workout here.
// Every payload is logged raw first (so a format surprise never loses a run),
// then parsed into a bb_activities row, deduplicated by the workout's start.
import { adminClient, cors, json, tokenFrom, userForToken } from '../_shared/auth.ts';

const MI_PER = { mi: 1, km: 0.621371, m: 0.000621371 } as const;

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    // Shortcuts often sends "5.12 mi" or "5,12" depending on locale.
    const m = v.replace(',', '.').match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  return null;
}

function unitOf(v: unknown, fallback: string): keyof typeof MI_PER {
  const s = String(v ?? fallback).toLowerCase();
  if (s.startsWith('k')) return 'km';
  if (s === 'm' || s.startsWith('meter') || s.startsWith('metre')) return 'm';
  return 'mi';
}

function date(v: unknown): Date | null {
  if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
  if (typeof v !== 'string' || !v.trim()) return null;
  // Health Auto Export: "2024-02-06 07:00:00 -0800"
  const hae = v.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/);
  if (hae) return new Date(`${hae[1]}T${hae[2]}${hae[3]}:${hae[4]}`);
  // iOS writes dates like "Sep 27, 2026 at 7:42 AM" with narrow no-break spaces.
  const d = new Date(v.replace(/[\u202f\u00a0]/g, ' ').replace(' at ', ' '));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Local calendar day of the run, using the offset the phone sent if any. */
function localDay(v: unknown, d: Date, tzOffsetMin: number | null): string {
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const shifted = new Date(d.getTime() + (tzOffsetMin ?? 0) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** One workout, whatever app sent it. */
interface Workout { startRaw: unknown; endRaw: unknown; distance: unknown; unit: unknown; duration: unknown; durationUnit: unknown; avgHr: unknown; maxHr: unknown; name: string }

const qty = (v: unknown) => (v && typeof v === 'object' && 'qty' in (v as Record<string, unknown>) ? (v as Record<string, unknown>).qty : v);
const units = (v: unknown) => (v && typeof v === 'object' && 'units' in (v as Record<string, unknown>) ? (v as Record<string, unknown>).units : undefined);

/** Accepts the iPhone Shortcut's single object, a list of them, or
 *  Health Auto Export's { data: { workouts: [...] } }. */
function workoutsIn(body: Record<string, unknown>): Workout[] {
  const data = body.data as Record<string, unknown> | undefined;
  const list = Array.isArray(data?.workouts) ? data!.workouts as Record<string, unknown>[]
    : Array.isArray(body.workouts) ? body.workouts as Record<string, unknown>[]
    : Array.isArray(body) ? body as unknown as Record<string, unknown>[]
    : [body];
  return list.map(w => {
    const hr = w.heartRate as Record<string, unknown> | undefined;
    return {
      startRaw: w.start ?? w.startDate ?? w.start_date,
      endRaw: w.end ?? w.endDate ?? w.end_date,
      distance: qty(w.distance ?? w.totalDistance),
      unit: w.distanceUnit ?? w.unit ?? units(w.distance),
      duration: w.duration ?? w.durationSeconds,
      durationUnit: w.durationUnit,
      avgHr: qty(w.avgHR ?? w.averageHeartRate ?? w.avgHeartRate ?? hr?.avg),
      maxHr: qty(w.maxHR ?? w.maxHeartRate ?? hr?.max),
      name: String(w.name ?? w.type ?? w.workoutType ?? ''),
    };
  });
}

type Db = ReturnType<typeof adminClient>;

/** One line per sample; workouts look like
 *  {"kind":"workout","start":ms,"end":ms,"workout":{"activityType":"running","duration":s,"totalDistanceMeters":m,
 *   "statisticsDetail":{"HKQuantityTypeIdentifierHeartRate":{"avg":..,"max":..}}}} */
async function ingestPuls(db: Db, userId: string, raw: string): Promise<Response> {
  let accepted = 0, lines = 0;
  const saved: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    lines++;
    let o: Record<string, unknown>;
    try { o = JSON.parse(line); } catch { continue; }
    const w = o.workout as Record<string, unknown> | undefined;
    if (o.kind !== 'workout' || !w || !/run/i.test(String(w.activityType ?? ''))) continue;
    const meters = Number(w.totalDistanceMeters ?? 0);
    const start = new Date(Number(o.start));
    if (!(meters > 80) || Number.isNaN(start.getTime())) continue;
    const hr = (w.statisticsDetail as Record<string, Record<string, number>> | undefined)?.HKQuantityTypeIdentifierHeartRate;
    const row: Record<string, unknown> = {
      user_id: userId,
      // PulsHealth sends UTC epochs; use the runner's saved time zone for the day.
      date: await localDate(db, userId, start),
      start_at: start.toISOString(),
      distance_mi: Math.round(meters * MI_PER.m * 100) / 100,
      duration_s: w.duration != null ? Math.round(Number(w.duration)) : null,
      avg_hr: hr?.avg != null ? Math.round(hr.avg) : null,
      max_hr: hr?.max != null ? Math.round(hr.max) : null,
      kind: 'easy', source: 'watch',
      external_id: `watch:${start.toISOString().slice(0, 16)}`,
      updated_at: new Date().toISOString(),
    };
    const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v != null));
    const { error } = await db.from('bb_activities').upsert(clean, { onConflict: 'user_id,external_id' });
    if (!error) { accepted++; saved.push(`${row.distance_mi} mi on ${row.date}`); }
  }
  if (accepted) await db.from('bb_ingest_log').insert({ user_id: userId, payload: { source: 'pulshealth', lines }, result: `Saved ${saved.join(', ')}` });
  // Always 2xx so the app marks the batch done (samples we don't use are simply skipped).
  return json({ accepted, deleted: 0, duplicates: 0, routePoints: 0, seriesPoints: 0, aggregateSamples: 0, activitySummaries: 0 });
}

const tzCache = new Map<string, string>();
async function localDate(db: Db, userId: string, d: Date): Promise<string> {
  let tz = tzCache.get(userId);
  if (!tz) {
    const { data } = await db.from('bb_profiles').select('settings').eq('user_id', userId).maybeSingle();
    tz = ((data?.settings as Record<string, unknown> | undefined)?.timezone as string) || 'America/New_York';
    tzCache.set(userId, tz);
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const path = new URL(req.url).pathname;
  if (req.method === 'GET' && path.endsWith('/healthz')) return json({ ok: true });
  const capabilities = req.method === 'GET' && path.endsWith('/v1/capabilities');
  if (req.method !== 'POST' && !capabilities) return json({ ok: false, error: 'POST a workout' }, 405);

  const db = adminClient();
  const userId = await userForToken(db, tokenFrom(req), 'shortcut');
  if (!userId) return json({ ok: false, error: 'Unknown or turned-off code. Copy a new one in the app.' }, 401);
  // PulsHealth's "Test Connection" asks this first; a 401 above tells it the code is wrong.
  if (capabilities) return json({ protocolVersions: [1], features: ['batches'], server: 'Bulletproof Base', version: '1' });

  // PulsHealth: gzip NDJSON with one line per sample. Keep only running
  // workouts, and don't log the raw batch (it can hold thousands of samples).
  const gz = (req.headers.get('content-encoding') ?? '').includes('gzip');
  const raw = gz && req.body ? await new Response(req.body.pipeThrough(new DecompressionStream('gzip'))).text() : await req.text();
  if (/ndjson/i.test(req.headers.get('content-type') ?? '') || new URL(req.url).pathname.endsWith('/v1/batches')) {
    return await ingestPuls(db, userId, raw);
  }
  const text = raw;
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  const log = await db.from('bb_ingest_log').insert({ user_id: userId, payload: body }).select('id').single();
  const logId = log.data?.id;
  const finish = async (result: string, status: number, extra: Record<string, unknown> = {}) => {
    if (logId) await db.from('bb_ingest_log').update({ result }).eq('id', logId);
    return json({ ok: status < 300, message: result, ...extra }, status);
  };

  const saved: { id: string; date: string; distance_mi: number }[] = [];
  const skipped: string[] = [];
  for (const w of workoutsIn(body)) {
    if (w.name && !/run|jog/i.test(w.name)) { skipped.push(`${w.name} (not a run)`); continue; }
    const start = date(w.startRaw);
    const end = date(w.endRaw);
    const rawDistance = num(w.distance);
    if (!start || rawDistance == null) { skipped.push('no start time or distance'); continue; }
    const inline = typeof w.distance === 'string' ? w.distance.replace(/[\d.,\s]/g, '') : '';
    const miles = Math.round(rawDistance * MI_PER[unitOf(w.unit ?? (inline || undefined), 'mi')] * 100) / 100;
    if (miles <= 0.05 || miles >= 100) { skipped.push(`distance ${miles} mi looks wrong`); continue; }
    let duration = num(w.duration);
    if (duration == null && end) duration = Math.round((end.getTime() - start.getTime()) / 1000);
    if (duration != null && String(w.durationUnit ?? '').toLowerCase().startsWith('min')) duration *= 60;
    const tz = num(body.tzOffsetMinutes);
    const avg = num(w.avgHr), max = num(w.maxHr);
    const row = {
      user_id: userId,
      date: localDay(w.startRaw, start, tz),
      start_at: start.toISOString(),
      distance_mi: miles,
      duration_s: duration != null && duration > 0 ? Math.round(duration) : null,
      avg_hr: avg != null ? Math.round(avg) : null,
      max_hr: max != null ? Math.round(max) : null,
      kind: 'easy',
      source: 'watch',
      // Same key for every sender, so a run sent twice (or by two apps) is saved once.
      external_id: `watch:${start.toISOString().slice(0, 16)}`,
      updated_at: new Date().toISOString(),
    };
    // A resend fills in details but never erases ones we already have.
    const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v != null));
    const { data, error } = await db.from('bb_activities').upsert(clean, { onConflict: 'user_id,external_id' }).select('id, date, distance_mi').single();
    if (error) return finish(`Could not save: ${error.message}`, 500);
    saved.push(data);
  }
  if (!saved.length) return finish(`Got it, but nothing to save${skipped.length ? `: ${[...new Set(skipped)].join(', ')}` : ''}. Saved the message so nothing is lost.`, 202);
  return finish(`Saved ${saved.map(a => `${a.distance_mi} mi on ${a.date}`).join(', ')}.`, 200, { activity: saved[saved.length - 1], activities: saved });
});
