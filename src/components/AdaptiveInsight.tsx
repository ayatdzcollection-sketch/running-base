import type { AdaptiveProfile } from '../lib/adaptive';

// Shows how the runner's own response personalizes their plan. Transparent and
// motivating, and honest about the one direction it moves: it can only ease the
// build or hold the long run, never push past the population-capped rate. As of
// Phase 2A this modulation shapes BOTH the displayed rolling plan (future/unlocked
// weeks) and the weeks you Generate — the card explains the same adjustment the
// plan applies. Display + reasons only.

const TONE: Record<AdaptiveProfile['readiness'], { chip: string; bar: string }> = {
  building: { chip: 'bg-teal-500/10 text-teal-300 border-teal-500/30', bar: '#2dd4bf' },
  steady:   { chip: 'bg-teal-500/10 text-teal-300 border-teal-500/30', bar: '#2dd4bf' },
  cautious: { chip: 'bg-amber-500/10 text-amber-300 border-amber-500/30', bar: '#f59e0b' },
  hold:     { chip: 'bg-rose-500/10 text-rose-300 border-rose-500/30', bar: '#fb7185' },
};

export default function AdaptiveInsight({ profile }: { profile: AdaptiveProfile }) {
  const tone = TONE[profile.readiness];
  const pct = Math.round(profile.growthFactor * 100);

  return (
    <section data-block="adaptive" className="card !rounded-2xl px-[18px] py-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-slate-500">TRAINING RESPONSE</span>
        <span className="text-[11px] text-slate-700">shapes your rolling plan</span>
      </div>

      <div className="flex items-center gap-2.5 flex-wrap">
        <span className={`inline-flex items-center px-[11px] py-1 rounded-full font-display text-[11px] font-semibold tracking-[0.05em] border ${tone.chip}`}>
          {profile.headline}
        </span>
      </div>

      {/* Build-rate bar: how much of the normal (already-capped) step is in play. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2 text-[11.5px] text-slate-500 tabular-nums">
          <span>Build rate</span>
          <span className="font-display text-slate-300 font-semibold">{pct}%</span>
          <span className="text-slate-600">of the normal safe step</span>
        </div>
        <div className="h-1.5 bg-border rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: tone.bar }} />
        </div>
      </div>

      {/* Signals from the runner's own log. */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <Signal label="clean weeks" value={String(profile.cleanWeeks)} />
        <Signal label="pain days / 90" value={String(profile.breachDays90)} />
        <Signal label="adherence" value={`${Math.round(profile.adherence * 100)}%`} />
      </div>

      <div className="flex flex-col gap-1 border-t border-[#101a2c] pt-2.5">
        {profile.reasons.map((r, i) => (
          <p key={i} className="m-0 text-[11.5px] leading-snug text-slate-500">{r}</p>
        ))}
        <p className="m-0 text-[11px] leading-snug text-slate-600">
          This eases your upcoming rolling plan and the weeks you Generate — it only ever slows
          the build or holds the long run, never raises your caps or unlocks speed. Locked and
          completed weeks are never changed.
        </p>
      </div>
    </section>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-ink border border-border py-2">
      <div className="font-display text-base font-semibold tabular-nums text-slate-200">{value}</div>
      <div className="text-[10px] text-slate-600">{label}</div>
    </div>
  );
}
