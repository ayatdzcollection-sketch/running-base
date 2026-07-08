// ============================================================
// HEAT-ADJUSTED EFFORT — display-only guidance. PURE.
//
// Given a manually-entered temperature and humidity, estimate the apparent
// temperature (NWS heat index) and translate it into plain guidance: in heat
// your heart rate drifts up at the same pace, so SLOW THE PACE to hold the same
// easy effort. That is the whole point — the HR ceiling and every other gate
// stay exactly where they are. This module is never imported by the plan,
// generator, speed, or metrics engines; its output is text/numbers to render.
// ============================================================

export type HeatLevel = 'mild' | 'moderate' | 'high' | 'extreme';

export interface HeatGuidance {
  heatIndexF: number;        // apparent temperature (°F), rounded
  level: HeatLevel;
  hrDriftBpm: number;        // ESTIMATE of extra HR at the same easy pace (display only)
  paceAddSecPerMi: number;   // suggested easing to hold the same effort (display only)
  headline: string;
  advice: string;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * NWS heat index (Rothfusz regression) in °F. Below ~80°F it reduces to a
 * simple apparent-temperature form. T in °F, RH in whole percent.
 */
export function heatIndexF(tempF: number, humidityPct: number): number {
  const T = clamp(tempF, -30, 130);
  const R = clamp(humidityPct, 0, 100);

  // Simple form (Steadman) — used when it averages below 80°F with the temp.
  const simple = 0.5 * (T + 61 + (T - 68) * 1.2 + R * 0.094);
  if ((T + simple) / 2 < 80) return simple;

  let HI =
    -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R -
    0.00683783 * T * T - 0.05481717 * R * R + 0.00122874 * T * T * R +
    0.00085282 * T * R * R - 0.00000199 * T * T * R * R;

  // Low-humidity and high-humidity adjustments (NWS).
  if (R < 13 && T >= 80 && T <= 112) {
    HI -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  } else if (R > 85 && T >= 80 && T <= 87) {
    HI += ((R - 85) / 10) * ((87 - T) / 5);
  }
  return HI;
}

/**
 * Translate temp + humidity into display-only running guidance. The numbers are
 * deliberately framed as estimates; nothing here changes a cap or a gate.
 */
export function heatGuidance(tempF: number, humidityPct: number): HeatGuidance {
  const hi = heatIndexF(tempF, humidityPct);
  const heatIndexF_ = Math.round(hi);

  // Bucketed by apparent temperature, tightened for exercise (running heats you
  // faster than the standing heat-index bands assume).
  const level: HeatLevel =
    hi < 80 ? 'mild'
    : hi < 90 ? 'moderate'
    : hi < 103 ? 'high'
    : 'extreme';

  // Estimates scale with apparent temp above a ~70°F comfortable baseline.
  const over = Math.max(0, hi - 70);
  const hrDriftBpm = clamp(Math.round(over / 3), 0, 18);
  const paceAddSecPerMi = clamp(Math.round(over * 2.5), 0, 75);

  const headline =
    level === 'mild' ? 'Comfortable — run as usual'
    : level === 'moderate' ? 'Warm — ease the pace a little'
    : level === 'high' ? 'Hot — slow down and shorten if needed'
    : 'Dangerous heat — reschedule or move indoors';

  const advice =
    level === 'mild'
      ? 'Little heat effect. Keep your normal easy pace and hydrate.'
    : level === 'moderate'
      ? `Expect your heart rate about ${hrDriftBpm} bpm higher at the same pace. Add roughly ${paceAddSecPerMi} sec per mile so effort stays easy — your HR band is still the target.`
    : level === 'high'
      ? `Heart rate can run ${hrDriftBpm}+ bpm high today. Add ${paceAddSecPerMi}+ sec per mile, run by feel and HR (not pace), take fluids, and cut it short if you drift over your ceiling.`
      : 'Very high heat stress. Move the run to a cooler hour, take it indoors, or make it a rest day. No workout is worth a heat illness.';

  return { heatIndexF: heatIndexF_, level, hrDriftBpm, paceAddSecPerMi, headline, advice };
}
