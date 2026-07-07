import { useState, useEffect, useCallback, useRef } from 'react';
import type { GlobalState, RunEntry, RunState, SyncStatus } from './lib/types';
import {
  getStoredCode, setStoredCode,
  loadLocal, saveLocal,
  loadGlobalLocal, saveGlobalLocal,
  applySeed, mergeStates, mergeGlobalStates,
  pullFromSupabase, upsertEntry, upsertMany,
  pullGlobalFromSupabase, upsertGlobalToSupabase,
  debounce,
} from './lib/storage';
import { hasSupabase } from './lib/supabase';
import { getPlan, todayStr, PLAN_START_DATE } from './config/plan';
import type { PlanDay } from './lib/types';
import {
  trailing30Longest, nextLongFrom, painFreeStreak,
  flareActive, recentBreach, addDaysStr, pendingMorningCheck,
} from './lib/metrics';
import { morningAnswer } from './lib/subjective';
import AccessCodeModal from './components/AccessCodeModal';
import TodayCard from './components/TodayCard';
import WeekAccordion from './components/WeekAccordion';
import StatsRow from './components/StatsRow';
import AwardTracker from './components/AwardTracker';
import GuardrailPanel from './components/GuardrailPanel';
import ResearchFooter from './components/ResearchFooter';
import BackupRestore from './components/BackupRestore';
import SpeedPlan from './components/SpeedPlan';
import GenerateWeek from './components/GenerateWeek';

const PLAN_END = '2026-08-14';

