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

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST a workout' }, 405);

  const db = adminClient();
  const userId = await userForToken(db, tokenFrom(req), 'shortcut');
  if (!userId) return json({ ok: false, error: 'Unknown or turned-off code. Copy a new one in the app.' }, 401);

  const text = await req.text();
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
