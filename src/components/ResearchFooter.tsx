export default function ResearchFooter() {
  return (
    <footer className="space-y-3 text-[11px] text-slate-600 leading-relaxed">
      <h4 className="font-display text-xs font-semibold text-slate-500 uppercase tracking-wider">
        Evidence behind the rules
      </h4>

      <Cite
        strength="STRONG"
        ref="Frandsen et al., Br J Sports Med 2025;59(17):1203–1210 (PMID 40623829)"
        finding="Overuse-injury rate rose when a single run exceeded ~110% of the longest run in the prior 30 days; weekly mileage didn't predict injury. ~5,200 runners, 18-month prospective (Garmin RUNSAFE)."
        caveat="Cohort mean age 45.8 — reasonable extrapolation to a teen with a reactive tendon, not a direct match."
      />

      <Cite
        strength="MIXED"
        ref="2021 systematic review (multiple sources)"
        finding="Running frequency is not an independent injury-risk factor. Five days/week with volume controlled is reasonable."
        caveat="Lower-quality and inconsistent evidence — treat as a sensible working assumption, not a hard finding."
      />

      <Cite
        strength="MODEL"
        ref="Cook JL & Purdam CR, Br J Sports Med 2009;43(6):409–416"
        finding="Reactive tendinopathy continuum: provoked by sudden load spikes, settles with load reduction. Not progressive loading."
        caveat="A clinical model, not a prediction trial. Consistent with the load-management approach."
      />

      <Cite
        strength="PHYSIOLOGY"
        ref="Standard zone physiology"
        finding="140–150 bpm ≈ 70–76% of HRmax (~198) — below the first ventilatory/lactate threshold. Builds aerobic base with minimal systemic stress."
        caveat="Not contested; applied zone discipline."
      />

      <p className="pt-2 border-t border-border text-slate-700">
        Saves on this device. Assumes the hip stays pain-free on easy running — if it
        doesn't, hold and tell PT. <strong className="text-slate-600">Not medical advice.</strong>
      </p>
    </footer>
  );
}

interface CiteProps {
  strength: string;
  ref: string;
  finding: string;
  caveat: string;
}

function Cite({ strength, ref: refStr, finding, caveat }: CiteProps) {
  const strengthColor: Record<string, string> = {
    STRONG: 'text-teal-600',
    MIXED: 'text-amber-600',
    MODEL: 'text-sky-600',
    PHYSIOLOGY: 'text-slate-500',
  };

  return (
    <div className="space-y-0.5">
      <p className={`font-semibold ${strengthColor[strength] ?? 'text-slate-500'}`}>
        [{strength}] {refStr}
      </p>
      <p>{finding}</p>
      <p className="text-slate-700 italic">{caveat}</p>
    </div>
  );
}