export default function App() {
  const plan = getPlan();
  const today = todayStr();

  const [accessCode, setAccessCode] = useState<string | null>(getStoredCode);
  const [runState, setRunState] = useState<RunState>(() => applySeed(loadLocal()));
  // v2 global speed-layer state — separate key, additive migration on load.
  const [globals, setGlobals] = useState<GlobalState>(loadGlobalLocal);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');

  const todayDay = plan.dateToDay.get(today) ?? null;
  const todayWeek = plan.dateToWeek.get(today) ?? null;

  // ── Live derived safety metrics (§2, §3) ─────────────────
  // Today's ceiling comes from the 30 days BEFORE today (excludes today's
  // own log, so an over-cap actual reads rose instead of raising its own cap).
  const trailingLongest = trailing30Longest(runState, today, false);
  const nextLong = nextLongFrom(trailingLongest);
  const streak = painFreeStreak(runState, globals.painCap);
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
        const next: GlobalState = { ...prev, ...patch, updated_at: new Date().toISOString() };
        saveGlobalLocal(next);
        if (accessCode && hasSupabase) debouncedGlobalUpsert.current(next, accessCode);
        return next;
      });
    },
    [accessCode],
  );

  // ── Auto-enforcement (§3, §4) ─────────────────────────────
  // 1. Two pain-cap breaches in 7 days → forced state 8 (flare/deload).
  // 2. While hills are unlocked (state ≥ 5): ANY logged hip pain in the
  //    last 7 days locks hills and drops the state to 4 (Yokozawa caution).
  useEffect(() => {
    if (flare && globals.speedState !== 8) {
      updateGlobals({ speedState: 8, painFreeEasyRunStreak: 0 });
      return;
    }
    if (!flare && globals.speedState >= 5 && globals.speedState !== 8) {
      const from = addDaysStr(today, -7);
      const anyHipPain = Object.values(runState).some(
        e => e.date > from && e.date <= today &&
          ((e.painDuring ?? 0) > 0 || (e.painNextAM ?? 0) > 0),
      );
      if (anyHipPain) updateGlobals({ speedState: 4 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flare, globals.speedState, runState, today]);

  // Keep the synced streak snapshot roughly current (display/debug only —
  // the live value is always recomputed from the log).
  useEffect(() => {
    if (globals.painFreeEasyRunStreak !== streak) {
      updateGlobals({ painFreeEasyRunStreak: streak });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streak]);

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
    !hasSupabase ? 'Local only — add Supabase to sync'
    : syncStatus === 'syncing' ? 'Syncing…'
    : syncStatus === 'offline' ? 'Offline — will sync on reconnect'
    : syncStatus === 'error' ? 'Sync error'
    : null;

  return (
    <>
      {!accessCode && <AccessCodeModal onConfirm={handleCodeConfirm} />}

      <div className="min-h-screen bg-ink text-slate-200">
        <div className="max-w-[480px] mx-auto px-4 pb-20 pt-6 space-y-4">

          {/* Header */}
          <header className="flex items-start justify-between mb-2">
            <div>
              <h1 className="font-display text-xl font-semibold text-slate-100 tracking-tight">
                Bulletproof Base
              </h1>
              <p className="text-xs text-slate-600 mt-0.5">
                7-week XC base · {PLAN_START_DATE} → {PLAN_END}
              </p>
            </div>
            <div className="text-right">
              {syncLabel && (
                <p className={`text-[10px] ${
                  !hasSupabase || syncStatus === 'offline' ? 'text-amber-600'
                  : syncStatus === 'error' ? 'text-rose-500'
                  : 'text-slate-600'
                }`}>
                  {syncLabel}
                </p>
              )}
              {accessCode && (
                <p className="text-[10px] text-slate-700 mt-0.5">
                  code: <span className="font-mono">{accessCode}</span>
                </p>
              )}
            </div>
          </header>

          {/* Flare / hold banner — guardrail copy, not a diagnosis */}
          {breach && (
            <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 space-y-1">
              <p className="text-sm text-rose-300 font-display font-semibold">
                Hip flared. Hold this week, don't advance. Tell your PT.
              </p>
              <p className="text-[11px] text-rose-400/70 leading-relaxed">
                {flare
                  ? 'Two pain days inside 7 — speed state forced to 8 (deload). Easy/rest only until it settles.'
                  : `Pain above your ${globals.painCap}/10 cap logged in the last 7 days. One more inside the window triggers a deload.`}
              </p>
            </div>
          )}

          {/* Morning-after check — one tap, only when yesterday logged pain */}
          {morningCheckDate && (
            <MorningCheck
              date={morningCheckDate}
              painDuring={runState[morningCheckDate]?.painDuring ?? 0}
              onAnswer={settled =>
                updateEntry(morningCheckDate, {
                  painNextAM: morningAnswer(settled, runState[morningCheckDate]?.painDuring ?? 0),
                })
              }
            />
          )}

          {/* Today hero */}
          <TodayCard
            today={today}
            day={todayDay}
            week={todayWeek}
            entry={runState[today]}
            onUpdate={updateEntry}
            planStart={plan.bonusDay.date}
            planEnd={PLAN_END}
            nextLong={nextLong}
            trailingLongest={trailingLongest}
            painCap={globals.painCap}
            speedState={globals.speedState}
          />

          {/* Stats row */}
          <StatsRow runState={runState} today={today} nextLong={nextLong} />

          {/* Bonus day + week accordions */}
          <div className="space-y-2">
            <BonusDayCard
              day={plan.bonusDay}
              entry={runState[plan.bonusDay.date]}
              today={today}
              onUpdate={updateEntry}
            />
            {plan.weeks.map(week => (
              <WeekAccordion
                key={week.weekNum}
                week={week}
                runState={runState}
                today={today}
                defaultOpen={week.allDays.some(d => d.date === today)}
                onUpdate={updateEntry}
                painCap={globals.painCap}
                speedState={globals.speedState}
              />
            ))}
          </div>

          {/* v2: speed permission machine + safe future-week generator */}
          <SpeedPlan
            runState={runState}
            globals={globals}
            today={today}
            onUpdateGlobals={updateGlobals}
          />
          <GenerateWeek
            runState={runState}
            globals={globals}
            today={today}
            onUpdateGlobals={updateGlobals}
          />

          <AwardTracker runState={runState} />
          <GuardrailPanel />
          <BackupRestore runState={runState} globals={globals} onRestore={handleRestore} />
          <ResearchFooter />

        </div>
      </div>
    </>
  );
}

// ── Morning-after check ──────────────────────────────────────
// Asks the settle question the morning AFTER a pain day, so painNextAM is
// recorded accurately (and one-tap) instead of predicted at log time.

function MorningCheck({ date, painDuring, onAnswer }: {
  date: string;
  painDuring: number;
  onAnswer: (settled: boolean) => void;
}) {
  const d = new Date(date + 'T12:00:00Z');
  const label = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  return (
    <div className="rounded-xl border border-sky-900/60 bg-sky-950/25 px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-sky-200 font-display">
          Did {label}'s hip settle by morning?
        </p>
        <p className="text-[11px] text-sky-400/60">
          You logged {painDuring}/10 during that run.
        </p>
      </div>
      <button
        onClick={() => onAnswer(true)}
        className="rounded-lg border border-teal-700 px-3 py-1.5 text-xs text-teal-300
                   hover:border-teal-500 transition active:scale-95"
      >
        Yes
      </button>
      <button
        onClick={() => onAnswer(false)}
        className="rounded-lg border border-rose-800 px-3 py-1.5 text-xs text-rose-300
                   hover:border-rose-600 transition active:scale-95"
      >
        No
      </button>
    </div>
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
          : <span className="text-slate-700 text-sm">—</span>}
      </div>
    </div>
  );
}
