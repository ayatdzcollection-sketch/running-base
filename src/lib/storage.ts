import type { GlobalState, RaceResult, RunEntry, RunState } from './types';
import { migrateGlobalState } from './migrate';
import { supabase } from './supabase';

const STATE_KEY = 'bb_run_state';
const CODE_KEY = 'bb_access_code';
// v2: global speed-layer state lives under its OWN key so the original
// run log is never rewritten by the new features.
const GLOBAL_KEY = 'bb_global_state';

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

function mergeRacesById(local: RaceResult[], remote: RaceResult[]): RaceResult[] {
  const byId = new Map<string, RaceResult>();
  for (const r of local) byId.set(r.id, r);
  for (const r of remote) {
    const ex = byId.get(r.id);
    if (!ex || r.updated_at > ex.updated_at) byId.set(r.id, r);
  }
  return [...byId.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function mergeGlobalStates(local: GlobalState, remote: GlobalState): GlobalState {
  const base: GlobalState = remote.updated_at > local.updated_at ? { ...remote } : { ...local };

  // settings: newest settings.updated_at wins, independent of the blob winner.
  const ls = local.settings ?? null;
  const rs = remote.settings ?? null;
  base.settings = ls && rs ? (rs.updated_at > ls.updated_at ? rs : ls) : (ls ?? rs);

  // races: merge by id, newest updated_at per id.
  base.races = mergeRacesById(local.races ?? [], remote.races ?? []);

  // acceptedWeeks: union of week keys; local wins ties (local edits are freshest).
  base.acceptedWeeks = { ...(remote.acceptedWeeks ?? {}), ...(local.acceptedWeeks ?? {}) };

  return base;
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
      console.warn('athlete_state table missing — global speed-layer state is local-only until the migration SQL runs.');
      return null;
    }
    throw error;
  }
  if (!data?.state) return null;
  const remote = migrateGlobalState(data.state, data.updated_at ?? new Date().toISOString());
  return remote;
}

export async function upsertGlobalToSupabase(state: GlobalState, code: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('athlete_state')
    .upsert(
      { access_code: code, state, updated_at: state.updated_at },
      { onConflict: 'access_code' },
    );
  if (error) {
    if (isMissingTableError(error)) return; // degrade silently to local-only
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
