# Speed Engine Research: Optimal Training Intensity for a Volume-Limited Adolescent Distance Runner

**What this is.** A research report that stress-tests one hypothesis — *"higher intensity
produces faster growth in VO2max, speed, and economy"* — for one specific athlete, and turns
the answer into a concrete specification for how a training-plan engine should dose intensity.
It synthesises the exercise-physiology literature with first-principles mechanism, runs an
adversarial verification pass over every load-bearing claim, and rules explicitly on the four
questions that actually shape a weekly plan: what limits *this* athlete, how to distribute
intensity, how to periodize toward a race, and how to anchor effort when the app logs almost
nothing. The conclusion, in one line: for this athlete the hypothesis is false — the largest
lever is easy aerobic volume that raises critical power, fenced by a small, fixed,
non-escalating quality floor delivered at psoas-moderate intensities.

**Who it is for.** The engineers and coach-facing designers building the app's speed/intensity
engine, and any reader auditing the physiological reasoning behind it. The report is written to
read standalone, end to end.

**The athlete profile (fixed target throughout).** A ~15-year-old (14–18 y) high-school
cross-country runner, ~25 miles per week (~4 h/wk, ~200 h/yr), with a reactive iliopsoas held
to a hard 3/10 pain cap — the muscle inserts at the lesser-trochanter apophysis, a
growth-plate-adjacent site that is the binding structural constraint. He already performs a
heavy leg-day strength session. The app logs **miles, a bare RPE scalar (1–10), and pain — no
duration**, so pace, time-in-zone, and true session-RPE load are all uncomputable from stored
data. Every ruling is made for *him*, not for the trained adults the literature mostly studies.

**How to read the evidence labels.** Every load-bearing claim is graded so a reader can see
exactly how much of the plan is demonstrated and how much is a well-reasoned prior:

- **[DEMONSTRATED]** — shown by controlled or empirical data in a stated population (the
  population is named because most of it is adult or trained-near-adult, not this athlete).
- **[MECHANISTIC INFERENCE]** — derived from physiological mechanism and first principles, not
  directly measured in this population; the direction is defensible, the exact number usually is
  not.
- **[SPECULATION]** — a plausible but unsupported conjecture, flagged precisely so it is never
  allowed to become load-bearing.

The honest split of the ~77 load-bearing claims: **~27% carry direct adolescent data — almost
all of it on the fear-and-cap side of the ledger — ~50% is adult/elite extrapolation (every
dose the engine would prescribe), and ~23% is pure mechanism.** There is zero adolescent RCT on
the four levers that most shape the plan (distribution, peak volume, taper, T@VO2max). The
decisive asymmetry: *adolescent data tells us what to fear and cap; adult data tells us what to
prescribe; mechanism fills the gaps.* This is a well-reasoned mechanistic prior, not a
demonstrated optimum — but its *safety* does not depend on the mechanism being right: every
uncertain call has a fallback that prescribes **less** and defers to the existing runtime safety
layer (3/10 pain cap, flare detection, downward-only guard).

**Where the design lives.** The buildable engine that operationalizes these conclusions — type
shapes, decision tables, proposed tunables, and machine-checkable invariant proofs — is the
report's Section 9, published as the companion document
**[SPEED_ENGINE_DESIGN_SPEC.md](SPEED_ENGINE_DESIGN_SPEC.md)**. This report is the *why*; the
design spec is the *what to build*.

**A note on references.** Section cross-references written as §N or §N.M point within this
report (except the Section-9 slot, which points to the design spec). Brief-name citations —
`fp-central`, `fp-neuro`, `fp-peripheral`, `fp-fatigue`, `ev-intervals`, `ev-distribution`,
`ev-economy`, `ev-anchoring`, `ev-youth`, `ev-taper`, `converge`, `transfer`,
`ground-speed-surface`, `ground-adaptive-surface`, and code paths like `generator.ts:269` —
name the underlying research and codebase-audit briefs this report was assembled from, and are
kept intact as provenance.

## Contents

