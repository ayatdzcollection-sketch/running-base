# Speed Engine Design Spec: A Frozen-Core Intensity-Prescription Engine

**What this is.** The buildable engine design that operationalizes the physiology of the
companion research report, **[SPEED_ENGINE_RESEARCH.md](SPEED_ENGINE_RESEARCH.md)** (this is that
report's Section 9). It is expressed as **type shapes, decision tables, proposed tunables, and
machine-checkable invariant proofs only — design, not code, and no algorithms.** Every
prescriptive number and ruling here is justified in the research report; this document does not
re-argue the physiology, it encodes it.

**The frozen core.** The governing constraint is architectural, not physiological: the mileage
engine (`stepWeek`, peak-seeking, feasibility) and the speed permission machine
(`evaluateSpeedGuard`) are **frozen and authoritative**. Nothing in this design rewrites them.
Everything below is a *consumer* of their outputs and, wherever it writes, writes only into the
one structured surface the frozen code already owns — the `ProposedDay.why` string and two new
optional display fields — or proposes values into settings the frozen `stepWeek` already reads.
The whole design is engineered so that the safety invariants are true **by construction** (no
write path exists to violate them) rather than by promise; Part 7 discharges each one, by
architecture where possible and otherwise by a named runtime check plus the test that must
exist.

**How to read the cross-references.** Cross-references written as **§N** or **§N.M** (for
example §3.4, §5.4, §8.1) point to the companion research report,
[SPEED_ENGINE_RESEARCH.md](SPEED_ENGINE_RESEARCH.md), where the physiological justification
lives. This document's own eight numbered sub-parts are cited as **Part N**. Brief-name
citations (`ground-speed-surface`, `ground-adaptive-surface`, `ev-anchoring`, `converge`, etc.)
and code paths (`speedGuard.ts:285-288`, `adaptive.ts:113-115`) name the underlying
research and codebase-audit sources, and are kept intact as provenance.

## Contents

- [Design overview](#overview)
1. [Workout generation model](#p1)
2. [Intensity anchoring](#p2)
3. [Intensity-distribution controller](#p3)
4. [Race-date periodization module](#p4)
5. [Required data-model additions](#p5)
6. [Proposed tunables](#p6)
7. [Integration constraints](#p7)
8. [Open questions / thin evidence](#p8)
- [Adversarial audit log](#audit)

<a id="overview"></a>

## Design overview

This engine translates the physiology of §§2–8 of the research report into a buildable prescription engine, expressed as type shapes and decision tables only — no algorithms. The governing design constraint is architectural, not physiological: the mileage engine (`stepWeek`, peak-seeking, feasibility) and the speed permission machine (`evaluateSpeedGuard`) are **frozen and authoritative**. Everything below is a *consumer* of their outputs and, wherever it writes, writes only into the one structured surface the frozen code already owns — the `ProposedDay.why` string and two new optional display fields — or proposes values into settings the frozen `stepWeek` already reads. The whole design is engineered so that the safety invariants of Part 7 are true by construction (no write path exists to violate them) rather than by promise. The `effectiveTier` the guard emits is the single input that decides *whether* a fast session appears at all; this engine only decides *what that session's content is* once the guard has already permitted it.

A single fact from the codebase ground-truth audit shapes every sub-part: **runs log miles, a bare RPE scalar (1–10), and pain — there is no duration field, so pace, time-in-zone, and true session-RPE load are all uncomputable from stored data** (ground-speed-surface §Claim 7). The engine therefore always carries a *dual anchor*: an external pace target it hands the athlete to execute on a watch, and an in-app RPE/behavioural proxy that is the only thing autoregulation can actually observe.

---

<a id="p1"></a>

## 1. Workout generation model

The generator's job: given `(effectiveTier, weekInPlan, raceDate, currentFitness, hardBudgetRemaining)`, emit a concrete session. `effectiveTier` and `hardBudgetRemaining` come verbatim from `evaluateSpeedGuard` — the engine never reads raw `speedState`. `currentFitness` is the anchoring output of Part 2 (a Critical Speed velocity, or the cold-start RPE profile). The flow is deterministic and total.

**Top-level decision flow (deterministic):**

| Step | Condition | Result |
|---|---|---|
| 0 | `seasonWeek` (Monday ≥ `xcStartDate`) | Emit **zero** app hard sessions — coach owns workouts (ground-adaptive §6). Optional tier-≤3 stride add-ons only, via existing `planWeekSpeedAddOns`. STOP. |
| 1 | `effectiveTier === 0` OR any RELOCK/HOLD blocker present | Easy/long/rest only; no fast content. STOP. |
| 2 | `isDownWeek` | Suppress the fast day (existing rule); strides ≤ tier 3 permitted. STOP. |
| 3 | `hardBudgetRemaining < unitsFor(tierSession)` | Downgrade one rung on the intensity ladder (threshold → fartlek → strides → none) until affordable. |
| 4 | else | Emit the session for `min(effectiveTier, generatableTier)` — see per-tier table below. |

`generatableTier` is capped at 7 in base: **tier 8 is never auto-generated** (ground-speed §Claim 5; ruled correct for this athlete in §4 — youth VO₂max payoff g≈0.10, highest apophyseal cost, unmeasurable stimulus). Tier 8, when the ladder has unlocked it near-season, is exposed only as a **coach-confirmed manual session**, never machine-scheduled.

**The per-tier session content, with the two degradation paths side by side.** The left column is what the athlete *actually gets* at tier 4 with no check-in/RPE history (the missing-data floor: the guard caps effective tier at `ADVANCED_MIN_TIER − 1 = 4` when `advancedDataOk` is false — ground-speed §Claim 3). The right column is the tier-7 full-data path. Both share identical easy/long/rest scaffolding from the frozen generator; only the quality day differs.

| | **Tier-4 path — NO check-in/RPE data (degraded, the common case)** | **Tier-7 path — full data (check-ins ≥1 wk, RPE samples ≥4)** |
|---|---|---|
| Guard prerequisite | pain-free streak ≥4; `advancedDataOk = false` → hard-capped at 4 | streak ≥4 **and** `advancedDataOk = true` |
| Quality session | **Hill strides**: 6→8 × 10–12 s hill sprints, walk-down full recovery | **Continuous tempo**: 1 × 15→25 min at CS − 10–15 s/mi |
| Budget units | 0 (neuromuscular; charged to tissue/streak gate, not `HARD_BUDGET`) | 1 |
| Pace anchor (external) | grade-based effort cue only (no CS needed) | CS − 10–15 s/mi if CS known; else RPE 7–8 sustained |
| In-app proxy | momentary RPE 8–9; logged easy-run session RPE unchanged | even RPE 7–8 to the end; a positive RPE split = started too fast |
| Progression variable | **reps** (6→8) | **duration** (15→25 min), then pace toward CS |
| What degrades vs full-data | no sustained aerobic-power stimulus; but this is *correct* — the app must not dose tier 5+ blind (§4, tier-5 prereq) | full threshold/tempo prescription available |

The degradation is graceful because the **missing-data floor is a feature, not a failure**: tiers 1–4 are fully prescribable on pain-free training alone, and they are exactly the neuromuscular touches this athlete most needs and can least be hurt by (§3.4 — a stride is metabolically free; §5.1 — strides supply Z3 recruitment "off the distribution ledger"). An athlete who never fills in a check-in still gets a complete, safe, progressing plan capped at hill strides.

**Where within-tier progression state lives — DERIVED, no new mutable state.** The progression variable (reps for tiers 1–4, fast-volume/duration for 5–8) advances on *demonstrated clean tolerance*, and that is fully reconstructable from data the app already stores. Define:

`weeksInTier` is a **consecutive clean streak, not a filtered count** — it is the exact structural twin of the frozen `cleanCompletedWeeks` (speed.ts:131–137), which walks weeks newest-to-oldest and `break`s on the first non-qualifying week. It must break, not merely skip, on any week the guard suppressed the tier, so that suppression re-titrates from the floor.

```
weeksInTier(globals, runState, today, tier): number
  windowStart = laterDate(speedStateSince, painTrackingSince)
  weeks = completed calendar weeks in [windowStart, mondayOf(today)), newest→oldest
  n = 0
  for w in weeks (newest first):
    if qualifies(w, tier) then n++         // clean AND the tier was NOT suppressed that week
    else break                             // streak breaks — everything older is discarded
  return n

qualifies(w, tier):
  // (a) TIER-SPECIFIC non-suppression: the tier's own session was actually
  //     PRESCRIBABLE that week — evaluateSpeedGuard(runState, globals, wMonday).effectiveTier
  //     >= tierThreshold(tier). A week the guard capped below this tier does NOT
  //     qualify (mirrors cleanCompletedWeeks' else-break). This is what makes a
  //     multi-week SUPPRESSION reset the dose even though speedStateSince never moved.
  // (b) PRESENCE-THEN-CLEANLINESS on every loading run in w (missing = UNKNOWN,
  //     never clean): for each such run e —
  //         e.done === true
  //         AND e.painDuring != null AND e.painNextAM != null   // presence first
  //         AND e.painDuring <= 1 AND e.painNextAM <= 1          // then value
  //     A run with an unlogged pain field is UNKNOWN, so the week does NOT qualify
  //     (null <= 1 is TRUE in JS and must never be relied on — cf. adaptive.ts:114,
  //     which guards painNextAM != null before comparing).
  // (c) the tier's session type was actually prescribed+completed that week
  //     (acceptedWeeks + didStrides / optional speedKind, Part 5).
  // (d) a missing weekly check-in that the tier requires (§4 "worked" rule) is
  //     UNKNOWN → the week does NOT qualify.
```

The within-tier dose is then a pure function `doseFor(tier, weeksInTier)` — a lookup into the per-tier ladder of §4 (e.g. tier 3: wk1 6×20 s → wk2 7×20 s → wk3 8×20 s → wk4 8×25 s, ceiling 8×25 s). Because `weeksInTier` is a *consecutive streak of tier-specific clean weeks*, `doseFor(tier, 0)` is the floor rung, and any break — a suppressed week, a flare, a lapsed check-in, a run with unlogged pain — drops the count so the very next generation re-enters at (or near) the floor. **No new stored field.** This is preferred over stored mutable progression state for three reasons that map onto the frozen invariants:

1. **It survives "never rewrite completed weeks" automatically.** `weeksInTier` reads locked history read-only; it never writes back. A completed week's prescription is whatever `acceptedWeeks` recorded; the *next* unlocked week derives its dose from counting those completed weeks. There is no state that could disagree with history.
2. **Relock AND transient suppression both reset progression, for free — because the streak breaks on suppression, not only on a stored relock.** This is the INV-10/INV-5 fix. The earlier revision counted *since* `speedStateSince` and reset only on a STORED relock (`returnFromBreakSpeedPatch`, speedGuard.ts:325/339). But `evaluateSpeedGuard` caps `effectiveTier` via `Math.min` of blocker `capTier`s (speedGuard.ts:285–288) **without touching `speedState`/`speedStateSince`** — the module's explicit "suppress today, don't erase progress" design (header speedGuard.ts:6–14). A filtered count therefore let a tier-6 dose of 3 survive a 6-week `advancedDataOk=false` clamp (or a `poorRecovery`/`painDrift`/`morningPainHold` cap) and re-emit the TOP dose the instant the tier returned — the exact upward-dose smuggle INV-10 forbids. The consecutive-streak-with-break form closes this by construction: any window week where `effectiveTier(wMonday) < tierThreshold(tier)` fails `qualifies` and **breaks the streak**, so N weeks of suppressed tolerance force N-fold re-titration from the floor — identical to a stored relock, and matching the physiology. **Justification for reset-on-any-suppression:** a suppression means the safety layer judged the tissue not currently ready for that tier (rising soreness, poor recovery, missing gating data, a mileage spike). The within-tier ladder titrates *tissue exposure*, not fitness; a period of judged-unready exposure means the prior dose is no longer proven safe, so restarting at the conservative floor is the physiologically correct behaviour, not a regrettable side effect (§3.1 — metabolic recovery outpaces structural recovery; the ladder must read mechanical, not metabolic, readiness). [MECHANISTIC INFERENCE]
3. **It cannot manufacture progression from absent data — presence is required before cleanliness (INV-6 fix).** A week with a missing check-in or an unlogged run breaks the streak: `qualifies` demands `e.painDuring != null && e.painNextAM != null` *before* the `<= 1` comparison, and demands the tier's required check-in be present. This is not cosmetic: `RunEntry.painDuring`/`painNextAM` are `number | null` (types.ts:8–9) and `null <= 1` evaluates to `true` in JavaScript, so a naïve `e.painDuring <= 1 && e.painNextAM <= 1` would score a completed run with unlogged pain as CLEAN and climb the dose from zero pain evidence. The frozen adaptive layer already guards exactly this (`painDriftSignal` filters `painNextAM != null` before comparing, adaptive.ts:113–115); the prescription layer must match it byte-for-byte. Missing = UNKNOWN = neither credit nor penalty, and (per fix 2) breaks the streak rather than silently skipping.

The only *optional* stored addition that would sharpen this (a logged `speedKind` tag on completed runs, Part 5) merely disambiguates which quality session was actually performed; without it the engine falls back to inferring from `acceptedWeeks` + `didStrides`, degrading gracefully.

---

<a id="p2"></a>

## 2. Intensity anchoring

**Model choice: Critical Speed, with an RPE-anchored cold-start as the default path.** [DEMONSTRATED, youth — ev-anchoring C6/C7]

CS wins on evidence that is, uniquely in this corpus, *adolescent-specific*: from two maximal efforts the athlete already runs — a **1600 m and a 3200 m** — `CS = (d₂ − d₁)/(t₂ − t₁)` returns the maximal-metabolic-steady-state velocity with youth reliability CV 2.4–4.3%, ICC 0.92–0.98, and youth concurrent validity (CS ≈ lactate-minimum velocity, n=25 youth runners). VDOT is rejected: its fixed running-economy constant is *precisely* what a maturing adolescent violates, so a VDOT trend across a growth season conflates fitness gain with maturation (ev-anchoring C2–C3). HR anchoring is rejected with numbers: estimated HRmax carries ±10–12 bpm error in adults and over-predicts by 6–12 bpm in under-18s — enough to misplace an entire zone — and the app logs no HR anyway (ev-anchoring C9–C10). D′ is used directionally only (weak, underestimated — C5).

**Input/output shape (design only):**

```
AnchorInput  = { races: RaceResult[]; today: string }
AnchorOutput =
  | { mode: 'cs';        csMiPerMin: number; staleDays: number;
      paceTargets: Record<SpeedTier, PaceBand>;   // external, watch-executed
      rpeFallback: Record<SpeedTier, RpeBand> }   // in-app proxy
  | { mode: 'coldstart'; paceTargets: null;
      rpeFallback: Record<SpeedTier, RpeBand>;    // the DEFAULT
      behaviouralCues: Record<SpeedTier, string> }
```

Per-tier targets when CS is known (from §4): tier 6 ≈ CS; tier 7 ≈ CS − 10–15 s/mi; tier 8 ≈ 3200 m race pace (≈ CS + 5–8%); Z1 easy ≥ 75–90 s/mi slower than CS. These are attached to the `why` string only.

**The cold-start path is the DEFAULT and must be excellent** — most sessions, and every athlete without two recent same-season time trials, run on it. It anchors on what the app observes: RPE bands plus behavioural cues that need no watch and no lab (§5.3):

| Tier band | Cold-start RPE proxy | Behavioural cue |
|---|---|---|
| Easy (Z1) | ≤ 3–4 | full-paragraph conversation; nose-breathing feasible; "all day" pace |
| Threshold (tier 6–7) | 7–8 | "comfortably hard — one sentence, not a paragraph"; at a rep's end feels holdable 15–20 min longer |
| Strides (tier 1–4) | momentary 6–9, session RPE unchanged (≤4) | fast but relaxed; "another gear left"; breathing recovered before next rep |

The cold-start path is not a degraded stopgap; for this athlete it is arguably *safer* than CS, because it cannot be corrupted by the maturation confound and it degrades to the same RPE proxy the app uses for autoregulation regardless.

**Maturation-confound hazard.** Race times fall with growth alone (economy + FFM + leg length; ev-youth C4, T19–T20). Therefore CS will *drift upward across a season without any training response*. Two guards: (a) CS sets *pace targets only*, never an "earned fitness" signal — it can never feed earned-trust or unlock anything (see invariant below); (b) CS is recomputed from races, so it silently tracks growth as a moving pace target without ever being interpreted as merit.

**Staleness.** CS is trusted only from a race pair within `CS_MAX_RACE_AGE_DAYS` (default 120) and with the two races within `CS_MAX_PAIR_SPREAD_DAYS` of each other. Stale or single-race → fall back to `mode: 'coldstart'` for that tier's pace target while keeping RPE. Riegel is permitted *only* to equate two nearby race distances into a usable pair, never as the primary anchor (ev-anchoring C8).

**The CRITICAL invariant — making race data an input changes the display-only rule; here is the exact bound.** Today `RaceResult` is display-only (ground-adaptive §5). This engine makes it an *input to pace-target computation*. That is acceptable **iff** the influence is bounded to display refinement and cannot touch any safety surface. Exact bound:

> CS derived from race data MAY influence **only** the pace number and behavioural copy written into a `ProposedDay.why` string for a session that some *other* mechanism (the guard) has already permitted. It MUST NEVER: unlock or raise a tier; widen the hard budget; raise the long-run cap or peak ceiling; override or soften any pain/flare/recovery gate; or feed the adaptive/earned-trust layer.

This is enforced structurally *in code*, not by discipline: CS is consumed *strictly downstream* of `effectiveTier` and `hardBudgetRemaining`, and the anchoring module has **no write path** to `speedState`, `settings`, `readiness`, or the `AdaptiveModulation`. It reads `RaceResult[]` and writes a string. A faster race can make the *prescribed pace* of an already-permitted threshold rep quicker; it can never cause the threshold rep to *exist* when the guard would not have permitted it. (This mirrors the existing reconciliation: a current-week race may only *suppress* speed downward via taper + budget spend — ground-adaptive §5.)

**The code write-path proof is complete but the DEPLOYED system is not acyclic — the body-in-the-loop coupling, stated explicitly (INV-8/INV-9 fix).** The code flow is acyclic; the deployed flow is not, and pretending otherwise is the gap an adversary exploits. The real loop is:

```
RaceResult → CS → prescribed pace (why string) → athlete executes that effort
  → logs rpe / painDuring / painNextAM / miles
  → easyRunRpeTrend / painDriftSignal / painFreeStreak / cleanCompletedWeeks
  → guard blockers (cap effectiveTier)
     AND evaluateReadiness streak + cleanWeeks items (speed.ts:169,254) — an UNLOCK gate
     AND assessEarnedTrust rpeTrend='stable' gate (adaptive.ts:450)
```

So race data *does* reach the tier-unlock gate and the earned-trust gate — through the athlete's body, not through code. Acyclicity therefore holds only for **code**; the deployment loop is a cycle. It is **safe today by negative feedback, not by structure**: a maturation-inflated CS → faster prescribed pace → equal-or-higher true effort and ground-reaction → equal-or-higher logged RPE/pain → *tighter* gate (streak breaks, `risingRpe` fires, earned-trust vetoes). A faster race buys *more* caution, never less. That negative sign holds **only while the in-app autoregulation proxy is EFFORT-anchored** (RPE + behavioural cues, the bands in Part 2 above), because then the logged signal tracks true strain regardless of the CS pace number.

If the proxy were ever anchored to CS-derived **absolute pace** ("hold 6:30/mi, self-report how it felt") the sign flips: a growth-inflated CS lets the athlete run a hard-for-current-fitness pace while logging artificially *low* effort → `rpeTrend='stable'` earned-trust gate satisfied and the pain-free streak accrues → race data reaches an unlock and a widened growth cap. That is a direct INV-8 (race display-only) + INV-2 (unlock) breach, gated only by an unstated convention. It is promoted here to a hard invariant:

> **INV-9a (autoregulation proxy is effort-anchored).** The in-app autoregulation signal MUST be effort/behaviour-based (RPE, conversational/breathing cues). No pace-derived quantity — CS pace, a split, a target pace, or anything computed from `RaceResult` — may be logged as, stored as, or compared against `rpe`/`painDuring`/`painNextAM`. Pace targets are *external, watch-executed display* only (the `paceTargets` field, Part 2 shape) and are structurally separate from the `rpeFallback`/behavioural proxy the guard and adaptive layer read. This keeps every branch of the deployed loop negative-feedback, which is what makes the code-acyclicity proof sufficient for safety.

The verifying test is byte-identity under fabricated faster races (see Part 7 INV-8/9 test): substituting strictly-faster `RaceResult`s must leave `painFreeStreak`, `cleanCompletedWeeks`, `evaluateReadiness.allGreen`, and `assessEarnedTrust.active` unchanged, proving no race-derived quantity crossed into a safety decision.

---

<a id="p3"></a>

## 3. Intensity-distribution controller

Physiological target from §5: **pyramidal ~80/13/7 by minutes** — the aspirational shape, NOT the enforced ratio. What is actually *enforced* is a one-sided cap on the measurable proxy (`f ≤ 0.10` base, `≤ 0.15` in-season), which **realises ~92/8/0** base (non-race weeks) — deliberately more conservative than the target. The controller's entire job is to *cap and remove*, never to add — so it can neither oscillate nor fight the guard.

| Property | Specification |
|---|---|
| Measured quantity | `f = fast_mi / total_mi` (fast_mi = miles in threshold+ sessions) over a rolling window; plus a **Z3 trip-wire**: any logged run at RPE ≥ `Z3_RPE_TRIPWIRE` (8). |
| Window | rolling 7-day for `f`; rolling 28-day for drift detection; evaluated at generation time only. |
| Tolerance (one-sided) | `f ≤ 0.10` base, `≤ 0.15` in-season (≈ ≤8% / ≤11% by minutes given the ~1.3× miles-overstatement of §5.4). **No lower bound — by design.** |
| Corrective action (DOWNWARD-ONLY) | If `f` exceeds cap, or session count exceeds budget, or the iliopsoas signal rises: **remove/downgrade the next hard day** along threshold → fartlek → strides → easy. On an RPE ≥ 8 trip-wire, apply the *existing* morning-pain / spike holds. |
| Forbidden | Never add Z3 or tempo to reach a floor; never inflate easy volume to dilute a ratio. If easy share reads low, the fix is to cut hard, not add easy. |

**Why it cannot oscillate.** The controller is monotone-removing: its only action is to subtract intensity. It has no branch that adds a session. A control loop that only ever decreases a quantity toward a one-sided bound has no oscillation mode — there is no overshoot to correct in the other direction because there is no other direction. In steady following-the-plan operation the generator already caps the threshold fast-portion at `min(10%·week, 3 mi)`, so `f ≤ 0.10` holds by construction and the controller is a **no-op**; it fires only on athlete-added intensity (a self-inserted hard run), where it removes the *next planned* hard day to bring the rolling window back under cap.

**Why it cannot fight the guard.** Both point the same direction. The guard lowers `effectiveTier` (removes/downgrades intensity); the controller removes/downgrades intensity. Two downward-only operators compose to a downward-only operator — `min(min(a,b), c)` is order-independent and still ≤ each input. The controller never proposes a tier the guard has forbidden, because it can only *subtract* from what the generator already produced under the guard's cap. (This is the same architecture as the guard's most-severe-wins `Math.min` chain — ground-speed §Part 6.) [MECHANISTIC INFERENCE — direction proven structurally; the specific 0.10/0.15 numbers are §5's extrapolation, low-confidence.]

---

<a id="p4"></a>

## 4. Race-date periodization module

The mileage engine is frozen. The periodization module therefore **never writes plan weeks and never touches `stepWeek` math**. It works with the frozen engine through exactly two doors: (1) it **proposes** values into the settings inputs `stepWeek` already reads (`peakMpw`, `xcStartDate`, `downEvery`), surfacing them for user/coach confirmation; (2) it emits **monitor-level advice** strings. It has no other authority.

**Backward sequencing (from §8, adaptation-timescale matching, not tradition):**

| Block | Weeks-out | What the module does (frozen-engine-compatible) |
|---|---|---|
| General base | ~16–8 | Propose `peakMpw ≈ 30–35` (soft caution at 30, hold-ceiling ~35) — `stepWeek`'s `gapSeek` then ramps toward it, hard-clamped by the +10%/wk `cap`. Intensity content = 1 hard unit/wk = threshold, via the tier ladder. |
| Specific / threshold | ~8–3 | No settings change; the tier ladder's own progression carries the 1 hard unit from fartlek → threshold as tolerance is earned. **Threshold, not VO₂max** (adolescent ruling, §8.1). |
| Sharpening | ~3–2 | Advise only; the app's own contribution is strides, already present. |
| Taper (goal race) | final 7–10 d | A current-week race *already* forces volume suppression + a budget spend in the frozen code. The module additionally **suppresses its own optional strides/fartlek add-ons** in the final 5–7 d and surfaces a taper-window advice string. |

**Proof it is not redesigning the mileage engine.** Every lever the module pulls is one `stepWeek` already consumes or one the app already owns:
- It writes `peakMpw` → `stepWeek` reads it as the terminal ceiling (`min(total, peakMpw)`), already clamped `peakMpw = max(raw, startMpw)`. The module cannot make the plan grow faster than +10%/wk because it does not touch `weeklyGrowthMax`, `growthFactor`, or the `cap` computation — those remain the frozen code's.
- It never writes a `ProposedDay.miles`, never calls `splitWeek`, never carries `{long, traj}`. The mileage trajectory is computed entirely by the frozen `buildWeekConfigsFromSettings` from the settings the module proposed.
- The taper is delivered through the *existing* race-week suppression path plus add-on silencing — no new volume-cut code. (The 7–10 d / ~40% shape of §8.4 is realised by *where the race sits in the settings-driven schedule*, not by a new taper function.)

**In-season (coach owns workouts).** The module stops prescribing and becomes a **monitor** (§8.7): it watches that coach load + races don't breach the downward-only signals (all of which already ratchet conservative), accounts races/coach sessions against the hard budget *for display and warning only*, and never lets the ladder climb into a coach's hard week (the `SEASON_TRANSITION_HOLD_DAYS = 14` freeze already does this).

**Goal race inside the coach's season (the hard case).** The module cannot add a taper workout or remove a coach session — it has no authority over coach content. It may only, all downward-compatible: (a) suppress its own optional add-ons in the final 5–7 d; (b) let the existing current-week-race taper apply (~25–30% easy-volume cut + budget spend); (c) surface a monitor recommendation to athlete/coach. The in-season goal-race taper is necessarily **partial** — the intensity that must be *maintained* is the coach's to hold; the fatigue-shedding *volume cut* is the app's to apply. The two compose correctly (§8.7). The module must **never** read a race result, post-taper PR, or fast metabolic recovery as earned fitness (§8.4 — taper gain is ~2–3% fatigue-shedding, compounded by the growth confound; crediting it would inflate load exactly when circa-PHV apophyseal risk peaks). [DEMONSTRATED — maturation confound + taper mechanism]

---

<a id="p5"></a>

## 5. Required data-model additions

Explicit, minimal, additive/optional, missing = UNKNOWN. Ranked by value.

| Rank | Field | Type | Lives on | Unlocks | Degrades without it | Migration |
|---|---|---|---|---|---|---|
| **1** | `durationMin` | `number \| null` | `RunEntry` | time-in-zone accounting; erases the ~2–3 pp miles→minutes bias (§5.4); true session-RPE load = RPE × min | miles proxy for distribution (error ~2–3 pp, **erring safe**); no sRPE load | additive optional; absent = UNKNOWN |
| 2 | `speedKind` | `SpeedKindTag \| null` | `RunEntry` (logged, not planned) | the **progression feedback loop** — confirms which quality session was actually done, sharpening `weeksInTier` (Part 1) and the distribution monitor's fast_mi | falls back to inferring from `acceptedWeeks` + `didStrides`; monitor relies on RPE ≥ 8 trip-wire alone | additive optional |
| 3 | `raceDistanceStd` | `1600 \| 3200 \| ...` (already have `distanceMi`) | `RaceResult` | cleaner CS pair-matching (already derivable from `distanceMi`) | CS matches on `distanceMi` directly — near-zero loss | none needed; already present |

`SpeedKindTag = 'buildups' | 'strides' | 'hills' | 'fartlek' | 'threshold' | 'tempo' | 'race'` — mirrors the tier ladder.

**The single highest-value addition is `durationMin`, and the argument is run duration specifically.** It is the one field that dissolves the report's central constraint. With duration: (a) the intensity-distribution target of §5 becomes *verifiable by minutes-in-zone* rather than approximated by a miles cap; (b) the ~1.3× miles-overstatement of the hard fraction vanishes, removing a (currently safe-but-real) systematic error; (c) session-RPE **load** (RPE × minutes — the Foster-validated construct, ev-anchoring C13–C14) becomes computable, which is the only validated form of the RPE the app already logs; today RPE is a bare scalar never multiplied by time. No other single field unlocks three capabilities at once. Crucially it is **additive and safe-by-default**: absent duration, every consumer falls back to the miles proxy, which *over*-states hard work and therefore errs toward cutting intensity earlier (§5.4) — so shipping without it is acceptable and shipping it only *improves* precision, never loosens a cap.

**Workout OUTCOME logging (the progression feedback loop).** The loop that advances the within-tier dose already has most of its inputs in `RunEntry` today: `done`, `painDuring`, `painNextAM`, `didStrides`, `strideNote`, `rpe`. The worked/overreached rule per tier (§4) reads exactly these — e.g. tier 4 "worked" = painDuring **present and** ≤ 1, painNextAM **present and** ≤ 1, check-in present and ≥ 3; "overreached" = the existing `morningPainHold`. Presence is part of the rule: a null pain field is UNKNOWN, not "worked" (see Part 1 `qualifies` — `!= null` before `<= 1`, guarding against `null <= 1 === true`). The one gap is knowing *which* quality session was performed when several were possible — closed by the optional `speedKind` tag (rank 2). No new outcome-scoring state is stored: `weeksInTier` (Part 1) recomputes the outcome each generation from the immutable log. Nothing about the outcome loop writes to `runState` — it only reads it.

---

<a id="p6"></a>

## 6. Proposed tunables

House-style multi-line comments, SCREAMING_SNAKE, grouped under a new `TUNABLES.PRESCRIPTION` block and additions to `TUNABLES.SPEED`. Every default traces to a research section or is marked a conservative guess.

```ts
  // ── Prescription engine (Evidence Spec §9; consumes the guard, never writes it) ──
  // Every constant here shapes the CONTENT of an already-permitted session or the
  // MONITOR that can only remove intensity. None can unlock a tier, widen a budget,
  // or loosen a cap — those live in the frozen speed guard and stepWeek.
  PRESCRIPTION: {
    /** Within-tier dose advances only after this many CLEAN completed weeks at the
     *  current dose (painDuring≤1, painNextAM≤1, no blocker). Derived from the log
     *  via weeksInTier — NOT stored. 1 wk/step keeps the ladder patient; the tissue
     *  clock (apophysis) lags the metabolic one, so a slow rep-climb is the point
     *  (Spec §3.1, §4 progression principle). [MECH — no youth dose-titration RCT.] */
    TIER_PROGRESS_MIN_CLEAN_WEEKS: 1,
    /** Neuromuscular rep ceiling (tiers 1–4). Above this, added reps at full
     *  recovery add tissue load without new recruitment — the size principle is
     *  satisfied on rep 1 (Spec §4). Matches the STRIDES.MAX_REPS validity cap. */
    NEURO_REP_CEILING: 8,
    /** Neuromuscular rep floor — every tier re-enters here on relock/first unlock
     *  (conservative restart; lost tolerance = unproven exposure, Spec Part 1). */
    NEURO_REP_FLOOR: 4,
    /** Critical-Speed anchor: races older than this (days) are STALE → fall back to
     *  the RPE cold-start for that tier's pace target. A season's fitness AND a
     *  growth increment both move CS, so an old race mis-paces (ev-anchoring C3,
     *  staleness). Conservative — one XC season ≈ 10–12 wk. */
    CS_MAX_RACE_AGE_DAYS: 120,
    /** The two races forming a CS pair must sit within this many days of each other,
     *  else they mix two fitness/maturation states. [Conservative guess — no youth
     *  CS-pair-spread study; err short.] */
    CS_MAX_PAIR_SPREAD_DAYS: 45,
    /** Minimum race-distance separation (mi) for a usable CS pair — a 1600 m and a
     *  3200 m give a stable slope; too-close distances inflate CS error (ev-anchoring
     *  C5, D′ noise). ~1 mi ≈ the 1600/3200 gap the athlete already races. */
    CS_MIN_PAIR_DISTANCE_MI: 0.9,
  },
```

```ts
  // ── additions to TUNABLES.SPEED ──
    /** Intensity-distribution monitor: any logged run at/above this RPE is tagged
     *  Z3 (hard) — the minimum-viable trip-wire while the app logs no duration
     *  (Spec §5.7). RPE 8 = "breathing dominates, 3k–5k effort". DOWNWARD-ONLY:
     *  a trip only ever REMOVES the next hard day, never adds. */
    Z3_RPE_TRIPWIRE: 8,
    /** Rolling window (days) for the fast-fraction-by-miles cap f ≤ FAST_FRACTION_*.
     *  7 d matches the weekly hard-budget cadence (Spec §5.7). */
    FAST_FRACTION_WINDOW_DAYS: 7,
    /** Fast-fraction-by-miles cap, base and in-season. ≈ ≤8% / ≤11% by MINUTES given
     *  the ~1.3× miles-overstatement of the hard fraction (Spec §5.4). One-sided:
     *  no lower bound — the engine never adds intensity to hit a floor. [MECH,
     *  low-confidence: no adolescent/25-mpw TID RCT exists; the CAP direction is
     *  robust, the exact number is extrapolation — deliberately conservative.] */
    FAST_FRACTION_MAX_BASE: 0.10,
    FAST_FRACTION_MAX_SEASON: 0.15,
    /** VO₂max (tier 8) rep-duration floor (seconds). Reps shorter than this never
     *  climb to VO₂max from cold (τ-kinetics: 1-min reps reach ~82% VO2peak, 2-min
     *  ~92% — Seiler & Sjursen; ev-intervals C5). Youth kinetics are faster, so 120 s
     *  is a safe floor, not a tight one. Tier 8 is NEVER auto-generated regardless
     *  (Spec §4); this bounds a coach-confirmed manual session only. */
    VO2_REP_MIN_S: 120,
```

Deliberately conservative constants are flagged inline (`CS_MAX_PAIR_SPREAD_DAYS`, the `FAST_FRACTION_MAX_*` pair). Everything else traces to a numbered claim.

---

<a id="p7"></a>

## 7. Integration constraints

Each frozen invariant, proven by architecture where possible (an absent write path cannot be exercised), and otherwise by a named runtime check plus the test that must exist.

**INV-1 — Never overrides pain / flare / recovery.**
*Structural proof:* the generator and every sub-module consume `effectiveTier`, `holdTier`, and `hardBudgetRemaining` as **inputs** from `evaluateSpeedGuard`. They import no blocker, hold no write path to `GlobalState.readiness` / `hipSafeFlag` / `painCap`, and never recompute a blocker. A pain breach that caps the guard at tier ≤1 is consumed as tier ≤1; there is no branch that can raise it. *What would break this:* the engine reading raw `globals.speedState` instead of the guard's `effectiveTier`; a module recomputing its own "usable tier" from streak. *Test that must exist:* "generated session tier ≤ guard.effectiveTier for 4000 fuzzed states, including every active blocker."

**INV-2 — Never unlocks a tier.**
*Structural proof (the strongest one):* the engine **consumes `effectiveTier` as a read-only input and has no write path to `speedState` or `evaluateReadiness`** → it is structurally incapable of unlocking a tier. Unlock authority lives solely in `canSetState` / `evaluateReadiness` (frozen). The CS anchor (Part 2) writes only a `why` string; the periodization module (Part 4) writes only `peakMpw`/`xcStartDate` settings, neither of which is an unlock lever. *What would break this:* adding a code path that sets `globals.speedState` from the prescription layer; letting CS or a race result feed `evaluateReadiness`. *Test:* "no prescription-module call mutates `speedState`; `canSetState` output byte-identical with vs without race data present."

**INV-3 — Never raises the long-run cap or peak ceiling.**
*Structural proof:* the engine never calls the `stepWeek` build branch and never writes `growthFactor`, `earnedGrowthMax`, `capPct`, or `trailingLongest`. The periodization module writes only `peakMpw` (which `stepWeek` clamps as a terminal ceiling `min(total, peakMpw)`, and which the frozen consumer re-clamps `max(raw, startMpw)`) — it cannot make a week grow faster than the frozen +10%/wk `cap` because that computation is untouched. The long-run ladder (`nextLongFrom`, ≤110%/step) is read, never written. *What would break this:* the module writing `buildStep` above 10% of `startMpw`; feeding CS into `earnedGrowthMax`. *Test:* "no build week grows >+10% over the last BUILD week and no long-run step >110% under any module-proposed `peakMpw`" (extends `feasibility.test.ts`).

**INV-4 — Never rewrites completed weeks / logged runs.**
*Structural proof:* the engine writes only future `ProposedDay` content for weeks where `isWeekLocked` is false, and reads `RunEntry` strictly read-only (`weeksInTier`, the distribution monitor, the outcome loop all read the log). There is no write path to `bb_run_state`. *Runtime check needed:* the generation entry point must gate all writes behind `!isWeekLocked(weekStart, today, runState)` — this is the one place a bug could reach a locked week. *Test:* "run log never mutated; locked weeks byte-identical with vs without the prescription engine" (extends `preservation.test.ts`, `acceptedWeeksDisplay.test.ts`).

**INV-5 — Stays downward-only.**
*Structural proof:* the distribution controller (Part 3) and the in-season monitor (Part 4) have only *remove/downgrade* operations — no branch adds a session or raises volume. Composed with the guard's `Math.min` chain they remain monotone-down. The within-tier dose (Part 1) is also monotone-down under suppression: `weeksInTier` is a consecutive streak that **breaks** (drops toward 0) on any window week whose `effectiveTier < tierThreshold`, so a suppressed period can only *lower* the next dose, never let a stale high dose resume — mirroring the frozen `cleanCompletedWeeks` else-break. The one *upward-looking* module, CS anchoring, writes only display copy and is covered by INV-2/INV-3/INV-9a. *What would break this:* a "hit the 13% Z2 floor" branch that *adds* tempo; a controller that inflates easy volume to dilute a ratio (§5.7 forbids both); **making `weeksInTier` a filtered COUNT again** (skips instead of breaks), which lets a top dose survive a multi-week suppression and re-emit — the INV-10 smuggle. *Test:* "the distribution controller never increases fast_mi, session count, or weekly volume across 4000 fuzzed logs"; **plus INV-10 test: "a tier suppressed below its threshold for K weeks (via `advancedDataOk=false`, `poorRecovery`, `painDrift`, or `morningPainHold`) then restored re-enters the within-tier ladder at the floor, not the pre-suppression dose, for all K≥1"** (mirrors the `cleanCompletedWeeks` break test in `speed`'s suite).

**INV-6 — Missing = UNKNOWN (missing field is never clean evidence; an unlogged week never advances progression).**
*Structural proof / check:* CS absent → `mode: 'coldstart'` (RPE), never a fabricated pace. `durationMin` absent → miles proxy (errs safe). The `weeksInTier` streak uses **presence-then-cleanliness**: `qualifies` requires `e.done && e.painDuring != null && e.painNextAM != null` *before* the `<= 1` test, so a completed run with an unlogged pain field is UNKNOWN and **breaks the streak** rather than counting as clean — closing the `null <= 1 === true` hole (types.ts:8–9 make both fields `number | null`; adaptive.ts:113–115 is the frozen precedent that guards `!= null` first). A missing required weekly check-in likewise fails `qualifies`. No missing field is ever read as 0 or as clean evidence. *What would break this:* treating a missing `durationMin` as 0 minutes (would zero a run's load); writing the predicate as the literal `e.painDuring <= 1 && e.painNextAM <= 1` without the `!= null` presence guards; counting (or merely skipping instead of breaking on) an unlogged week. *Test:* "missing `durationMin`/`speedKind`/race data leaves distribution, progression, and anchoring identical to the documented UNKNOWN fallback; a completed run with missing `painDuring`/`painNextAM` never advances a tier dose and breaks the streak" (mirrors `phase2bCheckins.test.ts` missing-fields cases).

**INV-8/INV-9 — Race data is display-only and reaches no safety decision.**
*Structural proof (code) + stated contingency (deployment):* the CS/anchoring module reads `RaceResult[]` and writes only a `why` string — no write path to `speedState`, `settings`, `readiness`, or `AdaptiveModulation` (INV-2/INV-3 proofs). That makes the **code** acyclic. The **deployed** loop is not acyclic (race → CS pace → executed effort → logged rpe/pain → guard + `evaluateReadiness` + `assessEarnedTrust`); it is safe by *negative feedback*, which holds iff the autoregulation proxy is effort-anchored — promoted to hard invariant **INV-9a** (Part 2): no pace-derived quantity may be logged as or compared against RPE/pain; pace targets are external-display only, structurally separate from the `rpeFallback` proxy. *What would break this:* anchoring the in-app proxy to CS-derived absolute pace (flips the feedback sign, letting a growth-inflated CS satisfy the earned-trust/streak gates); any code that feeds CS or a `RaceResult`-derived value into `evaluateReadiness` or `assessEarnedTrust`. *Test:* "substituting strictly-faster fabricated `RaceResult`s leaves `painFreeStreak`, `cleanCompletedWeeks`, `evaluateReadiness.allGreen`, and `assessEarnedTrust.active` byte-identical" — proving no race-derived quantity crossed into an unlock or earned-trust decision.

---

<a id="p8"></a>

## 8. Open questions / thin evidence

Per item: the question, why it is unresolved, the conservative fallback (when uncertain, prescribe *less* and defer to the safety layer), and what would resolve it.

1. **Is the in-season second hard unit (`HARD_BUDGET_SEASON = 2`) worth its apophyseal cost for a robust post-PHV athlete?** *Unresolved:* the supporting T@VO₂max / interval evidence is adult, and the youth structural data argues against it (§2 live open question; §4 tier-8 ruling). *Fallback:* keep the second unit gated and coach-owned in-season; the app never schedules it. *Resolves:* a maturity-offset (years-from-PHV) field + a within-athlete injury-incidence signal across seasons.

2. **The exact §5 distribution numbers (80/13/7).** *Unresolved:* zero adolescent or 25-mpw TID RCT exists; the numbers are extrapolation from recreational-adult low-volume trials (Festa null, Muñoz) — only the *pyramidal direction* is robust (ev-evidence §C). *Fallback:* enforce the cap as a one-sided ceiling the engine may only lower; never treat the ratio as a quota to reach by adding intensity. *Resolves:* a youth low-volume TID trial (does not exist).

3. **Within-tier dose-titration rate (`TIER_PROGRESS_MIN_CLEAN_WEEKS`, rep ceilings).** *Unresolved:* no youth study titrates stride reps or threshold minutes week-to-week; the ladder is mechanistic. *Fallback:* 1 clean week per step, rep ceiling 8, restart-on-relock — the slowest defensible climb. *Resolves:* a longitudinal youth tolerance study; until then bias to under-loading circa-PHV.

4. **CS validity as a *pace target* across a growth spurt.** *Unresolved:* CS reliability is youth-demonstrated, but its stability as a *prescription* anchor while leg length and economy change mid-season is untested (the maturation confound, ev-anchoring C3). *Fallback:* staleness window (120 d) + RPE cold-start whenever the pair is stale; never interpret a rising CS as earned merit. *Resolves:* serial in-season CS + maturity-offset tracking.

5. **Iliopsoas-specific adolescent running-injury data — absent entirely.** *Unresolved:* the hills-after-flat ordering, strain-rate ranking, and the whole apophyseal-cap rationale are precautionary mechanism; there are no RCTs (ev-evidence §G, converge N-P4 UNTESTED). *Fallback:* hold the 3/10 pain cap hard regardless of tier order; gate every hip-dominant drill behind it; regress instantly on flare. This is the single item where the safety layer, not the prescription, must own the outcome.

6. **Whether a logged `speedKind` tag is worth the schema/UX cost, or `acceptedWeeks` + `didStrides` inference suffices.** *Unresolved:* the inference path is untested against real athlete logging behaviour (do athletes complete the prescribed quality session, or improvise?). *Fallback:* ship without `speedKind`; rely on the RPE ≥ 8 trip-wire + inference, which errs toward *seeing* more hard work than occurred (safe direction). *Resolves:* a logging-fidelity study on real users.

7. **The biggest open question — is maximizing T@VO₂max even the right objective for tier 8?** *Unresolved:* no controlled trial shows a higher-T@VO₂max protocol yields greater VO₂max *gain* (Midgley; ev-intervals §2.6) — the entire tier-8 design rests on an assumed, unvalidated surrogate, and the youth payoff is small and maturation-confounded (g≈0.10). *Fallback:* never auto-generate tier 8; expose it only as a coach-confirmed manual session near-season; spend the base-phase hard unit on threshold (tier 6), whose CP target *is* the demonstrated dominant 5-k lever. *Resolves:* a youth interval dose-response trial with a true control — which does not exist, so the conservative posture is permanent, not provisional.

---

<a id="audit"></a>

## Adversarial audit log

Each entry: the violation an auditor raised against this spec, its resolution (**FIXED** — a new architectural argument making it structurally impossible — or **REBUTTED** — with the concrete argument), and any capability given up. All code claims were re-verified read-only against the frozen sources before resolving.

**V1 — INV-10 / INV-5 downward-only: within-tier progression resumes at the top dose after a multi-week SUPPRESSION.** *(serious)* **FIXED.** Root cause confirmed: `evaluateSpeedGuard` caps `effectiveTier` via `Math.min` of blocker `capTier`s (speedGuard.ts:285–288) *without* writing `speedState`/`speedStateSince` — the deliberate "suppress today, don't erase progress" design (header speedGuard.ts:6–14). The earlier `weeksInTier` was a **filtered count** that reset only on a STORED relock, so a 6-week `advancedDataOk=false` clamp (or `poorRecovery`/`painDrift`/`morningPainHold`) left the tier-6 dose-count of 3 intact and re-emitted the top threshold dose the instant the tier returned. Fix: redefined `weeksInTier` (Part 1) as a **consecutive clean streak that `break`s** on the first window week whose `effectiveTier(wMonday) < tierThreshold(tier)` — the exact structural twin of the frozen `cleanCompletedWeeks` else-break (speed.ts:131–137). The architectural argument is now "the streak cannot cross a suppressed week" rather than "we will reset on relock": K suppressed weeks force K-fold re-titration from the floor by construction, identical to a stored relock. Also made `qualifies` **tier-specific** (a lower rung cannot be earned by higher-tier history). Updated Part 1 point 2, INV-5, and added an INV-10 regression test.

**V2 — INV-6 missing = UNKNOWN: `null <= 1 === true` scores an unlogged run as clean.** *(serious)* **FIXED.** Confirmed `RunEntry.painDuring`/`painNextAM` are `number | null` (types.ts:8–9) and JS `null <= 1` is `true`; the frozen adaptive layer already guards `painNextAM != null` before comparing (adaptive.ts:113–115). Fix: `qualifies` now requires **presence before cleanliness** — `e.done && e.painDuring != null && e.painNextAM != null` *before* `<= 1` — and a missing required check-in fails the predicate. Missing → UNKNOWN → **breaks the streak** (not merely skipped). Updated Part 1 point 3, Part 5 prose, INV-6, and added the missing-pain-field test mirroring `phase2bCheckins.test.ts`.

**V3 — INV-8/INV-9: race data reaches an unlock via the body-in-the-loop.** *(serious)* **FIXED (as stated coupling + hard invariant), partial-rebuttal on current safety.** The auditor is right that the *code* write-path proof, though true, does not cover the deployed cycle race → CS pace → executed effort → logged rpe/pain → `evaluateReadiness`/`assessEarnedTrust`. I did not weaken the claim: Part 2 now downgrades "acyclic" to **code-acyclic; deployment loop is negative-feedback-only**, states the coupling explicitly, and adds hard invariant **INV-9a** — the autoregulation proxy MUST be effort-anchored and no pace-derived quantity may be logged as or compared against RPE/pain (pace targets are external-display only, structurally separate from the `rpeFallback` proxy the safety layer reads). The *partial rebuttal*: in the design **as specified today** the loop is genuinely safe — every branch is negative feedback (inflated CS → faster pace → higher true effort/pain → tighter gate), so no fix to today's code is required; the danger is purely a *future* re-anchoring of the proxy to absolute pace, which INV-9a now forbids by contract. Added the byte-identity-under-faster-races test to Part 7.

**Capability given up.** One real, minor loss, from V1: an athlete whose advanced tier is transiently suppressed (e.g. check-ins lapse for several weeks) now **re-titrates the within-tier dose from the floor** when the tier returns, instead of resuming at the prior dose. This is slower for an athlete who was genuinely fine throughout an data-outage but is the physiologically correct reading — a suppression means the safety layer could not *prove* tissue readiness, and the ladder titrates proven tissue exposure, not fitness. It is the intended INV-10 behaviour, not an accidental regression. No capability was lost to V2 or V3.

**Not in scope of this pass (flagged for the settings owner, unresolved here):** the audit's Finding 4 (`effectiveSettings.peakMpw` has a floor-only clamp `max(raw, startMpw)`, settings.ts:181, so a module that *auto-writes* `peakMpw` could raise the peak ceiling) and Finding 5 (Part 3 "apply the existing holds" wording implying a write). Part 4 already specifies `peakMpw` as a *proposal surfaced for user/coach confirmation* and Part 3 as remove/downgrade-only, so the spec text does not itself mandate a violating write — but neither is structurally enforced. These were outside the three violations assigned to this repair and are recorded here for the periodization/controller implementation pass.
