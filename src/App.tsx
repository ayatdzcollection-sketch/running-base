import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { GlobalState, PtNote, RaceResult, RawSettings, RunEntry, RunState, Shoe, SyncStatus, WeeklyCheckin as WeeklyCheckinType } from './lib/types';
import {
  getStoredCode, setStoredCode,
  loadLocal, saveLocal,
  loadGlobalLocal, saveGlobalLocal,
  loadSettingsLocal, saveSettingsLocal,
  loadRacesLocal, saveRacesLocal,
  applySeed, mergeStates, mergeGlobalStates,
  pullFromSupabase, upsertEntry, upsertMany,
  pullGlobalFromSupabase, upsertGlobalToSupabase,
  debounce,
} from './lib/storage';
import { hasSupabase } from './lib/supabase';
import { getAward, todayStr, PLAN_START_DATE, HR } from './config/plan';
import { resolveEffectivePlan, planTotalMiles, isOnBreak } from './lib/planOverlay';
import { assessPeakFeasibility } from './lib/feasibility';
import { defaultSettings, effectiveSettings, returnFromBreak } from './lib/settings';
import { FLAGS } from './config/flags';
import { HOME_BLOCKS, DEFAULT_HIDDEN_IDS, blockMeta, type BlockId } from './config/homeBlocks';
import { sanitizeOrder, sanitizeHidden } from './lib/layout';
import type { PlanDay } from './lib/types';
import {
  trailing30Longest, nextLongFrom, painFreeStreak,
  flareActive, recentBreach, addDaysStr, pendingMorningCheck, laterDate,
} from './lib/metrics';
import { morningAnswer } from './lib/subjective';
import { enforceGateConsistency } from './lib/speed';
import { computeTodaySpeed } from './lib/todaySpeed';
import { computeAdaptiveProfile, toModulation } from './lib/adaptive';
import AccessCodeModal from './components/AccessCodeModal';
import AdaptiveInsight from './components/AdaptiveInsight';
import SettingsPanel from './components/SettingsPanel';
import LayoutEditor from './components/LayoutEditor';
import RaceLog from './components/RaceLog';
import TodayCard from './components/TodayCard';
import WeekProgress from './components/WeekProgress';
import HipSpeedStatus from './components/HipSpeedStatus';
import PainLogger from './components/PainLogger';
import WeekAccordion from './components/WeekAccordion';
import AwardTracker from './components/AwardTracker';
import GuardrailPanel from './components/GuardrailPanel';
import ResearchFooter from './components/ResearchFooter';
import BackupRestore from './components/BackupRestore';
import SpeedPlan from './components/SpeedPlan';
import GenerateWeek from './components/GenerateWeek';
import StubCard from './components/StubCard';
import DailyNotes from './components/DailyNotes';
import WeeklyCheckin from './components/WeeklyCheckin';
import ShoeTracker from './components/ShoeTracker';
import CoachNotes from './components/CoachNotes';
import HeatEffort from './components/HeatEffort';

const PLAN_END = '2026-08-14';

