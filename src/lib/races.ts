// ============================================================
// RACE PROJECTIONS — DISPLAY ONLY.
//
// Riegel race-time model: T₂ = T₁ × (D₂/D₁)^1.06 (Riegel, Runner's World
// 1977 / Athletics 1981). ~80% accurate, best within one order of magnitude
// (mile ↔ 5K). These are ESTIMATES used to show projected times/paces and to
// set paces for blocks AFTER this base phase — never inputs to this block.
//
// SAFETY BY CONSTRUCTION: this module imports only ./types. Nothing in the
// plan, generator, speed machine, metrics, or todaySpeed imports it, so a race
// result can never raise an HR cap, a long-run cap, or unlock a speed state.
// (races.test.ts asserts this with byte-identical no-escalation proofs.)
// ============================================================

import type { RaceResult } from './types';

export const RIEGEL_EXPONENT = 1.06;
const MI_PER_M = 1 / 1609.34;

export interface StdDistance { key: string; label: string; miles: number }

/** The distances the projection table shows (matches the design). */
export const STD_DISTANCES: StdDistance[] = [
  { key: 'mile', label: 'Mile', miles: 1 },
  { key: '3200', label: '3200 m', miles: 3200 * MI_PER_M },
  { key: '5k', label: '5K', miles: 5000 * MI_PER_M },
];

/** Prototype dist string → miles (for loading the design's single-race blob). */
export const PROTO_DIST_MI: Record<string, number> = {
  mile: 1,
  '3200': 3200 * MI_PER_M,
  '5k': 5000 * MI_PER_M,
};

export function riegelPredict(fromTimeSec: number, fromMiles: number, toMiles: number, exponent = RIEGEL_EXPONENT): number {
  if (fromMiles <= 0 || toMiles <= 0) return NaN;
  return fromTimeSec * Math.pow(toMiles / fromMiles, exponent);
}

export interface RacePrediction {
  key: string;
  label: string;
  distanceMi: number;
  timeSec: number;
  paceSecPerMi: number;
  logged: boolean;   // this row is the actual logged result
}

/** Projection table from the most recent race result. Empty if no races. */
export function predictionTable(races: RaceResult[]): RacePrediction[] {
  if (!races.length) return [];
  const base = [...races].sort((a, b) => (a.date < b.date ? 1 : -1))[0]; // most recent
  return STD_DISTANCES.map(sd => {
    const logged = Math.abs(sd.miles - base.distanceMi) < 0.05;
    const timeSec = logged ? base.timeSec : riegelPredict(base.timeSec, base.distanceMi, sd.miles);
    return {
      key: sd.key, label: sd.label, distanceMi: sd.miles,
      timeSec, paceSecPerMi: timeSec / sd.miles, logged,
    };
  });
}

/** Merge race lists by id, newest updated_at per id (multi-device safe). */
export function mergeRaces(local: RaceResult[], remote: RaceResult[]): RaceResult[] {
  const byId = new Map<string, RaceResult>();
  for (const r of local) byId.set(r.id, r);
  for (const r of remote) {
    const ex = byId.get(r.id);
    if (!ex || r.updated_at > ex.updated_at) byId.set(r.id, r);
  }
  return [...byId.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '–';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
