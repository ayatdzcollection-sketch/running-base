import type { GlobalState, RaceResult, RawSettings, RunEntry, RunState } from './types';
import { migrateGlobalState, SCHEMA_VERSION } from './migrate';
import { migrateSettings } from './settings';
import { mergeRaces, PROTO_DIST_MI } from './races';
import { supabase } from './supabase';

const STATE_KEY = 'bb_run_state';
const CODE_KEY = 'bb_access_code';
// v2: global speed-layer state lives under its OWN key so the original
// run log is never rewritten by the new features.
const GLOBAL_KEY = 'bb_global_state';
// v3: local mirrors (design contract). The canonical synced copies live inside
// bb_global_state (globals.settings / globals.races); these are read-fallbacks.
const SETTINGS_KEY = 'bb_settings';
const RACES_KEY = 'bb_races';

// ── Access code ────────────────────────────────────────────

export function getStoredCode(): string | null {
  return localStorage.getItem(CODE_KEY);
}

export function setStoredCode(code: string): void {
  localStorage.setItem(CODE_KEY, code.trim());
}

// ── Local state ────────────────────────────────────────────

export function loadLocal(): RunState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveLocal(state: RunState): void {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

export function loadGlobalLocal(): GlobalState {
  let raw: unknown = null;
  try {
    const s = localStorage.getItem(GLOBAL_KEY);
    raw = s ? JSON.parse(s) : null;
  } catch {
    raw = null;
  }
  // Additive + idempotent: only fills missing keys, never wipes.
  return migrateGlobalState(raw, new Date().toISOString());
}

export function saveGlobalLocal(state: GlobalState): void {
  localStorage.setItem(GLOBAL_KEY, JSON.stringify(state));
}

// ── Settings mirror (bb_settings) — canonical copy rides in globals.settings ──

export function loadSettingsLocal(): RawSettings | null {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    return migrateSettings(s ? JSON.parse(s) : null, new Date().toISOString());
  } catch {
    return null;
  }
}

export function saveSettingsLocal(s: RawSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage full / unavailable — globals.settings remains the source of truth */
  }
}

// ── Races mirror (bb_races) — canonical copy rides in globals.races ──
// Accepts three shapes: the canonical RaceResult[], the design prototype's
// single object {dist, timeSec, date}, or absent (→ []). Never seeds a race.

let raceIdSeq = 0;

export function loadRacesLocal(): RaceResult[] {
  let raw: unknown = null;
  try {
    const s = localStorage.getItem(RACES_KEY);
    raw = s ? JSON.parse(s) : null;
  } catch {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.filter(r => r && typeof r === 'object' && 'id' in r) as RaceResult[];
  }
  // Prototype single-object shape → one RaceResult.
  if (raw && typeof raw === 'object') {
    const p = raw as { dist?: string; timeSec?: number; date?: string };
    const mi = p.dist ? PROTO_DIST_MI[p.dist] : undefined;
    if (mi && typeof p.timeSec === 'number') {
      return [{
        id: `proto-${raceIdSeq++}`,
        date: p.date ?? '',
        distanceMi: mi,
        timeSec: p.timeSec,
        updated_at: new Date().toISOString(),
      }];
    }
  }
  return [];
}

export function saveRacesLocal(races: RaceResult[]): void {
  try {
    localStorage.setItem(RACES_KEY, JSON.stringify(races));
  } catch {
    /* globals.races remains the source of truth */
  }
}

// Seed: pre-populate history on first use so the app isn't blank.
// updated_at is set early so a real Supabase record always wins.
export const SEED: RunState = {
  '2026-06-26': {
    date: '2026-06-26',
    done: true,
    miles_actual: 3.0,
    updated_at: '2026-06-26T12:00:00Z',
  },
  '2026-06-29': {
    date: '2026-06-29',
    done: true,
    miles_actual: 4.0,
    updated_at: '2026-06-29T12:00:00Z',
  },
};

export function applySeed(existing: RunState): RunState {
  const result = { ...existing };
  for (const [date, entry] of Object.entries(SEED)) {
    if (!result[date]) result[date] = entry;
  }
  return result;
}

// ── Merge: most-recent updated_at wins per date ────────────

// v2 subjective fields the legacy-column Supabase fallback cannot carry.
// (upsertEntry drops to legacy columns when the v2 SQL migration hasn't run,
// so a remote row can come back NEWER but stripped of these.)
const V2_SUBJECTIVE_FIELDS = ['rpe', 'painDuring', 'painNextAM', 'didStrides', 'strideNote'] as const;

