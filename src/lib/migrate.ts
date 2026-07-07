// ============================================================
// ADDITIVE MIGRATION — v2 speed layer.
//
// Rules this module guarantees:
//  * Never wipes or replaces existing data. The per-day run log
//    (bb_run_state) is not touched at all — new per-day fields are
//    optional on RunEntry, so old entries remain valid as-is.
//  * Global state lives under a NEW key (bb_global_state). Migration
//    only fills in keys that are absent; existing values (and any
//    unknown keys from future versions) are preserved verbatim.
//  * Idempotent: migrate(migrate(x)) === migrate(x).
// ============================================================

import type { GlobalState, SpeedStateNum } from './types';
import { TUNABLES } from '../config/tunables';

export const SCHEMA_VERSION = 2;

export function defaultGlobalState(nowIso: string): GlobalState {
  return {
    schemaVersion: SCHEMA_VERSION,
    speedState: 1,                 // base only
    hipSafeFlag: false,
    ptClearedSpeed: false,
    ptClearedIntensity: false,
    painFreeEasyRunStreak: 0,      // snapshot; live value derived from logs
    painCap: TUNABLES.PAIN_CAP_DEFAULT, // 3/10 — research ceiling is 5, we run tighter
    lastFastSessionDate: null,
    lastLongRunDate: null,
    delayUntil: null,
    readiness: {},
    acceptedWeeks: {},
    updated_at: nowIso,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Additive migration: start from `raw`, add ONLY the keys that are missing,
 * using safe defaults. Never removes or overwrites a present key.
 */
export function migrateGlobalState(raw: unknown, nowIso: string): GlobalState {
  const defaults = defaultGlobalState(nowIso);
  if (!isRecord(raw)) return defaults;

  const out: Record<string, unknown> = { ...raw };
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in out) || out[key] === undefined) out[key] = value;
  }

  // Clamp obviously-corrupt values without discarding the rest of the state.
  const st = Number(out.speedState);
  out.speedState = (Number.isInteger(st) && st >= 1 && st <= 8 ? st : 1) as SpeedStateNum;
  const cap = Number(out.painCap);
  out.painCap = Number.isFinite(cap) && cap >= 0 && cap <= 10 ? cap : defaults.painCap;
  if (!isRecord(out.readiness)) out.readiness = {};
  if (!isRecord(out.acceptedWeeks)) out.acceptedWeeks = {};

  // Stamp version LAST so a partially-old object still gets every key above.
  const ver = Number(out.schemaVersion);
  out.schemaVersion = Number.isInteger(ver) && ver > SCHEMA_VERSION ? ver : SCHEMA_VERSION;

  return out as unknown as GlobalState;
}
