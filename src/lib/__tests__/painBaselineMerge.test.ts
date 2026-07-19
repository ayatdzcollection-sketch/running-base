// ============================================================
// PAIN-TRACKING BASELINE — merge semantics.
//
// painTrackingSince records when this ATHLETE began tracking pain. It is one
// fact about a person, not a per-device value, so "newest blob wins" is the
// wrong tiebreaker for it.
//
// The bug this locks down: a freshly installed browser stamped the baseline to
// TODAY at mount. That write also made the local blob the newest, so the merge
// handed the fresh stamp the win over the athlete's real (earlier) baseline.
// Every logged run was then older than the baseline, so none counted as proven
// pain-free and the streak displayed 0/4 on a device that should have shown 4/4.
// ============================================================

import { describe, it, expect } from 'vitest';
import { mergeGlobalStates } from '../storage';
import { defaultGlobalState } from '../migrate';
import type { GlobalState } from '../types';

const NOW = '2026-07-19T12:00:00Z';

function g(patch: Partial<GlobalState> = {}): GlobalState {
  return { ...defaultGlobalState(NOW), ...patch };
}

describe('painTrackingSince survives a merge with a fresh device', () => {
  it('keeps the EARLIER baseline even when the later one is on the newer blob', () => {
    // The real device: tracking began 07-08, blob written earlier.
    const real = g({ painTrackingSince: '2026-07-08', updated_at: '2026-07-19T11:09:00Z' });
    // A fresh browser that just stamped today — and is therefore NEWEST.
    const fresh = g({ painTrackingSince: '2026-07-19', updated_at: '2026-07-19T11:40:00Z' });

    // Newest-blob-wins would give 2026-07-19 and wipe the streak.
    expect(mergeGlobalStates(fresh, real).painTrackingSince).toBe('2026-07-08');
    expect(mergeGlobalStates(real, fresh).painTrackingSince).toBe('2026-07-08');
  });

  it('is order-independent', () => {
    const a = g({ painTrackingSince: '2026-05-01', updated_at: '2026-07-01T00:00:00Z' });
    const b = g({ painTrackingSince: '2026-06-01', updated_at: '2026-07-19T00:00:00Z' });
    expect(mergeGlobalStates(a, b).painTrackingSince)
      .toBe(mergeGlobalStates(b, a).painTrackingSince);
  });

  it('takes the present value when only one side has one', () => {
    const has = g({ painTrackingSince: '2026-07-08' });
    const none = g({ painTrackingSince: null });
    expect(mergeGlobalStates(none, has).painTrackingSince).toBe('2026-07-08');
    expect(mergeGlobalStates(has, none).painTrackingSince).toBe('2026-07-08');
  });

  it('stays null when neither side has tracked yet (missing = UNKNOWN)', () => {
    const merged = mergeGlobalStates(g({ painTrackingSince: null }), g({ painTrackingSince: null }));
    expect(merged.painTrackingSince).toBeNull();
  });

  it('does not disturb the rest of the merge', () => {
    const local = g({ painTrackingSince: '2026-07-19', speedState: 0, updated_at: '2026-07-19T11:40:00Z' });
    const remote = g({ painTrackingSince: '2026-07-08', speedState: 3, updated_at: '2026-07-19T11:09:00Z' });
    const merged = mergeGlobalStates(local, remote);
    // Base election is unchanged (local is newer, same schema) …
    expect(merged.speedState).toBe(0);
    // … only the baseline is resolved field-wise.
    expect(merged.painTrackingSince).toBe('2026-07-08');
  });
});
