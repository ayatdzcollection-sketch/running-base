interface Props {
  hrBand: string;
  hrMax: number;
}

export default function ResearchFooter({ hrBand, hrMax }: Props) {
  return (
    <footer data-block="evidence" className="space-y-3 text-[11px] text-slate-600 leading-relaxed px-1 pt-2">
      <h4 className="font-display text-[10.5px] font-semibold text-slate-500 uppercase tracking-[0.12em]">
        Evidence behind the rules
      </h4>

      <Cite
        strength="MODERATE"
        source="Frandsen et al., Br J Sports Med 2025;59(17):1203–1210 (PMID 40623829)"
        finding="Single-session spike: the load-bearing rule. 5,205 runners, 18 months: overuse-injury rate rose once a run passed ~110% of the trailing-30-day longest, while week-to-week ratio showed no association."
        caveat="Cohort mean age 45.8, a reasonable extrapolation to a teen, not a direct match."
      />

      <Cite
        strength="WHY NOT WEEKLY"
        source="Buist et al., Am J Sports Med 2010;38(2):273–280 (GRONORUN RCT); Impellizzeri et al., IJSPP 2020;15(6):907–913"
        finding="The 10% weekly rule produced no injury reduction in the GRONORUN RCT; the acute:chronic workload ratio has no validated causal basis."
        caveat="This is why the cap is per-session, not per-week."
      />

      <Cite
        strength="MODEL"
        source="Cook JL & Purdam CR, Br J Sports Med 2009;43:409–416"
        finding="Reactive tendinopathy continuum: a reactive tendon settles with load reduction, not progressive loading."
        caveat="A clinical model, not a prediction trial. Consistent with the hold-don't-advance flare rule."
      />

      <Cite
        strength="MODERATE (mechanistic)"
        source="Yokozawa, Fujii & Ae, J Biomech 2007;40:3467–3475"
        finding="Uphill running raises hip-flexor / iliopsoas recruitment, the exact tissue being recovered. Hills therefore stay locked behind flat strides, a hip-safe flag, and PT sign-off."
        caveat="Biomechanics study, not an injury trial."
      />

      <Cite
        strength="MODERATE (extrapolated)"
        source="Silbernagel et al., Am J Sports Med 2007;35(6):897–906"
        finding="Pain-monitoring: loading pain up to ~5/10 is tolerable if it settles by next morning and doesn't rise week to week (Achilles/patellar evidence)."
        caveat="Extrapolated to iliopsoas. We run a tighter 3/10 default."
      />

      <Cite
        strength="WEAK / consensus"
        source="Krabak et al., Br J Sports Med 2021;55(6):305–318"
        finding="Youth: no evidence base for numeric mileage caps by age; prior injury is the strongest predictor of future injury."
        caveat="Which is why advancement gates on readiness and pain, not age."
      />

      <Cite
        strength="CONSENSUS"
        source="Easy by HR, standard zone physiology"
        finding={`${hrBand} bpm is roughly ${Math.round((parseInt(hrBand) / hrMax) * 100)}–${Math.round((parseInt(hrBand.split('–')[1] || hrBand) / hrMax) * 100)}% of an estimated HRmax ~${hrMax}, below the first ventilatory threshold.`}
        caveat="Estimated, not lab-measured; pair with the conversational-effort check."
      />

      <Cite
        strength="MODERATE"
        source="Riegel race-time model · Runner's World 1977 / Athletics 1981"
        finding="Projects times across distances via T₂ = T₁ × (D₂/D₁)^1.06, about 80% accurate, best within one order of magnitude. Used to set paces for later blocks, not this block's runs."
        caveat="A fitness ceiling, not a promise. Needs a genuine all-out effort; youth projections applied cautiously."
      />

      <p className="pt-2 border-t border-border text-slate-700">
        Progress saves on this device. Assumes the hip stays pain-free on easy running.
        If it doesn't, hold and tell your PT.{' '}
        <strong className="text-slate-600">Not medical advice.</strong>
      </p>
    </footer>
  );
}

interface CiteProps {
  strength: string;
  source: string;
  finding: string;
  caveat: string;
}

function Cite({ strength, source, finding, caveat }: CiteProps) {
  const strengthColor: Record<string, string> = {
    'MODERATE': 'text-teal-600',
    'MODERATE (mechanistic)': 'text-teal-600',
    'MODERATE (extrapolated)': 'text-teal-600',
    'WHY NOT WEEKLY': 'text-amber-600',
    'MODEL': 'text-sky-600',
    'CONSENSUS': 'text-slate-500',
    'WEAK / consensus': 'text-slate-500',
  };

  return (
    <div className="space-y-0.5">
      <p className={`font-semibold ${strengthColor[strength] ?? 'text-slate-500'}`}>
        [{strength}] {source}
      </p>
      <p>{finding}</p>
      <p className="text-slate-700 italic">{caveat}</p>
    </div>
  );
}