1. [Executive summary — the 5 decisions that matter most](#s1)
2. [Central hypothesis verdict](#s2)
3. [Mechanistic model of the body](#s3)
4. [Speed workout structures per tier, with progressions](#s4)
5. [Intensity distribution target + rationale](#s5)
6. [Plyometric / neuromuscular protocol](#s6)
7. [Tendon loading (walled-off advisory section)](#s7)
8. [Race-date periodization + ideal MPW model](#s8)
9. Engine design spec — published separately as [SPEED_ENGINE_DESIGN_SPEC.md](SPEED_ENGINE_DESIGN_SPEC.md)
10. [Evidence quality table](#s10)
11. [Where first-principles and literature conflict, and the ruling](#s11)
12. [Open questions and conservative fallbacks](#s12)

<a id="s1"></a>

## 1. Executive summary — the 5 decisions that matter most

The brief asked whether "higher intensity produces faster growth." For this athlete the answer is no — and five decisions follow. Each is contestable (a competent coach would argue the other side) and each changes what the engine builds. If a call here isn't both contestable and consequential, it isn't in this list.

### Decision 1 — Spend the risk budget on easy volume, not on unlocking intensity. The engine is volume-limited by default.

**Reasoning.** A high-school 5k is raced *above* critical power, so race speed = f(VO2max, fractional-utilization CP/VO2max, economy), and CP/VO2max is this athlete's largest untapped reserve (~78–84% vs ~88–92% trained). The critical-speed model makes it quantitative: from `d = v_CP·t + D′`, a 3% CP gain buys ~28 s in a 5k while a 25% anaerobic-reserve gain buys only ~10 s — dTime/dCP is ~2–3× the VO2max lever [MECHANISTIC INFERENCE, derived not cited]. CP is volume-and-threshold-built, and at 25 mpw this athlete sits on the *steep* part of every peripheral curve (mitochondrial density ~6% vs an ~11–12% ceiling). The "HIIT is time-efficient" literature is real but [DEMONSTRATED] in *trained adults on the flat part of the curve* — the wrong population; extrapolated here it inverts the correct advice. The decisive amplifier: intensity's failure mode (iliopsoas flare → layoff) is *common-mode* — one bad session detrains VO2max, economy, and speed at once — so the weekly intensity budget is the precautionary minimum set by the worst outcome, not a sum across benefits.
**Confidence: HIGH (~80%).** Against: CP-dominance and the "steep-part" claim are UNTESTED in a 25-mpw adolescent — no RCT compares +volume vs +hard-session at fixed mileage in this population, and the "2–3× signal per mile" figure is a reasoned guess.
**Changes:** the risk budget buys psoas-gated easy-mileage growth (≤10%/wk toward a ~30–35 mpw ceiling), not tier unlocks. `HARD_BUDGET_BASE` stays 1; a second weekly hard session is never funded.

### Decision 2 — Make threshold (tier 6) the one hard session; keep true VO2max intervals (tier 8) off the auto-schedule.

**Reasoning.** Given a one-session budget, *which* session? Threshold, not VO2max. VO2max is not the binding 5k lever (Decision 1); youth VO2max trainability is small and maturation-confounded (Engel g≈0.10, no passive controls) [DEMONSTRATED as a gap]; and the 3-min VO2max rep is the single highest sustained hip-flexion load in the ladder, landing on the PHV-vulnerable lesser-trochanter apophysis. Threshold pace is the rare band where the metabolic optimum (CP⁻ trains exactly the mitochondrial:glycolytic balance that *defines* CP) and the structural optimum (psoas-moderate) coincide.
**Confidence: MODERATE-HIGH.** Against: every conventional program treats VO2max intervals as the premier quality session; if this athlete were already at his CP ceiling, that lever would matter more than assumed.
**Changes:** tier 6 is the default generated hard session; tier 8 stays auto-suppressed out of season, gated behind coach confirmation + season markers, and ships a concrete 3×3→6×3-min ladder (not a static string) only when finally prescribed.

### Decision 3 — Gate permission on mechanical/hip signals, not metabolic-readiness proxies (HRV, "feeling recovered").

**Reasoning.** Adolescent *metabolic* recovery genuinely is faster (PCr, vagal, lactate clearance). But connective-tissue/apophyseal recovery is equal-or-*slower* circa-PHV. So metabolic-readiness signals recover *before* the tissue does and will systematically over-permit intensity in exactly this athlete — the composite is right-population DEMONSTRATED (converge P-P8), assembled from youth recovery, immature glycolysis, and apophyseal/BSI epidemiology (15–19y = 42.6% of athletic stress fractures). "Youth recover faster" is true metabolically and a trap structurally.
**Confidence: MODERATE-HIGH.** Against: the *iliopsoas-specific* over-permit magnitude rests on inference (site-specific adolescent running data is absent). It wins on safety asymmetry: gating wrong-permissive costs a months-long apophyseal injury; gating wrong-conservative costs a few seconds this season.
**Changes:** the permission ladder reads `painDuring`/`painNextAM`/hip signals and adds *no* HRV or "readiness" input. When a metabolic signal says go and the hip is ambiguous, withhold intensity and hold volume.

### Decision 4 — Prescribe pyramidal (~80/13/7, minutes-in-zone) with a protected Z2; reject polarized 80/20.

**Reasoning.** Polarization's premise is that high absolute easy volume already saturates the aerobic stimulus, so the middle can be emptied for free. At ~3.2 h/wk easy that premise is false — the one clean low-volume RCT (Festa 2020) found threshold-heavy *matched* polarized with 17% less time [DEMONSTRATED]. Polarized's 15–20% Z3 is also ~4–5 mi/wk of the highest-psoas-strain modality, a direct hit on the binding constraint. Elites are descriptively *pyramidal* anyway; "80/20" is largely a session-goal counting artifact (the Z3 fraction swings ~9%→23% under a different denominator).
**Confidence: MODERATE-HIGH.** Against: 80/20 is entrenched orthodoxy, low-volume TID is genuinely contested (Muñoz points pro-polarized), and no adolescent TID trial exists — the specific numbers are extrapolation.
**Changes:** the distribution controller is a thin *downward-only* monitor on the fast-miles fraction (cap the numerator, never add to a floor), measured in minutes-in-zone; the physiological target is ~80/13/7, and the existing caps realise a more-conservative ~92/8/0, which is the safe choice — no new enforcement machinery is needed.

### Decision 5 — Anchor intensity on RPE-plus-behavioral descriptors, not pace/VDOT; keep neuromuscular velocity and hip-tissue cost on axes separate from the metabolic load dial.

**Reasoning.** The app logs miles only — no duration — so VDOT, critical speed, and vVO2max all lack inputs, and race-fitted pace anchors would read *maturation as fitness* in a growing athlete. A behavioral threshold anchor ("holdable ~50–60 min fresh; one sentence not a paragraph") self-calibrates across age [MECHANISTIC INFERENCE]. Separately, speed's sign is *negative* on the metabolic-load axis (fatigued fast reps train slowness), and hills cost ~0 metabolic units yet load the hip most — so velocity-freshness and tissue-cost must be their own axes, or the engine will chase speed with hard running and stack "free" hill days onto a reactive apophysis.
**Confidence: HIGH (forced by the data model and mechanism).** Against: adding a `durationMin` field — the single highest-value future addition — would unlock a within-athlete pace signal and dissolve much of this constraint, so this is partly a limitation dressed as a choice.
**Changes:** every tier ships an RPE descriptor as the *primary* anchor; a Critical-Speed pair may attach a display-only pace hint with no write path to any cap, tier, or budget; strides stay 0 metabolic units but are spaced on a tissue clock, and standalone plyo charges a *tissue* budget parallel to the hard budget.

### What this report concludes, in one paragraph

For this athlete the intensity hypothesis is false: more intensity does not buy faster growth, and the largest lever is easy aerobic volume that raises critical power, fenced by a small, fixed, non-escalating quality floor delivered at psoas-moderate intensities. The engine should therefore spend its scarce risk budget on miles, make threshold its one hard session, gate permission on the hip rather than on metabolic readiness, distribute pyramidally, and anchor on effort rather than pace. **Honesty about the foundation: ~27% of the load-bearing claims carry direct adolescent data — almost all of it on the fear-and-cap side of the ledger — ~50% is adult/elite extrapolation (every dose the engine would prescribe), ~23% is pure mechanism, and there is zero adolescent RCT on the four levers that most shape the plan (distribution, peak volume, taper, T@VO2max).** This is a well-reasoned mechanistic prior, not a demonstrated optimum. Its *safety* does not depend on the mechanism being right — every uncertain call has a fallback that prescribes *less* and defers to the existing runtime safety layer (3/10 pain cap, flare detection, downward-only guard).

### What we are NOT recommending

- **A second/third hard session or a VO2max block** — VO2max is not the binding lever and the extra hip strain is common-mode across all three outcomes.
- **Polarized 80/20** — its aerobic-sufficiency premise fails at 25 mpw; the one clean low-volume RCT shows the middle is efficient, not junk.
- **HRV / readiness-based gating** — metabolic recovery outpaces tissue recovery in youth, so it over-permits exactly this athlete.
- **A dedicated plyometric block or more heavy strength** — heavy leg day plus strides already cover force and SSC; marginal RE gain is ~1–3% and the tendon-stiffness mechanism it targets is unsupported (ankle stiffness↔RE null).
- **VDOT/pace-driven prescription** — no duration is logged, and race-anchored paces would read growth as fitness.

<a id="s2"></a>

## 2. Central hypothesis verdict

The hypothesis under test — **"higher intensity produces faster growth in VO2max, speed, and economy"** — is a single monotonic claim ("higher → faster") bolted onto three outcomes at once. That packaging is its fatal flaw: the three outcomes have *different dose-response curves, different inflection points, and different inversion mediators*, so no single answer is honest. The central finding of this section is the disagreement itself. A three-skeptic adversarial panel (default-to-refuted, surviving only on a 2/3 failure-to-refute) refuted the monotonic claim on all three — **VO2max 0/3, speed 1/3, economy 0/3**. I adopt those verdicts and, for each, state the *restricted form that does survive*, prescriptively, and rule each on the 25-mpw adolescent explicitly using the now-recovered youth and anchoring briefs.

| Outcome | Verdict (monotonic claim) | Confidence | Curve shape | Flattens at | Inverts at | Inversion mediator |
|---|---|---|---|---|---|---|
| **VO2max** | REFUTED | High | Inverted-U | ~1–2 quality sessions/wk; pace past ~vVO2max | ≥3 genuinely hard sessions/wk | Super-linear autonomic recovery cost collapses weekly *accumulated* time-near-VO2max; compounded by easy-volume displacement + iliopsoas injury tax |
| **Speed** | REFUTED as stated (fresh-threshold necessity survives) | Moderate | Required-threshold → plateau-at-ceiling → cliff | ~95–100% of current vmax; after ~4–8 fresh reps | Reps bunched, pre-fatigued (<48 h post hard aerobic), or past hip strain-rate tolerance | Achieved-velocity collapse (trains slowness) + lesser-trochanter apophyseal injury |
| **Economy** | REFUTED | High | Near-flat in running intensity; dominated by maturation + neuromuscular force | Immediately — metabolic intensity is not the lever | During an iliopsoas flare (gait compensation); tendon past its stiffness optimum | Injury-driven gait compensation (~2–5% RE loss); displacement of the fresh neuromuscular touches that do help |

---

### VO2max — REFUTED (monotonic); inverted-U survives. Confidence: HIGH.

Refuted at three converging levels.

- **Outcome evidence (right category, adult).** The VO2max dose-response *plateaus by ~1–2 quality sessions/week* [DEMONSTRATED]: the between-protocol HIIT meta-effect is small/noisy, prospective polarized-vs-pyramidal time-trial difference is a wash (SMD −0.01), and a third hard session does not out-gain the first two (converge.md F-P4, C-P1). A monotone "more = more" is contradicted by the plateau itself.
- **Mechanism (why it inverts, not merely flattens).** VO2max is an *integral of stimulus over weeks*, and the binding cost is autonomic: severe intensity drives a catecholamine/parasympathetic-withdrawal load whose recovery cost is **super-linear in intensity** (fp-central §4, P9) [MECHANISTIC INFERENCE]. Once each maximal session costs 2–3 days of suppressed recovery, weekly *frequency* of quality collapses and total monthly accumulated time-near-VO2max falls — the curve turns down. Two secondary mediators pull the inversion *lower for this athlete*: at 25 mpw there is almost no easy volume to cannibalize to pay for extra hard days (fp-central §7), and a long/fast rep that flares the iliopsoas erases plasma-volume gains in days and cardiac remodeling in weeks — a central catastrophe (fp-central §4.4).
- **Flattens / inverts, prescriptively.** Flat above ~vVO2max (added pace buys negligible extra time-at-max at steep cost) and by ~1–2 true VO2max sessions/week; inverts at **≥3 genuinely hard sessions/week**.

**Strongest refutation of the pro-hypothesis surrogate:** Rønnestad 2024 — intensified 30/30 intervals produced *less* time >90% VO2max than long 3-min intervals *despite* more time >90% HRmax and equal RPE (ev-intervals C2/C3). Intensity's cheap surrogates point the wrong way; the engine must never score interval quality by HR-in-zone (corroborated by the anchoring brief: age-formula HRmax carries ±10–12 bpm error and formally fails to predict in under-18s — ev-anchoring C9/C10, so HR-in-zone is doubly unusable here).

**Restricted surviving form (prescriptive):** VO2max needs *presence*, not volume, of high aerobic intensity — roughly one hard aerobic unit per week, not a titratable dose. Separate the physiological ideal from the engine realisation. In the app's **base phase this presence is delivered as threshold / cruise intervals (tier 6)** — for this volume-limited, CP/fractional-utilisation-dominant, iliopsoas-reactive adolescent that is the better hard-unit spend, and it is what the generator actually schedules (at most 1 hard unit in base, never above tier-6 threshold work). **True vVO2max intervals — the 4–5 × 3 min at ~95% vVO2max (≈3-k effort), 2–3 min easy-jog relief session — are the season-gated tier-8 session**, coach-led and near-season only, NOT auto-scheduled in base. When they do run, reps must be **≥2 min** (1-min reps reach only ~82% VO2peak; 2-min reach ~92% — ev-intervals C5). The remaining easy volume is the *larger* VO2max lever for this athlete, who sits on the steep part of the plasma-volume and mitochondrial curves (transfer.md T7).

**Adolescent/25-mpw ruling (grounded in the youth brief):** the aerobic *payoff* of intensity is smaller than adult literature implies — the on-target trained-youth HIIT meta (Engel, N=577, mean 15.5 y) gives Hedges g ≈ 0.10 vs control, no passive controls, so much of the apparent gain is the **maturation confound** — absolute VO2 roughly doubles 11→17 y from growth alone (ev-youth C2, C4). Glycolytic machinery is immature until late adolescence (ev-youth C6), so HIIT taxes an under-built system for a modest return. Faster youth VO2 kinetics (ev-youth C7) *soften* the ≥2-min floor slightly but do **not** license more sessions: metabolic recovery outpaces *structural* recovery, so a metabolically-gated ladder systematically over-permits (converge.md P-P8 CONFIRMED). Hold intensity at a small fixed dose; grow volume; gate on the hip, never on how recovered the athlete feels.

### Speed — REFUTED as stated; a necessary fresh-threshold dose survives. Confidence: MODERATE.

Speed is the outcome where intensity is genuinely the irreplaceable lever — no volume of easy running substitutes — so it earned the panel's single non-refuting vote. The *monotonic* claim still fails:

- **Definitional equivocation (decisive).** "Intensity" everywhere else in this project means *metabolic* intensity (%VO2max, %HRmax, zone). Top-end speed is built on a different, partly antagonistic axis — *neuromuscular velocity* (% of max running velocity), delivered alactic and metabolically *easy* (adv-speed-2 Attack 1; fp-neuro §4). A 4×4 at 90–95% HRmax runs at ~70–80% of true max velocity — metabolically maximal, mechanically sub-maximal and fatigued — so it trains speed-*endurance*, not speed. On the axis the app measures, raising intensity is neutral-to-negative for speed.
- **Shape (even on the charitable velocity axis).** Required-threshold → plateau → cliff. The rising limb terminates almost immediately at ~95–100% of *current* vmax; the stimulus saturates after ~4–8 fresh reps (extra reps add fatigue, zero new recruitment); the sign *reverses* when velocity is delivered fatigued (fp-fatigue "SHAPE: CLIFF"). The correct primitive is a **fresh-legs gate, not an intensity dial**.
- **Inversion mediator.** Two: achieved-velocity collapse (bunched reps or work <48 h after hard aerobic drops peak velocity ~3–8% → trains slowness), and — integrated over injury — the **lesser-trochanter apophysis**, where high-velocity eccentric loading in fast *flat* sprinting lands on a tendon-weaker cartilaginous insertion circa-PHV (adv-speed-2 Attack 5; converge.md F-P5 CONFIRMED).

**Restricted surviving form (prescriptive):** **≈4–8 reps of 15–20 s near-max-velocity strides, ~2×/wk, full 2–3 min recovery, fresh (≥48 h from hard aerobic), flat before hills, gated at pain 3/10.** Necessary and irreplaceable — but a threshold, not titratable upward.

**Adolescent/25-mpw ruling (grounded in the youth brief):** keep the tiny fresh dose — the youth neuromuscular/SSC window is real (ev-economy C10/C12). But "speed work" read as *anaerobic capacity/W′* is a bad trade: glycolytic capacity matures for free with androgens (ev-youth C6), and W′ is worth ~10 s in a 5-k vs ~28 s for a 3% CP gain (adv-speed-2 Attack 4). Do not spend the psoas-limited budget on it.

### Economy — REFUTED (monotonic). Confidence: HIGH.

Running economy is not driven by metabolic training intensity at all, so "higher intensity → faster RE growth" is category-wrong.

- **The real levers are neuromuscular force and maturation, not intensity.** Plyometric/explosive work improves RE ~2–7% *in isolation*, but head-to-head **heavy strength beats plyo** (Eihara: plyo RE CI crosses zero) — and this athlete already does heavy leg day, so the marginal running-side RE lever is small and *speed-specific* (fast paces only) (ev-economy C1/C7). The tendon-stiffness causal story fails at the last link (ankle stiffness r=0.08, ns); the engine must **not** model tendon stiffness as the lever (ev-economy C13/C15). The curve is essentially **flat in running intensity**, and what stiffness effect exists is itself an *optimum*, not a maximum.
- **Inversion mediator.** An iliopsoas flare degrades RE ~2–5% via gait compensation (fp-fatigue F-P3), and chasing metabolic intensity displaces the fresh neuromuscular touches that *do* help — net-negative for RE precisely when it provokes the hip.

**Strongest refutation, and why it holds:** the best-demonstrated economy lever (heavy strength) is the *least* intense modality on any axis "intensity" normally means, and the running-specific intensity increment (fast flat) is the highest hip-strain modality. No corpus evidence shows harder running (in %VO2max terms) grows economy faster, and direct youth data disconfirm short-term training effects.

**Restricted surviving form (prescriptive):** the same small fresh-stride/low-amplitude-plyo dose that serves speed captures most available RE gain — deliver it on quality days, low-amplitude ankle/pogo work before any hip-dominant drive, gated at 3/10. No dedicated high-metabolic-intensity block for economy.

**Adolescent/25-mpw ruling (grounded in the youth brief — decisive):** youth are *less* economical than adults, and **RE improves with maturation independent of training; short-term run training/technique instruction does not improve youth RE** (ev-youth C5) [DEMONSTRATED]. Economy may transiently *regress* circa-PHV (ev-youth C8). Any in-season RE improvement is therefore largely growth, not the plan — the engine must never credit it as earned fitness (transfer.md T19; ev-anchoring C3 flags the identical VDOT-across-a-growth-season trap).

---

### What this means when the three answers disagree

The three outcomes do **not** point the same way — VO2max wants presence-not-more intensity, speed wants a fresh *threshold* dose on a different axis, economy wants neuromuscular force it mostly already gets from leg day — yet the engine serves all three through **one weekly structure**. The arbitration principle that reconciles them:

**Dose intensity for its *unique, non-substitutable products* at the smallest sufficient fixed presence; let easy volume carry everything intensity is not uniquely required for; and set the *ceiling and rate* of the whole plan by the binding structural constraint (the iliopsoas apophysis), never by the most permissive outcome.**

This works because the disagreement shrinks once you ask *what only intensity can deliver*. VO2max's unique product (time-at-VO2max, type-IIx recruitment coverage, mito quality) saturates at ~12–16 min/week of hard work; speed's unique product (high-velocity recruitment) saturates at ~4–8 fresh reps twice weekly; economy's residual is captured by that *same* stride/plyo touch. All three unique demands are met by a **small, non-escalating** allotment — one quality run plus ~2 stride doses — and **none** is served by escalation, because all three curves flatten or invert early. Everything the outcomes share a hunger for (aerobic base, capillarization, CP/fractional utilization — the dominant 5-k lever) is **volume**-built, and volume is the lower-injury-per-mile path (fp-central §7; transfer.md §4).

The tie-break is unambiguous because the *harm* channel is common-mode and catastrophic. An iliopsoas flare is not a speed-only or economy-only cost: a forced layoff [MECHANISTIC INFERENCE] erases VO2max fastest (most perishable), degrades economy directly via compensatory gait (2–5% O2 cost), and detrains speed — one bad intensity decision reverses the sign of *all three* at once. Because the downside is shared and the upside (VO2max's rising limb) is bounded and partly delivered by maturation for free (ev-youth C4), the expected-value integral over injury probability is **min-across-outcomes, not sum-across-outcomes**. When an intensity increment would serve one outcome's curve but sits past another's inversion or threatens the hip, the **hip wins**.

Operationally this is exactly the codebase's existing invariant, and the physiology ratifies it rather than asking to loosen it: adaptation may only make the plan more conservative (ground-adaptive-surface.md, the one hard invariant); intensity is a pain-gated permission ladder capped by `evaluateSpeedGuard`, the generator schedules at most 1 hard unit in base and never above tier-6 threshold work, and races/feelings can only *suppress* speed downward, never raise a cap (ground-speed-surface.md; ground-adaptive-surface.md §5). The engine already spends its scarce, psoas-limited intensity budget on the narrow band where all three restricted forms overlap.

*(Live open question — flagged, not reinstated. The panel refuted all three as* monotonic *claims and I reinstate none. The least-settled ruling is whether the in-season second hard unit — the `HARD_BUDGET_SEASON = 2` path — is worth its apophyseal cost for a robust, post-PHV athlete; the supporting evidence is adult and the youth structural data argues against it, so it stays gated, but a future engine pass with real maturity-offset data should revisit it.)*

<a id="s3"></a>

## 3. Mechanistic model of the body

Training does not act on "fitness." It acts on specific tissues through specific molecular signals, each of which builds a specific structure on its own clock. If you do not carry the timescales through, periodization looks arbitrary — a matter of taste about when to do what. It is not. Plasma volume moves in days, mitochondria in weeks, tendon and bone in months, and the whole logic of a season falls out of that ordering. This section builds the body from the signal up, in three systems — central delivery, peripheral/metabolic machinery, and neuromuscular/mechanical output — and then rules on the three questions that actually determine what the engine should prescribe: what limits *this* athlete, whether volume and intensity are interchangeable, and why a stride is nearly free while a threshold rep costs a day.

Throughout, the target is fixed: a ~15-year-old, ~25-mpw cross-country runner with a reactive iliopsoas (pain cap 3/10) who already lifts heavy legs. Every ruling is made for him, not for the trained adults the literature mostly studies.

### 3.1 The three reasoning chains, with their clocks

**Central delivery — the pump and the fluid it moves.** The governing identity is Fick:

> VO2max = Q̇max × (a–vO2 diff)max = (HRmax × SVmax) × (CaO2 − Cv̄O2)max

HRmax is untrainable (it drifts down with age and nothing raises it). So central trainability lives almost entirely in stroke volume and in arterial O2 content, and it resolves into three levers that sit on three different clocks [MECHANISTIC INFERENCE]:

- **Plasma volume (days).** `sustained elevated cardiac output + thermal/osmotic load → endothelial shear + albumin synthesis + aldosterone/ADH-driven Na⁺/H₂O retention → plasma volume ↑8–15% → venous return ↑ → end-diastolic volume ↑ → stroke volume ↑ (Frank–Starling) → Q̇max ↑`. This is the *first* thing that moves VO2max in a low-volume runner (plausibly +3–6% within 1–2 weeks) and the first thing lost to detraining. The sensed variable is **cumulative time with elevated Q̇**, i.e. volume × duration — not peak pace. The taper evidence corroborates the substrate: blood and plasma volume rises are "consistently demonstrated" post-taper while VO2max does not move [DEMONSTRATED, adult].
- **Eccentric cardiac remodeling (weeks–months).** `repeated high diastolic filling → chronic LV volume-loading → series sarcomere addition + chamber dilation + improved compliance → EDV ↑ at a given filling pressure → SVmax ↑`. Crucially, stroke volume is *near-maximal by ~50–70% VO2max and plateaus or falls slightly toward HRmax* (diastole shortens faster than filling improves), so the diastolic-loading stimulus is delivered well by high-aerobic/threshold work, not only by all-out efforts [MECHANISTIC INFERENCE].
- **Red-cell mass / tHb-mass (weeks–months, slowest, iron-gated).** `exercise renal-cortex hypoxia + plasma-dilution signal → EPO → marrow erythropoiesis → CaO2 ↑`. This is the rate-limiter on the late, ceiling-raising central gains, and in an adolescent it is substrate-limited by ferritin — growth and (where relevant) menstruation compete for iron [MECHANISTIC INFERENCE].

**Peripheral/metabolic — the machinery that extracts and the balance point that defines racing.** Mitochondrial biogenesis converges on PGC-1α, but the inputs are not interchangeable, because PGC-1α is not a scalar — it has an abundance, an activation state, a stability, and a location, each driven by a different sensor [MECHANISTIC INFERENCE]:

- **CaMKII** integrates the cytosolic Ca²⁺ transient in *recruited* fibers → MEF2 → PGC-1α transcription. Duration builds *depth* within recruited fibers; intensity buys *breadth* by recruiting more fibers.
- **AMPK** senses AMP:ATP *and* is disinhibited by glycogen depletion; ATP is creatine-kinase-buffered, so AMPK is a **threshold detector** (flat below ~critical power, steep above) plus a slow duration term via glycogen drawdown.
- **p38 MAPK** senses ROS/strain (intensity-loaded) and *stabilizes* the PGC-1α protein — a multiplicative effect on the area under the PGC-1α curve.
- **CREB/β-adrenergic** is the steepest intensity term (catecholamines rise exponentially above LT1) and drives transcription through the CRE promoter element.

These build two distinct things on two clocks. **Mitochondrial content** (citrate synthase, mito volume density) is a transcriptional mass-action integral — duration-loaded, τ ≈ **10–14 days**. **Mitochondrial function** (respiration per mg protein, cristae density, I+III₂+IV supercomplex assembly) is an organizational response to *high electron flux* — you cannot generate near-maximal flux at easy pace at any duration. Capillarization — which lets a central gain actually be *cashed*, since a fast transit time through an inadequate bed unloads O2 poorly — is driven by the shear integral and by PGC-1α→ERRα→VEGF, both volume-loaded, τ ≈ **4–8 weeks** [MECHANISTIC INFERENCE]. The timescale dissociation has a direct season-planning consequence: **mitochondrial enzymes respond within a 10-week season; capillary and tendon gains are built in the summer base and cashed in the fall.**

The load-bearing peripheral quantity is **critical power/critical speed (CP)** — mechanistically, the highest intensity at which whole-body mitochondrial pyruvate-oxidation capacity still equals glycolytic pyruvate production. It is a direct readout of the *ratio* of oxidative to glycolytic machinery in the recruited fibers, and it self-mirrors: training at CP⁻ drives exactly MCT1 (a PGC-1α target) and PDH/MPC/TCA capacity — the two terms of the CP-defining inequality. The stimulus is the mirror image of the constraint, which is the strongest first-principles case for threshold work.

**Neuromuscular/mechanical — recruitment, elastic return, and economy.** By Henneman's size principle, motor units recruit small-to-large with force/velocity demand. Easy pace (~65–70% VO2max) recruits type I and a slice of IIa; the top ~30–40% of the pool never fires. `≥95% max-velocity stride → full recruitment including type IIx + high firing rates/doublets → cortical and spinal adaptation (↑neural drive, ↓recurrent inhibition, ↑synchronization)`; the neural component adapts in **days–weeks**. Economy adds a slower arm: `brief high-force reactive contact → high tendon strain rate → collagen synthesis/cross-linking → tendon stiffness tuned toward the force-matched optimum`, τ **months**. Note the honest limit from the evidence: plyometrics reliably improve economy ~2–7% in isolation, but the causal chain runs through *neuromuscular* factors (RFD, coordination, ground-contact time), **not** through Achilles tendon stiffness — ankle stiffness does not correlate with economy (r ≈ 0.08, ns) [DEMONSTRATED, adult]. The engine must not model tendon stiffness as the lever.

**Adolescent transfer ruling (applies to all three systems).** The 15-year-old's muscle has lower PFK/glycolytic enzyme activity relative to oxidative (androgen-driven, matures late in puberty) → lower peak lactate, lower [La] at a given %VO2max, faster PCr resynthesis, faster metabolic recovery, faster VO2 on-kinetics. Maturation *alone* roughly doubles absolute VO2 from 11→17 and improves economy and race times independent of training [DEMONSTRATED]. Two consequences dominate: (1) **race-time trend is largely growth, not earned fitness** — any engine signal keyed to PRs will over-credit training during the growth spurt; and (2) **metabolic recovery outpaces structural recovery** — the youth "bounces back" finding is real *metabolically* but false for the growth plate, apophysis, and reactive psoas, where circa-PHV vulnerability is *elevated* (15–19-year-olds are 42.6% of athletic stress fractures; >30 mpw is a named male BSI risk) [DEMONSTRATED]. A ladder that gates intensity on metabolic readiness will systematically over-permit exactly this athlete.

### 3.2 Design driver (a): the binding constraint is fractional utilization (CP), not VO2max

Commit: **for this athlete the binding constraint on 5k performance is peripheral fractional utilization (CP/VO2max), not central O2 delivery and not VO2max.** The reasoning, and why it overrides the classical "VO2max is centrally limited" answer:

The classical answer is not wrong about *VO2max* — delivery (Q̇) probably does limit VO2max even in this athlete, since ex-vivo mitochondrial capacity exceeds the in-vivo flux achieved at VO2max. But VO2max is the wrong target variable, because **a high-school 5k is raced above CP**, in the severe domain (CP corresponds to ~50–60 min race pace; a 16–19 min 5k sits well inside it). Race speed is `f(VO2max, fractional utilization, economy)`, and fractional utilization is a *purely peripheral* quantity — the mito:glycolysis balance point of §3.1. A 25-mpw runner plausibly sits at CP/VO2max ≈ 78–84%; a well-trained distance runner at ~88–92%. That gap is his single largest untapped reserve.

The magnitude settles it. Using the linear critical-speed model `d = v_CP·t + D′` with a 16:00 baseline (v_CP = 5.00 m/s, D′ = 200 m): a **3% CP gain buys ~28 s**; a **25% D′ gain buys ~10 s**. A 3% CP gain is modest for an athlete with this much headroom; a 25% D′ gain is large. dTime/dCP is ~2.8× dTime/dD′, and the result is structural (D′ is a ~4% additive offset to 5000 m while v_CP divides the whole distance), robust across D′ ∈ [150, 250] m. Raising CP/VO2max 80%→87% at *unchanged* VO2max is worth ~78 s; a good +5% VO2max year propagates to only ~25–35 s. **The fractional-utilization lever is 2–3× the VO2max lever for this athlete** [MECHANISTIC INFERENCE, derivation shown].

Three independent evidence lines corroborate the *decoupling* of race performance from VO2max, which is what the ruling turns on: taper raises performance ~2–3% while VO2max does not move (SMD 0.20, ns); time-trial performance is flat across intensity distributions (SMD −0.01) even where VO2peak differs; and critical speed is the one anchor with youth-specific reliability and validity (CV 2.4–4.3%, ICC 0.92–0.98; CS ≈ lactate-minimum velocity in youth runners) [DEMONSTRATED, adult/near-adult and youth]. No study regresses Δ5k on ΔCP in a youth cohort, so the *number* stays [MECHANISTIC INFERENCE], but the direction is demonstrated three ways.

The corollary is uncomfortable and important: **CP is volume-and-threshold-built.** The 25-mpw adolescent sits on the *steep* part of every peripheral curve — mito volume ~6% vs a ~11–12% ceiling (~70–100% headroom), capillarization steep, CP/VO2max ~80% vs ~90%. The received "diminishing returns to volume, HIIT is time-efficient, add intensity not miles" wisdom was derived from trained adults on the *flat* part of those curves; extrapolated here it inverts the correct advice. **The dominant lever is more easy volume, gated by the hip — not more intensity.**

### 3.3 Design driver (b): volume and intensity are complements, not substitutes

Commit: **complements.** The naive "they both raise PGC-1α, so pick the cheaper one" argument fails at the promoter, in the currency, and in the product [MECHANISTIC INFERENCE]:

1. **Separate promoter elements.** The PGC-1α promoter carries both a CRE (CREB/ATF2, intensity-loaded) and a MEF2 site (CaMK, duration-loaded). Two transcription factors on two elements with cooperative coactivator (CBP/p300) recruitment is the textbook geometry for synergy, not redundancy — and PGC-1α coactivates MEF2 on its own promoter, a positive-feedback loop that makes co-stimulation supra-additive.
2. **Different currencies.** CREB/MEF2 *make* PGC-1α; AMPK/SIRT1 *activate* the protein you have; p38 *stabilizes* it. Transcript without activation is inert; activation without transcript has nothing to act on. A single-modality input is rate-limited by the currency it doesn't supply.
3. **Content × function is a product of two independently-controlled factors.** Volume builds mitochondrial content (transcriptional integral); intensity builds mitochondrial function (flux-driven cristae/supercomplex organization). VO2max and CP depend on the *product*, and you cannot compensate for a poorly organized ETC with more copies of it. That is the definitional structure of complements.

There is also a hard recruitment argument that is *specific to low volume* and cuts against the intuition that intervals are optional for a base-builder. Signaling only reaches recruited fibers. Glycogen depletion forces high-threshold recruitment, but that requires ~90+ min of easy running; this athlete's ~55–65 min long run never reaches it. **So at 25 mpw, nothing except above-threshold work ever recruits the type IIx pool.** Intensity is therefore *more* necessary at low volume than at high — but its job is recruitment *coverage* and mito *quality*, which saturate at ~12–16 min/week of work at 3k–5k pace. **Presence, not volume.**

Where the honest reading tempers the mechanism: the intervention evidence shows single-modality threshold-heavy training *matching* polarized at low volume (Festa null; threshold-heavy matched polarized with 17% less time), and polarized-vs-pyramidal a wash on time-trial in adults — so "both needed, neither omit-able" is solid, but a *strong supra-additive synergy* is not demonstrated at the outcome level. The engine should treat them as complements (never substitute all easy volume for a hard block, or vice versa) without banking on a large synergy multiplier. Net allocation: ~80% easy, ~10–13% threshold (CP⁻, the dominant performance lever), ~5–8% at 3k–5k pace as fixed non-escalating recruitment coverage.

### 3.4 Design driver (c): why a stride costs ~nothing and a threshold rep costs a day

This is the crux that justifies the app's "neuromuscular touches = 0 units" accounting, and it is decided entirely by **fatigue etiology** — which tissue is taxed and how long its recovery clock runs.

A **15–20 s near-max stride** with full recovery: total work is trivial (~50–100 m; a few kJ), and with full inter-rep recovery the effort stays **alactic/phosphagen-fueled** — no meaningful lactate, no glycogen drawdown, minimal muscle-damage signaling. What fatigues is the **neural transient** (recovers in minutes) plus tiny PCr depletion (recovers in ~2–5 min). The systemic recovery footprint is genuinely near-zero. The stimulus — full motor-unit recruitment via the size principle — is delivered on rep one, so a handful of reps is the whole dose [MECHANISTIC INFERENCE; physics + size principle are age-invariant, so this transfers to the adolescent unchanged].

A **threshold rep** engages the systems whose recovery clocks are long: glycogen depletion and low-frequency (SR Ca²⁺-handling) force depression clear over **24–72 h**; central/autonomic drive is suppressed **12–48 h**; if the work strays above CP, the finite W′ reservoir is spent and ROS/mechanical strain rise convexly. A single genuinely hard session casts a ~48 h shadow over high-quality capacity. That is the "costs a day."

The asymmetry has three sharp edges the engine must respect:

- **Full recovery is load-bearing, not conservatism.** Bunching stride reps (rest < ~2–3 min) lets PCr under-resynthesize, pushing the next rep glycolytic → velocity drops below the recruitment threshold (you now train slowness) *and* fatigued high-velocity eccentric contractions with degraded coordination raise strain on the very iliopsoas you are protecting. Bunching converts a free neural session into a moderate-cost glycolytic one that is worse on both stimulus and injury axes [MECHANISTIC INFERENCE].
- **The stride is metabolically free but tissue-real.** It barely touches the glycogen/autonomic budget, so it can sit beside a quality day or prime it — but it draws on a *different, smaller* connective-tissue pool. It must be scheduled against *tissue* recovery (no back-to-back reactive days), not aerobic recovery. "Zero units" is correct on the metabolic ledger, not the mechanical one.
- **The metabolic and structural optima agree at the extremes, and that is exploitable.** Iliopsoas peak strain scales with hip-extension ROM at toe-off × hip-flexion angular velocity — both steep in flat sprinting, both moderate at threshold and 3k–5k pace. Threshold is simultaneously the metabolic signal:cost optimum *and* a psoas-moderate intensity; flat sprints are metabolically near-worthless *and* the highest psoas-strain modality. Because the neuromuscular touches this athlete needs are the *strides* (near-zero metabolic and low tissue cost when done fresh, flat before hills — uphill loads the psoas concentrically at lower velocity and strain-rate, but the app prescribes its tier-3 flat strides *relaxed/submaximal*, so those never trigger the dangerous high-velocity eccentric end-swing event, and near-maximal concentric hill sprints (tier 4) remain the highest iliopsoas/apophyseal load in the block; the ordering is therefore monotone in iliopsoas provocation on the app's real specs — see §4 for the full resolution), the "0 units" bucket is well-targeted — provided the ladder reads mechanical, not metabolic, recovery.

### Where the mechanism is uncertain

- **The supra-CP signal exponent.** The claim that signal saturates at CP rests on the supra-threshold signal scaling ~linearly with W′-expenditure rate (`a ≈ 1`), making the per-bout integral a fixed reservoir. The catecholamine→CREB arm is the one input not stoichiometrically tied to W′ and could be superlinear; if so, harder buys somewhat more per bout. Fallback: keep a small non-escalating above-CP allocation regardless, which the recruitment argument already requires — so the plan is robust to this being wrong.
- **Capillarization: shear integral vs hypoxia/HIF.** I have argued capillarization is volume-loaded via the shear integral and PGC-1α→ERRα→VEGF, but the HIF-1α (intensity/hypoxia) arm is a genuine competing mechanism I cannot exclude from first principles. Fallback: build the volume anyway — it serves the shear and myocyte-VEGF arms fully, and the mandatory small interval dose covers the HIF arm. The plan does not need this resolved to be right.
- **Content/function dissociation is untested here.** The prediction that low-intensity volume raises mito content while intensity uniquely raises mass-specific respiration and supercomplex assembly is mechanistically triangulated but has no biopsy study in the evidence base. It is the cleanest falsifiable claim in the peripheral model and should be flagged as inference, not fact.
- **The CP-dominance number for youth.** dTime/dCP ≫ dTime/dD′ is structural math and transfers; but "CP/VO2max ≈ 80% in a 25-mpw adolescent" is a recalled anchor, and no brief regresses Δ5k on ΔCP in a youth cohort. The *ordering* (CP is the dominant lever) is robust; the exact reserve is not.
- **Iliopsoas-specific adolescent running data is essentially absent.** The flat-before-hills ordering, the strain-rate ranking, and the apophyseal-cap rationale are mechanistic/precautionary. There are no RCTs. Hold the 3/10 cap hard and bias to under-loading circa-PHV rather than trusting the mechanism to be precise.
- **Stroke-volume-vs-intensity curve is textbook but unmeasured in the briefs.** The claim that SV plateaus by 50–70% VO2max (used to argue threshold delivers near-maximal cardiac loading) is standard physiology but is not directly measured in any brief here; treat as [MECHANISTIC INFERENCE].

<a id="s4"></a>

## 4. Speed workout structures per tier, with progressions

The app today emits one hardcoded string per tier — cruise is always `3–5 × 5 min, 60–90s jog`, strides are always `{reps:6, durationS:20, recoveryS:90}`, fartlek always `5 × 45 s` (`generator.ts:271,298`, `todaySpeed.ts:45-51`) — with the *only* number that scales being `fastMiles`, and that scales with weekly volume, not with fitness or tolerance. There is no week-to-week ladder inside a tier. This section replaces those templates with an actual prescription and an explicit within-tier progression for each of the eight permission tiers, then designs the tier-8 VO2max session from first principles and rules on two structural questions (never-generate tier 8; hills-after-flat).

A hard constraint governs every anchor below. **The app logs miles, RPE (1–10), and pain — no duration, therefore no pace and no time-in-zone** (`ground-speed-surface.md`, Claim 7). So each prescription carries a *dual* anchor: an **external pace target** the athlete executes on a watch, set from **Critical Speed (CS)** derived from two races the athlete already runs (a 1600 m and a 3200 m) — the only intensity model with adolescent-specific reliability (CV 2.4–4.3%, ICC 0.92–0.98) and youth concurrent validity (CS ≈ lactate-minimum velocity, n=25 youth; `ev-anchoring.md` C6–C7) [DEMONSTRATED, youth] — plus an **RPE fallback** the app can actually observe. HR anchoring is ruled out with numbers: estimated HRmax carries ±10–12 bpm error in adults and *overestimates by 6–12 bpm in under-18s* (`ev-anchoring.md` C9–C10), enough to misplace an entire zone [DEMONSTRATED]. HR-in-zone is worse than useless as a *success* metric because it points the wrong way (see tier 8).

### Master table

| # | Name | Physiological purpose (one chain) | Session structure | Pace anchor | RPE fallback (CR10) | Progression variable | Weekly saturation ceiling | Budget units |
|---|------|-----------------------------------|-------------------|-------------|---------------------|----------------------|---------------------------|--------------|
| 1 | Buildups | Gentle re-introduction of fast limb turnover → wakes high-threshold motor units briefly, near-zero tissue cost; mostly a *safe rung* to prove the hip tolerates any acceleration | 4 → 6 × 15 s relaxed accelerations after an easy run, walk-back full recovery | Accelerate to ~85% max velocity, never a true sprint | Momentary ~6/10; easy-run session RPE unchanged (≤4) | **Reps** (4→6) | 6 × 15 s | 0 |
| 2 | Short strides | 15 s near-max stride recruits the full motor-unit pool (size principle) + loads the SSC → neural drive/coordination, at alactic cost | 4 → 6 × 15 s smooth strides, full (≥60–90 s) recovery | ~90% vmax, "fast but relaxed" | Momentary ~7/10; breathing recovered before next rep | **Reps** (4→6) | 6 × 15 s | 0 |
| 3 | Flat strides | Same recruitment/SSC stimulus, longer top-speed window (20 s) → more high-quality SSC cycles; still submaximal/**relaxed** so eccentric strain-rate stays low | 6 × 20 s relaxed strides, full recovery; progress reps then duration | ~90–95% vmax, controlled — not sprinting | Momentary 7–8/10; no hip niggle during/after | **Reps → duration** (6→8 × 20 s, then →25 s) | 8 × 25 s (app caps 8 reps / 35 s / ≥60 s rest, `speed.ts:475`) | 0 |
| 4 | Hill strides | Uphill = high **concentric** hip-flexor drive + full recruitment at **low velocity, low impact, muted eccentric** → force/RFD with the lowest whole-limb shock | 6 × 10 s hill sprints, walk-down full recovery | Steep enough that effort is high but turnover controlled | Momentary 8–9/10; walk-down until breathing eases | **Reps** (6→8), then grade/duration | 8 × 10–12 s | 0 |
| 5 | Light fartlek | Sub-threshold surges inside an easy run → first *sustained* fast bouts; bridges neuromuscular tiers to true threshold; modest glycolytic touch | Easy run with 5 → 8 × 45 s relaxed pickups, easy-run float between | ~10 k–8 k effort (just under CS) | 6–7/10 during surge, "could still talk" | **Reps → surge duration** (5→8 × 45 s, then →60 s) | 8 × 60 s | **0.5** |
| 6 | Cruise / threshold | Broken threshold at CS → drives fractional-utilization / CP, the dominant 5 k lever; jog breaks let you hold CS pace at lower per-bout strain than continuous | 3 × 5 min at CS, 60–90 s jog; fast-portion ≤ min(10% week, 3 mi) | Pace ≈ **CS** (1600+3200 races) | 7–8/10, "comfortably hard, one sentence not a paragraph" | **Fast volume** (reps/duration) → density | ≤10% of weekly miles, hard 3-mi cap (`generator.ts:269`) | 1 |
| 7 | Continuous tempo | Unbroken tempo just under CS → same MMSS stimulus as a single sustained autonomic/glycogen pulse; trains holding form under accumulating fatigue | 1 × 15 → 25 min continuous at tempo | Pace ≈ CS − ~10–15 s/mi (just sub-threshold) | 7–8/10 sustained, controlled to the end | **Duration** (15→25 min), then pace toward CS | ~25 min / ≤10% week, 3-mi cap | 1 |
| 8 | VO2max / race-specific | ~95% vVO2max reps long enough to reach and *bank* time at VO2max → central + peripheral VO2max stimulus and race-specific fitness | 4–5 × 3 min at ~95% vVO2max, 2–2.5 min easy jog | Pace ≈ **3200 m race pace** (≈ CS + ~5–8%) | 9/10, "pace holdable ~8–11 min flat out" | **Rep duration → reps → recovery density** | 5–6 × 3 min; **never auto-generated in base** (`generator.ts:255-257`) | 1 |

### The cross-tier progression principle (the governing logic)

The progression *variable* is not arbitrary; it is dictated by which axis actually carries the adaptation for that tier's stimulus, and the **saturation ceiling** is set where pushing that axis further either stops adding signal or starts adding disproportionate iliopsoas/glycolytic cost. Two regimes:

**Neuromuscular tiers (1–4): grow REPS, hold intensity and duration.** The speed/recruitment stimulus *saturates on rep 1* — to reach ≥90–95% velocity the nervous system must recruit essentially the entire motor-unit pool including the fast-fatigable units, so one true near-max exposure already delivers full recruitment (`fp-neuro.md` §2, §4) [MECHANISTIC INFERENCE]. Therefore **intensity cannot be the progression variable** (it is already near-ceiling by definition, and raising it past "controlled" is what invites the injury), and **duration cannot be** (15–20 s keeps the effort alactic — phosphagen-fuelled, <2–4 mmol lactate, trivial glycogen use; extending it toward 30 s+ tips into glycolysis and defeats the point, `fp-neuro.md` §4–5). The only axis that can safely climb is **rep count**, and what it grows is not the neural signal (already saturated) but the athlete's demonstrated *tissue tolerance* to the exposure — which is exactly the thing the permission ladder exists to titrate. The ceiling (~6–8 reps) is where added reps under full recovery add tissue load without new recruitment; earning the next tier then buys a genuinely *new* stimulus quality (longer top-speed window → concentric hill drive → sustained surges), not just more of the same.

**Aerobic tiers (5–8): hold intensity at the physiological anchor, grow fast VOLUME first, then density.** Threshold and VO2max adaptations are duration-at-a-fixed-intensity phenomena — the intensity *is* the target system (CS = maximal metabolic steady state; ~95% vVO2max = the pace whose demand pulls VO2 to max). Running faster than the anchor does not deepen the stimulus, it changes which system you train and overshoots into cost. So intensity is pinned and **accumulated fast-minutes** is the primary progression axis, up to the app's `min(10% of weekly miles, 3 mi)` ceiling — which is well-placed: it ties fast volume to the aerobic base that must absorb it and hard-caps it on high-mileage weeks. **Recovery density** (shortening jog breaks) is the secondary lever, used only after volume, because incomplete recovery raises time-at-target but also raises per-session fatigue.

This is why "earning the next tier" is meaningful rather than cosmetic: each tier's ceiling is the point of *saturation of its own progression axis*, so the next rung is the only remaining way to add stimulus.

---

### Tier 1 — Buildups

**Purpose.** A *safe rung*, honestly. A 15 s buildup that only reaches ~85% velocity does not fully recruit the top motor-unit pool the way a true stride does — its job is to prove the reactive iliopsoas tolerates *any* acceleration at all before real fast work is offered, and to give the athlete a low-stakes re-entry. The adaptive payload is small; the gating value is large.

**Structure.** 4 × 15 s relaxed accelerations appended to an easy run, walking back to full recovery between. Effort builds smoothly to ~85% and is never held at true top speed. Anchor: subjective "smooth, building, comfortably fast." RPE fallback: momentary ~6/10, and — critically — the *logged session RPE of the whole easy run stays ≤4*; if it rises, the buildups are being run too hard.

**Recovery.** Full walk-back (≥60–90 s), justified: even at 85% the point is quality turnover, and any bunching converts an alactic neural touch into a glycolytic one (`fp-neuro.md` §5). Density is deliberately low. Total fast volume ~1 min.

**Within-tier progression.** wk1 4 × 15 s → wk2 5 × 15 s → wk3 6 × 15 s. Reps only (see principle). **Ceiling: 6 × 15 s.** Duration is *not* extended and intensity is *not* raised — those define tier 2/3.

**Prerequisites / readiness.** Pain-free easy-run streak ≥3 (app `REQUIRED_STREAK[1]=3`, `tunables.ts:57`); this is the entry rung above locked. No check-in/RPE-history requirement (tiers 1–4 are non-advanced, `ADVANCED_MIN_TIER=5`).

**Worked vs overreached (app data only).** *Worked:* painDuring 0–1, painNextAM ≤ painDuring, easy-run RPE flat across the week, weekly check-in ≥3. *Overreached:* painNextAM ≥2 or > painDuring (the app's `morningPainHold` signal, `speedGuard.ts:189-196`), or easy-run RPE drifting up. No absent-data flag — everything needed is logged.

**Budget: 0.** Agree. Metabolically a rounding error (`fp-neuro.md` §10); the tissue cost is real but is governed by the pain gate and stride-streak requirement, not by the aerobic hard-budget.

### Tier 2 — Short strides

**Purpose.** The first *true* neuromuscular stimulus. A 15 s stride at ~90% vmax forces full recruitment of the motor-unit pool (size principle) and delivers dozens of high-quality stretch-shortening-cycle contacts, driving neural drive, firing rate, and inter-muscular coordination — the fast-adapting (weeks) arm of both speed and economy (`fp-neuro.md` §2–4) [MECHANISTIC INFERENCE]. Youth neural plasticity is high, so this is a high-leverage, low-cost window.

**Structure.** 4 → 6 × 15 s smooth strides, full recovery, after an easy run. Anchor: ~90% vmax, "fast but relaxed," turnover quick and light. RPE fallback: momentary ~7/10; breathing fully recovered before the next rep (the field proxy for alactic/full recovery).

**Recovery.** ≥60–90 s, full — the app's `MIN_RECOVERY_S=60` validity floor exists precisely to reject bunched strides as "a hidden anaerobic session" (`tunables.ts:62`, `speed.ts:475`). Justified: full recovery keeps velocity high (preserving the stimulus) and keeps the effort off the iliopsoas-hostile fatigued-eccentric regime (`fp-neuro.md` §5).

**Within-tier progression.** wk1 4 × 15 s → wk2 5 × 15 s → wk3 6 × 15 s. Reps only. **Ceiling: 6 × 15 s** at full recovery.

**Prerequisites.** Streak ≥3 (`REQUIRED_STREAK[2]=3`); `STRIDES_MIN_STATE=2`, `STRIDES_MIN_STREAK=3` (`tunables.ts:58-67`) — strides are never offered below this tier.

**Worked vs overreached.** As tier 1, plus: `didStrides=true` with no niggle in `strideNote`. *Overreached:* any painDuring at cap (3), painNextAM ≥2, or the athlete reporting via note that later reps felt "heavy" (a proxy for velocity decay — but note the app cannot *measure* achieved velocity; **flag:** true speed-quality drop is unobservable without pace/duration data).

**Budget: 0.** Agree, same reasoning as tier 1.

### Tier 3 — Flat strides

**Purpose.** Extends the top-speed window from 15 s to 20 s → more high-quality SSC cycles per rep and a longer bout at full recruitment, consolidating the neural/coordination gains. Still prescribed **relaxed/controlled**, not maximal — which, as the hills ruling below argues, is what keeps its eccentric strain-rate low enough to sit *below* hill sprints in the ladder.

**Structure.** 6 × 20 s relaxed strides, full recovery. Anchor: ~90–95% vmax but *smooth* — the athlete should feel they have another gear. RPE fallback: momentary 7–8/10, no hip sensation during or after.

**Recovery.** Full (≥90 s). Same justification.

**Within-tier progression.** The first tier with a two-stage ladder: grow reps first (wk1 6 × 20 s → wk2 7 × 20 s → wk3 8 × 20 s), *then* duration (wk4 8 × 25 s). Reps-before-duration because rep count grows tissue-exposure tolerance at fixed alactic cost, whereas lengthening the rep is the first step toward glycolytic drift and is spent last. **Ceiling: 8 × 25 s** — bounded by the app's stride-validity rule (`MAX_REPS=8`, `MAX_DURATION_S=35`, `speed.ts:475`); I would stop at 25 s well short of the 35 s hard limit, because 30 s+ strides begin accumulating lactate and lengthen the eccentric exposure.

**Prerequisites.** Streak ≥4 (`REQUIRED_STREAK[3]=4`).

**Worked vs overreached.** As tier 2. **Flag:** the ideal marker here — did later reps hold velocity — needs pace data the app lacks.

**Budget: 0.** Agree.

### Tier 4 — Hill strides

**Purpose.** Uphill sprinting recruits the full pool and maximally drives the hip flexors **concentrically** — but at *low running velocity, reduced vertical impact and braking, and a muted SSC* (short pre-stretch, more "push," `fp-neuro.md` §6). It adds a high-force/RFD stimulus and race-specific power the relaxed flat strides do not, while keeping whole-limb shock and the violent end-swing eccentric event low. It is the correct place to add real intensity for a reactive-hip athlete.

**Structure.** 6 × 10 s hill sprints on a moderate grade, walk-down full recovery. Anchor: a grade steep enough that effort is high but turnover stays controlled (not a grind, not a flat-out sprint). RPE fallback: momentary 8–9/10; walk the full way down until breathing eases.

**Recovery.** Full walk-down (~45–90 s of actual recovery). Justified: hill sprints are the highest-force reps in the neuromuscular block; incomplete recovery here both degrades power and stacks concentric load on the reactive iliopsoas apophysis.

**Within-tier progression.** wk1 6 × 10 s → wk2 7 × 10 s → wk3 8 × 10 s, then optionally 8 × 12 s. Reps first. **Ceiling: 8 × ~12 s.** Duration is capped low deliberately — a 10 s hill sprint is alactic; extending toward 15–20 s uphill turns it into a lactic hill *rep* (a different, higher-cost stimulus) and prolongs peak hip-flexor tension.

**Prerequisites.** Streak ≥4 (`REQUIRED_STREAK[4]=4`); demonstrated clean tolerance of tier 3.

**Worked vs overreached.** *Worked:* painDuring 0–1, painNextAM ≤1, check-in ≥3. *Overreached (watch this tier closely — it is the first tier that loads the reactive tissue near-maximally):* painDuring ≥2, any painNextAM ≥2 or morning-worse, or a check-in drop. The `morningPainHold` (`speedGuard.ts:189-196`) is the right sentinel here.

**Budget: 0.** Agree metabolically; the caveat that it is a real *tissue* unit is handled by the pain/streak gates, not the aerobic budget.

### Tier 3 vs tier 4: is hills-after-flat right?

The apparent conflict: a first-principles reading says the iliopsoas-strain mechanism is *high-velocity eccentric rapid-stretch of an actively-shortening hip flexor at end of backswing* — a **flat fast-running** event — while uphill running loads the iliopsoas *concentrically* at low velocity, so "hills are the safe on-ramp, flat max-velocity is the higher tier" (`fp-neuro.md` §6). Read literally, that argues hills should come *before* flat, making the app's flat-3/hills-4 ordering look inverted. The counter the ordering invites: uphill running *increases* iliopsoas concentric recruitment, and the lesser-trochanter apophysis is a classic *concentric-drive* avulsion site — so loading it hard concentrically (hills) is itself a provocation, arguably one to gate *later*.

**Ruling: the app's ordering (flat tier 3 → hills tier 4) is correct — but for a reason the naive mechanism misses.** The resolution is in the app's actual intensity specs, not the abstract "flat vs hill" contrast. The tier-3 flat strides are prescribed **relaxed/controlled (~90–95%, "another gear left")**, *not* maximal — so they never trigger the high-velocity eccentric end-swing event that is the dangerous flat mechanism; that event belongs to true max-velocity flat sprinting, which appears nowhere as a standalone tier and only inside tier-8 race-specific work. The tier-4 hills are **10 s hill *sprints* — near-maximal concentric hip-flexor drive** at the reactive apophysis. So on the app's real specs the ordering is monotone in iliopsoas provocation: relaxed submaximal flat strides (low eccentric strain-rate, low force) sit *below* near-maximal concentric hill sprints (highest concentric apophyseal load in the neuromuscular block). The first-principles "hills-before-flat" conclusion was implicitly comparing hills against *flat max-velocity sprinting*; against *relaxed* flat strides it does not apply. [MECHANISTIC INFERENCE — and the direction is all we can claim: adolescent iliopsoas-specific running data is essentially absent (`transfer.md` T14, `converge.md` N-P4 UNTESTED), so both tiers stay hard-gated on the 3/10 pain cap regardless of order.] The one design caveat: keep tier-3 strides genuinely *relaxed* in the copy — if the athlete runs them flat-out, the ordering's safety rationale collapses.

### Tier 5 — Light fartlek

**Purpose.** The bridge from neuromuscular touches to true threshold work: the first *sustained* fast bouts (45 s), run sub-threshold inside an easy run. It introduces a modest glycolytic/aerobic-power stimulus and teaches pace control before the athlete is asked to hold CS for 5-minute blocks. Half a hard unit reflects its genuine-but-light cost.

**Structure.** An easy run carrying 5 → 8 × 45 s relaxed pickups, easy-run float (not a stop) between. Anchor: ~10 k–8 k effort — *just under* CS. RPE fallback: 6–7/10 during the surge, "could still talk"; if it reaches threshold RPE (7–8) it has become a tier-6 session and should be re-gated. The app's fixed `5 × 45 s` (`tunables.ts:100`) becomes the wk1 floor of a ladder.

**Recovery.** Easy-run float, ~45–90 s, not full stop — this is deliberately incomplete because the aim is a light aerobic-power stimulus, not alactic quality. Density is low.

**Within-tier progression.** Reps then surge duration: wk1 5 × 45 s → wk2 6 × 45 s → wk3 7 × 45 s → wk4 8 × 45 s, then 6–8 × 60 s. **Ceiling: 8 × 60 s** (~8 min fast) — beyond this it is a threshold session in disguise and should route to tier 6.

**Prerequisites.** Streak ≥4 (`REQUIRED_STREAK[5]=4`) **and** the advanced-data gate: ≥1 readable weekly check-in and ≥4 RPE samples (`ADVANCED_MIN_TIER=5`, `advancedDataOk`, `speedGuard.ts:274-276`). Missing data caps the athlete at tier 4 — correct, since tier 5+ is where a genuine aerobic cost begins and the app should not dose it blind.

**Worked vs overreached.** *Worked:* painDuring ≤1, painNextAM ≤1, easy-run RPE stable, check-in ≥3. *Overreached:* rising easy-run RPE trend (`risingRpe`, `speedGuard.ts:206-212`), painNextAM ≥2, or check-in ≤2. All observable.

**Budget: 0.5.** Agree — a light sub-threshold surge set inside an easy run is a real but half-weight draw on the weekly hard budget (`FARTLEK_UNITS=0.5`, `tunables.ts:99`).

### Tier 6 — Cruise / threshold intervals

**Purpose.** Broken threshold at CS is the workhorse for **fractional utilization / Critical Speed** — the dominant lever for a HS 5 k (dTime/dCP ≫ dTime/dVO2max; race performance repeatedly moves without VO2max, `converge.md` Conflict 2) [DEMONSTRATED-adjacent, via performance outcomes]. Breaking it into 5-min blocks with jog breaks lets the athlete hold true CS pace at lower per-bout fatigue and form-breakdown than a continuous effort — the right first threshold format.

**Structure.** 3 × 5 min at CS, 60–90 s jog; fast portion capped at `min(10% of week, 3 mi)` (`generator.ts:269`). Anchor: pace ≈ **CS** from the 1600+3200 races. RPE fallback: 7–8/10, "comfortably hard — one sentence, not a paragraph."

**Recovery.** 60–90 s jog — short and active, justified: threshold blocks are sub-severe, so brief jog recoveries keep the aerobic stimulus continuous without needing full clearance, and the app's index math keeps the whole session ≥2 run-days clear of the long run (`generator.ts:263-264`).

**Within-tier progression.** Fast volume first, then density: wk1 3 × 5 min → wk2 4 × 5 min → wk3 5 × 5 min (subject to the 10%/3-mi cap) → then shorten jog to 60 s. Hold pace at CS throughout — this is the pinned-intensity regime. **Ceiling:** the app's fast-volume cap (≤10% of weekly miles, hard 3 mi).

**Prerequisites.** Streak ≥4 (`REQUIRED_STREAK[6]=4`) + advanced-data gate + tier-5 tolerance.

**Worked vs overreached.** *Worked:* completed the prescribed fast miles, painDuring ≤1, painNextAM ≤1, session RPE 7–8 as intended, check-in ≥3. *Overreached:* session RPE ≥9 (pace overshot CS — the app cannot verify pace, so RPE is the only guard; **flag:** without duration the app cannot confirm CS pace was actually held, only that effort was appropriate), painNextAM ≥2, `weeklyRecoverySignal` caution/poor (`speedGuard.ts:223-233`).

**Budget: 1.** Agree.

### Tier 7 — Continuous tempo

**Purpose.** The same maximal-metabolic-steady-state stimulus as tier 6 delivered as a *single sustained pulse* — one unbroken tempo just under CS. It trains holding economy and form under accumulating fatigue (a race-relevant skill) and is a larger single autonomic/glycogen draw than the broken version, which is why it sits *above* tier 6: continuous fatigue is where late-run form breaks down and compensatory iliopsoas load rises (`fp-fatigue.md` §3, economy cliff via gait compensation).

**Structure.** 1 × 15 → 25 min continuous at tempo. Anchor: pace ≈ CS − ~10–15 s/mi (just sub-threshold — sustainable continuously where CS is only sustainable in blocks). RPE fallback: 7–8/10 held evenly to the end; a positive split in RPE means it started too fast.

**Recovery.** N/A within-session (continuous). Session spacing ≥2 run-days from the long run, as tier 6.

**Within-tier progression.** Duration first, then pace toward CS: wk1 15 min → wk2 18 min → wk3 22 min → wk4 25 min, then nudge pace from CS−15 s/mi toward CS. Duration before pace because accumulated threshold-minutes is the adaptation and holding the slightly-easier pace longer is lower-risk than lifting pace. **Ceiling:** ~25 min / the 10%–3-mi fast-volume cap.

**Prerequisites.** Streak ≥4 (`REQUIRED_STREAK[7]=4`) + advanced-data + tier-6 tolerance.

**Worked vs overreached.** As tier 6, with the extra sentinel that a rising *within-run* RPE (reported as a high session RPE relative to the tempo target) flags overshoot. **Flag:** even split vs positive split is not directly observable without a pace stream.

**Budget: 1.** Agree.

### Tier 8 — VO2max / race-specific

**Structure (summary; full design below).** 4–5 × 3 min at ~95% vVO2max (≈ 3200 m race pace), 2–2.5 min easy-jog recovery, thorough warm-up with 2–3 primers. Anchor: **3200 m race pace** (≈ CS + ~5–8%). RPE fallback: 9/10, "a pace holdable ~8–11 min flat out." Budget 1. **Never auto-generated in base** (`generator.ts:255-257`) — ruled on below.

**Prerequisites / readiness.** Stored tier 8 unlocked via the *full* readiness ladder: pain-free streak + the advanced-data gate (readable weekly check-in + ≥4 RPE samples, `ADVANCED_MIN_TIER=5`) + the near-season gate (`NEAR_SEASON_DAYS=21`) + PT intensity clearance; plus ≥2–3 clean tier-6/7 blocks completed and the athlete away from the peak-height-velocity window. And — uniquely for this tier — **coach-confirmed**: tier 8 is coach-led / manually triggered, never auto-generated (`generator.ts:255-257`, ruled below), so satisfying the unlock ladder is necessary but not sufficient without explicit coach initiation.

**Worked vs overreached (app data only).** *Worked:* reps completed at target effort with session RPE plateauing rather than climbing across the reps; painDuring ≤ cap and painNextAM settling (≤ the during-run value); easy-run RPE stable in the following days; weekly check-in ≥3. *Overreached:* painNextAM > painDuring or a morning-pain blocker (`morningPainHold`, `speedGuard.ts:189-196`), easy-run RPE trend rising (`risingRpe`, `speedGuard.ts:206-212`), weekly check-in soreness/energy degrading (`weeklyRecoverySignal` caution/poor, `speedGuard.ts:223-233`), or an inability to hold rep effort — any of which trips the existing downward guards (hold / downgrade / relock). **Flag:** without pace or duration the app cannot verify the in-zone (T@VO2max) stimulus was actually delivered, so RPE + pain are the only in-session markers — a known limitation (cross-reference the data-model section, `ground-speed-surface.md` Claim 7).

---

### The VO2max-maximizing session (tier 8)

**Design objective:** maximize cumulative **time at ≥90–95% VO2max** per unit autonomic and iliopsoas cost. Derived from O2 kinetics and the T@VO2max literature, then ruled for this athlete.

**Minimum rep duration — from the fast-component time constant.** VO2 rises toward demand with a phase-II time constant τ ≈ 25–40 s in a fit adolescent (possibly faster in youth; `fp-central.md` §3). Reaching ~95% of the demanded value takes ~3τ ≈ 90–105 s, and reaching *true* VO2max (running just above the intensity whose steady-state demand equals VO2max) takes roughly **90–150 s**. This sets a hard floor: reps shorter than ~2 min never climb to VO2max from cold, so they cost the metabolic price and buy near-zero time-at-max. The demonstrated data land exactly here: **1-min reps reach only ~82% VO2peak; 2-min reps reach ~92%** (Seiler & Sjursen; `ev-intervals.md` C5) [DEMONSTRATED, trained]. **Minimum rep ≈ 2 min; the useful floor for *banking* time above 90% is ~3 min** (≈2 min to reach max, then ~1 min accrued).

**Why too long fails.** Beyond ~4–5 min, pace decays below vVO2max (VO2 drifts *down* off max), while glycogen, autonomic, and — decisively for this athlete — iliopsoas load keep accumulating for no additional time-at-max (`fp-central.md` §3). Diminishing central return against rising injury/autonomic cost.

**What recovery must do — incomplete, and passive/easy, quantified.** Incomplete recovery keeps VO2 partially elevated so rep 2+ re-attains VO2max with less of the τ-climb to repeat → *more* cumulative time-at-max per session. The trade-off against fatigue is real: too-short recovery lets pace decay (killing the velocity that defines the stimulus). The operating point is recovery ≈ 70–90% of rep duration (2–2.5 min per 3-min rep). **Active vs passive: rule passive/easy-jog for these short (<3 min) reliefs.** First-principles central reasoning argued *active* (sustain venous return/SV), but that is self-limiting — SV is already near its plateau by 50–70% VO2max, so the marginal central gain from an active float is small — while the proxy that actually matters, faster VO2 re-attainment, favors keeping baseline VO2 elevated, which short *passive/easy* relief does best (`ev-intervals.md` C7; adjudicated in `converge.md` Conflict 1) [MECHANISTIC INFERENCE, both sides]. Easy jog (not a hard float, not a full stop) is the practical middle.

**The protocol comparison, on MEASURED T@VO2max.** This is the crux, and it overturns the folk wisdom:

| Protocol | Measured time >90% VO2max | Note |
|---|---|---|
| 4 × 3 min @ 95% vVO2max | **327.9 ± 146.8 s** | Rønnestad 2024/25, highly-trained MD (some F ~19.5 y) [DEMONSTRATED, acute] |
| 24 × 30/30 @ 100% vVO2max | **201.3 ± 268.4 s** (p≈0.05) | *Less* T@VO2max than long reps — huge SD |
| 15/15 | inferred lower still | shorter work → more VO2 dip per float |
| 6 × 2 min | reaches ~92% VO2peak/rep | at the floor; each rep just *reaches* max, banks little |
| 5 × 3 min | ≈ best T@VO2max/fatigue balance | long enough to bank, short enough that pace/hip hold |
| 4 × 4 min @ 90–95% HRmax | +7–9% VO2max over 8 wk | Helgerud 2007 — the only *chronic-outcome*-validated protocol [DEMONSTRATED, moderately-trained adults] |

**The Rønnestad crux:** the same 30/30 session that produced *less* true T@VO2max produced **more** time >90% HRmax (820 vs 545 s, p<0.001 — opposite direction to VO2) and equal RPE (`ev-intervals.md` C2–C3) [DEMONSTRATED]. So an app scoring interval "success" by HR-in-zone or effort would systematically conclude the *worse* VO2max session was the better one. Long intervals win on the metric that matters; the cheap surrogates point the wrong way. This is why the engine must never grade tier-8 quality by HR or RPE-in-zone.

**THE session:** **4–5 × 3 min at ~95% vVO2max (≈ 3200 m race pace, RPE 9), 2–2.5 min easy-jog recovery, preceded by a genuine warm-up with 2–3 short primers (strides/~30 s surges)** to pre-accelerate VO2 kinetics (the first rep banks little; count on reps 2+). Target ~12–15 min accumulated fast, ~5–9 min >90% VO2max on a good day. For the iliopsoas-reactive athlete, **30/30 is the defensible lower-tissue-cost alternative** — shorter hip-flexor loading bouts, lower peak lactate — but it must be sold on *joint economy, not a T@VO2max advantage it does not have.*

**4–6 week progression** (variable order: rep duration → reps → recovery density; intensity pinned at 95% vVO2max):
- wk1: 4 × 2 min, 2.5 min jog (establish at the kinetics floor)
- wk2: 4 × 3 min, 2.5 min jog (extend rep to *bank* time above 90%)
- wk3: 5 × 3 min, 2.5 min jog (add a rep → more accumulated T@VO2max)
- wk4 (down week): hold or 3 × 3 min
- wk5: 5 × 3 min, 2 min jog (tighten recovery → raise the fraction spent at max)
- wk6: 5–6 × 3 min, 2 min jog. **Saturation ceiling ≈ 6 × 3 min at 2 min recovery** — beyond it pace decays and hip cost climbs with no added time-at-max.

**Evidence grade.** Structure: **well-grounded for adults** (Helgerud chronic outcome; Rønnestad/Seiler acute T@VO2max) [DEMONSTRATED]. Youth: **directionally supported but modest** — the pooled youth HIIT effect on VO2peak is small and noisy (Engel 2018, g ≈ 0.10, no passive controls; `ev-youth.md` C2) [DEMONSTRATED, weak]. Youth-specific *dosing* is [MECHANISTIC INFERENCE], thin, softened only by faster youth kinetics (one Buchheit cohort hit 43% of a session >90% VO2max on short reps, `ev-intervals.md` C15). And the whole edifice rests on an **assumed, not validated, surrogate**: no controlled trial shows a higher-T@VO2max protocol yields greater VO2max gain (Midgley; `ev-intervals.md` §2.6). Do not tell the athlete that maximizing minutes-in-zone is proven to maximize VO2max — it is not.

**Ruling on never auto-generating tier 8 in base — CORRECT, not a real gap, with one refinement.** Four reasons it is right for *this* athlete: (1) the VO2max payoff in youth is small (g ≈ 0.10) and partly confounded by maturation; (2) the athlete is **volume-limited, not intensity-limited** — the marginal easy mile beats a third weekly hard session on the steep part of every peripheral curve (`transfer.md` §4), and the base-phase hard unit is better spent on threshold (tier 6), which builds the CP/fractional-utilization that actually governs the 5 k; (3) tier 8 is the highest iliopsoas-strain and highest-autonomic-cost session — worst injury-integrated expected value, and the injury curve inverts *left* of the fitness curve (`fp-fatigue.md` §7); (4) the app cannot even *measure* the tier-8 stimulus (no pace/duration; HR would mislead), so autonomously dosing it blind is indefensible. In-season, the coach and races supply race-specific/VO2max stimulus and the app correctly defers (season branch schedules zero hard work, `generator.ts:265-266`). **The one refinement:** the readiness *ladder* already lets state 8 unlock (streak + advanced data + near-season gate, `NEAR_SEASON_DAYS=21`), so the gap is only in *generation*. That is the right place for the gap — but tier 8 should be exposed as a **coach-confirmed / manually-triggered** session near season, not left physically unreachable, so an athlete who has genuinely earned tiers 1–7 clean and is away from PHV can be given a supervised 4–6 wk introductory block rather than nothing. Never *auto*-generate: correct. Never *offer*: slightly over-conservative.

<a id="s5"></a>

## 5. Intensity distribution target + rationale

### 5.1 The target, as numbers and as a zone model

For this athlete — HS XC, ~25 mpw (~4 h/wk, ~200 h/yr), reactive iliopsoas (pain cap 3/10), already lifting heavy legs — the target is:

> **~80 / 13 / 7 by minutes-in-zone, 3-zone LT-anchored model, pyramidal.** Z1 (below LT1, easy) ≈ 80%; Z2 (LT1→CP, threshold/tempo) ≈ 13%; Z3 (above CP, 3k–5k/VO₂ pace) ≈ 7%, hard-capped at ≤8% and non-escalating. Z3 is coach/season-gated and must emerge through the tier ladder, never be dialed up to satisfy a ratio. [MECHANISTIC INFERENCE — extrapolated from recreational-adult low-volume RCTs (Festa null, Muñoz) plus the volume-limited CP argument and the iliopsoas cap; no adolescent or 25-mpw TID RCT exists.]

Two athlete-specific riders keep this from being a generic prescription:

1. **The 80 is a floor, not a ceiling.** At 25 mpw the dominant performance lever is *raising the easy denominator*, not tuning the split. The athlete sits on the steep part of the mitochondrial-volume (~6% of fibre volume vs ~11–12% ceiling), capillarisation, and fractional-utilisation (CP/VO₂max ~80% vs ~90%) curves, and a HS 5k is raced above CP, so `dTime/dCP ≫ dTime/dD′` — CP is the dominant 5k lever and it is volume/threshold-built [MECHANISTIC INFERENCE, fp-peripheral §7]. More easy volume is the buy; the split is secondary.

2. **The 7% Z3 is *coverage*, delivered mostly off the sustained-running books.** Z3's unique product is type-IIx recruitment and mitochondrial-quality (cristae/supercomplex) stimulus that easy running below ~90 min never reaches — but that product is *presence*, and it saturates at ~12–16 min/wk [MECHANISTIC INFERENCE, fp-peripheral §6]. Because sustained Z3 running is also the single highest iliopsoas-strain modality (hip-extension ROM × hip-flexion angular velocity both peak with speed [MECHANISTIC INFERENCE, fp-peripheral §5]), most of that 7% should be bought as short strides/hill-strides (near-zero metabolic and time cost, low strain-*rate*), not VO₂ intervals. Realised minutes-in-zone will therefore read closer to **~82 / 14 / 4**, and that is correct, not a shortfall — the strides do the recruiting off the distribution ledger.

### 5.2 Why pyramidal — and why polarized and threshold both lose *here*

**Polarized (≈80/5/15, hollow middle) loses on two independent counts.** Its entire rationale is that *high absolute easy volume* supplies a sufficient aerobic stimulus, so the middle can be abandoned and intensity minimized. That premise is volume-conditional and fails at ~4 h/wk: 80% of 25 mpw ≈ 20 easy miles ≈ 3.0–3.3 h — below the ~350 h/yr band that even *descriptively* looks threshold-like, and far below the ~750 h/yr at which polarization appears at all [DEMONSTRATED descriptively, ev-distribution C11]. Second, ~15% Z3 by minutes is a large recurring iliopsoas load for no demonstrated payoff: prospective POL-vs-PYR is a statistical wash even in trained adults (Filipas 2022: 5-km differences "within the technical error"; 2024 MA time-trial SMD −0.01) [DEMONSTRATED, adult]. Paying Z3's injury cost to buy nothing is the wrong trade for an athlete whose binding constraint is a growth-plate-adjacent apophysis.

**Threshold (Z2-dominant, ~40–50% Z2) is the serious rival, and the honest reason it survives at all is Festa.** Festa 2020 — an RCT in the *right volume band* (recreational adults, ~3–4 h/wk) — put threshold-heavy 40/50/10 against polarized 77/3/20 and found **no between-group difference on any outcome, with 17% less training time in the threshold arm** [DEMONSTRATED]. That result does real work: it *licenses the pyramidal middle* — at low volume the moderate zone is efficient, not junk, so we do **not** empty it the way strict POL does. What Festa does *not* license is Z2-*dominance* for this athlete, for two reasons the trial couldn't see. (i) 40–50% of weekly minutes at/near CP is a large cumulative moderate hip load and a real glycogen/CNS cost that narrows the easy-volume base — and that base is precisely this athlete's top lever (§5.1). (ii) A Z2-dominant week spends the scarce weekly stimulus on holding tempo rather than on the volume expansion that pays on the steep part of every peripheral curve. So Festa refutes *strict polarized* at low volume; it does not mandate threshold. **Pyramidal wins because it banks the maximal easy base (top lever, lowest iliopsoas cost per mile), keeps a real but bounded Z2 to build CP — the dominant 5k lever — and holds Z3 to a small non-escalating coverage dose the pain cap can afford.** The metabolic optimum (CP⁻) and the structural optimum (psoas-moderate) coincide at threshold pace; pyramidal is the only distribution sitting on both.

### 5.3 Zone boundaries the athlete can actually measure (no lab)

Lab anchors are unavailable *and* two of them do not transfer to a 15-year-old. Fixed lactate (4 mmol/OBLA) mis-places the boundary because adolescents reach 4 mmol at a higher %VO₂max — or never — owing to immature PFK/glycolytic capacity [DEMONSTRATED, ev-youth C6; T11]. Adult %HRmax tables mis-zone youth (higher, more variable HRmax; larger 220-age error) and HR dissociates from VO₂ within intervals [DEMONSTRATED, T4/T11]. **Do not zone by HR or by fixed lactate.** Use field surrogates:

| Zone (3-zone) | Field surrogate the athlete can measure |
|---|---|
| **Z1** (< LT1, easy) | Full-paragraph conversation; nose-breathing feasible; "all day" pace; ≥75–90 s/mi slower than Critical Speed; RPE ≤ 3–4. |
| **Z2** (LT1→CP, threshold) | **Critical Speed** from two recent races: `CS = (d₂−d₁)/(t₂−t₁)` from a 1600 m and a 3200 m — the only anchor with youth-specific reliability *and* concurrent validity (T9). Behaviourally: holdable ~50–60 min fresh; one sentence not a paragraph; at a rep's end feels you could have held it 15–20 min longer [MECHANISTIC INFERENCE, fp-peripheral §4.4]; RPE 5–7. |
| **Z3** (> CP, hard) | Anything faster than CS — 3k–5k effort; breathing dominates; RPE 8–10. |

**3-zone vs 5-zone shift.** The number is meaningless until the model *and* the boundaries are fixed — the *same* sessions reclassify polarized↔pyramidal purely by method, and the Z3 fraction moves ~9%→23% on identical training just by switching denominator/boundary convention [DEMONSTRATED, ev-distribution C9/C10]. Moving 3→5 zones subdivides both ends: the easy band splits (some low-steady running a 3-zone model calls Z1 gets pushed into a 5-zone "Z2"), and the top splits into threshold/VO₂/anaerobic, shrinking the apparent "hard" share because true anaerobic minutes are tiny. Net: **the same plan reads as more easy-dominant / more pyramidal under a 5-zone lens than under 3-zone — a 3–4× swing in the reported hard fraction is achievable with no change in training.** Commit to **3-zone, minutes-in-zone, LT/CP-anchored**, and state it; every number in §5.1 is void under any other convention.

### 5.4 The denominator ruling (sessions vs minutes vs miles)

**In principle the correct denominator is time-in-zone (minutes), pre-specified.** Session-goal and session-count both *inflate* the hard fraction — one interval session (mostly easy warmup/recovery minutes) scores as a single "hard" unit; this is how "80/20-by-session-goal" becomes ~91/9 by time-in-zone on the same training [DEMONSTRATED, ev-distribution C10]. The denominator swings the number >2×, so it is the measurement, not a bookkeeping detail. TRIMP is defensible but hard to communicate to a 15-year-old.

**The app logs miles only** (no duration field; RunEntry carries `miles_actual`, a bare RPE scalar, and pain — ground-speed Claim 7). Miles cannot yield time-in-zone; they can give a hard-fraction-by-mileage and a hard-session count — enough for a cap, not enough to verify the target.

**The error miles introduce — direction and magnitude, ruled precisely (and the intuitive framing is backwards).** A hard mile is run faster, so it occupies *fewer* minutes than an easy mile. Worked example: 10 easy mi @ 10:00 (100 min) + 2 hard mi @ 6:00 (12 min) → hard is **16.7% by miles but 10.7% by minutes.** Formally, easy-fraction-by-time `x·pₑ/(x·pₑ+y·p_f)` exceeds easy-fraction-by-miles `x/(x+y)` whenever `pₑ > p_f` — always. So **time OVER-weights easy; miles OVER-STATE the hard fraction (equivalently under-state easy)** — the opposite of "easy miles are slower, so miles favour easy." At a realistic easy/threshold pace ratio (~9:00 vs ~6:45 ≈ 1.33), the overstatement is **hard-by-miles ≈ 1.3–1.4× hard-by-minutes** (~2–3 percentage points at a 10%-by-miles cap). **This bias is conservative for a downward-only cap:** a miles-based hard-cap reads more hard work than the athlete truly does by time, so it errs toward cutting intensity earlier — the safe direction. **Ruling: use time-in-zone in principle; with miles only, cap hard-by-miles and treat the ~1.3× overstatement as a feature. Log duration to remove the bias, not because the bias is dangerous.**

### 5.5 Is 80/20 valid at 25 mpw? — head-on: No

**Not as strict polarized, and not as "20% hard."** The polarized justification rests on high *absolute* easy volume carrying the aerobic load; at ~20 easy miles (~3.2 h) that dose is modest and non-saturating, and the athlete sits on the steep part of every peripheral curve — the easy fraction is not "already enough," it is the lever to *grow* (§5.1). Emptying the middle throws away the cheapest CP stimulus available, and the one clean low-volume RCT (Festa, ~3–4 h/wk) is a **null**. Both the model's premise (easy is sufficient) and its numerator (20% Z3) fail here. "80/20" survives only reinterpreted as *~80% easy, ~20% not-easy split pyramidally (mostly Z2, minimal Z3)* — and even the 80 is a floor. The "20" is a **ceiling on non-easy, never a target to reach by adding intensity.** [DEMONSTRATED that the premise fails descriptively; MECHANISTIC INFERENCE for the prescription.]

### 5.6 Adolescent ruling

**No adolescent TID intervention trial exists** — the youngest MA cohorts sit at the adult edge (~17±3, embedded in adult pools) [ev-distribution §5; ev-youth: zero located]. The only youth-directed guidance is expert opinion to *restrict Z3* ("modified polarized," developmental neuromuscular/endocrine caution) [ev-distribution C13]. Three *demonstrated* youth findings all push the same way and select the conservative end of the adult-derived shape: (i) HIIT's aerobic payoff is small (g=0.10 vs control) and its target glycolytic system is immature until late adolescence, so a big Z3 block buys little [DEMONSTRATED, ev-youth C2/C6]; (ii) race-time trend is heavily growth-confounded — falling times in a 14–16yo are largely maturation (economy + FFM + leg length), so performance can *not* validate a distribution or license more intensity [DEMONSTRATED, ev-youth C4; T19]; (iii) metabolic recovery outpaces structural recovery, so metabolic readiness *systematically over-permits* — the hard fraction must be gated on the hip/apophysis, never on how recovered the athlete feels [CONFIRMED, P8]. **Rule: adopt the pyramidal *direction* — which every independent line (Festa null, volume-threshold physiology, apophyseal risk, CP argument, youth evidence) converges on — treat the specific numbers as low-confidence, and never let the ratio override the pain cap or a rising mechanical signal.**

### 5.7 Engine-enforceable form — downward-only

| Field | Specification |
|---|---|
| **Measured quantity** | fast-fraction-by-miles `f = fast_mi / total_mi` (proxy for Z2+Z3), plus a Z3 trip-wire = any logged run at RPE ≥ 8. |
| **Window** | rolling 7-day for the ratio; rolling 28-day (block) to catch drift; checked at generation time. |
| **Tolerance band (one-sided)** | `f ≤ 0.10` base, `≤ 0.15` in-season (≈ ≤8% / ≤11% by minutes, given §5.4's ~1.3× overstatement). Sustained-Z3 running ≤ 1 session/wk base, 0 preferred. **No lower bound is enforced — by design.** |
| **Out-of-band action (DOWNWARD-ONLY)** | If `f` exceeds the cap (e.g. an athlete-added hard run) or session count exceeds budget or the iliopsoas signal rises → **remove/downgrade** the next hard day along threshold → fartlek → strides → easy; on an RPE ≥ 8 trip-wire apply the existing morning-pain/spike holds. **Never add Z3 or tempo to reach a floor; never inflate volume to dilute a ratio.** If easy share reads "too low," the fix is to *cut hard*, not add easy. |

Staying inside downward-only: the distribution is controlled *only by capping/removing the numerator (fast miles)*. Because the true (time) fast fraction is even lower than the miles number (§5.4), a miles-based cut always over-protects. Volume growth stays governed by its own psoas-gated ≤10%/wk rule, never by a distribution target. This mirrors the existing architecture exactly — the guard only ever `Math.min`s the tier down; the generator caps the threshold fast-portion at `min(10%·week, 3 mi)`.

**Schema requirement.** Currently logged: **miles + RPE + pain.** To enforce the minutes target the app SHOULD add per run: (1) **duration_min** — highest value; converts miles→time, erases the ~2–3 pp bias, enables true zone-minute accounting; *without it, the miles proxy degrades acceptably (error ~2–3 pp, erring safe)*; (2) **a fast-portion/kind tag on LOGGED (not just planned) runs** — without it the monitor is blind to athlete-added intensity, though **RPE ≥ 8 already flags a run as Z3** and is the minimum viable trip-wire. *What degrades without duration:* cannot verify 80/13/7 by minutes, cannot detect "easy" runs drifting into the grey zone (Z1→Z2 creep), cannot compute sRPE load (RPE × minutes — the scalar is never multiplied by time). Minimum viable = keep RPE on every run (Z3 detection) + add duration (denominator fix).

### 5.8 What the app's current rules already produce

Computing the realised distribution from the wired rules (HARD_BUDGET_BASE=1, one generated threshold day, fast-portion = `min(10%·week, 3)`, no VO₂/race-pace path ever generated, Tier 8 season-gated, strides/hills = 0 hard units):

| Base week, 25 mpw | Z1 | Z2 | Z3 |
|---|---|---|---|
| by **miles** | 90.0% | 10.0% | 0% |
| by **minutes** (easy 8:00, thr 6:00/mi) | ~92.3% | ~7.7% | 0% |

In-season (budget 2): typically one threshold + episodic races (races consume budget first); non-race weeks stay ~90/10/0; race weeks spike hard-by-miles to ~18–22% for that week only. The generator itself schedules **zero** fast miles in coach/season mode — the coach owns the ≤2 hard units; the app's own contribution to intensity is only ever to *hold or remove*, never add.

**Reconciliation with the ~80/13/7 target.** The app *already* produces a correctly-shaped **pyramidal** distribution — in fact slightly *more* conservative: it runs hotter on easy (90–92% vs 80%, because it can only add one small threshold day and cannot push volume), a touch light on Z2 (~8–10% vs 13%, held down by the 10%/3-mile cap and the single-unit base budget), and zero *sustained* Z3 vs the target's 7% — which the iliopsoas cap and the POL-vs-PYR wash say is the safe choice, with strides supplying recruitment presence off-book. **The existing `THRESHOLD_MAX_WEEK_PCT = 0.10` + `HARD_BUDGET_BASE = 1` + season-gated Tier 8 already produce the target's shape and err safe on its magnitude. No new distribution-enforcement machinery is needed; the caps *are* the distribution mechanism.** The single defensible refinement the target permits — carrying in-season Z2 marginally longer toward ~13% of minutes — is gated on volume growing *and* the hip staying clean, must stay a *cap the engine may lower* (never a quota it adds intensity to hit), and must never add Z3.

<a id="s6"></a>

## 6. Plyometric / neuromuscular protocol

This athlete already does heavy leg day. That single fact reframes the whole question. The literature that makes plyometrics look valuable overwhelmingly *adds* it to endurance-only runners or *substitutes* it for running volume — neither is this athlete. The only question that matters here is the **marginal** one: what does plyometric/reactive/drill work buy *on top of* existing heavy strength and the strides/hill-strides the ladder already prescribes at tiers 1–4? The honest answer is "less than the isolation trials imply," and saying so is the useful finding. The recommendation is *not* a plyo block: keep reactive work concentrated in running-specific strides, add only a minimal low-amplitude plyo touch, and refuse to let it consume the hard-session budget threshold work has the stronger claim on.

### 6.1 Mechanism first — and which link actually breaks

Plyometrics can improve running economy (RE) and speed through four pathways on two timescales:

1. **Motor-unit recruitment + rate coding** (neural, fast — days–weeks): high-velocity ballistic contact forces the size principle to recruit the highest-threshold type-II/FF units and drives fast firing/doublets. Submaximal running never recruits the top ~30–40% of the pool, so this is genuinely orthogonal to easy mileage. [MECHANISTIC INFERENCE]
2. **SSC coordination** (neural, weeks): antagonist co-activation ↓ and the timing of muscle stiffening across the ~100–200 ms ground contact improves, driving fascicles toward near-isometric operation while the tendon does the length change — more elastic return, less metabolic cost. [MECHANISTIC INFERENCE]
3. **Tendon stiffness / CSA** (material, slow — months): high-strain-rate loading signals collagen remodelling. [DEMONSTRATED that plyo raises MTS/tendon stiffness — Spurrs 2003.]
4. **Reduced ground-contact time / duty-factor tuning** — an emergent output of 1–3.

**The tendon-stiffness story is ASSUMED, not demonstrated as the cause of the RE gain — and this dictates what the engine models.** Inputs and outputs are each well-supported: plyo raises tendon stiffness [DEMONSTRATED], and *whole-limb* stiffness correlates with RE (vertical r ≈ −0.52, leg r ≈ −0.57, both p<0.001; Li 2022). But the specific link plyo is meant to exploit fails: **ankle/plantarflexor-tendon stiffness — the tissue depth jumps most target — did NOT correlate with RE (r ≈ 0.084, NS)**, and in highly-trained runners (Fletcher) tendon-stiffness changes did not track RE changes. Nobody has shown the measured stiffness *increase* is what produced the measured RE *improvement*; it is co-occurrence, and the relationship is non-linear with an optimum (fp-neuro §7: past the force-matched optimum, impact buffering and the fascicle force–length operating point both degrade RE). **Engine ruling: attribute any RE gain to neuromuscular coordination and recruitment (pathways 1–2), NOT to tendon stiffness. Do not model tendon stiffness as the lever.** [SPECULATION for the stiffness→RE link; DEMONSTRATED for coordination/recruitment as the safer attribution.] Timescale consequence for dosing: the neural arm shows in **2–4 weeks**, the tendon arm over **2–4 months** — this is patience-rewarding, not a quick win.

### 6.2 The marginal-value ruling (the point of this section)

The question is not "does plyo work" but "does plyo add anything on top of heavy strength he already does." The evidence separates the three conditions:

| Comparison | Source | Effect | What it tells us |
|---|---|---|---|
| Heavy vs plyo, head-to-head (substitution) | Eihara 2022 meta, trained adults | Heavy RE **SMD −0.32** (−0.55,−0.10); plyo **−0.17** (CI to **+0.21**, crosses 0) | Plyo is a **poor substitute** — it loses to the heavy work he already does. [DEMONSTRATED] |
| Explosive vs heavy (both vs control) | Denadai 2017 meta | Explosive **−4.83%**, heavy **−3.65%** RE | Comparable in isolation; duration, not modality, is the moderator. [DEMONSTRATED] |
| Heavy **+** plyo ("complex") vs heavy alone — **adolescent** runners | Yu 2025, 32 M, 16.8 y, 44.5 km/wk, 8 wk | Complex RE **+8.5–15.5%** across 12/14/16 km/h vs RT **+3.4% at 12 km/h only**; RSI +26.5% vs +7.4% | The only on-population *additive* test, and it favours adding plyo — **but single, no true control, ~2× this athlete's volume, effects almost certainly inflated.** [DEMONSTRATED, low confidence] |

The one study that tests the actual question (additive, in adolescents) is favourable but is a single uncontrolled trial at double the mileage. First-principles agreement (fp-neuro §8): because heavy leg day already trains maximal force and *running strides already deliver the SSC at the exact running contact time*, the marginal RE gain from a **separate** plyo program is small, and most of even that is capturable by fast strides alone — more running-specific and lower-risk than depth jumps.

**RULING: SMALL marginal value, speed-specific. Commit to ~1–2% RE over an 8–12-week block as the planning number, and treat most of the reactive stimulus as already delivered by tiers 1–4. GRADE: MODERATE that the effect is small; LOW that any larger (Yu-sized) effect is real.** The benefit, where it appears, shows up at *faster* paces (Saunders 2006: RE improved only at 18 km/h in elites; Spurrs: largest at 12–14 km/h in sub-elites) — a racing/finishing-speed lever, not an easy-pace one. Do **not** build a separate high-volume plyometric program.

### 6.3 Modalities — justified from mechanism, and the overlap that shrinks the dose

The app already prescribes buildups, short strides, flat strides, and hill strides at tiers 1–4. **These ARE reactive/plyometric work** — each footstrike at high velocity is a maximal SSC event delivering pathways 1, 2, and 4 at the running-specific contact time. This overlap is decisive: **a large fraction of the plyometric stimulus is already in the plan under a different name, so less separate plyo is needed than a naive read of the isolation literature suggests.** Strides/hill-strides are the *primary* SSC/recruitment vehicle; standalone plyo is a *supplement* adding only the vertical/high-amplitude component strides under-cover. Prescribe from mechanism, in priority order:

| Modality | Reactive stimulus | Specificity | Iliopsoas/tissue risk | Verdict |
|---|---|---|---|---|
| Flat strides (tier 3) | Maximal SSC at running contact time (prescribed relaxed/submaximal) | Highest | Low–moderate (relaxed/submaximal — never the high-velocity eccentric end-swing) | Primary economy/speed lever and the earlier, lower-load reactive entry |
| Hill sprints (tier 4) | High recruitment, near-maximal concentric drive, muted SSC | High | **High** (near-maximal concentric hip drive — highest iliopsoas/apophyseal load in the block) | Highest-load reactive tier — gated higher behind hip-safe + PT clearance |
| Ankle/pogo hops, low skips | High RFD, short contact, bilateral | Moderate | Low–moderate if bilateral/low-amplitude | The one marginal add worth prescribing |
| Submaximal bounds / A-skips | Low-grade reactive | Moderate | Moderate (hip drive) | Bridge only; no separate economy credit |
| Hurdle / drop / depth jumps | Highest RFD + high impact | Low | **High** (impact + hip-flexor load) | Late, gated, low-volume only — first to be pulled |

High-volume depth jumping is NOT justified: high tissue cost, small marginal benefit on top of heavy leg + strides, elevated impact/iliopsoas risk. Hip-dominant high-velocity work (sprint-drive, high-knee bounding) is the classic iliopsoas strain mechanism (rapid stretch of an actively shortening hip flexor) — gate it behind proven tolerance and the 3/10 cap.

### 6.4 Dose — real numbers from trials that worked

Synthesised from Spurrs 2003 (+4–7% RE: 2→3×/wk, progressive foot-contacts, low→high intensity, 6 wk), Turner 2003 (+2.3%: 3×/wk, 6 wk), Saunders 2006 (3×30 min/wk, 9 wk), Chen 2023 youth optimum (2×/wk, ~20–25 min, 7–8 wk):

- **Frequency:** 2×/week (isolation trials used 2–3; 2 is right once strides already carry reactive load).
- **Volume — measured in ground contacts:** start ~30–60/session, progress toward ~60–100 over weeks. Low-amplitude first; youth + iliopsoas → stay low end.
- **Intensity:** low-amplitude/submaximal for the first 2–3 weeks; add higher-intensity (hurdle/drop) contacts only after clean tolerance. Every rep high-quality, short-contact, full recovery — a fatigued long-contact "plyo" rep trains the wrong thing and raises strain.
- **Duration:** ~15–25 min including recovery.
- **Block length:** 6–10 weeks minimum — the tendon arm needs months; expect the neural arm in 2–4 weeks.
- **Progression:** contacts and amplitude up slowly; regress instantly on any hip-flexor flare; hold volume flat and expect non-monotonic progress through a near-PHV growth phase.

### 6.5 Placement vs hard days and the long run

A properly-run reactive session is **metabolically cheap** (alactic, trivial glycogen/cardiovascular cost) **but draws on a real, smaller tissue/neural pool** — and for this athlete the iliopsoas/apophyseal tissue axis is the binding constraint. Schedule by *tissue*, not aerobic, recovery:

- **Place reactive/plyo on or adjacent to a hard running day** (pre-run neural primer or same-day add-on) to keep easy days easy and consolidate high-neural-load days. [MECHANISTIC INFERENCE / EXPERT]
- **Do not stack two distinct reactive-loading days back-to-back** — leave a tissue gap.
- **Keep reactive work ≥48 h from the long run** — the week's highest-impact tissue event; plyo inside that window competes for the connective-tissue recovery the long run needs.

**Engineering correction (I now have the codebase audit the earlier draft lacked):** the constant `FAST_LONG_SPACING_H = 48` is **DEAD CODE — defined but never read anywhere in `src/`.** The 48 h separation is enforced *structurally* by day-index arithmetic (`generator.ts:263-264` requires a ≥2-run-day gap; the conflict check at `:423-426` demotes fast days within 2 days of the long run), not by the named constant. The *intent* is correct and must be preserved, but a new engine must NOT assume reading `FAST_LONG_SPACING_H` enforces anything. A reactive add-on scheduled on the threshold day inherits the spacing automatically.

### 6.6 Adolescent safety and efficacy — verify, don't repeat

- **"Youth respond especially well to neural/plyo work": PARTIALLY VERIFIED, narrower than the slogan.** Youth plyo reliably improves *jump and sprint* (Chen 2023 meta, 19 trials, 536 adolescents: CMJ **+2.74 cm**, 20-m sprint **−0.12 s**) — [DEMONSTRATED for jump/sprint, NOT RE]. The heightened-neural-plasticity window (~12–16 y male) is a model, not a measured RE effect [MECHANISTIC INFERENCE]. Direct adolescent *RE* evidence is essentially the one Yu 2025 trial, so adolescent RE efficacy is **PROBABLE, not proven** — adopt the direction, not a magnitude. Compounding this, youth RE improves with *age alone* independent of training, and short-term training does not reliably improve youth RE (Krahenbuhl & Williams) — an engine crediting a plyo block with RE gains during growth is largely **reading growth.** [DEMONSTRATED]
- **Safety / PHV / apophyseal risk — conditional, not reassuring by default.** Supervised, progressed youth plyo is rated safe (NSCA position stand), but the youth meta base **under-reports adverse events**; absence of reported harm ≠ demonstrated safety. The binding hazard here is specific: the iliopsoas inserts at the **lesser-trochanter apophysis**, a cartilaginous, tendon-weaker site where, during PHV, bone lengthens faster than the muscle-tendon unit — a classic adolescent avulsion/apophysitis location, and 15–19-year-olds account for ~43% of athletic stress fractures. **Hip-flexor-loading plyo (high-knee drive, bounding, sprint-drive) is the specific thing to gate.** Conservative fallback: bilateral low-amplitude ankle/pogo work first; gate any hip-dominant reactive drill behind the 3/10 pain cap; regress instantly on flare; hold volume flat through growth spurts.

### 6.7 THE BUDGET RULING — is a plyo session a hard unit?

**What fatigues, and on what timescale, decides this.** A full-recovery reactive session fatigues (a) the *neural* system — transient, minutes-to-hours — and (b) *connective tissue* — ~24–96 h. It does **not** meaningfully deplete glycogen or load the cardiovascular system, so on the metabolic axis threshold and VO₂ work compete on, it is **not a hard unit** (fp-neuro §10, fp-fatigue §4). But on the *tissue* axis — the binding constraint here — it is a real load.

This is the tension the brief names: at **0 units** it is metabolically free and an athlete could stack unlimited reactive volume onto a reactive apophysis; at **1 unit** it competes 1:1 with threshold work, which is the more valuable metabolic buy (threshold builds CP, the dominant 5 k lever; plyo's marginal RE value is small — §6.2). Resolve it **dose-dependently, and by charging the right budget:**

- **Low-dose reactive touches — buildups, strides, hill strides, low-amplitude pogos/skips (tiers 1–4; alactic, full-recovery, ≤8 reps ≤35 s per the existing `STRIDES` config): 0 units against the metabolic `HARD_BUDGET`.** This preserves the app's current rule ("neuromuscular touches count 0") and it is *correct* — they genuinely don't spend glycogen/cardiovascular budget, so charging them there would wrongly crowd out threshold work. They are governed instead by the pain cap, streak gates, and the ≥48 h long-run spacing — a *tissue* gate, not a metabolic one. This split is a **flagged limitation of the frozen metabolic budget** (see §12): tissue load ≠ metabolic cost, so reactive load must be gated separately rather than folded into `HARD_BUDGET` — a known constraint this design works around, not one it resolves. This is the right home for reactive work.
- **A genuine high-intensity plyo session — hurdle/drop/depth jumps at ~60–100 contacts, or any hip-dominant reactive volume: 0.5 unit, charged against a TISSUE/reactive cap, NOT `HARD_BUDGET`.** Not free (it spends real connective-tissue recovery on a reactive apophysis) but not a full metabolic hard unit (it doesn't compete with threshold for glycogen recovery). Cap dedicated high-intensity plyo at **≤1 such session/week** regardless.

This mirrors the existing architecture, which already charges `FARTLEK_UNITS = 0.5` for light fartlek and 0 for neuromuscular touches: dose moves a session from the 0-unit tier to a 0.5-unit tier, and the 0.5 charge belongs to a tissue budget *parallel* to `HARD_BUDGET`, not inside it. **Net rule: 0 units for tier-1–4 reactive work (as now); 0.5 tissue-unit for a standalone high-intensity/high-contact plyo session, capped at one per week; never 1 full metabolic unit.**

### 6.8 Running drills (A-skips, high knees, B-skips)

**Is there evidence they improve economy? NO.** No controlled RE trial isolates running drills at any age (ev-economy C16). The economy benefit is inferred only because drills are low-grade plyometrics — entirely borrowed from the plyo evidence, not independently supported. [SPECULATION]

**Prescribe them anyway? Yes, but narrowly and with no separate credit.** Justification: (i) they deliver the same low-amplitude reactive/coordination stimulus as pogos at near-zero tissue and metabolic cost, so they sit in the tier-1–4 / 0-unit bucket; (ii) they are a low-risk technique/warm-up vehicle. But the engine must **NOT model a distinct "drill economy" benefit** on top of strides and plyo — that would double-count an effect that isn't even independently demonstrated. And any hip-dominant drill (A-skips, high knees) is gated behind the same 3/10 pain cap as flat striding — it loads the one tissue to protect. Forced to choose between prescribing A-skips and prescribing hill strides, **prescribe the hill strides**: more running-specific, better-evidenced, lower-risk.

<a id="s7"></a>

## 7. Tendon loading (walled-off advisory section)

**This section is PARALLEL and ADVISORY. It does not modify sections 1–3.** Those sections
derive the optimal intensity target on performance merits alone — deliberately. The app
already ships an independent **RUNTIME SAFETY LAYER**: the 3/10 pain cap, flare detection,
morning-pain blockers, tier gates, and the speed guard's downward-only blockers. *That* layer
decides what is actually delivered on any given day. The division of labor is the whole point:
**the research establishes the optimal TARGET; the safety layer decides what is safe to
DELIVER today.** If tendon conservatism were folded back into the target, the system would be
conservative twice over and could no longer report what it is giving up. So nothing below
lowers an intensity number. It tells a tendon-informed observer what to *watch*, and maps
those observations onto safety signals that already exist.

### Mechanotransduction: what the tendon actually senses

Tenocytes transduce matrix strain into collagen-gene expression; the adaptive signal is
driven by **strain magnitude and strain rate — not by cycle count.** [DEMONSTRATED]
Controlled human Achilles work (Arampatzis/Bohm) shows a **high strain magnitude (~4.5–6.5%)
at low frequency** drives stiffness/CSA gains, whereas high-frequency low-magnitude cycling
does not — more bounces at low strain is not a substitute for adequate strain. [DEMONSTRATED]
Read: tendon adaptation is a **magnitude/quality** stimulus, mechanistically parallel to the
recruitment/quality logic sections 2–4 already use for the neural system.

### Collagen synthesis timing — why frequency beats volume

After a loading bout, **both** synthesis and degradation of tendon collagen rise. Synthesis
peaks ~24 h and stays elevated to ~72 h; degradation peaks earlier and resolves sooner
(Magnusson/Kjaer/Langberg). [DEMONSTRATED] Langberg's peritendinous microdialysis showed
procollagen (PICP) roughly **tripling by 72 h** post-exercise. [DEMONSTRATED] Consequently
**net collagen balance is transiently NEGATIVE in the first ~24–36 h and turns net-positive
only later in the ~72 h window.** [MECHANISTIC INFERENCE] This is why **loading frequency
matters more than per-session volume** — you re-stimulate as the net-positive window opens,
rather than piling cycles into one session or reloading while balance is still negative. It is
the tissue-level echo of the app's spacing logic.

### Stiffness adaptation vs. muscle — the mismatch that is the key insight

Muscle strength/CSA adapt in **weeks**; tendon stiffness adapts over **months** (meaningful
change ~8–12 wk of high-load work; continued remodeling 3–6 months; full turnover far longer).
On detraining the order reverses only slightly. [DEMONSTRATED] The insight: **a runner's force
output and aerobic fitness can outrun their own tendon.** The neural gains sections 2–4 promise
arrive in weeks; the tendon that must tolerate those faster, harder contacts lags by months.
That lag is a **window of vulnerability** — the strong-engine / not-yet-remodeled-tendon gap is
exactly where overuse tendon injury occurs. This is about **rate of progression over months**,
not about any single session's intensity. [MECHANISTIC INFERENCE]

### Youth tendon and PHV

Adolescent tendon is adaptable, but its stiffness is driven upward chiefly by **rising muscle
force imposing greater tendon stress** (maturation + sex effects). [DEMONSTRATED] Around **peak
height velocity**, bone lengthens faster than the musculotendinous unit accommodates; the
apophyses (tendon-to-bone attachments) are structurally weaker than mature bone, producing the
traction apophysitides — **Osgood-Schlatter** (patellar/tibial tuberosity) and **Sever**
(Achilles/calcaneus). [DEMONSTRATED] For THIS athlete the binding tissue is the iliopsoas, but
the PHV lesson holds: **expect non-monotonic tolerance through a growth spurt**, independent of
training load. [MECHANISTIC INFERENCE]

### Relation to the app's speed tiers

Tendon strain-rate load rises with contact velocity and impact. The tendon-heaviest work is
**flat max-velocity striding and depth/drop plyometrics** (highest strain rate); **hill
strides** load with high force but muted eccentric/impact strain (§6); **low plyo/pogos** sit
lowest. So the app's higher speed tiers are the tendon-relevant ones. The **tendon-relevant
recovery interval between two high-strain reactive sessions is ~48–72 h**, matching the
collagen net-balance window above — far longer than the neural recovery (minutes–hours) that
gates rep spacing *within* a session. [MECHANISTIC INFERENCE]

### ADVISORY BOX — observations, not intensity cuts

A tendon-informed observer watches for, and maps onto EXISTING signals:

- **Morning-after stiffness/pain at a tendon insertion** (Achilles/calcaneus, patellar, or the
  reactive hip flexor) → exactly what **`painNextAM` and the morning-pain blocker** already
  capture. Treat a morning-stiffness uptick as the tendon's own "interval-too-short" flag.
- **Two high-strain reactive sessions closer than ~48–72 h** → the existing **24–48 h hold**
  already spaces them; tendon biology simply explains *why* the hold exists.
- **A rapid jump in reactive quality/force with no matching tolerance history** → the
  earned-trust cap and tier gates already govern how fast load may widen.
- **A growth-spurt phase** → expect noisier morning-pain readings; the downward-only blockers
  absorb this without the target moving.

None of these is an instruction to lower an intensity number. Each is an observation the runtime
layer already acts on.

---

**Explicit closing statement:** Nothing in this section modifies sections 1–3. The optimal
intensity target stands as derived on performance merits. Tendon concerns are the province of
the runtime safety layer (pain cap, flare detection, `painNextAM`/morning-pain blocker, the
24–48 h hold, tier gates, speed-guard downward-only blockers) — **not** of a lowered target.
The two concerns are kept architecturally separate by design.

**Sources:** Kjaer et al. 2009, *Scand J Med Sci Sports* (mechanical loading → collagen
synthesis); Magnusson, Langberg & Kjaer 2010, *Nat Rev Rheumatol* (net synthesis/degradation
balance); Langberg et al. (peritendinous PICP kinetics); Arampatzis/Bohm (strain-magnitude
threshold for tendon adaptation); "How do tendons adapt?" 2019 review
(https://pmc.ncbi.nlm.nih.gov/articles/PMC6737558/); adolescent maturation/PHV apophysitis
literature (per ev-youth §8).

<a id="s8"></a>

## 8. Race-date periodization + ideal MPW model

Periodization is where this report must speak in weeks-out numbers, and also where the evidence is thinnest and most adult. The organizing logic is not tradition — it is **adaptation-timescale matching**: lay down the adaptations with long time-constants first (while there is time for them to accrue and consolidate), sharpen the ones with short time-constants last (so they are still present on race day). Every ruling below is for the design-target athlete — a 14–18y, ~25 mpw runner with a reactive iliopsoas and a hard 3/10 pain cap — and is reconciled with the app's actual `stepWeek` / `xcStartDate` mechanics as verified in source.

### 8.1 Backward sequencing from adaptation timescales (not tradition)

Working backward from the physiology briefs, the trainable levers sort cleanly by time-constant:

| Lever | Build time-constant | Persistence | Sequence position |
|---|---|---|---|
| Capillarization | τ ≈ 4–8 wk [MECH] | slow to lose | **earliest** (general base) |
| Total Hb-mass / red-cell mass | 3–6+ wk, iron-gated | slow | earliest |
| Cardiac eccentric remodeling (EDV/SV) | weeks–months | weeks–months | early |
| Mitochondrial content | τ ≈ 2 wk | ~2–4 wk | mid |
| Threshold velocity / critical speed | weeks (volume-built) | weeks | mid→late |
| Plasma volume | 24h–1 wk | days (lost fast) | rides through, peaks late |
| Neuromuscular / economy (coordination) | 3–6 wk | weeks | late sharpening |
| Fatigue-shedding (glycogen, autonomic, low-freq force) | days | days | **race week only** |

That ordering **is** the periodization; the "general → specific" template falls out of it mechanically:

| Block | Weeks-out | Primary target (why here) | Intensity content for THIS athlete |
|---|---|---|---|
| **General base** | ~16–8 wk | Capillary bed, Hb-mass, cardiac remodeling — slow, must start now; all volume-driven | Easy volume growth; strides 2×/wk (neuromuscular seeding, ~0 tissue cost); **1** hard aerobic unit/wk max |
| **Specific / threshold** | ~8–3 wk | Critical speed / fractional utilization — the dominant 5k lever (dTime/dCP ≫ dTime/dVO2max) | Hold volume near peak; the 1 hard unit becomes threshold/CS-paced |
| **Sharpening** | ~3–2 wk | Economy + speed neuromuscular; race-specific | Race-pace work maintained, reps trimmed; plasma volume rising |
| **Taper** | final 7–14 d | Shed fatigue; supercompensate glycogen/PV/fiber | Intensity **held**, volume cut ~40% |

**Adolescent-transfer ruling (decisive, now grounded in the youth brief):** the "specific" block is a **threshold / critical-speed** block, NOT a VO2max/interval block. Adult specific-prep phases lean on high-intensity glycolytic work; but glycolytic machinery (PFK-1, LDH) is immature until *late* adolescence, the pooled youth HIIT effect vs control is small (g = 0.10, Engel 2018, n = 577), youth already sit near an oxidative metabolic profile, and the 5k is CP-dominated. The scarce, psoas-limited hard budget therefore buys more as threshold than as VO2max intervals. [DEMONSTRATED — youth HIIT effect size; MECHANISTIC INFERENCE — CP-dominance of the HS 5k]

### 8.2 Ideal peak weekly mileage — honest evidence grade

**No controlled dose-response trial establishes an "ideal" peak MPW for anyone, least of all a HS runner.** [DEMONSTRATED that none exists — taper brief claim 19: zero RCT.] Every circulating "ideal volume" figure is **observational and confounded**: faster runners train more *and* are more talented and durable, so the mileage-performance correlation cannot be read causally. This must be stated plainly, not laundered as evidence.

What the evidence *does* support, and how it bounds the recommendation:

1. **This athlete is volume-limited, not intensity-limited** (transfer brief §4, MODERATE-HIGH confidence). He is on the *steep* part of every peripheral curve — mitochondrial volume ~6% vs a ~12% ceiling, CP/VO2max ~80% vs ~90%. The marginal easy mile is ~2–3× more productive here than in the 70–100 mpw adults the literature studies, where "diminishing returns to volume, add intensity" was derived. That conclusion **inverts** at 25 mpw (two independent first-principles agents converge). [MECHANISTIC INFERENCE]

2. **Marginal value of mile 26–30 vs 21–25.** Both lie on the productive part of the aerobic curve — this athlete has not reached aerobic diminishing returns anywhere in that band. But the *injury* cost is not flat: **>30 mi/wk is a named male BSI risk factor, and 15–19y olds are 42.6% of athletic stress fractures.** [DEMONSTRATED — epidemiology] Miles 21–25 are nearly free aerobically and low-risk; miles 26–30 remain aerobically productive but begin climbing the structural-risk curve; mile 31+ is where risk steepens against a still-reactive apophysis.

3. **The binding limiter is tissue, not aerobic headroom.** In adolescents metabolic recovery *outpaces* structural recovery (youth brief — the single most dangerous asymmetry for an engine). Volume is the correct growth *target*, but its rate and ceiling are set by the hip signal, never by how good the athlete feels aerobically.

**Recommendation — labelled honestly as convention + mechanism, NOT evidence:** target a peak of **~30–35 mpw, approached patiently (≤10%/wk), with the true ceiling set by hip tolerance rather than a number.** Treat 30 mpw as a soft caution line and ~35 mpw as a hold-and-consolidate ceiling pending demonstrated multi-season durability. This is a defensible operating point, not an "optimum" — there is no optimum to name. The app's peak-seeking `stepWeek` already implements this shape: `gapSeek = max(0, peakMpw − traj) / PEAK_RAMP_WEEKS(4)` accelerates toward a distant peak but is hard-clamped by the +10%/wk `cap`, and `peakMpw` is the terminal ceiling — so setting `peakMpw ≈ 32` and letting the pain-gated `growthFactor` throttle the *rate* is the correct encoding of this ruling.

### 8.3 Peak-volume timing vs peak-intensity timing — they differ

Peak volume and peak intensity should **not** coincide, justified from timescale + recovery-cost accounting:

- **Volume** builds the slow adaptations (capillary, Hb-mass, mitochondrial content) that must be in place and *consolidated* before race day; they persist for weeks, so peak volume can and should sit **earlier** (~6→4 wk out), then plateau and ease.
- **Intensity** (race sharpness, economy, top-end) has a short productive-then-decaying signal and a high autonomic + tissue recovery cost. Co-locating peak volume and peak intensity doubles the recovery bill with no adaptive upside — saturating stimulus plus interference (residual fatigue from one degrades the quality of the other). So **peak intensity sits later** (~3→2 wk out), *after* volume has come off its peak and freed recovery budget.

**Is "they differ" evidenced or conventional?** **Conventional / mechanistic, not demonstrated.** [SPECULATION per taper brief claim 21 — "peak volume precedes peak intensity" is coaching convention, untested.] The *mechanism* (recovery-cost accounting + timescale separation) is sound [MECHANISTIC INFERENCE], but no controlled trial has isolated the two peak timings. Conservative fallback: hold to **one** hard unit per week through the base so the collision rarely becomes acute, and never stack a hard effort within 48h of another quality session or a race.

Concrete weeks-out numbers: **peak volume** ~30–35 mpw held ~**6→4 wk out**; **peak intensity** (sharpness) highest quality **~3→2 wk out** on trimmed volume; both fall together in the taper.

### 8.4 Taper — full specification

The taper is the **single best-evidenced lever in this domain** — and even it was built almost entirely on adult, higher-volume endurance athletes (Bosquet's 27 studies; the 2023 PLOS review, age 17–32, touches only the *top* of the HS range). Youth taper evidence exists only in **swimmers** (Bishop/Girold: +3.6% force, +1.6% power), so applying it to a 15y runner is **inference, not demonstration** [MECHANISTIC INFERENCE]. It transfers-with-modification: err shorter, cut less.

| Parameter | Prescription (this athlete) | Adult evidence anchor | Grade |
|---|---|---|---|
| **Duration** | **7–10 days** (adults tolerate 14–21) | 8–14 d sharpest; ≥22 d loses effect (SMD +0.69, n.s.) | [DEMONSTRATED, adult] → shortened by inference |
| **Volume cut** | **~40%** from peak (low end) | 41–60% optimal (Bosquet 0.72 ± 0.36, P<0.001) | [DEMONSTRATED, adult] |
| **Decay shape** | Progressive / exponential, front-loaded — not one step | fast-exp +6–7% vs step | [DEMONSTRATED, single-study] |
| **INTENSITY** | **MAINTAIN — do not reduce pace.** Keep 1–2 quality sessions at race pace; cut their *reps/volume*, not their speed | maintain 0.33 ± 0.14 (P<0.001); *decreasing* intensity SMD +0.25, n.s. | [DEMONSTRATED] — **the load-bearing rule** |
| **FREQUENCY** | **MAINTAIN** — keep run days, shorten each; do not drop to 3 d/wk | maintain 0.35 ± 0.17 (P<0.001); *decreasing* freq n.s./worse | [DEMONSTRATED] |
| **Pre-taper overload** | **SKIP** — deliberately overloading a reactive iliopsoas before a taper is the wrong trade | overload+taper > taper alone (P<0.05) in adults | [DEMONSTRATED benefit] but **contraindicated here** |

Why err short and shallow: a ~25-mpw adolescent has *less accumulated fatigue to shed* than a 100-mpw adult, so a full 2-week/60% taper risks **detraining** — and plasma volume, the fastest-decaying adaptation, is lost within days of undertraining. A 7–10 day, ~40% cut sheds fatigue without bleeding fitness.

**Prominent, non-negotiable rule:** the taper cuts **volume**, holds **intensity and frequency**. The intuitive "rest more, run easy" taper is *directly refuted* — decreasing intensity or frequency did not help and trended worse. [DEMONSTRATED]

**Why the taper works — mechanism ledger (demonstrated vs assumed):**

| Mechanism | Status |
|---|---|
| Muscle glycogen supercompensation | [DEMONSTRATED] — measured |
| Blood/plasma volume + Hb/hematocrit rise | [DEMONSTRATED] — "consistently demonstrated" |
| Single-fiber (MHC IIa) diameter/force/power rise | [DEMONSTRATED] — Trappe/Luden 2010, distance runners |
| Muscle-damage repair / low-frequency force recovery | [MECHANISTIC INFERENCE] |
| Autonomic normalization (↓sympathetic, ↑parasympathetic) | [MECHANISTIC INFERENCE] — direction only, inconsistent |
| Neuromuscular potentiation | [MECHANISTIC INFERENCE] |
| Hormonal (T:C) normalization | [SPECULATION] — "proposed," not established |
| Psychological recovery / mood | [MECHANISTIC INFERENCE] |

Crucially, **VO2max and running economy do NOT reliably improve during a taper** (SMD 0.20 and −0.47, both n.s.). [DEMONSTRATED] The taper is fatigue-shedding + glycogen/blood/fiber supercompensation, **not a fitness gain** — realistic total ~**2–3%** (range 0.5–12%). [DEMONSTRATED] Engine consequence: do not read a post-taper PR as *earned training fitness*; it is largely fatigue removal, which compounds the youth growth-confound and must never license more load.

### 8.5 Race week + post-race recovery

Race week *is* the taper's final days for a goal race. A 5k needs modest recovery: soreness peaks 24–48h, inflammation largely resolves by ~day 5, and **2–4 easy days restore sharpness — easy running, not rest, aids repair** [MECHANISTIC INFERENCE, muscle-damage physiology]. Never schedule a hard interval within 48h before a race; the app already enforces this by index arithmetic (`thresholdFits`), and a current-week race correctly forces the taper and spends a hard-budget unit.

### 8.6 Multi-race seasons (weekly-to-biweekly XC)

A HS XC season stacks 6–10 races across ~10 weeks; you cannot fully taper each without abandoning training. Ruling:

- **The race IS the hard session.** A weekly race substitutes for the Tuesday quality workout — drop that workout, don't add to it. In-season real load ≈ race + coach sessions + leg day, already at the ceiling; cut weekly volume ~5–7% in-season to pay for the racing. [EXPERT-OPINION / MECHANISTIC INFERENCE]
- **Which races get a taper:** only the **1–2 goal races** (league / section / state). For those, a compressed **3–5 day mini-taper** (~25–30% volume cut, intensity held) — not the full 7–10 day taper, which would cost too much training across the season.
- **Between races:** maintain volume, easy running, one set of strides; the race supplied the intensity. No stacked quality.
- **Treating a race as exactly 1 hard unit is CORRECT** and matches the ground-truth mechanics (`unitsUsed = weekRaces.length`, races consume budget first, `HARD_BUDGET_SEASON = 2`). A race and a threshold session are not physiologically identical, but as a *budget-accounting* unit — one high-tissue-cost, autonomic-taxing effort that forecloses another that week — 1 unit is the right abstraction. It must not count as 2 or 0.

Adolescent reinforcement: youth recover *metabolically* fast between weekly races, which tempts more quality between them — but the structural/apophyseal system recovers slowly and is the binding limiter. Gate inter-race work on the hip signal, never on how recovered the athlete *feels*. [DEMONSTRATED — the metabolic/structural recovery asymmetry]

### 8.7 Coexistence with xcStartDate — the module becomes a MONITOR

The ground-truth audit is unambiguous: **in season (Monday ≥ `xcStartDate`) the app schedules ZERO hard sessions** — the `if (seasonWeek)` branch short-circuits threshold/fartlek scheduling; volume is *held* flat (`total = min(prev.traj, peakMpw)`), the long-run ladder is frozen, and the budget of 2 exists only to *account for* the coach's workouts and races, never to schedule app work. **The coach owns workouts in season.**

So what does a periodization module *do* in season? **It stops prescribing and becomes a monitor.** Its in-season job: watch that coach load + races don't breach the downward-only signals (pain drift, RPE trend, recovery check-ins, weekly jump) — all of which already ratchet the plan *more* conservative; account races/coach sessions against the hard budget for *display and warning*, not scheduling; and preserve the base-block gains (hold volume, don't let the ladder climb into a coach's hard week). The module should not fight this: periodization *planning* is out-of-season work; in-season it is *surveillance* that can only deload.

**The hard case — a goal race INSIDE the coach's season.** The coach owns the calendar, but the athlete has a championship they care about. Solution, respecting every invariant (downward-only; app schedules no in-season hard work):

1. The module **cannot add** a taper workout or remove a coach session — it has no authority over coach content and may only act conservatively.
2. What it *can* do, all downward-compatible: (a) **suppress its own optional strides/fartlek add-ons** in the final 5–7 days (the todaySpeed add-on layer, tier-clamped ≤3, is app-owned and can be silenced); (b) apply the **race-week taper it already applies** — a current-week race forces volume suppression + spends a budget unit; (c) surface a **monitor-level recommendation** to athlete/coach ("goal race in 5 days — this is a taper window; the plan has cut easy volume ~25% and dropped optional strides") without mutating coach sessions.
3. Because the only lever the app fully controls in-season is its *own* easy volume and optional add-ons, the in-season goal-race taper is necessarily **partial** — a ~25–30% easy-volume cut plus add-on suppression, inside the coach's frame. That is the honest ceiling of what a downward-only, coach-subordinate module can deliver, and it suffices: the intensity that must be *maintained* is the coach's to hold; the fatigue-shedding *volume cut* is the app's to apply. The two compose correctly.

The one thing the module must never do — in or out of season — is read a race result, a post-taper PR, or fast metabolic recovery as *earned fitness* that licenses more load. At 14–16y that signal is largely growth and fatigue-removal, not training response, and crediting it would inflate load exactly when circa-PHV apophyseal risk peaks. [DEMONSTRATED — maturation confound + PHV injury clustering]

<a id="s10"></a>

## 10. Evidence quality table

**Honest headline — what this report actually rests on.** With the anchoring and youth briefs now in hand, the corpus is larger and its adolescent footing is better than the earlier (partial) draft claimed. Of the ~70 load-bearing claims below, about **19 (~27%) carry direct adolescent data** — but almost all of that sits on the *constraint / do-not* side of the ledger: the maturation confound (Armstrong/Barker), apophyseal + BSI injury epidemiology (15–19y = 42.6% of athletic stress fractures), youth HRmax-formula failure, Critical-Speed youth reliability, and the small, noisy youth-HIIT effect (Engel g=0.10). Roughly **~50% is adult / trained-near-adult extrapolation** — every actual taper parameter, the interval structure, the 4×4, the TID trials, the plyometric RE trials — i.e. the numbers the engine would *prescribe* are overwhelmingly adult numbers. The remaining **~23% is pure mechanism / UNTESTED** (recovery-type, SV-vs-intensity, fiber recruitment, tendon-vs-economy causation, most fatigue-inversion predictions). The decisive asymmetry: **adolescent data tells us what to fear and cap; adult data tells us what to prescribe; mechanism fills the gaps.** There is still ZERO adolescent RCT on intensity distribution, peak volume, taper, or T@VO2max — the four levers that most shape the plan. Read every dose as adult-anchored and every ceiling as youth-anchored.

**Transfer verdict legend:** YES / WITH-MODIFICATION (WM) / NO / UNKNOWN. Maps the transfer agent's TRANSFERS→YES, TRANSFERS-WITH-MOD→WM, DOES-NOT-TRANSFER→NO, UNKNOWN→UNKNOWN; ‡ marks a verdict inferred where the transfer agent did not rule explicitly. **[⚠ …]** flags where converge.md or a source brief rules differently.

**Grade legend:** META = meta-analysis · RCT · CT = controlled trial · OBS = observational · EXPERT = expert-opinion/consensus · MECH = mechanistic inference · SPEC = speculation.

---

### A. Hypothesis / framing (the load-bearing meta-claims)

| Claim | Evidence grade | Population (n + duration) | Effect size | Transfers to ~25mpw adolescent? | Source |
|---|---|---|---|---|---|
| Maximize time ≥90% VO2max ("several min/session") — the objective the interval field optimizes | MECH (authors flag it as belief) | trained adults, narrative | ~4–10 min >95% typical session | YES (the assumption travels; its validity does not) | Buchheit & Laursen 2013, Sports Med 43:313 & 927 |
| Maximizing T@VO2max has never been shown to maximize VO2max GAIN head-to-head | DEMONSTRATED (as a gap) | distance runners, reviews | no controlled trial exists | YES — strengthens in youth (zero youth dose-response) | Midgley, Wilkinson & McNaughton 2006, Sports Med 36:117 |
| %VO2max attained during intervals best reflects adaptation magnitude (only pro-surrogate study) | DEMONSTRATED but CORRELATIONAL | trained adult cyclists, training block | positive association only | UNKNOWN‡ — correlational, adult, paywalled | Odden et al. 2024, Eur J Sport Sci, doi 10.1002/ejsc.12202 |
| VO2max decouples from performance: static in taper yet performance rises ~2–3% | DEMONSTRATED | trained adults, SR+MA | VO2max SMD 0.20 (−0.93,1.33) ns | YES (direction) | Rehman/PLOS 2023, PMC10171681 |
| Time-trial performance flat across intensity distributions while VO2peak differs | DEMONSTRATED | trained+rec adults, MA | TT SMD −0.01 ns | YES (direction) | 2024 Sports Med MA, PMC11329428 |
| CP / fractional utilization (CP/VO2max), not VO2max, dominates the 5k lever (dTime/dCP ≫ dTime/dD′) | MECH (CP-model derivation), supported 3 ways | first-principles + indirect | structural; no youth regression | YES — decisive; core of volume-limited ruling | converge Conflict 2 / transfer T22 — **UNCITED empirically; verify before relying** |
| At 25 mpw the athlete is VOLUME-limited above a small quality floor (next easy mile > next hard minute) | MECH (multi-agent convergence) | first-principles, target-native | conf. MODERATE-HIGH | YES — driver of the whole engine | transfer §4 — **UNCITED empirically** |
| HR/RPE mislead about interval quality; individual Δsurrogate ≠ ΔVO2peak | DEMONSTRATED | trained adults, RCT | HR trends OPPOSITE to VO2 in short reps | YES — measurement physiology, age-independent | Rønnestad 2024 (below); surrogate-marker RCT 2024, PMC11385293 |

### B. Intervals + tiers

| Claim | Evidence grade | Population (n + duration) | Effect size | Transfers? | Source |
|---|---|---|---|---|---|
| Long intervals (4×3 min @95% vVO2max) accumulate more true T@VO2max than 30/30 | DEMONSTRATED (acute crossover) | highly-trained MD, n=12 (F mean 19.5y); acute | 328±147 s vs 201±268 s >90% VO2max (p≈0.05) | WM — one near-adolescent cohort; youth kinetics only faster | Rønnestad et al. 2024, Front Sports Act Living 6:1507957 |
| HR/RPE dissociate from VO2 in short intervals (proxies point wrong way) | DEMONSTRATED (acute) | highly-trained MD, n=12 | 30s 820±249 s >90%HRmax vs 3min 545±131 (opposite to VO2); RPE ns | YES (worse in youth) | Rønnestad et al. 2024 (as above) |
| VO2 kinetics τ≈25–40 s; work must ≥ time-to-VO2max to reach it | MECH (anchored to kinetics) | trained adults, narrative | ~4τ (~80–140 s) to steady state | YES‡ (softer floor in youth) | Buchheit & Laursen 2013 Part I |
| 1-min reps reach only ~82% VO2peak; 2-min reach ~92% (keep reps ≥2 min) | DEMONSTRATED (acute) | well-trained runners, small n | 82±5% vs 92±4% VO2peak | WM — floor softer in youth; allow ~90 s | Seiler & Sjursen 2004 (in B&L 2013) |
| ≥95% vVO2max single / ≥90% repeated elicits VO2max | MECH (from acute VO2) | trained adults, narrative | intensity window | YES‡ | Buchheit & Laursen 2013 Part I |
| Passive recovery preferred when relief <2–3 min (keeps baseline VO2 up) | MECH (contested) | trained adults, narrative | qualitative | YES‡ **[⚠ converge C-P5 REFUTES the active-recovery alternative]** | Buchheit & Laursen 2013 Part I |
| Surges within long work intervals increase T@VO2max | DEMONSTRATED (acute) | well-trained male cyclists, n≈12 | 410 s vs 286 s ≥90% VO2max (p=0.02) | UNKNOWN — **cycling; running transfer unproven** | Bossi et al. 2020, IJSPP (PMID 32244222) |
| Billat 30/30 sustains long exposure near VO2max vs a CONTINUOUS run | DEMONSTRATED (acute) | well-trained runners, small n | ~9:30 at vVO2max PACE (≠ VO2 ≥95%) | WM‡ — superseded by long-interval finding for T@VO2max | Billat et al. 2000, Eur J Appl Physiol 81:188 (PMID 10638376) |
| 4×4 min @90–95% HRmax raises VO2max ~7–9% over 8 wk | DEMONSTRATED (chronic outcome) | moderately-trained adults, 8 wk | +7.2% VO2max; SV +~10% | WM — works in youth but effect small; cap by psoas + 25 mpw | Helgerud et al. 2007, MSSE 39:665 |
| HIIT reliably improves VO2max in adults; between-protocol differences small | DEMONSTRATED | adults, mixed status, many RCTs | category effect; protocol edge weak | WM‡ (category); doesn't validate T@VO2max | Bacon 2013 PLoS ONE; Wen 2019 meta |
| Priming (prior bout/early reps/surges) speeds VO2 kinetics; first rep contributes little | MECH, well-supported | trained adults | qualitative | YES‡ | Buchheit & Laursen 2013 Part I |
| Recommended: 4–5×3 min @~95% vVO2max, passive/easy relief 2–3 min, primed warm-up | MECH (synthesis) | target-native | expect ~3–6 min >90% VO2max | YES (native ruling) | ev-intervals §3 |

### C. Intensity distribution

| Claim | Evidence grade | Population (n + duration) | Effect size | Transfers? | Source |
|---|---|---|---|---|---|
| Polarized beat THR/HIIT/HVT across most endurance variables (flagship) | CT (single RCT) | trained adults, n=48→41, 9 wk | VO2peak +11.7%, TTE +17.4% | NO — comparators under-dosed; not replicated in pooling | Stöggl & Sperlich 2014, Front Physiol 5:33 |
| POL modestly beats other TIDs — VO2peak only; TT/TTE/threshold-velocity equivalent | META | trained+rec adults, 14 studies n=437, 4–24 wk | VO2peak SMD 0.24 (0.01–0.48); TT SMD −0.01 ns | NO (as "POL superior") | 2024 Sports Med MA, PMC11329428 |
| POL VO2peak edge exists ONLY <12 wk and ONLY in highly-trained | META (subgroup) | same MA | <12wk 0.40 (p=0.01); ≥12wk ns; developmental ns | NO — subgroup excludes this athlete | 2024 Sports Med MA |
| POL beat THR ~40 s on 10-km TT | META | trained+rec adults | ~40 s pooled | NO‡ — small, adult, high-vol | Rosenblat 2019, JSCR |
| Pure POL vs pure PYR: no clear winner (within technical error) | RCT | well-trained M runners, n=60→56, 37±6y, 16 wk | 5k PYR→POL −1.5% vs POL −1.1% vs PYR −0.6% | WM‡ — supports "PYR not inferior" | Filipas et al. 2022, Scand J Med Sci Sports |
| At low volume POL beats THR (pro-POL low-vol point) | CT | recreational adults, n=30, 10 wk | 10k POL +5.0% vs THR +3.6%; compliant ES=1.29 | WM — contested by Festa; low-vol TID unsettled | Muñoz et al. 2014, IJSPP |
| At low volume threshold-heavy MATCHES POL on every outcome (null), 17% less time | RCT | rec adults ~3–4 h/wk, n=38, 8 wk | no between-group difference | WM — closest volume match; supports keeping Z2 | Festa et al. 2020, Front Sports Act Living |
| Elite descriptive TID is predominantly PYRAMIDAL, not polarized | OBS (retrospective) | elite adults, reviews | HVLIT >70%, little Z2/Z3 | YES — kills descriptive→prescriptive fallacy | Stöggl & Sperlich 2015, Front Physiol 6:295 |
| Same training reclassifies POL↔PYR by zone-boundary method | OBS | world-class adult, n=7, 50 wk | race-pace zones → 88.5/7.4/4.1 pyramidal | YES | Kenneally et al. 2021, EJSS |
| Reported TID swings >2× with denominator (session-goal vs time-in-zone) | OBS | elite adults, descriptive | Z3 9% (time) vs 23% (session-goal) | YES — use minutes-in-zone | Seiler; Norwegian XC skiers (in ev-distribution) |
| Polarization emerges only >750 h/yr; ~350 h/yr looks threshold-like | OBS/EXPERT | mixed, review | 25 mpw ≈ 200 h/yr (below both) | YES — supports pyramidal lean | Frontiers 2025 review, PMC12568352 |
| Norwegian double-threshold (2 lactate-clamped sessions/day, 2–4 mmol) | EXPERT + CASE-SERIES | elite adults, anecdote/case | no prospective controlled trial | NO — volume- & lactate-meter-dependent | Casado, Foster, Bakken & Tjelta 2023 |
| Youth need "modified polarized," restrict Z3 | EXPERT (no trials) | adolescent | none | WM — adopt direction, not as evidence | Frontiers 2025 review (extrapolation) |
| Recommended distribution: pyramidal ~80/13/7 by minutes (target; frozen caps realise a more-conservative ~92/8/0) | MECH (extrapolation) | target-native | no adolescent/25-mpw RCT exists | YES (native ruling) | ev-distribution §7 |

### D. Plyometrics + running economy

| Claim | Evidence grade | Population (n + duration) | Effect size | Transfers? | Source |
|---|---|---|---|---|---|
| Heavy resistance improves RE MORE than plyometrics (head-to-head) | META | trained/rec adults; HRT n=216, PLY n=263, 21 studies | HRT SMD −0.32 (−0.55,−0.10); PLY −0.17 (CI crosses 0) | WM — plyo a poor SUBSTITUTE for existing heavy work | Eihara et al. 2022, Sports Med Open, PMC9653533 |
| Explosive and heavy both improve RE ~comparably | META | mixed adult runners, 16 studies | explosive −4.83%, heavy −3.65% (p<0.01) | WM‡ **[⚠ contests Eihara — live meta-vs-meta disagreement]** | Denadai et al. 2017, Sports Med (PMID 27497600) |
| Plyometric jump training improves RE + time-trial; VO2max NS | META | endurance runners, 21 studies n=511 | RE ES 0.36–0.73; TT ES 0.88; VO2max ns | WM — marginal add on existing heavy leg small (~1–3%) | Ramírez-Campillo et al. 2023, Kinesiology |
| Complex (heavy+plyo) beats heavy-alone for RE — ADOLESCENT runners | CT (no true control; likely inflated) | 32 M adolescents 16.8y, 44.5 km/wk, 8 wk | RE +8.5–15.5% vs RT +3.4% (12 km/h only); RSI +26.5% | WM, low-confidence — single, uncontrolled, ~2× this athlete's volume | Yu et al. 2025, PMC12646903 |
| Explosive training (32% vol substitution) improves 5k + RE (landmark) | CT (substitution) | 18 endurance athletes, 9 wk | 5k ↓; RE ↑; VO2max unchanged | WM‡ (substitution principle) | Paavolainen et al. 1999, J Appl Physiol 86:1527 |
| Plyo added to running improves RE + 3-km | CT | 17 M, 60–80 km/wk, 6 wk | RE +6.7/6.4/4.1% @12/14/16; 3k +2.7% | WM‡ | Spurrs et al. 2003, Eur J Appl Physiol 89:1 |
| Plyo improves RE in highly-trained only at fast speeds (ceiling) | CT | 15 national-level M, 107 km/wk, 9 wk | RE +4.1% @18 km/h only | WM‡ (ceiling caution) | Saunders et al. 2006, JSCR 20:947 |
| Plyo improves RE in recreational runners | CT | 18 recreational, 6 wk, 3×/wk | RE +2.3% | WM‡ | Turner et al. 2003, JSCR 17:60 |
| Youth plyo improves jump/sprint (NOT RE) | META | adolescents 10–19y, 19 trials n=536 | CMJ +2.74 cm; 20-m sprint −0.12 s (−0.20,−0.04) | YES (jump/sprint); RE UNKNOWN | Chen et al. 2023, IJERPH, PMC9915200 |
| Youth resistance + plyo safe/effective when supervised & progressed | EXPERT position stand | children/adolescents | qualitative; risk from poor supervision | WM‡ (conditional on supervision) | Faigenbaum et al. 2009, NSCA position statement |
| Adolescence is a responsive window for SSC/neuromuscular training | MECH (model) | male ~12–16y | qualitative | WM‡ | Lloyd & Oliver YPD model |
| Vertical/leg stiffness correlate w/ better RE; ANKLE stiffness does NOT | META (associative) | 272 runners, 13 studies | vertical r −0.52, leg −0.57 (p<0.001); ankle r 0.084 ns | NO (as mechanism) — undercuts tendon story | Li et al. 2022, PMC9742541 |
| Plyo increases tendon/MTS stiffness | CT | trained adults, 6–12 wk | MTS/ankle stiffness ↑ | YES‡ (the input); causal role UNKNOWN | Spurrs et al. 2003 |
| The stiffness increase CAUSES the RE improvement | SPEC / assumed | — | ankle stiffness↔RE null; chain unproven | NO — engine must not model tendon stiffness as the lever | ev-economy C15 — **UNCITED causal claim; verify before relying** |
| Running drills (A-skips etc.) improve RE | SPEC (no controlled RE trial) | — | none isolated | UNKNOWN → treat as null | ev-economy C16 — **UNCITED — no source exists** |

### E. Taper + periodization

| Claim | Evidence grade | Population (n + duration) | Effect size | Transfers? | Source |
|---|---|---|---|---|---|
| ~2-week taper maximizes performance | META | competitive endurance adults, 27 studies | effect 0.59±0.33, P<0.001 | WM — err shorter (7–10 d) at low base | Bosquet et al. 2007, MSSE 39:1358 (PMID 17762369) |
| Reduce volume 41–60% exponentially (optimal cut) | META | competitive adults, 27 studies | 0.72±0.36; <20% or >60% ns | WM — bias to ~40% off a small base | Bosquet et al. 2007 |
| MAINTAIN intensity through taper | META + SR | trained adults | maintain 0.33±0.14; decreasing ns | WM (load-bearing rule kept) | Bosquet 2007; Rehman/PLOS 2023, PMC10171681 |
| MAINTAIN frequency (don't cut sessions much) | META + SR | trained adults | maintain 0.35±0.17; decreasing ns | WM | Bosquet 2007; Rehman 2023 |
| Taper gain is modest (~2–3%; range 0.5–12%) | META/REVIEW | mixed adult athletes | ~2–3% typical TT | YES‡ | Mujika 2004, Sports Med 34:13 (PMID 15487904) |
| 8–14 d is the sharpest window; ≥22 d loses effect | SR+META | runners/cyclists 17–32y, 14 studies n=174 | 8–14d SMD −1.47; ≥22d +0.69 ns | WM | Rehman/PLOS 2023 |
| Fast-decay exponential > slow-decay > step taper | CT (single) | endurance adults | fast-exp +6–7% vs slow +2–3% | YES‡ | Banister-lineage taper trials |
| VO2max does NOT reliably improve during taper (not the mechanism) | SR+META | trained adults | SMD 0.20 (ns), I²=87% | YES — don't model taper as fitness gain | Rehman/PLOS 2023 |
| Running economy does NOT reliably improve during taper | SR | trained adults | EM SMD −0.47 (ns) | YES | Rehman/PLOS 2023 |
| Blood/plasma volume + Hb rise post-taper (real mechanism) | CT/REVIEW | trained adults | "consistently demonstrated" | YES‡ | Mujika 2004; Houmard |
| Muscle glycogen supercompensates during taper | CT | trained adults | ↑ [glycogen] measured | YES‡ | taper physiology reviews — verify primary |
| Single-fiber (MHC IIa) diameter/force/power rise during taper | CT | competitive distance runners | ↑ diameter, force, power | YES‡ | Luden/Trappe et al. 2010, J Appl Physiol |
| Pre-taper OVERLOAD block amplifies taper gains | SR (moderate) | trained adults | overload+taper > taper alone, P<0.05 | NO — contraindicated w/ reactive iliopsoas | Rehman/PLOS 2023 |
| Higher weekly mileage correlates with better HS performance | OBS | HS XC, survey/coaching | direction only; confounded | WM — supports direction, not a target number | HS XC coaching/survey data — **partly UNCITED; verify** |
| An "ideal peak mpw" exists | SPEC | — | no controlled dose-response | NO (no evidence at any age); mileage = injury dial | ev-taper claim 19 — **UNCITED; no source exists** |
| Injury risk rises with weekly mileage in HS runners | OBS | HS runners | 28–38% seasonal incidence, dose-related | YES (native) — governs growth rate | UW-Madison HS injury research — verify primary |
| Peak VOLUME should precede peak INTENSITY | SPEC (expert convention) | — | untested | UNKNOWN‡ | ev-taper claim 21 — **UNCITED** |
| 5k race needs ~2–4 recovery days; inflammation resolves ~day 5 | MECH | recreational adults, muscle-damage studies | soreness peaks 24–48 h | YES‡ | muscle-damage physiology |
| In-season race substitutes for a hard workout; drop Tuesday session (−5–7% mpw) | MECH / EXPERT | HS XC | coaching consensus | YES‡ (native reasoning) | coaching consensus — **UNCITED** |
| Taper works in adolescents | MECH (thin CT) | youth swimmers | +3.6% force, +1.6% power (swim) | WM — swim only, transfers by inference | Bishop/Girold youth taper studies |
| Block > traditional periodization | META (low quality) + contested | trained cyclists/mixed | small VO2max edge; RCT found NO difference | NO — near-noise/irrelevant at 25 mpw | Mølmen 2019 (PEDro 3.7); Frontiers 2022 null |
| LTAD long-term periodization model is evidence-based | SPEC | youth | "lack of empirical data" | NO‡ | Ford/Lloyd et al. 2011 (critiqued) |

### F. Anchoring / pace models (miles + RPE only logged)

| Claim | Evidence grade | Population (n + duration) | Effect size | Transfers? | Source |
|---|---|---|---|---|---|
| VDOT O2-cost eq predicts race ~±3–5% (1.5–50 km flat); E/M/T/I/R paces are coach convention | DEMONSTRATED (prediction) / EXPERT (zone split) | trained/elite adults | ±3–5% | NO cleanly — fixed-economy assumption vs growth | Daniels VDOT; arxiv 1807.10595 (critique) |
| VDOT assumes fixed running economy; a maturing adolescent violates it → VDOT trend conflates fitness w/ growth | MECH | model-structure critique; adolescents | direction only | NO | ev-anchoring C2–C3 |
| Critical Speed better represents maximal metabolic steady state than MLSS | DEMONSTRATED | well-trained adults, CT | VO2 steady above MLSS not above CS | YES | ev-anchoring C4, PMC8505327 |
| CS from 3-min all-out reliable; D′ weaker/underestimated | DEMONSTRATED | trained adults, CT | CS ICC 0.95 CV ~3%; D′ ICC 0.93 CV ~5% | YES — use CS, D′ directional only | ev-anchoring C5 |
| CS is reliable in ADOLESCENTS (single-visit field test) | DEMONSTRATED | n=29 trained + 14 untrained, 17.5±0.5y | CV 2.4–4.3%, ICC 0.919–0.983 | YES — the ONLY youth-validated anchor | mdpi 2075-4663/3/4/358 |
| CS from 1600 m + 3000 m ≈ lactate-minimum velocity in youth | DEMONSTRATED | n=25 youth runners | no significant difference | YES | ev-anchoring C7 |
| Riegel ±5% only for nearby distances; over-predicts long/undertrained | DEMONSTRATED | competitive adults, observational | exponent 1.06; fades >30 km | WM — equate nearby race distances only | ev-anchoring C8 |
| 30-min TT estimates LT velocity/HR well | DEMONSTRATED | trained/rec adults | SEE 0.21 m·s⁻¹, 8.0 bpm | NO — redundant w/ CS; heavy load for a teen | ev-anchoring C11 (PMID 16095403) |
| 30-15 IFT reliable but overestimates lab VO2max | DEMONSTRATED | team-sport athletes | ICC ≥0.85; ES vs lab 0.84–1.10 | NO — needs a max test the app can't observe | ev-anchoring C12 |
| Age-formula HRmax error ±10–12 bpm (adults); Tanaka SEE 11.4 | DEMONSTRATED | adults, meta-analytic | SD 10–12 bpm | NO | ev-anchoring C9 |
| 220-age does NOT predict HRmax in children/adolescents (overest. ~6–12 bpm) | DEMONSTRATED | Verschuren 2011 + adolescent samples | overest. 12.4 bpm (adolescent ♀) | NO — unusable (and app logs no HR) | ev-anchoring C10 (Wiley 10.1111/j.1469-8749.2011.03989.x) |
| Session-RPE (RPE×duration) valid load monitor; raw RPE correlates w/ intensity | DEMONSTRATED | Foster 2001 + reviews, mixed adults | strong r vs HR/lactate/%VO2max | WM — fallback anchor + daily execution proxy | ev-anchoring C13 |
| sRPE LOAD requires duration — not logged by this app | DEMONSTRATED (by definition) | — | load uncomputable; only intensity tag survives | YES (constraint) | ev-anchoring C14 |
| Do NOT use HR-in-zone as a session success metric (proxies mislead) | DEMONSTRATED | trained adults | HR opposite to VO2 in short reps | YES | Rønnestad 2024; surrogate-marker RCT 2024, PMC11385293 |

### G. Youth trainability & the binding constraint

| Claim | Evidence grade | Population (n + duration) | Effect size | Transfers? | Source |
|---|---|---|---|---|---|
| Youth VO2peak trainable at all maturities; "trigger hypothesis" rejected but pre-pubertal gains smaller/contested | DEMONSTRATED (occurrence); CONTESTED (magnitude) | mixed youth, meta-analyses | trained youth +7.2%; pre-pubertal ~5–6% inconsistent | YES (direction); magnitude UNKNOWN | ev-youth C1; Engel 2018 |
| Trained-youth HIIT raises VO2peak more than higher-volume alt — but effect vs control is SMALL | META | trained adolescents mean 15.5y, baseline VO2 54; N=577 (24 studies), 2–13 wk | HIIT +7.2±6.9% vs alt +4.3±6.9%; g=0.10±0.28 vs control; no passive controls | WM — on-target but modest, noisy, maturation-confounded | Engel et al. 2018, Front Physiol 9:1012, PMC6072873 |
| High-intensity intermittent training raises peak VO2 in prepubertal children | CT | prepubertal ~9.7y, 7 wk | significant peak VO2 gain vs control | WM — younger than target | Baquet et al. 2002, Int J Sports Med |
| Youth have faster VO2 on-kinetics → may tolerate shorter reps than adult ≥2-min floor | MECH (one cohort) | young runners (vVO2max 18.6) | 43% of session >90% VO2max on 90-s reps | YES‡ (direction; one cohort) | Buchheit young-runner cohort (in B&L 2013) |
| Maturation alone improves VO2/economy/race time independent of training | DEMONSTRATED (longitudinal) | 10–17y boys & girls, 1057 tests | absolute peak VO2 ~doubles 11→17y | YES — decisive confound on any earned-trust signal | Armstrong & Barker; PMC6682696 |
| Youth are LESS economical than adults; RE improves with age; short-term training does NOT improve youth RE | DEMONSTRATED | children→adolescents, cross-sec+longitudinal | RE improves with age untrained | YES | Krahenbuhl & Williams 1992, MSSE (PubMed 1560744) |
| Reduced glycolytic capacity (lower PFK-1/LDH, lower peak lactate) until late adolescence | DEMONSTRATED | children→late teens, reviews | adult-like glycolysis only late adolescence | YES — HIIT's target system is immature | ev-youth C6 |
| Children recover FASTER than adults from HI work (PCr, lactate, HR) | DEMONSTRATED (CT) | prepubertal vs adults, small n | profile ~ trained-adult | YES — metabolic ONLY | Birat/Ratel; Frontiers 2018, PMC5928424 |
| Circa-PHV: motor-coordination decline, possible economy regression, elevated apophyseal/injury risk | DEMONSTRATED (coordination/injury); MECH (economy regression) | pubertal athletes (soccer-heavy) | injury spike ±6 mo PHV | YES **[⚠ economy-regression-in-runners is inference, not run-cohort demonstrated]** | ev-youth C8; PMC12101259 |
| Early specialization/intensity does NOT predict senior distance success (predictors opposite) | DEMONSTRATED (SR+MA) | elite track/distance, large | senior ← later spec., multi-sport, gradual | YES — lowers optimal aggression now | ev-youth C9, PMC9124658 |
| Male adolescent BSI/low-BMD risk rises >30 mi/wk; teens 15–19 = 42.6% of athletic stress fractures | DEMONSTRATED (epidemiology) | adolescent runners | 15–19y = 42.6% of stress # | YES — the binding constraint | ev-youth C10; PMC8073721 |
| Adolescent metabolic recovery outpaces structural recovery → metabolic readiness OVER-permits; gate on mechanical, not metabolic | DEMONSTRATED (multi-source, right-population) | youth C6/C7/C10 + anchoring C10 | — | YES — highest-value engine finding | converge P-P8 CONFIRMED |
| Iliopsoas-specific adolescent running-injury evidence | ABSENT | — | none | UNKNOWN — hold 3/10 cap as precaution | ev-youth GAPS — **UNCITED — verify before relying** |

### H. Mechanism-only predictions (converge.md — no brief directly bears)

| Claim | Evidence grade | Population (n + duration) | Effect size | Transfers? | Source |
|---|---|---|---|---|---|
| Early VO2max rise is plasma-volume-mediated, reverses before tHb-mass | MECH | — | no time-course trial | UNKNOWN | converge C-P2 |
| SV plateaus/falls by 50–70% VO2max (not monotonic to HRmax) | MECH (textbook) | — | no brief measures curve | UNKNOWN | converge C-P4 |
| Iron/ferritin gates tHb-mass and late VO2max gains | MECH | — | no ferritin×training trial | UNKNOWN | converge C-P8 |
| Volume & intensity complements; mixed supra-additive | claimed DEMONSTRATED but REFUTED for synergy | rec adults (Festa) | single-modality matches POL | NO (supra-additivity refuted); "both needed" YES | converge P-P3 |
| Mito content vs function dissociate by intensity; overreaching degrades function | UNTESTED (no biopsy in briefs) | — | — | UNKNOWN | converge P-P4/P-P5 |
| Capillarization slow (τ 4–8 wk); mito enzymes fast (τ ~2 wk) | MECH | — | indirect only | UNKNOWN | converge P-P6 |
| Near-max strides → +2–5% top speed, negligible systemic cost | MECH (jump/sprint proxy) | youth plyo C10 | sprint −0.12 s | WM‡ | converge N-P1/N-P2 |
| Uphill strides < flat for iliopsoas strain-rate | MECH (precautionary) | iliopsoas run data absent | — | UNKNOWN | converge N-P4 |
| VO2max/intensity dose-response plateaus by ~1–2 quality sessions/wk | DEMONSTRATED | distribution + HIIT metas + Engel g=0.10 | plateau | YES | converge F-P4 CONFIRMED |
| Speed quality drops sharply <48 h after hard aerobic; RE worsens during iliopsoas flare | UNTESTED (no direct brief) | — | — | UNKNOWN | converge F-P2/F-P3 |

---

### Row count by transfer verdict

- **YES: 30** (several are cautions or evidence-gaps that travel intact, not positive green-lights)
- **WITH-MODIFICATION: 21**
- **NO: 14**
- **UNKNOWN: 12**
- **Total: 77 load-bearing rows**

*Notes on the count:* "YES" is partly inflated by rows where what transfers is a warning or a gap (e.g. "T@VO2max is unvalidated," "no adolescent TID trial exists," "don't use HR-in-zone") rather than a prescription — these travel intact precisely because they are cautions. The genuinely prescription-enabling rows in the right population are few; most positive prescriptions are WM (adult dose, youth-modified) or rest on mechanism. No disagreement with the transfer agent's explicit rulings was found; ‡ marks verdicts inferred where it did not rule, chosen conservatively. Three inline **[⚠]** flags mark internal disagreements (active-vs-passive recovery; Denadai-vs-Eihara; circa-PHV economy-regression grade).

<a id="s11"></a>

## 11. Where first-principles and literature conflict, and the ruling

**Athlete:** HS XC runner ~15y, ~20–30 mpw (~200 h/yr), reactive iliopsoas (pain cap 3/10, insertion at the lesser-trochanter apophysis), already does heavy leg day. Barbell OUT; plyo/strides/hills IN. Every ruling is for THIS athlete.

Epistemic labels: [DEM] demonstrated in a stated population · [MECH] mechanistic inference · [SPEC] speculative. Adjudication principle applied throughout: **trust the evidence when it is right-population and directly measures the outcome; trust the mechanism when the evidence is wrong-population, underpowered, too short, measures a proxy, or is not the rate-limiter.** Several "literature" points here are themselves narrative [MECH] (B&L recovery-type; taper autonomics) — so some collisions are mechanism-vs-mechanism, flagged where it matters. Conflicts are the most valuable output of this investigation and are not papered over.

---

### Lead table

| # | Conflict | Mechanism predicts | Literature shows | Ruling | Conf. |
|---|---|---|---|---|---|
| 1 | Is VO2max the target? | Central: VO2max = Q̇×a-vO2; delivery binds; train PV/cardiac/tHb-mass | Perf. moves without VO2max: taper +2–3% at static VO2max; TT flat across TID (SMD −0.01); CS is the youth-validated anchor | **Fractional utilization / CS is the primary lever, not VO2max.** Trust performance-outcome evidence over VO2max-centric mechanism | HIGH |
| 2 | Volume: diminishing returns? | Steep-curve: at 25 mpw he is on the STEEP part of mito-vol / capillary / CP curves → marginal mile ~2–3× more productive | "Diminishing returns to volume; HIIT is time-efficient; add intensity not miles" (trained adults ≥50–60 mpw) | **INVERTS here.** Literature is a flat-part-of-curve artifact. Volume is the dominant lever; a small fixed intensity dose is still mandatory | HIGH |
| 3 | Do adolescents tolerate/benefit from intensity? | Faster kinetics, fast PCr/lactate clearance, better ROS handling → strong, well-tolerated interval response | Youth HIIT VO2peak g=0.10 (CI hugs 0), no passive controls; gains confounded by growth; apophyseal risk elevated circa-PHV | **Metabolic tolerance ≠ license to load.** Dose intensity for its unique products at a small fixed presence; gate on STRUCTURAL signals | HIGH |
| 4 | Interval recovery: active or passive? | Active jog sustains muscle pump → venous return → EDV/SV → chamber-remodeling + faster VO2 re-attainment | B&L 2013: for short relief (<2–3 min) default PASSIVE — keeps baseline VO2 elevated so next rep re-reaches VO2max faster | **Passive/easy short relief.** SV plateaus by 50–70% VO2max, so the pump premium is self-limited; the proxy that matters favors passive | MOD-HIGH |
| 5 | Is falling race time "earned fitness"? | Adult prior: race-time trend over a block is a valid fitness / clean-training proxy | Youth: maturation ~doubles absolute VO2 11→17, improves economy & race time WITHOUT training | **Never credit race-time trend as earned fitness at this age.** Largely growth; key upward signals to executed training + symptom-clean weeks | HIGH |
| 6 | Does stiffer tendon drive economy? | Plyo → stiffer Achilles → more elastic return → better RE (the popular causal chain) | Ankle stiffness r=0.084 NS vs RE; stiffness–RE is an inverted-U (optimum, not maximum); youth run-drill→RE evidence-free | **Do NOT model tendon stiffness as the lever.** Attribute RE to neuromuscular (RFD, coordination); dose reactive quality as presence, not magnitude | MOD |

---

### Conflict 1 — Is VO2max even the right target?

**Steelman (central / VO2max-centric).** VO2max is the single best-validated correlate of distance performance across a century of exercise physiology. It is a hard ceiling: you cannot race above the O2 flux you can deliver. The trainable levers are real and mechanistically clean — plasma-volume expansion (fast, ~3–6% in 1–2 wk), cardiac eccentric remodeling (raises SV), tHb-mass (slow, iron-gated). 4×4 raises it +7–9% (Helgerud) and the category reliably beats easy-only. If you want a faster runner, raise the engine's displacement.

**Steelman (peripheral / performance).** A HS 5k is raced *above* critical speed; the race is decided by how much of VO2max you can hold, not its height. From `d = v_CP·t + D′`, `dTime/dCP` is ~2–3× `dTime/dVO2max` for this athlete, whose CP/VO2max (~78–84%) sits well below the trained ~88–92% — his largest untapped reserve is peripheral. And the outcome evidence agrees three independent ways: taper raises performance ~2–3% while VO2max is statically unchanged (SMD 0.20 NS); time-trial is flat across intensity distributions (SMD −0.01) while VO2peak differs; CS is the one anchor with youth reliability (CV 2.4–4.3%, ICC 0.92–0.98) and concurrent validity (CS ≈ lactate-min, n=25 youth).

**Diagnosis.** Central is not *wrong* about VO2max physiology; it answers "what raises VO2max," which is **not this athlete's binding performance question**. The evidence is right-population-adjacent and directly measures *performance*, and repeatedly shows performance moving without VO2max — exactly peripheral's prediction. Central's target is a proxy one rung removed from the scoreboard. (P-P2's exact number stays UNTESTED — no brief regresses Δ5k on ΔCP in youth — but the direction is demonstrated three ways.)

**Ruling & principle.** *When a mechanism optimizes a variable and the outcome evidence shows the outcome moving independently of that variable, the mechanism has the wrong target.* Fractional utilization / threshold velocity (CS) is the primary trainable performance lever; VO2max physiology (PV, aerobic base) is the *substrate* that enables threshold work, not the scoreboard.

**Design consequence.** The engine anchors on Critical Speed from races the athlete already runs (1600 + 3200), targets threshold/CP development, and must NOT reward a VO2max or VDOT bump as success — especially since at this age most of that bump is growth (Conflict 5).

### Conflict 2 — "Diminishing returns to volume; add intensity, not miles"

**Steelman (literature).** In trained adults the marginal aerobic mile is genuinely cheap: mitochondrial volume and capillary density are near-ceiling, so adding easy volume yields little while costing time and injury exposure. HIIT delivers equivalent or greater VO2peak in a fraction of the minutes (time-efficiency is real and replicated). The rational move for a plateaued athlete is to raise intensity, not chase mileage.

**Steelman (steep-curve mechanism).** That entire conclusion is drawn from athletes at 50–100+ mpw, on the **flat part** of every peripheral curve. This athlete, at ~4 h/wk, sits on the **steep part**: mito volume ~6% vs a ~12% ceiling (~70–100% headroom), capillarization steep, CP/VO2max ~80% vs ~90%. Two independent first-principles agents converge here. The marginal mile is ~2–3× more productive for him than for the study populations, and the 5k lever (CP) is precisely volume/threshold-built.

**Diagnosis.** Classic **wrong-population + wrong-part-of-curve** transfer. "Diminishing returns to volume" is a true statement about a *different* athlete. The dose-response is training-status-dependent, and the developmental subgroup shows *no* POL/HIIT VO2peak edge (0.46 highly-trained vs NS developmental); Festa's low-volume (~3–4 h/wk) threshold-heavy arm *matched* polarized on every outcome with 17% less time. The time-efficiency framing captures a flat curve, not a law.

**Ruling & principle.** *A dose-response measured on the flat part of a curve does not transfer to an athlete on the steep part; it can invert.* This athlete is **volume-limited** for the dominant levers. What survives from the literature: intensity is still *mandatory* but for its **unique products** (type-IIx recruitment coverage that sub-90-min easy running never delivers, mito quality) — and those **saturate at ~12–16 min/wk: presence, not volume.**

**Design consequence.** Grow easy volume as the primary dial toward ~30–35 mpw; hold hard *running* at a small fixed non-escalating dose (1 session base / 2 in-season), not an escalating one. Do not let the engine "trade miles for intensity" as if on the flat curve.

### Conflict 3 — Adolescents "tolerate/reach intensity well" vs the small, confounded reality

**Steelman (metabolic mechanism).** Youth reach VO2max faster (quicker kinetics — a Buchheit cohort hit >90% VO2max on 90-s reps where adults need ≥2 min), clear lactate and resynthesize PCr faster, and handle oxidative stress better. Their recovery profile resembles a *trained adult*. This predicts they should absorb and benefit from interval work well — arguably better than adults.

**Steelman (youth outcome evidence).** The chronic aerobic payoff is small and fragile: trained-youth HIIT VO2peak is g=0.10 vs control (CI hugging zero), with **no passive controls**, so maturation is unpartitioned. Absolute VO2, economy, and race time improve from growth alone. Glycolytic machinery (PFK/LDH) is immature until late adolescence — the system HIIT most taxes is under-built. And structural/apophyseal risk is *elevated* circa-PHV (15–19y = 42.6% of athletic stress fractures; >30 mpw a named male BSI risk).

**Diagnosis.** A **proxy-vs-outcome + wrong-limiter** split. The mechanism is right about a *proxy* (how fast VO2max is *reached within a session*) but the right-population *outcome* says the chronic payoff is modest — and the readiness signal the mechanism keys on (metabolic recovery) is exactly the one that **over-permits**, because structural recovery lags it (P-P8, CONFIRMED multi-source). "Kids bounce back" is DEMONSTRATED *metabolically* and routinely, dangerously over-generalized to the growth-plate/apophyseal system where it is FALSE.

**Ruling & principle.** *Metabolic tolerance is not license to load; gate on the slowest-recovering tissue, not the fastest signal.* Dose intensity for its unique products (recruitment, economy, race-specific fitness) at a small fixed presence, NOT for a large VO2max premium the youth data does not support — and gate every increment on **mechanical/hip/PHV** signals, never on the metabolic readiness the athlete recovers into first.

**Design consequence.** The permission ladder advances on symptom-clean *structural* signals (hip pain ≤ cap, PHV status), holds the 3/10 cap hard, and biases to under-load circa-PHV. This is the single highest-value engine finding.

### Conflict 4 — Active vs passive recovery in VO2max intervals

**Steelman (mechanism).** An easy jog float sustains the muscle pump → maintains venous return → keeps end-diastolic volume and stroke volume high through the recovery → both delivers more chamber-remodeling stimulus AND speeds VO2 re-attainment on the next rep. Keep moving.

**Steelman (literature, B&L 2013).** For short relief (<2–3 min), default to **passive**: it keeps baseline VO2 *elevated*, so the next work bout re-reaches VO2max faster and accumulates more time at target. Active recovery only earns its keep at relief ≥3–4 min.

**Diagnosis.** **Mechanism-vs-mechanism, not evidence-vs-mechanism** — B&L C7 is itself narrative [MECH] ("effects on T@VO2max are not straightforward"), not a chronic-outcome trial. Central's own C-P4 (SV plateaus by 50–70% VO2max) undercuts the active case: during an easy float SV is already near plateau, so the *marginal* central signal from keeping the pump running is small, while the VO2-baseline argument for the actual target (time-at-VO2max) is direct.

**Ruling & principle.** *When two mechanisms collide, prefer the one whose premise directly serves the binding proxy and whose competitor is self-limited.* Adopt passive/easy short relief. Central's active case only revives at long relief this athlete shouldn't be using anyway.

**Design consequence.** Interval templates prescribe passive or very-easy short recoveries; the engine does not push "keep jogging" between reps of a VO2max session.

### Conflict 5 — Race-time trend as an "earned fitness" signal

**Steelman (adult prior).** In adults, improving race times over a block is a clean, cheap fitness proxy — it integrates everything that matters and needs no lab. An engine that watches race-time trend to decide the athlete has "earned" more load is doing exactly what a good coach does.

**Steelman (youth evidence).** In a 14–16yo, falling race times are **substantially growth**: absolute peak VO2 roughly doubles 11→17 (FFM), economy improves year-on-year in *untrained* children (Sjödin & Svedenhag: O2 cost fell with age in trained AND untrained), and leg length / mass redistribution cut times regardless of program quality. The maturation effect is large and DEMONSTRATED (Armstrong/Barker, 1057 tests longitudinal).

**Diagnosis.** A **confounder the adult literature never had to model.** In adults the growth term is ~zero, so race-time trend ≈ training response. At 15 the growth term dominates, so the same inference reads mostly maturation and *mis-credits the training* — and it over-rewards precisely during the growth spurt, when circa-PHV injury risk peaks. The exact failure mode the youth brief flags as decision-critical.

**Ruling & principle.** *A proxy that is valid only because a confounder is absent becomes invalid the moment the confounder is large.* Never treat race-time improvement as earned fitness / clean-training evidence at this age.

**Design consequence.** The earned-trust / upward signal keys to **executed training + symptom-clean weeks**, not PRs or VDOT/CS trend. (Repair note: with the youth brief now in hand, "performance trend = fitness" is DOES-NOT-TRANSFER, DEMONSTRATED — no longer merely suspected.)

### Conflict 6 — Does stiffer tendon drive running economy?

**Steelman (mechanism).** The SSC returns ~35–50% of stride energy for free; a stiffer Achilles stores and returns more elastic energy and lets fascicles operate quasi-isometrically. Plyometrics demonstrably raise tendon stiffness. Therefore reactive work → stiffer tendon → better economy. The chain is physiologically coherent and each link is individually attested.

**Steelman (evidence).** The *last* link fails in the broader data: ankle (plantarflexor) stiffness does **not** correlate with RE (r=0.084, NS), and in highly-trained runners tendon-stiffness change did not track RE change (Fletcher). Where stiffness *does* relate to RE it is an **inverted-U with an optimum** — too stiff loses elastic buffering and forces the fascicle onto an unfavorable force-length region, worsening economy. Youth running-*drill*→RE benefit is essentially evidence-free.

**Diagnosis.** A coherent multi-link mechanism whose **terminal causal link is unsupported** — a chain (plyo→stiffness→economy) whose middle is real but whose last step is [SPEC]. RE gains from reactive work are DEMONSTRATED (~2–7% in isolation); the *attribution to tendon stiffness* is not.

**Ruling & principle.** *Do not model a lever whose causal terminal link the outcome data contradicts; attribute the effect to the mechanism the data supports.* Attribute RE gains to **neuromuscular** factors (RFD, coordination, co-activation timing, GCT). Reactive quality is dosed as **presence** (a handful of near-max strides + light plyo 2×/wk, saturating ~60–100 contacts), not escalated toward maximal stiffness.

**Design consequence.** Economy work is a small fixed neuromuscular touch, ordered **flat-before-hills** to match the ladder and the code: tier-3 flat strides are prescribed relaxed/submaximal (low eccentric strain-rate), so they precede the tier-4 near-maximal *concentric* hill sprints, which carry the highest iliopsoas/apophyseal load in the neuromuscular block and are gated higher (hip-safe + PT). See §4. The engine must not treat "more plyo / stiffer tendon" as a monotone economy dial, and — since the athlete already does heavy leg day covering the max-force arm — the marginal running-economy return is small (~1–3%), most of it capturable by strides alone.

---

### Consensus by repetition (everyone cites it; primary data weak or absent)

- **"80/20 / polarized — elites do it, so you should."** The biggest one. Favorable "polarized" descriptions are largely a **denominator artifact**: session-goal counting moves the Z3 fraction from ~9% (time-in-zone) to ~23% on identical training; zone-boundary choice reclassifies the *same* sessions POL↔PYR. Descriptively elites are mostly **PYRAMIDAL**, and polarization only *appears* above ~750 h/yr — this athlete is at ~200 h/yr, below where the phenomenon even exists. Prospective POL-vs-PYR is a wash in adults (TT SMD −0.01); the VO2peak edge is short-trial-only and highly-trained-only; at low volume it is contested (Muñoz pro-POL vs **Festa null**). **Zero adolescent TID intervention trial exists.** A descriptive-to-prescriptive fallacy compounded by a denominator trick, least applicable exactly at this athlete's age and volume. Defensible target: pyramidal-leaning ~80/13/7 by minutes-in-zone, chosen for the iliopsoas cap.
- **T@VO2max maximization as the interval goal.** B&L flag it as *belief*; Midgley: no controlled trial shows a higher-T@VO2max protocol yields greater VO2max gain. Worse, Rønnestad shows pushing %vVO2max *up* (30/30 @100%) *reduces* T@VO2max vs 4×3 @95% (201 s vs 328 s >90% VO2max) — the field's own axis moves the proxy the wrong way, while HR and RPE both point opposite to the actual VO2 stimulus.
- **"Youth recover faster."** DEMONSTRATED *metabolically* (faster PCr/lactate/vagal), then over-generalized to the musculoskeletal/growth-plate system where it is FALSE (apophyseal cluster circa-PHV; 15–19y = 42.6% of stress fractures). This over-generalization *is* the engine failure mode Conflict 3 exists to prevent.
- **"Ideal peak mpw."** Zero controlled dose-response; all observational and confounded (including the HS-mileage-correlates-with-performance data). Mileage is an injury dial, not a performance target.
- **"Peak volume precedes peak intensity" / block periodization.** Coaching convention [SPEC]; block-vs-traditional is an RCT near-null even in adults. Over-engineering at 25 mpw.

### Where the literature is simply silent (mechanism is all we have)

Several items previously stranded as UNTESTED are now **partly resolved** against the regenerated youth/anchoring briefs; the genuinely silent ones are flagged as such.

- **Iliopsoas-specific adolescent running-injury data: effectively ABSENT** (no RCTs; PHV injury data is soccer-heavy). *Resolution:* the *class* is DEMONSTRATED (apophyseal/BSI epidemiology, ev-youth C8/C10), so hold hip rules as precautionary-mechanistic and the 3/10 cap hard, bias to under-load circa-PHV. The site-specific number stays SPEC.
- **HR / HRmax anchoring in youth — now RESOLVED, not silent.** With the anchoring brief in hand: 220-age overestimates youth HRmax by ~6–12 bpm and formally fails to predict in under-18s (Verschuren) — enough error to misplace an entire zone. **CONFIRMED unusable.** The app must never build zones on estimated HRmax (and logs no HR anyway).
- **Youth threshold anchor — now RESOLVED.** Critical Speed is the *only* model with youth reliability (CV 2.4–4.3%, ICC 0.92–0.98) AND concurrent validity (CS ≈ lactate-min, n=25 youth). **CONFIRMED as the anchor**, using races already run. VDOT's fixed-economy constant is exactly what a maturing adolescent violates — **DOES-NOT-TRANSFER cleanly.**
- **Chronic sprint/speed benefit in youth distance runners.** No chronic trial; ev-youth confirms only a small aerobic payoff and immature glycolysis. Stays UNTESTED for chronic speed; mechanism (recruitment necessity, freshness-gated, economy-mediated transfer) governs.
- **Genuinely silent (mechanism only):** mito CONTENT vs FUNCTION dissociation by intensity (no biopsy data); capillarization vs mito-enzyme time-constants; early VO2max-gain time-course (PV vs tHb-mass); double-threshold pulse-saturation at low volume; T@VO2max→VO2max-gain causal link. For all of these the engine carries LOW-confidence, mechanism-only priors and encodes no confident dose-response.

<a id="s12"></a>

## 12. Open questions and conservative fallbacks

This section is the report's honesty instrument. Sections 2–9 commit to confident
defaults; this section catalogues every place those defaults rest on something less than
direct evidence in the design target, so a reader can see exactly how much of the plan is
demonstrated and how much is a well-reasoned prior. The organizing fact, from the evidence
table (§10) and the convergence tally (`converge.md` §1), is stark: of the ~77
load-bearing claims, **~27% now carry direct adolescent data, ~50% rest on adult/elite
extrapolation, ~23% on pure mechanism, and there is still zero adolescent RCT on the four
levers that most shape the prescription — intensity distribution, peak volume, taper, and
T@VO2max.** The decisive asymmetry (§10): **adolescent data tells us what to fear and cap
(the maturation confound, apophyseal/BSI epidemiology, youth HRmax-formula failure, the
small g≈0.10 HIIT effect, Critical-Speed youth reliability); adult data tells us what to
prescribe (every taper parameter, the interval structure, the plyo RE trials); mechanism
fills the gaps.**

**Correction carried in from the repair pass.** An earlier run of this investigation lost
the youth and anchoring briefs to server errors and several downstream adjudications were
stranded as "UNTESTED because the brief is missing." Both briefs now exist. The three items
that were stranded on them are **resolved below and their gradings corrected**: the
metabolic/structural recovery asymmetry (Q3) is no longer mechanism-only — it is
right-population DEMONSTRATED (`converge.md` P-P8 CONFIRMED); adolescent VO2max trainability
(Q6) now has the on-target Engel g≈0.10 meta in hand; and intensity anchoring (Q11) is
resolved at the model level — Critical Speed is the one youth-validated anchor
(`ev-anchoring` C6/C7), leaving only a narrower residual. Where a prior conclusion was
reached without these briefs, it is revisited here with the brief in hand.

**The discipline applied to every fallback is one-directional: when uncertain, the engine
prescribes LESS and defers to the existing runtime safety layer (the 3/10 pain cap, flare
detection, morning-pain blockers, the downward-only speed guard). "Conservative" never
means "add more to be safe" — it means withhold intensity, hold volume, and let the safety
layer decide what is delivered today.** Every fallback is checked against this rule.

Questions are ranked by **impact** — how much the athlete's actual weekly training changes
between the optimistic and pessimistic answer.

---

### Q1 (HIGHEST IMPACT) — Is this athlete volume-limited or intensity-limited?

**The question.** At 25 mpw, is the highest-marginal-value next unit of training an extra
easy mile (volume-limited) or an extra hard minute (intensity-limited), once a small fixed
quality floor is met?

**Why unresolved.** The textbook "evidence in the wrong population" case (`converge.md`
Conflict A). The HIIT-efficiency literature (Helgerud +7–9%, Bacon, Wen) is real and
[DEMONSTRATED] — but entirely in trained adults on the *flat* part of the peripheral
dose-response curve, whose remaining headroom genuinely is central/neuromuscular. The
volume-limited ruling (transfer §4, HIGH ~80%) derives from the CP model + the claim that a
25-mpw adolescent sits on the *steep* part of every peripheral curve (mito density ~6% vs
~11–12% ceiling; CP/VO2max ~80% vs ~90%). That derivation is multiply-supported (mito
ceiling + capillary ceiling + CP algebra + Festa null + injury economics + now the youth
brief: HIIT's aerobic payoff is small, g≈0.10, and its target glycolytic system is immature
— ev-youth C2/C6) but remains **UNTESTED in-population**: no RCT compares +volume vs
+hard-session at fixed mileage in a low-volume adolescent, and the "2–3× mito signal per
mile" figure is an explicit guess [MECHANISTIC INFERENCE].

**Conservative fallback.** Ship the volume-limited default: fill one quality floor (~1
threshold session + strides), then spend all remaining psoas-gated capacity on easy volume.
Conservative *because it is also the low-injury choice* — easy miles load the reactive
iliopsoas far less per mile than intervals, so a partly-wrong ruling still errs toward the
modality that spares the binding constraint. Withholding a second hard session cannot injure
the apophysis; adding one can.

**What would resolve it.** A right-population RCT (+volume vs +2nd-hard-session at matched
mileage on ΔCP and Δ5k). Absent that: **`durationMin` + race results** would let the engine
detect a per-athlete plateau — if CP/pace stalls across a block of clean volume growth, the
volume-emphasis is revisited for *this* athlete ("revisit if the athlete stalls").

**Impact if wrong.** Maximal — the single decision that shapes the entire weekly structure
(+easy miles vs +hard session; nearly every day differs). Ranks #1 not because confidence is
low (~80%) but because the consequence of the residual 20% is the largest on the board.

*Sub-question folded in — does the athlete currently MEET the quality floor?* If he does
zero quality, the first hard session outranks the next easy mile until the floor is filled.
Unresolved because the app cannot see pre-existing training. Fallback: the tier ladder fills
the floor first by construction, so the engine self-corrects without needing the answer.

---

### Q2 — What is the ideal peak MPW?

**The question.** What weekly mileage should this athlete build toward as his volume peak?

**Why unresolved.** **No controlled dose-response for "ideal peak mpw" exists at any age**
(`ev-taper` claim 19 [SPECULATION]; §10 row E: "no source exists"). What exists is (a)
confounded observational HS data (faster runners train more *and* are more durable/talented)
and (b) one robust on-population finding now firmly in hand — **injury incidence rises with
weekly mileage in HS runners (28–38% seasonal, dose-related), >30 mi/wk is a named male BSI
risk factor, and 15–19y-olds are 42.6% of athletic stress fractures** (ev-youth C10)
[DEMONSTRATED]. The mechanism underdetermines the number: the CP model says miles 26–30 sit
on the *steep* segment (real positive marginal fitness value, unlike an adult), while the
same miles raise apophyseal hazard during PHV. Performance says take them; safety says take
them slowly.

**Conservative fallback.** `peakMpw = 30–32` default, do not exceed ~35, grown ≤~10%/wk,
psoas-gated, held or regressed on any hip signal. Conservative because the number is anchored
to the *injury* finding (the only [DEMONSTRATED] fact available), not the performance
speculation, and because the growth *rate* — not the target — is the real injury dial. The
peak-seeking `stepWeek` already implements this shape (`gapSeek` hard-clamped by the +10%/wk
`cap`).

**What would resolve it.** An on-population volume–injury–performance study. Absent that:
**logged mileage + painDuring/painNextAM trends** already tell the engine, per-athlete, where
*this* runner's hip stops tolerating volume — more useful than any population number.

**Impact if wrong.** High. Volume is the primary lever, so the ceiling caps how much of the
dominant adaptation accrues. But the asymmetry is stark: overshooting risks a months-long
apophyseal injury that erases everything; undershooting costs bounded fitness. The fallback
deliberately accepts the bounded cost.

---

### Q3 — Gate intensity on MECHANICAL/hip signals or on metabolic-readiness signals?

**The question.** When deciding whether to permit a hard session, should the engine read
tissue/hip signals (pain, morning stiffness) or metabolic-recovery proxies (HRV, sleep, RPE
trend)?

**Why unresolved — and how the repair pass changed its grade.** The earlier draft filed this
as [MECHANISTIC INFERENCE], "UNTESTED because ev-youth/ev-anchoring were never written."
**That grade is now corrected.** With the youth and anchoring briefs recovered, the core
claim — *adolescent metabolic recovery outpaces connective-tissue/apophyseal recovery, so
metabolic-readiness signals systematically OVER-permit intensity* — is **right-population
DEMONSTRATED, assembled from multiple direct sources**: youth recover metabolically faster
(PCr/lactate/HR, ev-youth C7); glycolytic capacity is immature (C6); apophyseal/BSI risk is
*elevated* circa-PHV (C8/C10); and age-formula HRmax fails outright in under-18s (ev-anchoring
C9/C10), so the metabolic proxy an HRV/HR-gated ladder would use is *itself* unusable in this
population. `converge.md` grades the composite **P-P8 CONFIRMED — "the highest-value engine
finding."** What remains genuinely inference is only the *iliopsoas-specific* over-permitting
magnitude (site-specific adolescent running data is absent — Q9), not the recovery asymmetry
itself.

**Conservative fallback.** Gate quality on pain/hip signals, **not** on HRV/metabolic proxies;
when ambiguous, withhold intensity and keep volume — exactly how the existing guard works.
Conservative because the failure mode is asymmetric and catastrophic: a metabolic gate would
green-light hard work precisely when the metabolically-recovered-but-tissue-unrecovered
athlete is most vulnerable, driving an apophyseal injury that (per §2's arbitration) reverses
all three performance outcomes at once. Gating on the hip can only ever withhold, never
over-permit.

**What would resolve it.** A study pairing metabolic-readiness markers (HRV, RPE) with
tissue-tolerance outcomes in training adolescents; a maturity-offset (years-from-PHV) field.
Absent that: **logging painDuring/painNextAM against subsequent tolerance** confirms
per-athlete that hip signals lead metabolic ones.

**Impact if wrong.** High and safety-critical — this is the single most load-bearing safety
decision in the design. The difference is not in *what* session is offered but in *when it is
withheld*; getting the withholding wrong is how the injury happens. The evidence upgrade
raises confidence but does *not* relax the fallback: the asymmetry still commands the
conservative gate.

---

### Q4 — Is tier-8 (true VO2max) work worth doing at all, and what is the minimum rep length?

**The question.** Should the engine ever prescribe true VO2max intervals, and if so, is the
adult ≥2-min rep floor correct or can youth kinetics justify ~90 s?

**Why unresolved.** Two compounding uncertainties. (a) *Whether tier 8 is worth it:* VO2max
is not the binding 5k constraint (CP is — dTime/dCP ≫), youth VO2max trainability is small and
maturation-confounded (Engel g≈0.10, no passive controls — ev-youth C2/C4, now in hand), and
the 3-min rep is the single highest sustained hip-flexion load in the ladder, landing on the
lesser-trochanter apophysis during PHV. (b) *The rep floor:* τ (VO2 on-kinetics) is unmeasured
in a low-volume 15-yo; adults need ≥2 min (1-min→82% VO2peak, 2-min→92%, [DEMONSTRATED]) but
one youth cohort hit 43% of session >90% VO2max on 90-s reps (ev-youth/Buchheit, [MECHANISTIC
INFERENCE], direction only). And T@VO2max is itself an unvalidated surrogate (Q10), so the
stakes of optimizing rep length are smaller than they appear.

**Conservative fallback.** Keep the current posture: **auto-suppress tier 8 out of season**;
expose it only as a coach-confirmed manual session near-season; when finally prescribed, hand
over a concrete `120s→180s`, `3×3→6×3` ladder, not a static string. Keep `VO2_REP_MIN_S = 120`
(the adult floor) even though 90 s is defensible in youth — a too-short rep pays the full
metabolic *and* hip cost for near-zero time-at-VO2max, failing the tier's own target; the
conservative error is the longer, better-yielding rep. This prescribes *less* VO2max work and
defers the highest-risk session to coach + season gating.

**What would resolve it.** A youth interval trial partitioning ΔVO2max by rep length; a
right-population Δ5k partition (ΔCP vs ΔVO2max) to settle whether tier 8 is worth the hip risk
at all; per-athlete, `durationMin` + HR to estimate his on-kinetics.

**Impact if wrong.** Moderate-high, concentrated on the most dangerous session. Optimistic
(tier 8 valuable, 90-s reps fine) auto-schedules VO2max work and shortens reps; the
conservative answer suppresses it and keeps reps long. The *safety* consequence of the
optimistic error is large even though the *fitness* stakes are small (VO2max is not the
binding lever).

---

### Q5 — Does standalone plyometrics add anything on top of heavy leg day + strides?

**The question.** Given the athlete already does heavy leg day and the app prescribes
strides/hill-strides (tiers 1–4), does a *dedicated* plyo program add meaningful economy?

**Why unresolved.** The one study testing the actual additive question in the right population
(Yu 2025, complex vs heavy-alone, adolescent runners, RE +8.5–15.5%) is **single,
uncontrolled, at ~2× this athlete's volume, and likely inflated** [DEMONSTRATED,
low-confidence]. Head-to-head, heavy strength *beats* plyo (Eihara SMD −0.32 vs −0.17 ns) —
and heavy is the modality he already trains. First-principles put the marginal add at ~1–3%
over 8–12 wk, most of it already delivered by strides. The mechanism the benefit is *supposed*
to run through (tendon stiffness → RE) is refuted at its load-bearing link: ankle stiffness ↔
RE is null (r≈0.08 — ev-economy C13/C15), so the engine must not model tendon stiffness as the
lever.

**Conservative fallback.** Strides-first (running-specific, low-risk); ≤1 dedicated plyo
session/wk charged **0.5 to a *tissue* budget, not the metabolic hard budget**; low-amplitude
ankle/pogo work before any hip-dominant reactive drill; gate everything behind the 3/10 cap;
regress instantly on flare. Prescribes *less* plyo than the isolation literature implies and
routes the small residual through the lowest-hip-risk modalities — the marginal benefit is
small and speed-specific while hip-dominant bounding is the classic iliopsoas-strain mechanism.

**What would resolve it.** A controlled additive youth-runner RE trial (plyo-on-top-of-strength
vs strength-alone, matched volume). RE is not measurable in-app, so this stays a population
question.

**Impact if wrong.** Low-moderate. Even the optimistic answer changes only a small,
speed-specific 1–3% RE lever at ≤1 session/wk — it does not restructure the week.

---

### Q6 — How large is adolescent VO2max/HIIT trainability, and is HIIT worth its cost at 15?

**The question.** Does high-intensity work produce a VO2max gain large enough to justify its
hip-strain cost in a 15-yo, or does maturation deliver most of it for free?

**Why unresolved — now largely resolved with the youth brief in hand.** The on-target meta
(Engel 2018, 24 trials, N=577, mean 15.5y) gives **Hedges g ≈ 0.10 ± 0.28 vs control — small,
heterogeneous, no passive controls**, so it cannot separate training from maturation
[DEMONSTRATED as a gap]. Maturation *alone* roughly doubles absolute peak VO2 from 11→17y
(Armstrong & Barker) [DEMONSTRATED], so a within-athlete "VO2max rose after the hard block" is
maturation-confounded and cannot be credited to intensity. This item is no longer open at the
*direction* level — the youth brief confirms the payoff is small and largely free; what remains
open is only the exact magnitude of the trainable increment, which no maturation-controlled
trial isolates.

**Conservative fallback.** Do not chase VO2max with intensity; treat the largest VO2max lever
at 25 mpw as easy volume (plasma volume, capillarity, tHb-mass) and let maturation deliver the
rest. Spending scarce psoas-limited budget to chase a g≈0.10 effect puberty partly hands over
free is, per transfer §5, "the worst trade on the board." Conservative because it declines to
mortgage the apophysis for a small, partly-free gain.

**What would resolve it.** A maturation-controlled (passive-control or twin/sibling) youth HIIT
trial. Per-athlete, a height-velocity marker would let the engine *flag* a growth epoch and
discount race-based fitness inferences during it.

**Impact if wrong.** Moderate. Optimistic (large trainability) would justify more in-season
VO2max work; the conservative answer defers it to coach + season. Overlaps Q4; underwrites the
Z3 distribution ceiling (kept minimal).

---

### Q7 — Are the within-tier progression step sizes right? (Almost certainly unevidenced.)

**The question.** Are the specific week-by-week rungs (e.g. tier 3: 6×20 → 7×20 → 8×20 → 8×25 s)
the correct increments?

**Why unresolved.** **Almost certainly not evidenced — and this must be said plainly.** No
trial dose-responds stride/interval progression increments at any age, let alone in a 25-mpw
adolescent; the recovered youth brief does not touch it either. The ladders in §4 are built
from the progression *principle* (advance the safe axis — reps, then duration; pin the
dangerous axis — velocity/pace), which is [MECHANISTIC INFERENCE] from fatigue physiology, not
a demonstrated optimal step size. The specific numbers are reasoned defaults, not measured.

**Conservative fallback.** Advance `weeksInTier` **only on a clean qualifying completed week**
(painDuring≤1, painNextAM≤1, no blocker) — derived from logs, never stored — so a relock or
breach resets progression to the tier's first rung automatically (`TIER_PROGRESS_MIN_CLEAN_WEEKS
= 1`, `NEURO_REP_FLOOR = 4`). This makes the *rate* of progression self-limiting on tolerance
regardless of whether the step *sizes* are optimal: a too-big step is caught by the pain signal
within a week. Conservative because the increment is gated by the athlete's own clean-week
evidence, not the calendar.

**What would resolve it.** `sessionOutcome` + `repsSlowed` logging (the design spec Part 5 item 2) would give a
real advance/hold/regress loop; over many athletes this reveals which step sizes are tolerated.
For one athlete, the clean-week gate is already the resolution.

**Impact if wrong.** Low-moderate, self-correcting. A too-aggressive step is caught by the pain
cap within a week; a too-timid step only slows advancement. The safety layer absorbs the error,
so *safety* is insensitive to the exact numbers even though *efficiency* is not.

---

### Q8 — Is the 1-hard-unit base budget right, and does 80/20 transfer to 25 mpw?

**The question.** Should the base-phase weekly hard budget be 1 unit, is the resulting ~92/8/0
(Z1/Z2/Z3 by minutes) distribution correct given the stated pyramidal target ~80/13/7, and does
"80/20" transfer to this athlete?

**Why unresolved.** No adolescent TID intervention trial exists (§10 §C/§G; youngest MA cohorts
~17±3, embedded in adult pools). The **80/20-transfer sub-question is largely resolved to No**:
polarized's premise (high *absolute* easy volume already saturates the aerobic stimulus) fails
at ~3.2 h/wk easy; the one clean low-volume RCT (Festa 2020) is a null (threshold-heavy matched
polarized with 17% less time); elites are descriptively pyramidal; and "80/20" is largely a
session-goal-denominator artifact [DEMONSTRATED + descriptive]. So the pyramidal *direction*
converges across four independent lines. What stays open is the *specific numbers* [MECHANISTIC
INFERENCE], plus a disclosed internal tension (critique §Contradictions #4): the headline
80/13/7 is ~2.5× the moderate-hard work a 1-unit budget funds, so the engine's *real* target
is ~92/8/0 and 80/13/7 is aspirational/unfundable at this budget.

**Conservative fallback.** Keep `HARD_BUDGET_BASE = 1` and let the existing caps
(`THRESHOLD_MAX_WEEK_PCT = 0.10`, season-gated tier 8) *be* the distribution mechanism — they
already produce ~92/8/0, erring *more* conservative than the target on both intensity zones,
enforced downward-only (cap/remove the numerator, never add to a floor). Right conservative
choice because for a volume-limited, injury-gated adolescent, under-shooting the moderate/hard
fraction costs bounded fitness while over-shooting spends the psoas budget.

**What would resolve it.** An adolescent TID RCT. Per-athlete, `durationMin` converts the
miles-proxy fast-fraction to true zone-minutes (removing the ~1.3× / ~2–3 pp overstatement,
which currently errs safe anyway).

**Impact if wrong.** Moderate. The gap between real (~92/8/0) and target (80/13/7) is one
threshold session's worth of Z2/wk — bounded, disclosed, one-directional, and the engine
already sits on the safe side.

---

### Q9 — Is the flat-before-hills ordering (flat tier 3 → hills tier 4) right for an iliopsoas case?

**The question.** Should flat strides be earned before hill strides, or the reverse, for an
athlete whose reactive tissue is specifically the iliopsoas?

**Why unresolved.** **No hills-vs-flat iliopsoas trial exists anywhere in the corpus**
(`converge.md` N-P4, UNTESTED; iliopsoas-specific adolescent running data is essentially absent
— ev-youth GAPS). The mechanism is coherent — max-velocity *flat* sprinting is the high-velocity
eccentric psoas-strain event, but the app prescribes tier-3 flat strides *relaxed/submaximal*
(never triggering that event), while tier-4 hill *sprints* deliver near-maximal *concentric*
psoas drive at the apophysis from rep one. On the app's real specs the ordering is monotone in
provocation (relaxed flat < near-max concentric hill), so flat-first is correct — but the
*magnitude* of the concentric-vs-eccentric difference is an estimate, untested.

**Conservative fallback.** Keep the ordering: flat strides (tier 3) at controllable velocity
first, hill strides (tier 4) gated behind demonstrated tolerance, with any anterior-hip pain
instantly relocking hills to tier 3. Conservative because the alternative's failure mode
(high concentric hip-flexor drive before the tissue proves itself at controllable velocity) is
exactly the injury the ladder prevents, and the relock is aggressive and automatic. Keep tier-3
copy genuinely *relaxed* — the safety rationale collapses if the athlete runs them flat-out.

**What would resolve it.** A hills-vs-flat iliopsoas-loading (EMG/strain) study. Per-athlete,
hip-specific `painDuring` after each modality already validates the ordering via the relock.

**Impact if wrong.** Low-moderate but safety-relevant. A reversed-and-wrong ordering meets high
concentric psoas load earlier; the relock limits the blast radius to one flare.

---

### Q10 — Is T@VO2max a valid surrogate for VO2max GAIN?

**The question.** Does maximizing time ≥90% VO2max actually maximize the VO2max *gain* — the
assumption the entire interval-programming field optimizes?

**Why unresolved.** **It is assumed, not validated** (`converge.md` §4, the "most significant"
consensus-by-repetition). Buchheit & Laursen flag it as belief; Midgley states no controlled
trial has taken two protocols differing in T@VO2max and shown the higher one produced greater
VO2max gain; the single supporting study (Odden 2024) is correlational and adult. Worse, the
surrogate cannot be reliably *measured* in the field — HR and RPE point the *wrong way* in short
intervals (Rønnestad: 30/30 produced more time >90% HRmax but *less* true T@VO2max).

**Conservative fallback.** Do **not** treat T@VO2max as a proven objective; do **not** score
sessions by HR-in-zone (which would systematically reward the wrong sessions); judge quality by
pace-holdability (RPE) and pain. Prescribe interval *structure* (long reps) for its
[DEMONSTRATED] acute T@VO2max, but claim no chronic causal dose. Conservative because it declines
to build the engine on an unvalidated, unmeasurable surrogate.

**What would resolve it.** A head-to-head chronic trial varying T@VO2max. Until then the app must
not optimize it.

**Impact if wrong.** Low *for this athlete*, precisely because tier 8 is suppressed and VO2max is
not the binding lever — the surrogate governs a session the engine rarely prescribes. The main
design consequence is the negative one already taken: never ship an HR-in-zone success metric.

---

### Q11 — Can intensity be anchored without duration data, given the maturation confound?

**The question.** With no logged pace/duration and race times that improve with *growth* as well
as training, how should the engine anchor intensity?

**Why unresolved — now resolved at the model level with the anchoring brief in hand.** The
earlier draft filed this as "mechanism-only, ev-anchoring never written." **Corrected:** the
anchoring brief resolves the *model choice*. **Critical Speed** from two races the athlete
already runs (1600 m + 3200 m) is the one anchor with adolescent-specific reliability (CV
2.4–4.3%, ICC 0.92–0.98) *and* youth concurrent validity (CS ≈ lactate-minimum velocity, n=25
youth) [DEMONSTRATED, ev-anchoring C6/C7]. VDOT is rejected (its fixed-economy constant is
exactly what a maturing adolescent violates, conflating fitness with growth — C2/C3); HR
anchoring is rejected with numbers (220-age over-predicts HRmax by 6–12 bpm in under-18s, and
the app logs no HR anyway — C9/C10). So "how to anchor" is *answered*: CS pace-target where a
fresh race pair exists, RPE-plus-behavioural cold-start otherwise. The **residual** open
question is narrower: CS reliability is youth-demonstrated, but its stability as a *prescription*
anchor while leg length and economy change mid-season is untested (the maturation confound
persists in the *pace number*, ev-anchoring C3).

**Conservative fallback.** Make the **RPE-plus-behavioural-descriptor anchor the primary** for
every tier ("a pace holdable ~50–60 min fresh; one sentence not a paragraph; could've held
15+ min longer at the rep's end") — it self-calibrates across age and needs no meter. CS attaches
a **display-only pace hint and nothing else**: it may never unlock a tier, move a cap, change the
budget/mileage, or override a gate (enforced structurally — the anchor has no write path to
`speedState`/`settings`/readiness). Stale races (>120 d) or unpaired races fall back to
cold-start; races are never blended across a growth spurt (`CS_MAX_PAIR_SPREAD_DAYS`).
Conservative because the maturation-confound harm channel is *severed by construction* — the
worst case is a slightly-too-fast cosmetic annotation while the RPE anchor still governs effort.

**What would resolve it.** `durationMin` logging (the design spec Part 5 item 1) — a self-generated pace from the
athlete's own easy runs is *not* a race result: it sidesteps the maturation confound, the
display-only tangle, and the staleness window at once, and enables an RPE×pace consistency check;
plus serial in-season CS + a maturity-offset marker for the residual.

**Impact if wrong.** Low by construction. Because the anchor drives no cap and no unlock, a
maturation-inflated race cannot escalate load — the harm is bounded to a cosmetic hint. The
deliberate smallest-consequence question in the report.

---

### Impact ranking (summary)

| Rank | Question | What changes between optimistic and pessimistic answer | Post-repair status |
|---|---|---|---|
| 1 | Q1 Volume- vs intensity-limited | Entire weekly structure — +easy miles vs +hard session | Still UNTESTED in-population; youth brief strengthens the prior |
| 2 | Q2 Ideal peak MPW | Primary lever's ceiling (30–35 vs 40+) and injury exposure | No dose-response at any age; injury epi now firm |
| 3 | Q3 Gate mechanical vs metabolic | *When* intensity is withheld — the injury-prevention call | **Upgraded to right-population DEMONSTRATED (P-P8 CONFIRMED)** |
| 4 | Q4 Tier 8 worth it / rep floor | Whether the highest-strain session is prescribed at all | Youth kinetics + g≈0.10 now grounded; posture unchanged |
| 5 | Q5 Marginal plyo value | Whether to add a ≤1×/wk supplement (1–3% RE, speed-specific) | Yu/Eihara/ankle-stiffness-null in hand |
| 6 | Q6 Youth VO2max trainability | In-season VO2max emphasis + Z3 ceiling | **Resolved in direction (Engel g≈0.10 + maturation confound)** |
| 7 | Q7 Within-tier step sizes | Rate of advancement (self-correcting via clean-week gate) | Confirmed unevidenced — stated plainly |
| 8 | Q8 1-unit budget / 80/20 transfer | ~one threshold session of Z2 (disclosed, bounded, errs safe) | 80/20-transfer sub-question resolved to No |
| 9 | Q9 Flat-before-hills ordering (tier 3→4) | Which modality is met first (relock contains the error) | Still UNTESTED (N-P4); mechanism coherent |
| 10 | Q10 T@VO2max surrogate | A session the engine rarely prescribes; forbids HR-in-zone metric | Unchanged — assumed, unvalidated |
| 11 | Q11 Anchor without duration | A cosmetic pace hint only (harm severed by construction) | **Model resolved (CS youth-validated); residual = pace stability** |

The shape is reassuring: the questions whose wrong answer would most change what the athlete does
(Q1–Q3) all have fallbacks that **prescribe less and defer to the safety layer**, and the
thinnest-evidence questions (Q7 step sizes, Q9 hills order, Q10 T@VO2max, Q11 anchoring) are
precisely the ones whose error the architecture contains — self-correcting via the clean-week gate
and pain cap, or severed by construction (display-only, no write path). The plan is most confident
exactly where being wrong matters most, and most exposed exactly where the runtime layer absorbs
the exposure. The repair pass moved Q3 from mechanism-only to demonstrated and closed Q6 and Q11 at
the model level *without* loosening any fallback — the conservative posture was already correct;
the recovered briefs simply raised confidence in it.

---

### What we would need to log to answer these

The telemetry/data-model roadmap implied above, cross-referenced to **the design spec Part 5 (required data-model
additions), part 5**. Every field is additive + optional; absent = current behaviour; missing =
UNKNOWN (defaulted to the safe floor). Ordered by how many open questions it unblocks.

| Field (the design spec Part 5 rank) | Lives on | Open questions it resolves | Why |
|---|---|---|---|
| **`durationMin`** (rank 1) | `RunEntry` | Q1, Q4, Q8, Q11 | The single highest-value field. Unblocks a per-athlete **plateau signal** to test the volume-limited ruling (Q1); **on-kinetics estimation** for the VO2max rep floor (Q4, with HR); **true zone-minute distribution** removing the ~1.3× miles-proxy bias (Q8); and a **within-athlete pace signal that sidesteps the race/maturation confound entirely** (Q11). One field, four questions. Lowest logging friction — a number the watch already shows. |
| **`speedKind` + `sessionOutcome`/`repsSlowed`** (rank 2) | `RunEntry` (logged, not planned) | Q3, Q7 | The **progression feedback loop**: `completed`/`partial`/`aborted` disambiguates advance/hold/regress, so step-size errors surface as repeated holds (Q7). `repsSlowed` captures **rep-velocity decay** — the most informative speed/VO2max overreach signal neither pain nor session-RPE can see, a *mechanical*-tolerance readout that operationalises gating on tissue rather than metabolic signals (Q3). |
| **height / growth-velocity marker** (candidate, not yet in the design spec Part 5) | `GlobalState` | Q3, Q6, Q11 | A **growth-epoch flag** (years-from-PHV) would let the engine discount race-based fitness inferences during PHV (Q6, Q11) and expect non-monotonic hip tolerance (Q3) — the maturity-offset field Q3/the design spec Part 8 explicitly call for. Coarse self-report (a periodic height entry) suffices; precision is not needed for a flag. **Flagged as a recommended addition** the youth rulings would most benefit from. |
| **`IntervalSpec` + `interval?`** (rank ~3) | new type; `ProposedDay` | Q4, Q8 | Not telemetry but a prerequisite for *prescribing* what these questions concern: tiers 6–8 (minute-scale reps) have no data structure today, so the concrete `120s→180s`, `3×3→6×3` ladders Q4/Q8 argue over cannot be emitted — only a prose string. |
| **`goalRace` marker + hip-tissue-cost axis / hill `grade`** | `RaceResult`/`StrideSpec` | Q5, Q9 (+ periodization) | A **tissue budget parallel to the metabolic `HARD_BUDGET`** would make visible that tier-4 hills and standalone plyo load the reactive apophysis at 0 metabolic units — a flagged limitation of the frozen budget (critique §Contradictions #5): the frozen `HARD_BUDGET` is metabolic (tissue load ≠ metabolic budget), so hills cost 0 units yet load the hip more than the 0.5-unit fartlek, and reactive touches are gated by the tissue gate (pain cap, streak, long-run spacing), not the metabolic budget — supporting the plyo (Q5) and hills-ordering (Q9) rulings. `goalRace` enables the selective taper/countdown (the design spec Part 4). |

**The minimum viable set is two fields — `durationMin` and `sessionOutcome`/`repsSlowed` — which
between them touch Q1, Q3, Q4, Q7, Q8, and Q11.** Everything else is refinement or
prescription-enablement. Critically, **none of these fields is required for safety**: every open
question's conservative fallback already ships and errs toward less intensity without any new
logging. The telemetry roadmap is what would let the engine *stop being conservative where it is
currently conservative by necessity* — converting population-level unknowns into per-athlete
answers — but the plan is safe to run the day it ships, blind.
