import { useState, useEffect, useCallback, useRef } from 'react';
import type { RunEntry, RunState, SyncStatus } from './lib/types';
import {
  getStoredCode, setStoredCode,
  loadLocal, saveLocal,
  applySeed, mergeStates,
  pullFromSupabase, upsertEntry, upsertMany,
  debounce,
} from './lib/storage';
import { hasSupabase } from './lib/supabase';
import { getPlan, todayStr, PLAN_START_DATE } from './config/plan';
import type { PlanDay } from './lib/types';
import AccessCodeModal from './components/AccessCodeModal';
import TodayCard from './components/TodayCard';
import WeekAccordion from './components/WeekAccordion';
import StatsRow from './components/StatsRow';
import AwardTracker from './components/AwardTracker';
import GuardrailPanel from './components/GuardrailPanel';
import ResearchFooter from './components/ResearchFooter';
import BackupRestore from './components/BackupRestore';

const PLAN_END = '2026-08-14';

export default function App() {
  const plan = getPlan();
  const today = todayStr();

  const [accessCode, setAccessCode] = useState<string | null>(getStoredCode);
  const [runState, setRunState] = useState<RunState>(() => applySeed(loadLocal()));
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');

  const todayDay = plan.dateToDay.get(today) ?? null;
  const todayWeek = plan.dateToWeek.get(today) ?? null;

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessCode]);

  // ── Debounced network write (stable ref) ─────────────────
  const debouncedUpsert = useRef(
    debounce((entry: RunEntry, code: string) => {
      upsertEntry(entry, code).catch(console.error);
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

  // ── Restore from export ───────────────────────────────────
  const handleRestore = useCallback(
    (imported: RunState) => {
      const merged = mergeStates(runState, Object.values(imported));
      setRunState(merged);
      saveLocal(merged);
      if (accessCode && hasSupabase) {
        upsertMany(Object.values(merged), accessCode).catch(console.error);
      }
    },
    [runState, accessCode],
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

          {/* Today hero */}
          <TodayCard
            today={today}
            day={todayDay}
            week={todayWeek}
            entry={runState[today]}
            onUpdate={updateEntry}
            planStart={plan.bonusDay.date}
            planEnd={PLAN_END}
          />

          {/* Stats row */}
          <StatsRow runState={runState} today={today} />

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
              />
            ))}
          </div>

          <AwardTracker runState={runState} />
          <GuardrailPanel />
          <BackupRestore runState={runState} onRestore={handleRestore} />
          <ResearchFooter />

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
          : <span className="text-slate-700 text-sm">—</span>}
      </div>
    </div>
  );
}