/**
 * When a newer remote row wins, keep any v2 subjective value the local row has
 * that the winner lacks. This makes the merge FIELD-preserving: a legacy-path
 * sync can never silently drop logged pain/effort data. Core fields (done,
 * miles_actual) always sync, so only the subjective fields need protecting.
 * Safe direction: we bias toward keeping logged pain, never losing it.
 */
function preserveSubjective(winner: RunEntry, loser: RunEntry): RunEntry {
  let out: RunEntry = winner;
  for (const f of V2_SUBJECTIVE_FIELDS) {
    if (winner[f] == null && loser[f] != null) {
      if (out === winner) out = { ...winner };
      (out as unknown as Record<string, unknown>)[f] = loser[f];
    }
  }
  return out;
}

export function mergeStates(local: RunState, remote: RunEntry[]): RunState {
  const merged: RunState = { ...local };
  for (const row of remote) {
    const existing = merged[row.date];
    if (!existing) {
      merged[row.date] = row;
    } else if (row.updated_at > existing.updated_at) {
      merged[row.date] = preserveSubjective(row, existing);
    }
    // else: local is newer-or-equal — keep it (already field-complete).
  }
  return merged;
}

// ── Global-state merge: field-aware, not whole-blob last-write-wins ──
// The base blob is the newer of the two, but settings, races, and
// acceptedWeeks reconcile per-field so a newer speed-layer blob can never
// clobber locally-newer settings, and neither device loses race/accepted
// data the other hasn't seen. Same non-destructive spirit as mergeStates.

/** Effective schema of a blob (0 when absent/corrupt). Used by the schema
 *  guard below so an older-schema interpretation can never out-vote newer
 *  semantics on recency alone. */
function schemaOf(g: GlobalState): number {
  const v = Number((g as { schemaVersion?: unknown }).schemaVersion);
  return Number.isFinite(v) ? v : 0;
}

export function mergeGlobalStates(local: GlobalState, remote: GlobalState): GlobalState {
  // Schema guard (Phase 2D hardening): a blob written under a NEWER schema
  // always wins the base election, regardless of updated_at. Fields like
  // speedState were RENUMBERED at schema 3, so letting an older-schema blob
  // win on recency would silently reinterpret them under stale semantics.
  // Equal schemas fall back to newest-updated_at, byte-identical to before.
  const lv = schemaOf(local);
  const rv = schemaOf(remote);
  const base: GlobalState =
    rv > lv ? { ...remote }
    : lv > rv ? { ...local }
    : remote.updated_at > local.updated_at ? { ...remote } : { ...local };

  // settings: newest settings.updated_at wins, independent of the blob winner.
  const ls = local.settings ?? null;
  const rs = remote.settings ?? null;
  base.settings = ls && rs ? (rs.updated_at > ls.updated_at ? rs : ls) : (ls ?? rs);

  // painTrackingSince: EARLIEST non-null wins, not newest-blob-wins.
  // It records when this ATHLETE began tracking pain — one fact about a person,
  // not a per-device value, so recency is the wrong tiebreaker. A freshly
  // installed device stamps today and (being newest) would otherwise overwrite a
  // real earlier baseline, retroactively disqualifying every logged run as
  // "pre-tracking" and resetting the pain-free streak to 0. Taking the earliest
  // reproduces the athlete's actual history on every device.
  const pts = [local.painTrackingSince, remote.painTrackingSince].filter(
    (d): d is string => typeof d === 'string' && !!d,
  );
  base.painTrackingSince = pts.length ? pts.reduce((a, b) => (a < b ? a : b)) : null;

  // races: merge by id, newest updated_at per id.
  base.races = mergeRaces(local.races ?? [], remote.races ?? []);

  // acceptedWeeks: union of week keys; local wins ties (local edits are freshest).
  base.acceptedWeeks = { ...(remote.acceptedWeeks ?? {}), ...(local.acceptedWeeks ?? {}) };

  // v4 widget stores — same non-destructive spirit: never let an older blob
  // drop journal/rotation data the other device recorded.
  // notes: plain strings (no per-note timestamp) → union, local wins ties.
  base.notes = { ...(remote.notes ?? {}), ...(local.notes ?? {}) };
  // checkins: keyed by weekStart, newest updated_at per week wins.
  base.checkins = mergeRecordNewest(local.checkins ?? {}, remote.checkins ?? {});
  // shoes / ptNotes: merge by id, newest updated_at per id wins.
  base.shoes = mergeByIdNewest(local.shoes ?? [], remote.shoes ?? []);
  base.ptNotes = mergeByIdNewest(local.ptNotes ?? [], remote.ptNotes ?? []);

  return base;
}

