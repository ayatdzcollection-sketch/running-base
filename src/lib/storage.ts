import type { RunEntry, RunState } from './types';
import { supabase } from './supabase';

const STATE_KEY = 'bb_run_state';
const CODE_KEY = 'bb_access_code';

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

export function mergeStates(local: RunState, remote: RunEntry[]): RunState {
  const merged: RunState = { ...local };
  for (const row of remote) {
    const existing = merged[row.date];
    if (!existing || row.updated_at > existing.updated_at) {
      merged[row.date] = row;
    }
  }
  return merged;
}

// ── Supabase I/O ───────────────────────────────────────────

export async function pullFromSupabase(code: string): Promise<RunEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('runs')
    .select('date, done, miles_actual, updated_at')
    .eq('access_code', code);
  if (error) throw error;
  return (data ?? []) as RunEntry[];
}

export async function upsertEntry(entry: RunEntry, code: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('runs')
    .upsert({ ...entry, access_code: code }, { onConflict: 'date,access_code' });
  if (error) throw error;
}

export async function upsertMany(entries: RunEntry[], code: string): Promise<void> {
  if (!supabase) return;
  const rows = entries.map(e => ({ ...e, access_code: code }));
  const { error } = await supabase
    .from('runs')
    .upsert(rows, { onConflict: 'date,access_code' });
  if (error) throw error;
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
