// ============================================================
// STAGE A — CURRENT-STATE PRESERVATION CHECKPOINT
//
// Proves that existing logged data survives load, migration,
// refresh (save→load round-trip), backup/restore, and sync
// merge. This suite is the safety net the whole redesign sits
// on: if any later stage rewrites or drops a logged field, one
// of these fails first. It must stay green.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadLocal, saveLocal, loadGlobalLocal, saveGlobalLocal,
  buildBackup, parseBackup, mergeStates,
} from '../storage';
import { defaultGlobalState } from '../migrate';
import type { GlobalState, RunEntry, RunState } from '../types';

// vitest runs in node with no DOM — provide a minimal Map-backed localStorage.
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  get length(): number { return this.m.size; }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();
});

// ── A realistic snapshot of the real user's log ──────────────
// Bonus day + Week 1 complete + Week 2 partial with every v2 subjective
// field populated, plus globals mid-progression (speedState 3, a delay,
// hip clearance, and one confirmed generated week).
function makeRunFixture(): RunState {
  return {
    '2026-06-26': { date: '2026-06-26', done: true, miles_actual: 3.0, updated_at: '2026-06-26T12:00:00Z' },
    '2026-06-29': { date: '2026-06-29', done: true, miles_actual: 4.0, updated_at: '2026-06-29T12:00:00Z' },
    '2026-06-30': { date: '2026-06-30', done: true, miles_actual: 4.0, updated_at: '2026-06-30T12:00:00Z' },
    '2026-07-01': { date: '2026-07-01', done: true, miles_actual: 4.0, updated_at: '2026-07-01T12:00:00Z' },
    '2026-07-02': { date: '2026-07-02', done: true, miles_actual: 3.7, updated_at: '2026-07-02T12:00:00Z' },
    '2026-07-03': { date: '2026-07-03', done: true, miles_actual: 4.5, updated_at: '2026-07-03T12:00:00Z' },
    // Week 2 Monday — partial, with the full subjective payload.
    '2026-07-06': {
      date: '2026-07-06', done: true, miles_actual: 4.5, updated_at: '2026-07-06T18:30:00Z',
      rpe: 4, painDuring: 2, painNextAM: 0, didStrides: true, strideNote: '4x15s flat grass',
    },
  };
}

function makeGlobalsFixture(): GlobalState {
  return {
    ...defaultGlobalState('2026-07-06T18:30:00Z'),
    speedState: 3,
    hipSafeFlag: true,
    ptClearedSpeed: true,
    painCap: 3,
    delayUntil: '2026-07-20',
    acceptedWeeks: {
      '2026-07-13': [
        { date: '2026-07-13', dayLabel: 'Mon', kind: 'easy', miles: 4.5, why: 'easy aerobic' },
        { date: '2026-07-17', dayLabel: 'Fri', kind: 'long', miles: 5.0, why: 'ladder step' },
      ],
    },
  };
}

describe('refresh survival — save → load round-trip is identity', () => {
  it('run log survives a save/load cycle byte-for-byte', () => {
    const runs = makeRunFixture();
    saveLocal(runs);
    expect(loadLocal()).toEqual(runs);
  });

  it('global state survives a save/load cycle (migration is a no-op on complete state)', () => {
    const globals = makeGlobalsFixture();
    saveGlobalLocal(globals);
    expect(loadGlobalLocal()).toEqual(globals);
  });

  it('every v2 subjective field on a run entry survives the round-trip', () => {
    const runs = makeRunFixture();
    saveLocal(runs);
    const loaded = loadLocal()['2026-07-06'];
    expect(loaded.rpe).toBe(4);
    expect(loaded.painDuring).toBe(2);
    expect(loaded.painNextAM).toBe(0);
    expect(loaded.didStrides).toBe(true);
    expect(loaded.strideNote).toBe('4x15s flat grass');
  });
});