/** Merge two id-keyed lists, keeping the newest updated_at per id. */
function mergeByIdNewest<T extends { id: string; updated_at: string }>(a: T[], b: T[]): T[] {
  const by = new Map<string, T>();
  for (const x of a) by.set(x.id, x);
  for (const x of b) {
    const cur = by.get(x.id);
    if (!cur || x.updated_at > cur.updated_at) by.set(x.id, x);
  }
  return [...by.values()];
}

/** Merge two key→record maps, keeping the newest updated_at per key. */
function mergeRecordNewest<T extends { updated_at: string }>(
  a: Record<string, T>, b: Record<string, T>,
): Record<string, T> {
  const out: Record<string, T> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (!out[k] || v.updated_at > out[k].updated_at) out[k] = v;
  }
  return out;
}

// ── Supabase row mapping (v2 columns are snake_case) ───────

interface RunRow {
  date: string;
  done: boolean;
  miles_actual: number | null;
  updated_at: string;
  rpe?: number | null;
  pain_during?: number | null;
  pain_next_am?: number | null;
  did_strides?: boolean | null;
  stride_note?: string | null;
}

function rowToEntry(r: RunRow): RunEntry {
  const e: RunEntry = {
    date: r.date,
    done: r.done,
    miles_actual: r.miles_actual,
    updated_at: r.updated_at,
  };
  // Only attach v2 fields when present so pre-migration rows stay lean.
  if (r.rpe != null) e.rpe = r.rpe;
  if (r.pain_during != null) e.painDuring = r.pain_during;
  if (r.pain_next_am != null) e.painNextAM = r.pain_next_am;
  if (r.did_strides != null) e.didStrides = r.did_strides;
  if (r.stride_note != null) e.strideNote = r.stride_note;
  return e;
}

function entryToRow(e: RunEntry, code: string, includeV2: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = {
    date: e.date,
    done: e.done,
    miles_actual: e.miles_actual,
    updated_at: e.updated_at,
    access_code: code,
  };
  if (includeV2) {
    row.rpe = e.rpe ?? null;
    row.pain_during = e.painDuring ?? null;
    row.pain_next_am = e.painNextAM ?? null;
    row.did_strides = e.didStrides ?? null;
    row.stride_note = e.strideNote ?? null;
  }
  return row;
}

/** True once we know the v2 columns exist server-side; starts optimistic. */
let v2ColumnsAvailable = true;

/** False once we learn the athlete_state table does not exist. Mirrors
 *  v2ColumnsAvailable. The app is designed to degrade to local-only when the
 *  SQL migration has not been run — but it must be able to SAY so. Reporting
 *  "synced" while settings, speed state and pain history never leave the device
 *  is how the same athlete opens a second browser and finds default settings. */
let globalStateTableOk = true;

/** Is full sync available, or is this device silently running runs-only?
 *  UI-facing so the header can distinguish "synced" from "partially synced". */
export function syncCapability(): { runDetail: boolean; globalState: boolean } {
  return { runDetail: v2ColumnsAvailable, globalState: globalStateTableOk };
}

function isMissingColumnError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === 'PGRST204' || e.code === '42703' ||
    /column .* does not exist|could not find .* column/i.test(e.message ?? '');
}

function isMissingTableError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === 'PGRST205' || e.code === '42P01' ||
    /relation .* does not exist|could not find the table/i.test(e.message ?? '');
}

// ── Supabase I/O ───────────────────────────────────────────

export async function pullFromSupabase(code: string): Promise<RunEntry[]> {
  if (!supabase) return [];
  // select('*') is resilient: works whether or not the additive SQL
  // migration has been applied yet.
  const { data, error } = await supabase
    .from('runs')
    .select('*')
    .eq('access_code', code);
  if (error) throw error;
  return ((data ?? []) as RunRow[]).map(rowToEntry);
}