/** Replace an item with a matching id, or append it. Used by the shoe store. */
function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex(x => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

export default function App() {
  const today = todayStr();

  const [accessCode, setAccessCode] = useState<string | null>(getStoredCode);
  const [runState, setRunState] = useState<RunState>(() => applySeed(loadLocal()));
  // v2 global speed-layer state — separate key, additive migration on load.
  const [globals, setGlobals] = useState<GlobalState>(() => {
    const g = loadGlobalLocal();
    // Stamp the pain-tracking baseline once, so runs logged before the pain
    // feature don't count as proven pain-free toward speed progression.
    if (g.painTrackingSince == null) {
      const stamped = { ...g, painTrackingSince: todayStr() };
      saveGlobalLocal(stamped);
      return stamped;
    }
    return g;
  });
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // v3: settings drive the plan. null = pure static plan (original behavior).
  const settings = globals.settings ?? null;
  const breakStart = globals.breakStart ?? null;
  const onBreak = isOnBreak(breakStart, today);

  // Individual adaptive profile — personalizes the RATE of progression only
  // (Phase 2A body-response signals: easy-run RPE trend, sub-threshold pain
  // drift, long-run readiness). Downward-only: it may HOLD / REDUCE / DELOAD but
  // never accelerate. Computed BEFORE the plan so its modulation can reshape the
  // visible rolling plan and the feasibility diagnostic — applied to future/
  // UNLOCKED weeks only (locked/completed weeks are generated at identity).
  const adaptiveProfile = FLAGS.ADAPTIVE_ENGINE
    ? computeAdaptiveProfile(runState, globals, today, settings)
    : null;
  const adaptiveMod = adaptiveProfile ? toModulation(adaptiveProfile) : null;
  // Is body-response modulation actually easing the plan right now? (Identity =
  // no change; drives the plain-language "body-response adjustment" explanation.)
  const bodyAdjusted = !!adaptiveMod
    && (adaptiveMod.growthFactor < 1 - 1e-9 || adaptiveMod.holdLong === true);
  // Phase 2C: is earned-trust ACTIVE (the build may use a slightly wider cap)?
  // Mutually exclusive with bodyAdjusted by construction (any easing disables it).
  const earnedTrustActive = !!adaptiveProfile?.earnedTrust.active;

  const { plan } = resolveEffectivePlan(settings, runState, today, { breakStart, modulation: adaptiveMod });
  const award = getAward(settings);
  const blockTotalTarget = planTotalMiles(plan);

  // Effective (safety-clamped) HR band for display.
  const eff = settings ? effectiveSettings(settings, runState, today).eff : null;
  const hrBand = eff ? `${eff.hrEasyMin}–${eff.hrEasyMax}` : `${HR.easyMin}–${HR.easyMax}`;
  const hrHardCap = eff ? eff.hrHardCap : HR.hardCap;

  // Is the peak target safely reachable before XC/maintenance? Diagnostic only —
  // surfaced as a banner so a too-high peak reads as "not reachable" not "broken".
  // The modulation is threaded in so `reachedByPlan` tracks the body-adjusted plan
  // the athlete is actually shown; `maxSafeReachable` stays the UNMODULATED
  // population safety ceiling (the "safe theoretical max").
  const peakFeas = eff ? assessPeakFeasibility(eff, adaptiveMod) : null;
  const pfNeeded = eff ? eff.pfNeeded : 4;

  // Home layout (Stage G). With no settings yet, stubs are hidden by default.
  const layoutOrder = sanitizeOrder(settings?.layoutOrder, HOME_BLOCKS);
  const layoutOff = sanitizeHidden(settings?.layoutOff ?? DEFAULT_HIDDEN_IDS, HOME_BLOCKS);

  const todayDay = plan.dateToDay.get(today) ?? null;
  const todayWeek = plan.dateToWeek.get(today) ?? null;

  // Today's optional speed dose (Stage D) — display-only, low-dose add-on.
  const todaySpeed = FLAGS.TODAY_SPEED
    ? computeTodaySpeed({ runState, globals, today, plan, acceptedWeeks: globals.acceptedWeeks })
    : null;

  // ── Live derived safety metrics (§2, §3) ─────────────────
  // Today's ceiling comes from the 30 days BEFORE today (excludes today's
  // own log, so an over-cap actual reads rose instead of raising its own cap).
  const trailingLongest = trailing30Longest(runState, today, false);
  const nextLong = nextLongFrom(trailingLongest);
  // Readiness streak for the speed gate + its display: counted only since the
  // current state was entered (or pain-tracking start, whichever is later), so
  // the pips reset after each advance and match evaluateReadiness exactly.
  const streak = painFreeStreak(
    runState, globals.painCap, laterDate(globals.painTrackingSince, globals.speedStateSince),
  );
  const flare = flareActive(runState, today, globals.painCap);
  const breach = recentBreach(runState, today, globals.painCap);
  const morningCheckDate = pendingMorningCheck(runState, today);

  // ── Initial Supabase pull on mount / code change ─────────
  useEffect(() => {
    if (!accessCode || !hasSupabase) return;

    setSyncStatus('syncing');
    pullFromSupabase(accessCode)
      .then(remote => {
        setRunState(prev => {
          const merged = mergeStates(prev, remote);
          saveLocal(merged);
          // Push back any locally-newer entries
          const toSync: RunEntry[] = [];
          for (const [date, localEntry] of Object.entries(merged)) {
            const remoteEntry = remote.find(r => r.date === date);
            if (!remoteEntry || localEntry.updated_at > remoteEntry.updated_at) {
              toSync.push(localEntry);
            }
          }
          if (toSync.length > 0) upsertMany(toSync, accessCode).catch(console.error);
          return merged;
        });
        setSyncStatus('idle');
      })
      .catch(err => {
        console.warn('Supabase pull failed (offline?):', err);
        setSyncStatus('offline');
      });

    // Global state: field-aware merge, so a newer remote speed-layer blob can't
    // clobber locally-newer settings/races/acceptedWeeks. Push the union back.
    pullGlobalFromSupabase(accessCode)
      .then(remote => {
        if (!remote) return;
        setGlobals(prev => {
          const merged = mergeGlobalStates(prev, remote);
          saveGlobalLocal(merged);
          // Non-destructive: pushing the merged union back is idempotent and
          // ensures the server ends up with both devices' data.
          upsertGlobalToSupabase(merged, accessCode).catch(console.error);
          return merged;
        });
      })
      .catch(err => console.warn('Global state pull failed:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessCode]);

  // ── Debounced network writes (stable refs) ───────────────
  const debouncedUpsert = useRef(
    debounce((entry: RunEntry, code: string) => {
      upsertEntry(entry, code).catch(console.error);
    }, 1500),
  );
  const debouncedGlobalUpsert = useRef(
    debounce((state: GlobalState, code: string) => {
      upsertGlobalToSupabase(state, code).catch(console.error);
    }, 1500),
  );

  // ── Update single entry ───────────────────────────────────
  const updateEntry = useCallback(
    (date: string, updates: Partial<RunEntry>) => {
      setRunState(prev => {
        const now = new Date().toISOString();
        const existing = prev[date] ?? { date, done: false, miles_actual: null, updated_at: now };
        const next: RunEntry = { ...existing, ...updates, updated_at: now };
        const nextState = { ...prev, [date]: next };
        saveLocal(nextState);
        if (accessCode && hasSupabase) debouncedUpsert.current(next, accessCode);
        return nextState;
      });
    },
    [accessCode],
  );

  // ── Update global state (partial, additive) ───────────────
  const updateGlobals = useCallback(
    (patch: Partial<GlobalState>) => {
      setGlobals(prev => {
        // Stamp speedStateSince whenever the speed state actually changes, so the
        // readiness streak re-accumulates from fresh pain-free runs at the new
        // state (one long streak can't cascade up the whole ladder). A caller
        // that sets speedStateSince itself wins.
        const stateChanged =
          patch.speedState != null && patch.speedState !== prev.speedState
          && patch.speedStateSince === undefined;
        const next: GlobalState = {
          ...prev, ...patch,
          ...(stateChanged ? { speedStateSince: today } : {}),
          updated_at: new Date().toISOString(),
        };
        saveGlobalLocal(next);
        if (accessCode && hasSupabase) debouncedGlobalUpsert.current(next, accessCode);
        return next;
      });
    },
    [accessCode, today],
  );

  // ── Settings (v3) — canonical copy in globals.settings, bb_settings mirror ──
  const updateSettings = useCallback(
    (patch: Partial<RawSettings>) => {
      setGlobals(prev => {
        const base = prev.settings ?? defaultSettings(new Date().toISOString());
        const nextSettings: RawSettings = { ...base, ...patch, updated_at: new Date().toISOString() };
        saveSettingsLocal(nextSettings);
        const next: GlobalState = { ...prev, settings: nextSettings, updated_at: new Date().toISOString() };
        saveGlobalLocal(next);
        if (accessCode && hasSupabase) debouncedGlobalUpsert.current(next, accessCode);
        return next;
      });
    },
    [accessCode],
  );

  const saveLayout = useCallback(
    (order: BlockId[], off: BlockId[]) => updateSettings({ layoutOrder: order, layoutOff: off }),
    [updateSettings],
  );

  // "Rebuild upcoming plan": discard any confirmed draft future weeks and
  // re-materialize settings so the future regenerates cleanly. Completed weeks
  // stay locked and logged runs are never touched (both handled downstream).
  const handleFullReset = useCallback(() => {
    setGlobals(prev => {
      const base = prev.settings ?? defaultSettings(new Date().toISOString());
      const nextSettings: RawSettings = { ...base, updated_at: new Date().toISOString() };
      saveSettingsLocal(nextSettings);
      const next: GlobalState = {
        ...prev, settings: nextSettings, acceptedWeeks: {}, updated_at: new Date().toISOString(),
      };
      saveGlobalLocal(next);
      if (accessCode && hasSupabase) debouncedGlobalUpsert.current(next, accessCode);
      return next;
    });
    setSettingsOpen(false);
  }, [accessCode]);

  // Start break: pause the rolling plan (end of season, injury, time off).
  // NOTHING is reseeded here — settings and history are untouched. The plan
  // simply stops projecting future weeks until Return-from-break is used. The
  // returning flow is where the length-aware reseed happens.
  const handleStartBreak = useCallback(() => {
    setGlobals(prev => {
      const nowIso = new Date().toISOString();
      const next: GlobalState = {
        ...prev,
        breakStart: today,
        acceptedWeeks: {},              // future drafts belong to before the break
        updated_at: nowIso,
      };
      saveGlobalLocal(next);
      if (accessCode && hasSupabase) debouncedGlobalUpsert.current(next, accessCode);
      return next;
    });
    setSettingsOpen(false);
  }, [today, accessCode]);

  // Return from break: length-aware conservative reseed. Runs `returnFromBreak`
  // to shape the plan (startMpw scaled by break length; startDate = next Monday
  // from today). For breaks ≥ ~3 weeks, also reset the speed layer so intensity
  // is re-earned; for shorter breaks the speed state persists. Logged runs are
  // NEVER deleted and completed weeks are never rewritten.
  const handleReturnFromBreak = useCallback(() => {
    setGlobals(prev => {
      if (!prev.breakStart) return prev;
      const nowIso = new Date().toISOString();
      const { settings: nextSettings, breakDays } = returnFromBreak(
        prev.settings ?? null, runState, today, prev.breakStart, nowIso,
      );
      saveSettingsLocal(nextSettings);
      const longBreak = breakDays >= 21;
      const next: GlobalState = {
        ...prev,
        settings: nextSettings,
        breakStart: null,
        ...(longBreak ? {
          speedState: 1 as const,          // speed re-earned after a real detraining break
          speedStateSince: today,          // reset the readiness streak baseline too
          hipSafeFlag: false,
          ptClearedSpeed: false,
          ptClearedIntensity: false,
          delayUntil: null,
          lastFastSessionDate: null,
          lastLongRunDate: null,
          painFreeEasyRunStreak: 0,
        } : {}),
        acceptedWeeks: {},                 // stale drafts belong to before the break
        updated_at: nowIso,
      };
      saveGlobalLocal(next);
      if (accessCode && hasSupabase) debouncedGlobalUpsert.current(next, accessCode);
      return next;
    });
    setSettingsOpen(false);
  }, [runState, today, accessCode]);

  // Races (v3) — canonical copy in globals.races, bb_races mirror.
  const races = globals.races ?? [];
  const updateRaces = useCallback(
    (next: RaceResult[]) => {
      setGlobals(prev => {
        saveRacesLocal(next);
        const g: GlobalState = { ...prev, races: next, updated_at: new Date().toISOString() };
        saveGlobalLocal(g);
        if (accessCode && hasSupabase) debouncedGlobalUpsert.current(g, accessCode);
        return g;
      });
    },
    [accessCode],
  );

  // ── v4 secondary widget stores (notes / check-ins / shoes / PT log) ──
  // Each is a plain additive GlobalState field, persisted and synced through
  // updateGlobals. NONE is ever read by a gate, cap, or the speed ladder.
  const notes = globals.notes ?? {};
  const checkins = globals.checkins ?? {};
  const shoes = globals.shoes ?? [];
  const ptNotes = globals.ptNotes ?? [];

  // One-time adoption of bb_settings / bb_races mirrors (e.g. from the design
  // prototype) when globals has none yet — additive, never overwrites existing.
  useEffect(() => {
    if (globals.settings == null) {
      const mirror = loadSettingsLocal();
      if (mirror) updateSettings(mirror);
    }
    if ((globals.races ?? []).length === 0) {
      const mirror = loadRacesLocal();
      if (mirror.length) updateRaces(mirror);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-enforcement (§3, §4) ─────────────────────────────
  // Priority order, single effect to avoid render loops:
  //  1. Two pain-cap breaches in 7 days → forced state 8 (flare/deload) — wins.
  //  2. A clearance revoked under the current state → downgrade to the safe
  //     pre-gate state (hills need hip-safe + PT speed; structured needs PT
  //     intensity).
  //  3. While hills are unlocked (state ≥ 5): ANY logged hip pain in the last
  //     7 days locks hills and drops the state to 4 (Yokozawa caution).
  useEffect(() => {
    if (flare && globals.speedState !== 8) {
      updateGlobals({ speedState: 8, painFreeEasyRunStreak: 0 });
      return;
    }
    if (flare) return;
    const gatePatch = enforceGateConsistency(globals);
    if (gatePatch) {
      updateGlobals(gatePatch);
      return;
    }
    if (globals.speedState >= 5) {
      const from = addDaysStr(today, -7);
      const anyHipPain = Object.values(runState).some(
        e => e.date > from && e.date <= today &&
          ((e.painDuring ?? 0) > 0 || (e.painNextAM ?? 0) > 0),
      );
      if (anyHipPain) updateGlobals({ speedState: 4 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flare, globals.speedState, globals.hipSafeFlag, globals.ptClearedSpeed, globals.ptClearedIntensity, runState, today]);

  // Keep the synced streak snapshot roughly current (display/debug only —
  // the live value is always recomputed from the log).
  useEffect(() => {
    if (globals.painFreeEasyRunStreak !== streak) {
      updateGlobals({ painFreeEasyRunStreak: streak });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streak]);

  // Maintain lastLongRunDate / lastFastSessionDate from the plan + log. These
  // feed the 48h long-run spacing used by the generator; previously unwritten.
  useEffect(() => {
    let lastLong: string | null = null;
    let lastFast: string | null = null;
    const acc = globals.acceptedWeeks ?? {};
    const accByDate = new Map<string, string>(); // date → kind
    for (const days of Object.values(acc)) for (const d of days) accByDate.set(d.date, d.kind);
    for (const [date, e] of Object.entries(runState)) {
      if (date > today || !(e.done || e.miles_actual != null)) continue;
      const planDay = plan.dateToDay.get(date);
      const kind = accByDate.get(date);
      const isLong = kind === 'long' || (!kind && planDay?.isLongRun);
      const isFast = kind === 'threshold';
      if (isLong && (!lastLong || date > lastLong)) lastLong = date;
      if (isFast && (!lastFast || date > lastFast)) lastFast = date;
    }
    const patch: Partial<GlobalState> = {};
    if (lastLong && lastLong !== globals.lastLongRunDate) patch.lastLongRunDate = lastLong;
    if (lastFast && lastFast !== globals.lastFastSessionDate) patch.lastFastSessionDate = lastFast;
    if (Object.keys(patch).length) updateGlobals(patch);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runState, today]);

  // ── Restore from export (v1 or v2 backup) ─────────────────
  const handleRestore = useCallback(
    (imported: RunState, importedGlobals: GlobalState | null) => {
      const merged = mergeStates(runState, Object.values(imported));
      setRunState(merged);
      saveLocal(merged);
      if (accessCode && hasSupabase) {
        upsertMany(Object.values(merged), accessCode).catch(console.error);
      }
      if (importedGlobals && importedGlobals.updated_at > globals.updated_at) {
        setGlobals(importedGlobals);
        saveGlobalLocal(importedGlobals);
        if (accessCode && hasSupabase) {
          upsertGlobalToSupabase(importedGlobals, accessCode).catch(console.error);
        }
      }
    },
    [runState, globals, accessCode],
  );

  function handleCodeConfirm(code: string) {
    setStoredCode(code);
    setAccessCode(code);
  }

  const syncLabel =
    !hasSupabase ? 'local only'
    : syncStatus === 'syncing' ? 'syncing…'
    : syncStatus === 'offline' ? 'offline, will sync'
    : syncStatus === 'error' ? 'sync error'
    : 'synced';
  const syncTone =
    !hasSupabase || syncStatus === 'offline' ? 'text-amber-600'
    : syncStatus === 'error' ? 'text-rose-500' : 'text-slate-600';

  // Day-of-block label for the header subtitle.
  let dayIdx = 0;
  for (const d of plan.allDates) if (d <= today) dayIdx++;
  const isPre = today < plan.bonusDay.date;
  const isPost = today > PLAN_END;
  const dayOfBlock = isPost ? 'plan complete' : isPre ? 'starts soon' : `day ${dayIdx}`;
  // Training phase — the rolling plan is continuous. Break wins over XC/season.
  const inXcSeason = !!settings && !!settings.xcStartDate && today >= settings.xcStartDate;
  const phaseLabel =
    onBreak ? 'on break'
    : inXcSeason ? 'XC season · maintain'
    : 'base building';
  const phaseTone =
    onBreak ? 'text-teal-400'
    : inXcSeason ? 'text-teal-400'
    : 'text-slate-400';

  function renderBlock(id: BlockId): ReactNode {
    const meta = blockMeta(id);
    if (!meta) return null;
    if (!meta.real) return <StubCard meta={meta} />;
    switch (id) {
      case 'today':
        return (
          <TodayCard
            today={today} day={todayDay} week={todayWeek} entry={runState[today]}
            onUpdate={updateEntry} planStart={plan.bonusDay.date} planEnd={PLAN_END}
            nextLong={nextLong} trailingLongest={trailingLongest}
            hrBand={hrBand} hrHardCap={hrHardCap} todaySpeed={todaySpeed}
          />
        );
      case 'week':
        return <WeekProgress runState={runState} plan={plan} today={today} week={todayWeek} blockTotalTarget={blockTotalTarget} />;
      case 'hipspeed':
        return <HipSpeedStatus speedState={globals.speedState} hipHold={flare || breach} flare={flare} streak={streak} pfNeeded={pfNeeded} />;
      case 'adaptive':
        return adaptiveProfile ? <AdaptiveInsight profile={adaptiveProfile} /> : null;
      case 'pain':
        return (
          <PainLogger
            today={today} entry={runState[today]} painCap={globals.painCap} speedState={globals.speedState}
            onUpdate={updateEntry}
            morningCheckDate={morningCheckDate}
            morningPainDuring={morningCheckDate ? (runState[morningCheckDate]?.painDuring ?? 0) : 0}
            onMorningAnswer={settled => {
              if (!morningCheckDate) return;
              // Never overwrite an already-answered morning value.
              if (runState[morningCheckDate]?.painNextAM != null) return;
              updateEntry(morningCheckDate, { painNextAM: morningAnswer(settled, runState[morningCheckDate]?.painDuring ?? 0) });
            }}
          />
        );
      case 'speed':
        return <SpeedPlan runState={runState} globals={globals} today={today} onUpdateGlobals={updateGlobals} />;
      case 'weeks':
        return (
          <div className="space-y-2">
            <BonusDayCard day={plan.bonusDay} entry={runState[plan.bonusDay.date]} today={today} onUpdate={updateEntry} />
            {plan.weeks.map(week => (
              <WeekAccordion
                key={week.weekNum} week={week} runState={runState} today={today}
                defaultOpen={week.allDays.some(d => d.date === today)}
                onUpdate={updateEntry} painCap={globals.painCap} speedState={globals.speedState}
              />
            ))}
          </div>
        );
      case 'nextweek':
        return <GenerateWeek runState={runState} globals={globals} today={today} settings={settings} adaptive={adaptiveMod} onUpdateGlobals={updateGlobals} />;
      case 'races':
        return FLAGS.RACE_LOG ? (
          <RaceLog
            races={races} adaptive={settings?.adaptive ?? true}
            onSaveRace={r => updateRaces([...races, r])}
            onDeleteRace={id => updateRaces(races.filter(r => r.id !== id))}
            onSetAdaptive={v => updateSettings({ adaptive: v })}
          />
        ) : null;
      case 'guardrails':
        return <GuardrailPanel capPct={eff ? eff.capPct : 110} hrBand={hrBand} hrHardCap={hrHardCap} />;
      case 'award':
        return <AwardTracker runState={runState} plan={plan} award={award} />;
      case 'backup':
        return <BackupRestore runState={runState} globals={globals} onRestore={handleRestore} />;
      case 'evidence':
        return <ResearchFooter hrBand={hrBand} hrMax={eff ? eff.hrMax : HR.hrmax} />;
      // ── v4 secondary widgets — real, but the flag stays a kill switch ──
      case 'notes':
        return FLAGS.dailyNotes ? (
          <DailyNotes
            notes={notes} today={today}
            onSave={(date, text) => updateGlobals({ notes: { ...notes, [date]: text } })}
            onDelete={date => { const n = { ...notes }; delete n[date]; updateGlobals({ notes: n }); }}
          />
        ) : <StubCard meta={meta} />;
      case 'checkin':
        return FLAGS.weeklyCheckin ? (
          <WeeklyCheckin
            checkins={checkins} today={today}
            onSave={(c: WeeklyCheckinType) => updateGlobals({ checkins: { ...checkins, [c.weekStart]: c } })}
          />
        ) : <StubCard meta={meta} />;
      case 'shoes':
        return FLAGS.shoeMileage ? (
          <ShoeTracker
            shoes={shoes} runState={runState} today={today}
            onSave={(s: Shoe) => updateGlobals({ shoes: upsertById(shoes, s) })}
            onDelete={id => updateGlobals({ shoes: shoes.filter(s => s.id !== id) })}
          />
        ) : <StubCard meta={meta} />;
      case 'coach':
        return FLAGS.coachThread ? (
          <CoachNotes
            notes={ptNotes} today={today}
            onAdd={(n: PtNote) => updateGlobals({ ptNotes: [n, ...ptNotes] })}
            onDelete={id => updateGlobals({ ptNotes: ptNotes.filter(n => n.id !== id) })}
          />
        ) : <StubCard meta={meta} />;
      case 'weather':
        return FLAGS.heatEffort ? <HeatEffort /> : <StubCard meta={meta} />;
      default:
        return null;
    }
  }

  const visibleOrder = layoutOrder.filter(id => !layoutOff.includes(id));

  return (
    <>
      {!accessCode && <AccessCodeModal onConfirm={handleCodeConfirm} />}

      {FLAGS.SETTINGS_UI && settingsOpen && (
        <SettingsPanel
          raw={settings ?? defaultSettings(new Date().toISOString())}
          runState={runState}
          today={today}
          breakStart={breakStart}
          onChange={updateSettings}
          onFullReset={handleFullReset}
          onStartBreak={handleStartBreak}
          onReturnFromBreak={handleReturnFromBreak}
          onClose={() => setSettingsOpen(false)}
          layoutSection={
            <LayoutEditor
              layoutOrder={settings?.layoutOrder}
              layoutOff={settings?.layoutOff ?? DEFAULT_HIDDEN_IDS}
              onChange={saveLayout}
            />
          }
        />
      )}

      <div className="min-h-screen bg-ink text-slate-200 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-[480px] mx-auto px-3 sm:px-4 pb-16 pt-[22px] flex flex-col gap-3.5">

          {/* Header (pinned) */}
          <header className="flex flex-col gap-[5px] px-1 pb-1">
            <div className="flex items-center justify-between gap-3">
              <h1 className="font-display text-[22px] font-bold tracking-tight text-slate-100">Bulletproof Base</h1>
              <div className="flex items-center gap-2.5">
                {accessCode && (
                  <span className="font-display text-[10.5px] font-semibold tracking-[0.14em] text-slate-500">
                    CODE {accessCode.toUpperCase()}
                  </span>
                )}
                {FLAGS.SETTINGS_UI && (
                  <button
                    onClick={() => setSettingsOpen(true)} aria-label="Settings"
                    className="shrink-0 grid place-items-center w-8 h-8 rounded-[9px] border border-border text-slate-400 hover:text-slate-200 hover:border-slate-600 transition"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs text-slate-500">
                rolling XC plan · {PLAN_START_DATE} · <span className="text-slate-400">{dayOfBlock}</span> · <span className={phaseTone}>{phaseLabel}</span>
              </p>
              <span className={`text-[10.5px] whitespace-nowrap ${syncTone}`}>{syncLabel}</span>
            </div>
          </header>

          {/* Break banner — wins over flare/breach visually; plan is paused. */}
          {onBreak && (
            <div className="rounded-2xl border border-teal-500/30 bg-teal-500/[0.08] px-4 py-3.5 flex flex-col gap-[5px]">
              <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-teal-300">ON BREAK · PLAN PAUSED</span>
              <p className="m-0 text-[13px] leading-relaxed text-slate-200">
                Break started <span className="font-mono text-slate-300">{breakStart}</span>. No future weeks are being projected. Open Settings and hit <em>Return from break</em> when you're back — the plan will re-seed conservatively based on how long you've been off.
              </p>
            </div>
          )}

          {/* Flare / breach banner (pinned) — two-tone: rose flare, amber single breach.
              Suppressed during a break: the plan is already paused. */}
          {onBreak ? null : flare ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.08] px-4 py-3.5 flex flex-col gap-[5px]">
              <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-rose-400">FLARE · DELOAD ACTIVE</span>
              <p className="m-0 text-[13px] leading-relaxed text-slate-200">
                We've eased your plan to protect your hip. This is normal. This week repeats at reduced volume. Check in with your PT.
              </p>
            </div>
          ) : breach ? (
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3.5 flex flex-col gap-[5px]">
              <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-amber-400">ONE PAIN DAY LOGGED</span>
              <p className="m-0 text-[13px] leading-relaxed text-slate-300">
                Hold this week rather than advance. One more pain day above your {globals.painCap}/10 cap inside 7 days eases the plan into a deload. Tell your PT.
              </p>
            </div>
          ) : null}

          {/* Body-response adjustment — plain-language why the future weeks are
              easing/holding. Only shows when the modulation actually changes the
              plan (bodyAdjusted). Suppressed during break/flare/breach, which have
              their own stronger banners (a real pain breach outranks this drift). */}
          {!onBreak && !flare && !breach && bodyAdjusted && adaptiveProfile && (
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3.5 flex flex-col gap-[6px]">
              <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-amber-300">BODY-RESPONSE ADJUSTMENT</span>
              <p className="m-0 text-[13px] leading-relaxed text-slate-300">
                Your recent signals have eased the upcoming weeks. This only ever holds or reduces the plan — it never raises a cap or pushes past your normal safe rate.
              </p>
              <ul className="m-0 mt-0.5 pl-4 flex flex-col gap-[3px] list-disc marker:text-amber-500/60">
                {adaptiveProfile.reasons
                  .filter(r => !/full safe rate/i.test(r))
                  .map((r, i) => (
                    <li key={i} className="text-[12.5px] leading-snug text-slate-400">{r}</li>
                  ))}
              </ul>
            </div>
          )}

          {/* Earned-trust active banner — calm, confidence-framed (Phase 2C). Only
              shows when the wider cap is genuinely in play. Suppressed during
              break/flare/breach (which disable earned-trust anyway) and never
              coexists with the body-response banner (mutually exclusive). */}
          {!onBreak && !flare && !breach && earnedTrustActive && adaptiveProfile && (
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] px-4 py-3.5 flex flex-col gap-[5px]">
              <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-emerald-300">EARNED-TRUST ACTIVE</span>
              <p className="m-0 text-[13px] leading-relaxed text-slate-300">
                Recent training has been clean — {adaptiveProfile.earnedTrust.cleanWeeks} clean weeks with strong
                adherence, steady effort, and good recovery — so the build can use a slightly wider weekly cap
                (+{Math.round((adaptiveProfile.earnedTrust.growthMax - 1) * 100)}% vs the usual +10%). Still capped
                by the long-run, pain, recovery, and peak rules, and it pauses instantly if any of those signals worsen.
              </p>
            </div>
          )}

          {/* Peak-not-reachable banner — makes a too-high peak read as "not
              reachable before XC", not "broken". Paused during a break/flare. */}
          {!onBreak && !flare && peakFeas && !peakFeas.feasible && (
            <button
              onClick={() => FLAGS.SETTINGS_UI && setSettingsOpen(true)}
              className="text-left rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3.5 flex flex-col gap-[5px] hover:border-amber-500/40 transition"
            >
              <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-amber-400">PEAK NOT REACHABLE BEFORE XC</span>
              <p className="m-0 text-[13px] leading-relaxed text-slate-300">
                Peak {peakFeas.targetPeak} mi can't be safely reached by {peakFeas.boundaryDate}.{' '}
                {bodyAdjusted
                  ? `Your current body-adjusted plan builds to ~${peakFeas.reachedByPlan} mi; the safe theoretical max before then (ignoring today's body signals) is ~${peakFeas.maxSafeReachable} mi.`
                  : `The plan builds to ~${peakFeas.reachedByPlan} mi (safe max ~${peakFeas.maxSafeReachable} mi).`}
                {' '}It then maintains — it won't break any safety cap to force the number.
                {peakFeas.daysRoute
                  ? ` Adding a ${peakFeas.daysRoute.toDays}${peakFeas.daysRoute.feasible ? 'th day could reach it' : `th day could raise the safe max to ~${peakFeas.daysRoute.reachable} mi`}. Tap to adjust.`
                  : ' Tap to adjust in Settings.'}
              </p>
              {/* Phase 2C: whether the earned (wider) cap could close the gap. */}
              {peakFeas.earnedNote && (
                <p className="m-0 mt-0.5 text-[12px] leading-relaxed text-emerald-300/80">
                  {peakFeas.earnedNote}
                </p>
              )}
            </button>
          )}

          {/* Reorderable blocks — DOM order == stored order == visual order */}
          {visibleOrder.map(id => (
            <div key={id}>{renderBlock(id)}</div>
          ))}

        </div>
      </div>
    </>
  );
}

// ── Bonus day mini-card ──────────────────────────────────────

interface BonusProps {
  day: PlanDay;
  entry: RunEntry | undefined;
  today: string;
  onUpdate: (date: string, updates: Partial<RunEntry>) => void;
}

function BonusDayCard({ day, entry, today, onUpdate }: BonusProps) {
  const [localMiles, setLocalMiles] = useState(
    entry?.miles_actual != null ? String(entry.miles_actual) : '',
  );
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setLocalMiles(entry?.miles_actual != null ? String(entry.miles_actual) : '');
    }
  }, [entry?.miles_actual, focused]);

  const done = !!entry?.done;
  const effective = entry?.miles_actual ?? (done ? 3 : null);

  return (
    <div className={`card flex items-center gap-3 px-4 py-3
      ${today === day.date ? 'ring-1 ring-teal-800/40' : ''}`}>
      <button
        onClick={() => onUpdate(day.date, { done: !done })}
        aria-label={done ? 'Mark undone' : 'Mark done'}
        className={`w-8 h-8 rounded-full border flex items-center justify-center
                    text-sm transition-all active:scale-90 shrink-0
                    ${done
                      ? 'border-teal-500 bg-teal-500/20 text-teal-400'
                      : 'border-border text-slate-700 hover:border-slate-500'}`}
      >
        {done && '✓'}
      </button>

      <div className="flex-1 min-w-0">
        <p className="font-display text-sm text-slate-400">
          Fri Jun 26
          <span className="tag tag-sky ml-2">bonus</span>
        </p>
        <p className="text-xs text-slate-600">Optional · no prescription</p>
      </div>

      <div className="w-24 shrink-0">
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          max="20"
          value={localMiles}
          onChange={e => setLocalMiles(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            const num = parseFloat(localMiles);
            onUpdate(day.date, { miles_actual: isNaN(num) ? null : Math.max(0, num) });
          }}
          placeholder="actual"
          className="w-full bg-ink border border-border rounded px-2 py-1.5
                     text-xs text-slate-300 font-display tabular-nums text-right
                     placeholder:text-slate-700 outline-none
                     focus:border-teal-500/50 transition"
        />
      </div>

      <div className="w-12 text-right shrink-0">
        {effective != null
          ? <span className="font-display text-sm tabular-nums text-teal-400">{Number(effective).toFixed(1)}</span>
          : <span className="text-slate-700 text-sm">–</span>}
      </div>
    </div>
  );
}
