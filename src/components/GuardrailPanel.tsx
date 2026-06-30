import { useState } from 'react';
import { TRAILING_LONGEST, CAP_FACTOR, HR } from '../config/plan';

export default function GuardrailPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="card space-y-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-1 py-1 text-left hover:opacity-80 transition"
      >
        <h3 className="font-display text-sm font-semibold text-slate-400">
          Governor rules
        </h3>
        <span className="text-slate-600 text-xs">{open ? '▴ hide' : '▾ show'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <Rule
            color="amber"
            title={`Long-run cap (×${CAP_FACTOR})`}
            body={`No single run over ~110% of your longest in the trailing 30 days. Anchor: ${TRAILING_LONGEST} mi → cap ≈ ${(TRAILING_LONGEST * CAP_FACTOR).toFixed(1)} mi per session. The Friday long run is the week ceiling — weekday runs stay under it. Miss a week? Drop the long run to 1.1× your actual recent longest. Never resume the ladder blindly.`}
          />
          <Rule
            color="rose"
            title={`HR ceiling — not pace`}
            body={`${HR.easyMin}–${HR.easyMax} bpm, hard cap ${HR.hardCap}. HRmax ≈ ${HR.hrmax}. Pace targets let you drift too hard on hills, heat, or tired legs — and you unconsciously run ~170 bpm in groups when easy should be 140–150. The talk test is too loose (it permits the grey zone). The cap is real-time: if HR hits ${HR.hardCap}, walk until it drops.`}
          />
          <Rule
            color="rose"
            title="No speed"
            body="Zero intervals, tempo, or fartlek until your PT/doctor explicitly clears it. The hip flares on speed, not easy volume. Keep the strength work (calf raises, tib raises, clamshells, eccentrics) going throughout."
          />
          <Rule
            color="sky"
            title="Hip flares → repeat the week"
            body="Pain during a run or the next morning means stop, don't advance. Drop back to the prior week or full rest. Reactive tendinopathy settles with load reduction, not loading through it. A short pause costs almost nothing — aerobic fitness holds ~10 days before meaningful decay."
          />
        </div>
      )}
    </div>
  );
}

interface RuleProps {
  color: 'amber' | 'rose' | 'sky';
  title: string;
  body: string;
}

function Rule({ color, title, body }: RuleProps) {
  const bar = {
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
    sky: 'bg-sky-500',
  }[color];

  return (
    <div className="flex gap-3">
      <div className={`w-0.5 rounded-full shrink-0 ${bar} opacity-70`} />
      <div className="space-y-0.5">
        <p className="font-display text-sm font-semibold text-slate-300">{title}</p>
        <p className="text-xs text-slate-500 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
