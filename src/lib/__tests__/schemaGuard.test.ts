// ============================================================
// PHASE 2D HARDENING — schema guard for synced global state.
//
// The speed ladder was RENUMBERED at schemaVersion 3, so a blob interpreted
// under an older schema must never overwrite newer semantics:
//  • merge: the higher-schema blob always wins the base election, regardless
//    of updated_at (equal schemas keep the newest-updated_at rule).
//  • write: this build only publishes blobs stamped EXACTLY its own schema
//    (canWriteGlobalSchema) — so when schema 4 ships someday, today's build
//    can't clobber the newer row the way a v2 build could have clobbered v3.
//  • all ingress paths (local load, Supabase pull, backup restore) migrate,
//    so a v2 blob is remapped to v3 before anything consumes it.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadGlobalLocal, saveGlobalLocal, mergeGlobalStates, canWriteGlobalSchema,
  buildBackup, parseBackup,
} from '../storage';
import { defaultGlobalState, migrateGlobalState, SCHEMA_VERSION } from '../migrate';
import type { GlobalState, RunState } from '../types';

const NOW = '2026-07-07T12:00:00Z';

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

function v3(patch: Partial<GlobalState> = {}): GlobalState {
  return { ...defaultGlobalState(NOW), ...patch };
}

describe('ingress paths migrate v2 → v3', () => {
  it('a v2 localStorage blob loads remapped to v3 tiers', () => {
    // Old scale: 7 = structured speed. New scale: 8 = VO₂/race.
    (globalThis.localStorage as Storage).setItem(
      'bb_global_state',
      JSON.stringify({ schemaVersion: 2, speedState: 7, hipSafeFlag: true }),
    );
    const g = loadGlobalLocal();
    expect(g.schemaVersion).toBe(SCHEMA_VERSION);
    expect(g.speedState).toBe(8);
    expect(g.hipSafeFlag).toBe(true);
    // Round-trips cleanly: save → load is stable (no double remap).
    saveGlobalLocal(g);
    expect(loadGlobalLocal()).toEqual(g);
  });

  it('a v2 backup restores remapped to v3 (old flare 8 → relocked 0, not VO₂ tier)', () => {
    const runs: RunState = {
      '2026-07-06': { date: '2026-07-06', done: true, miles_actual: 4, updated_at: NOW },
    };
    const legacyGlobals = { ...defaultGlobalState(NOW), schemaVersion: 2, speedState: 8 } as GlobalState;
    const text = JSON.stringify(buildBackup(runs, legacyGlobals));
    const parsed = parseBackup(text);
    expect(parsed.globals?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.globals?.speedState).toBe(0); // flare/deload → relock, re-earn
    expect(parsed.runs).toEqual(runs);
  });

  it('migration remains idempotent (migrate ∘ migrate = migrate)', () => {
    const once = migrateGlobalState({ schemaVersion: 2, speedState: 6, painCap: 2 }, NOW);
    const twice = migrateGlobalState(once, NOW);
    expect(twice).toEqual(once);
    expect(once.speedState).toBe(6); // old threshold → cruise, stable thereafter
  });
});

describe('mergeGlobalStates schema guard', () => {
  it('a v3 remote is NOT overwritten by a stale older-schema local, even with a newer timestamp', () => {
    // Remote: proper v3 state, relocked to tier 0 after a flare, older stamp.
    const remote = v3({ speedState: 0, updated_at: '2026-07-06T10:00:00Z' });
    // Local: an older-schema interpretation (v2 semantics) with a NEWER stamp
    // and a speed state that would mean something else entirely on v3.
    const local = {
      ...v3({ speedState: 8, updated_at: '2026-07-07T10:00:00Z' }),
      schemaVersion: 2,
    } as GlobalState;

    const merged = mergeGlobalStates(local, remote);
    expect(merged.schemaVersion).toBe(3);
    expect(merged.speedState).toBe(0);          // newer-schema semantics win
    expect(merged.updated_at).toBe(remote.updated_at);
  });

  it('symmetric: a newer-schema LOCAL beats an older-schema remote (future-proof direction)', () => {
    const local = v3({ speedState: 2, updated_at: '2026-07-06T10:00:00Z' });
    const remote = {
      ...v3({ speedState: 7, updated_at: '2026-07-07T10:00:00Z' }),
      schemaVersion: 2,
    } as GlobalState;
    const merged = mergeGlobalStates(local, remote);
    expect(merged.speedState).toBe(2);
    expect(merged.schemaVersion).toBe(3);
  });

  it('the per-field stores still union under the schema guard (nothing is dropped)', () => {
    const remote = v3({ speedState: 0, updated_at: '2026-07-06T10:00:00Z' });
    remote.acceptedWeeks = { '2026-07-13': [] };
    const local = {
      ...v3({ speedState: 8, updated_at: '2026-07-07T10:00:00Z' }),
      schemaVersion: 2,
    } as GlobalState;
    local.acceptedWeeks = { '2026-07-20': [] };
    local.notes = { '2026-07-05': 'felt good' };

    const merged = mergeGlobalStates(local, remote);
    expect(Object.keys(merged.acceptedWeeks).sort()).toEqual(['2026-07-13', '2026-07-20']);
    expect(merged.notes?.['2026-07-05']).toBe('felt good');
    expect(merged.speedState).toBe(0); // the guarded base still holds
  });

  it('normal v3 ↔ v3 sync is unchanged: newest updated_at wins the base', () => {
    const older = v3({ speedState: 2, updated_at: '2026-07-06T10:00:00Z' });
    const newer = v3({ speedState: 3, updated_at: '2026-07-07T10:00:00Z' });
    expect(mergeGlobalStates(older, newer).speedState).toBe(3); // remote newer
    expect(mergeGlobalStates(newer, older).speedState).toBe(3); // local newer
  });
});

describe('canWriteGlobalSchema — sync write guard', () => {
  it('publishes only blobs stamped exactly this build’s schema', () => {
    expect(canWriteGlobalSchema(v3())).toBe(true);
    expect(canWriteGlobalSchema({ ...v3(), schemaVersion: SCHEMA_VERSION + 1 } as GlobalState)).toBe(false); // future row: read-only
    expect(canWriteGlobalSchema({ ...v3(), schemaVersion: 2 } as GlobalState)).toBe(false);                  // un-migrated: never publish
    expect(canWriteGlobalSchema({ ...v3(), schemaVersion: Number.NaN } as GlobalState)).toBe(false);
  });

  it('everything the normal pipeline produces IS writable (guard is invisible in the happy path)', () => {
    // local load, remote migrate, and backup restore all stamp SCHEMA_VERSION.
    expect(canWriteGlobalSchema(loadGlobalLocal())).toBe(true);
    expect(canWriteGlobalSchema(migrateGlobalState({ schemaVersion: 2, speedState: 5 }, NOW))).toBe(true);
    const restored = parseBackup(JSON.stringify(buildBackup({}, v3()))).globals!;
    expect(canWriteGlobalSchema(restored)).toBe(true);
  });
});