describe('migration on load preserves in-flight training state', () => {
  it('loadGlobalLocal keeps acceptedWeeks / delayUntil / hipSafeFlag / painCap verbatim', () => {
    const globals = makeGlobalsFixture();
    saveGlobalLocal(globals);
    const loaded = loadGlobalLocal();
    expect(loaded.acceptedWeeks).toEqual(globals.acceptedWeeks);
    expect(loaded.delayUntil).toBe('2026-07-20');
    expect(loaded.hipSafeFlag).toBe(true);
    expect(loaded.ptClearedSpeed).toBe(true);
    expect(loaded.speedState).toBe(3);
    expect(loaded.painCap).toBe(3);
  });

  it('a raw (partial) stored blob is filled additively without touching present keys', () => {
    // Simulate a pre-existing localStorage blob missing newer keys.
    const raw = { speedState: 4, hipSafeFlag: true, delayUntil: '2026-08-01', acceptedWeeks: { '2026-07-13': [] } };
    (globalThis.localStorage as Storage).setItem('bb_global_state', JSON.stringify(raw));
    const loaded = loadGlobalLocal();
    expect(loaded.speedState).toBe(4);
    expect(loaded.hipSafeFlag).toBe(true);
    expect(loaded.delayUntil).toBe('2026-08-01');
    expect(loaded.acceptedWeeks).toEqual({ '2026-07-13': [] });
    expect(loaded.ptClearedIntensity).toBe(false); // filled default
  });
});

describe('backup / restore preserves everything', () => {
  it('v2 backup round-trip preserves all run fields and the full globals object', () => {
    const runs = makeRunFixture();
    const globals = makeGlobalsFixture();
    const text = JSON.stringify(buildBackup(runs, globals));
    const parsed = parseBackup(text);
    expect(parsed.runs).toEqual(runs);
    // globals passes through migrateGlobalState — identity on complete state.
    expect(parsed.globals).toEqual(globals);
  });

  it('restoring an ORIGINAL v1 flat export cannot wipe current globals (globals === null)', () => {
    const runs = makeRunFixture();
    const text = JSON.stringify(runs); // pre-update flat export
    const parsed = parseBackup(text);
    expect(parsed.runs).toEqual(runs);
    expect(parsed.globals).toBeNull();
  });
});

describe('sync merge is field-preserving (protects pain logs from legacy fallback)', () => {
  it('a NEWER remote row missing v2 fields keeps the local painDuring / rpe', () => {
    const local: RunState = {
      '2026-07-06': {
        date: '2026-07-06', done: true, miles_actual: 4.5, updated_at: '2026-07-06T12:00:00Z',
        rpe: 4, painDuring: 2, painNextAM: 0, didStrides: true, strideNote: 'flat grass',
      },
    };
    // Legacy-column fallback: newer, but stripped of subjective fields.
    const remote: RunEntry[] = [
      { date: '2026-07-06', done: true, miles_actual: 5.0, updated_at: '2026-07-06T20:00:00Z' },
    ];
    const merged = mergeStates(local, remote);
    expect(merged['2026-07-06'].miles_actual).toBe(5.0);     // newer core value wins
    expect(merged['2026-07-06'].painDuring).toBe(2);         // local subjective preserved
    expect(merged['2026-07-06'].rpe).toBe(4);
    expect(merged['2026-07-06'].strideNote).toBe('flat grass');
    expect(merged['2026-07-06'].didStrides).toBe(true);
  });

  it('a newer remote row WITH v2 fields overrides local subjective values', () => {
    const local: RunState = {
      '2026-07-06': { date: '2026-07-06', done: true, miles_actual: 4.5, updated_at: '2026-07-06T12:00:00Z', painDuring: 2 },
    };
    const remote: RunEntry[] = [
      { date: '2026-07-06', done: true, miles_actual: 4.5, updated_at: '2026-07-06T20:00:00Z', painDuring: 5 },
    ];
    expect(mergeStates(local, remote)['2026-07-06'].painDuring).toBe(5);
  });

  it('an OLDER remote row never overwrites a newer, field-complete local entry', () => {
    const local: RunState = {
      '2026-07-06': { date: '2026-07-06', done: true, miles_actual: 5, updated_at: '2026-07-06T20:00:00Z', painDuring: 1 },
    };
    const remote: RunEntry[] = [
      { date: '2026-07-06', done: false, miles_actual: null, updated_at: '2026-07-06T10:00:00Z' },
    ];
    const merged = mergeStates(local, remote);
    expect(merged['2026-07-06'].miles_actual).toBe(5);
    expect(merged['2026-07-06'].painDuring).toBe(1);
  });
});
