// ============================================================
// RESTORE AUTHORITY — an explicit restore must win, and propagate.
//
// Regression guard for a silent data-loss path: restore used to be gated on
// `imported.updated_at > current.updated_at`, so restoring an OLDER backup did
// nothing at all — the exact case that matters, because the state you want back
// is usually older than whatever replaced it. The stale timestamp then also lost
// the sync merge, so the cloud kept the state you were trying to discard.
// ============================================================

import { describe, it, expect } from 'vitest';
import { restoredGlobals, mergeGlobalStates } from '../storage';
import { defaultGlobalState } from '../migrate';
import { defaultSettings } from '../settings';
import type { GlobalState } from '../types';

const OLD = '2026-07-19T11:09:57.820Z';   // the good backup
const NEW = '2026-07-19T11:40:59.650Z';   // the defaults that replaced it
const NOW = '2026-07-19T13:00:00.000Z';

function state(stamp: string, patch: Partial<GlobalState> = {}): GlobalState {
  const g = defaultGlobalState(stamp);
  return {
    ...g,
    updated_at: stamp,
    settings: { ...defaultSettings(stamp), updated_at: stamp },
    ...patch,
  };
}

describe('restoredGlobals', () => {
  it('restamps the blob so an OLDER backup still wins', () => {
    const backup = state(OLD, { painTrackingSince: '2026-07-08' });
    const restored = restoredGlobals(backup, NOW);

    expect(restored.updated_at).toBe(NOW);
    expect(restored.updated_at > NEW).toBe(true);   // now beats the defaults
    expect(restored.painTrackingSince).toBe('2026-07-08'); // content preserved
  });

  it('restamps settings too — mergeGlobalStates elects settings separately', () => {
    const backup = state(OLD, { painTrackingSince: '2026-07-08' });
    const restored = restoredGlobals(backup, NOW);
    expect(restored.settings!.updated_at).toBe(NOW);
  });

  it('the restored state beats the defaults through a full sync merge', () => {
    // The device that replaced everything with defaults.
    const defaults = state(NEW, { painTrackingSince: '2026-07-19' });
    defaults.settings = { ...defaults.settings!, buildStep: 1.5, updated_at: NEW };

    // The good backup, restored.
    const backup = state(OLD, { painTrackingSince: '2026-07-08' });
    backup.settings = { ...backup.settings!, buildStep: 2, updated_at: OLD };
    const restored = restoredGlobals(backup, NOW);

    // Merge in BOTH directions — the restore must win either way.
    for (const merged of [
      mergeGlobalStates(restored, defaults),
      mergeGlobalStates(defaults, restored),
    ]) {
      expect(merged.settings!.buildStep).toBe(2);
      expect(merged.updated_at).toBe(NOW);
    }
  });

  it('without restamping, the older backup would LOSE (documents the old bug)', () => {
    const defaults = state(NEW);
    defaults.settings = { ...defaults.settings!, buildStep: 1.5, updated_at: NEW };
    const backup = state(OLD);
    backup.settings = { ...backup.settings!, buildStep: 2, updated_at: OLD };

    // Un-restamped: the defaults win purely on recency. This is what used to ship.
    const merged = mergeGlobalStates(backup, defaults);
    expect(merged.settings!.buildStep).toBe(1.5);
  });

  it('tolerates a backup with no settings', () => {
    const backup = state(OLD, { settings: null });
    const restored = restoredGlobals(backup, NOW);
    expect(restored.settings).toBeNull();
    expect(restored.updated_at).toBe(NOW);
  });
});
