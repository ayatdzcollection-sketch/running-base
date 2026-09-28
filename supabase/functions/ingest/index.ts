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

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST a workout' }, 405);

  const db = adminClient();
  const userId = await userForToken(db, tokenFrom(req), 'shortcut');
  if (!userId) return json({ ok: false, error: 'Unknown or turned-off code. Copy a new one in the app.' }, 401);

  const text = await req.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { _raw: text };
  }
  const log = await db.from('bb_ingest_log').insert({ user_id: userId, payload: body }).select('id').single();
  const logId = log.data?.id;
  const finish = async (result: string, status: number, extra: Record<string, unknown> = {}) => {
    if (logId) await db.from('bb_ingest_log').update({ result }).eq('id', logId);
    return json({ ok: status < 300, message: result, ...extra }, status);
  };

  const start = date(body.start ?? body.startDate ?? body.start_date);
  const end = date(body.end ?? body.endDate ?? body.end_date);
  const rawDistance = num(body.distance ?? body.totalDistance);
  if (!start || rawDistance == null) {
    return finish('Got it, but no start time or distance was in the message. Saved it so nothing is lost.', 202);
  }
  // The unit can come separately or inside the value ("8.2 km", "5.1 mi").
  const inline = typeof (body.distance ?? body.totalDistance) === 'string' ? String(body.distance ?? body.totalDistance).replace(/[\d.,\s]/g, '') : '';
  const miles = Math.round(rawDistance * MI_PER[unitOf(body.distanceUnit ?? body.unit ?? (inline || undefined), 'mi')] * 100) / 100;
  if (miles <= 0.05 || miles >= 100) return finish(`Skipped: distance ${miles} mi looks wrong.`, 202);

  let duration = num(body.duration ?? body.durationSeconds);
  if (duration == null && end) duration = Math.round((end.getTime() - start.getTime()) / 1000);
  if (duration != null && String(body.durationUnit ?? '').toLowerCase().startsWith('min')) duration *= 60;

  const tz = num(body.tzOffsetMinutes);
  const row = {
    user_id: userId,
    date: localDay(body.start ?? body.startDate, start, tz),
    start_at: start.toISOString(),
    distance_mi: miles,
    duration_s: duration != null && duration > 0 ? Math.round(duration) : null,
    avg_hr: num(body.avgHR ?? body.averageHeartRate) != null ? Math.round(num(body.avgHR ?? body.averageHeartRate)!) : null,
    max_hr: num(body.maxHR ?? body.maxHeartRate) != null ? Math.round(num(body.maxHR ?? body.maxHeartRate)!) : null,
    kind: 'easy',
    source: 'watch',
    external_id: `watch:${start.toISOString().slice(0, 16)}`,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db
    .from('bb_activities')
    .upsert(row, { onConflict: 'user_id,external_id' })
    .select('id, date, distance_mi')
    .single();
  if (error) return finish(`Could not save: ${error.message}`, 500);
  return finish(`Saved ${data.distance_mi} mi on ${data.date}.`, 200, { activity: data });
});