export async function upsertEntry(entry: RunEntry, code: string): Promise<void> {
  if (!supabase) return;
  if (v2ColumnsAvailable) {
    const { error } = await supabase
      .from('runs')
      .upsert(entryToRow(entry, code, true), { onConflict: 'date,access_code' });
    if (!error) return;
    if (!isMissingColumnError(error)) throw error;
    // v2 SQL migration not applied yet — fall back to legacy columns so the
    // core log keeps syncing. Subjective fields stay safe in localStorage.
    v2ColumnsAvailable = false;
    console.warn('Supabase runs table missing v2 columns — run the additive migration SQL. Falling back to legacy columns.');
  }
  const { error } = await supabase
    .from('runs')
    .upsert(entryToRow(entry, code, false), { onConflict: 'date,access_code' });
  if (error) throw error;
}

export async function upsertMany(entries: RunEntry[], code: string): Promise<void> {
  if (!supabase) return;
  if (v2ColumnsAvailable) {
    const { error } = await supabase
      .from('runs')
      .upsert(entries.map(e => entryToRow(e, code, true)), { onConflict: 'date,access_code' });
    if (!error) return;
    if (!isMissingColumnError(error)) throw error;
    v2ColumnsAvailable = false;
    console.warn('Supabase runs table missing v2 columns — run the additive migration SQL. Falling back to legacy columns.');
  }
  const { error } = await supabase
    .from('runs')
    .upsert(entries.map(e => entryToRow(e, code, false)), { onConflict: 'date,access_code' });
  if (error) throw error;
}

// ── Global state sync (new athlete_state table, jsonb blob) ─

export async function pullGlobalFromSupabase(code: string): Promise<GlobalState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('athlete_state')
    .select('state, updated_at')
    .eq('access_code', code)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) {
      globalStateTableOk = false;
      console.warn('athlete_state table missing — global speed-layer state is local-only until the migration SQL runs.');
      return null;
    }
    throw error;
  }
  if (!data?.state) return null;
  const remote = migrateGlobalState(data.state, data.updated_at ?? new Date().toISOString());
  return remote;
}

/** Schema write guard (Phase 2D hardening): this build may only publish
 *  global state written under EXACTLY its own schema.
 *   • blob schema > build schema → a newer build owns that row; pushing our
 *     older interpretation over it would corrupt renumbered fields (this is
 *     the guard the v2→v3 speed-ladder migration wished the v2 build had).
 *   • blob schema < build schema → the blob bypassed migration; migrate
 *     stamps the current version on every load/pull/restore path, so this
 *     should be impossible — refuse rather than publish stale semantics.
 *  Local persistence (saveGlobalLocal) is deliberately NOT guarded: the
 *  device always keeps its own state; only the shared row is protected. */
export function canWriteGlobalSchema(state: GlobalState): boolean {
  return schemaOf(state) === SCHEMA_VERSION;
}

export async function upsertGlobalToSupabase(state: GlobalState, code: string): Promise<void> {
  if (!supabase) return;
  if (!canWriteGlobalSchema(state)) {
    console.warn(
      `Global-state sync write skipped: blob schema ${schemaOf(state)} ≠ this build's schema ${SCHEMA_VERSION}. ` +
      'Refusing to overwrite newer/unknown semantics — update this device to sync again.',
    );
    return;
  }
  const { error } = await supabase
    .from('athlete_state')
    .upsert(
      { access_code: code, state, updated_at: state.updated_at },
      { onConflict: 'access_code' },
    );
  if (error) {
    if (isMissingTableError(error)) {
      globalStateTableOk = false;   // degrade to local-only, but REPORT it
      return;
    }
    throw error;
  }
}

// ── Backup format (v2 adds globals; v1 flat RunState still restores) ──

export interface BackupV2 {
  format: 'bulletproof-base-backup';
  schemaVersion: number;
  runs: RunState;
  globals: GlobalState;
}

export function buildBackup(runs: RunState, globals: GlobalState): BackupV2 {
  return { format: 'bulletproof-base-backup', schemaVersion: globals.schemaVersion, runs, globals };
}

export interface ParsedBackup {
  runs: RunState;
  globals: GlobalState | null;
}

/** Accepts both the v2 envelope and the original flat RunState export. */
export function parseBackup(text: string): ParsedBackup {
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('bad format');
  }
  if (parsed.format === 'bulletproof-base-backup' && typeof parsed.runs === 'object') {
    return {
      runs: parsed.runs as RunState,
      globals: parsed.globals
        ? migrateGlobalState(parsed.globals, new Date().toISOString())
        : null,
    };
  }
  return { runs: parsed as RunState, globals: null };
}

// ── Simple debounce ────────────────────────────────────────

export function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  ms: number,
): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}
