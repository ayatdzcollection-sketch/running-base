import { useState } from 'react';
import { heatGuidance, type HeatLevel } from '../lib/heat';

// Manual temp + humidity → display-only running guidance. In heat your heart
// rate drifts up at the same pace, so the advice is always "slow the pace to
// hold the same easy effort." It never changes your HR ceiling, the long-run
// cap, the pain cap, or any speed gate — those are unconditional. Nothing is
// stored; this is a quick look-up before you head out.

const TONE: Record<HeatLevel, { chip: string; ring: string }> = {
  mild: { chip: 'bg-teal-500/10 text-teal-300 border-teal-500/30', ring: 'border-teal-500/20' },
  moderate: { chip: 'bg-amber-500/10 text-amber-300 border-amber-500/30', ring: 'border-amber-500/20' },
  high: { chip: 'bg-amber-500/[0.14] text-amber-200 border-amber-500/40', ring: 'border-amber-500/30' },
  extreme: { chip: 'bg-rose-500/10 text-rose-300 border-rose-500/30', ring: 'border-rose-500/30' },
};

export default function HeatEffort() {
  const [unit, setUnit] = useState<'F' | 'C'>('F');
  const [temp, setTemp] = useState('72');
  const [humidity, setHumidity] = useState('50');

  const t = parseFloat(temp);
  const h = parseFloat(humidity);
  const valid = Number.isFinite(t) && Number.isFinite(h);
  const tempF = unit === 'C' ? t * 9 / 5 + 32 : t;
  const g = valid ? heatGuidance(tempF, h) : null;
  const tone = g ? TONE[g.level] : null;

  return (
    <section data-block="weather" className="card !rounded-2xl px-[18px] py-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-slate-500">HEAT-ADJUSTED EFFORT</span>
        <span className="text-[11px] text-slate-700">guidance only</span>
      </div>

      <div className="flex items-end gap-2">
        <label className="flex-1 flex flex-col gap-1">
          <span className="text-[10.5px] text-slate-600">temperature</span>
          <div className="flex">
            <input inputMode="decimal" value={temp} onChange={e => setTemp(e.target.value)}
              className="w-full min-w-0 bg-ink border border-border rounded-l-[10px] px-3 py-2 text-[15px] text-slate-200 tabular-nums outline-none focus:border-amber-500/50 transition" />
            <button onClick={() => setUnit(u => (u === 'F' ? 'C' : 'F'))}
              className="shrink-0 px-2.5 rounded-r-[10px] border border-l-0 border-border bg-card-alt text-slate-400 font-display text-[12.5px] font-semibold hover:text-slate-200 transition">
              °{unit}
            </button>
          </div>
        </label>
        <label className="w-[92px] flex flex-col gap-1">
          <span className="text-[10.5px] text-slate-600">humidity %</span>
          <input inputMode="decimal" value={humidity} onChange={e => setHumidity(e.target.value)}
            className="bg-ink border border-border rounded-[10px] px-3 py-2 text-[15px] text-slate-200 tabular-nums outline-none focus:border-amber-500/50 transition" />
        </label>
      </div>

      {g && tone && (
        <div className={`flex flex-col gap-2.5 rounded-xl bg-ink border ${tone.ring} px-3 py-3`}>
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className={`inline-flex items-center px-[11px] py-1 rounded-full font-display text-[11px] font-semibold tracking-[0.05em] border ${tone.chip}`}>
              {g.headline}
            </span>
            <span className="ml-auto text-[11px] text-slate-600 tabular-nums">feels like {g.heatIndexF}°F</span>
          </div>
          {g.level !== 'mild' && (
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg bg-card-alt border border-border py-2">
                <div className="font-display text-base font-semibold tabular-nums text-slate-200">+{g.hrDriftBpm}</div>
                <div className="text-[10px] text-slate-600">est. bpm at same pace</div>
              </div>
              <div className="rounded-lg bg-card-alt border border-border py-2">
                <div className="font-display text-base font-semibold tabular-nums text-slate-200">+{g.paceAddSecPerMi}s</div>
                <div className="text-[10px] text-slate-600">per mile, to hold effort</div>
              </div>
            </div>
          )}
          <p className="m-0 text-[12px] leading-relaxed text-slate-400">{g.advice}</p>
        </div>
      )}

      <p className="m-0 text-[10.5px] leading-relaxed text-slate-600">
        Based on the NWS heat index. Your HR ceiling and every plan limit stay exactly the same — in heat you ease the pace to hold the same effort. Guidance only; nothing is recorded or changed.
      </p>
    </section>
  );
}
