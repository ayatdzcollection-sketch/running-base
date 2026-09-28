import { useState } from 'react';
import { planWeek, addDays, weekStart, type RunnerData } from '../engine/index.ts';
import { api } from '../data/api.ts';
import { useStore } from '../data/store.tsx';
import { isIOS, isStandalone } from '../app/format.ts';
import { Bubble, Icon, NavBar, Progress, Seg, Toggle } from '../ui/kit.tsx';
import { SeasonEditor, defaultSeason, type DraftSeason } from './Seasons.tsx';

const TOTAL = 6;

function Stepper({ label, value, unit, hint, onChange, step = 1, min = 0, max = 100 }: { label: string; value: number; unit: string; hint: string; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  const b = (s: string, d: number, l: string) => (
    <button aria-label={l} onClick={() => onChange(Math.min(max, Math.max(min, Math.round((value + d) * 2) / 2)))}
      className="btn center" style={{ width: 52, height: 52, borderRadius: 26, background: 'var(--gray-btn)', fontSize: 28, fontWeight: 500 }}>{s}</button>
  );
  return (
    <section className="card pad">
      <span style={{ fontSize: 15, fontWeight: 600 }}>{label}</span>
      <div className="hstack" style={{ justifyContent: 'space-between' }}>
        {b('−', -step, 'Less')}
        <span className="hstack" style={{ alignItems: 'baseline', gap: 6 }}><span className="num" style={{ fontSize: 56, lineHeight: '56px', fontWeight: 700 }}>{value}</span><span style={{ fontSize: 20, fontWeight: 600, color: 'var(--sec)' }}>{unit}</span></span>
        {b('+', step, 'More')}
      </div>
      <span className="small">{hint}</span>
    </section>
  );
}

export function Onboarding() {
  const { loaded, uid, act, today } = useStore();
  const p = loaded!.profile;
  const [step, setStep] = useState(isIOS() && !isStandalone() ? 0 : 1);
  const [birthYear, setBirthYear] = useState<number>(p.birth_year ?? new Date().getFullYear() - 16);
  const [years, setYears] = useState<number>(p.experience_years ?? 1);
  const [mpw, setMpw] = useState<number>(Number(p.start_mpw) || 15);
  const [longest, setLongest] = useState<number>(Number(p.start_longest) || 4);
  const [days, setDays] = useState<number>(p.days_per_week);
  const [longDay, setLongDay] = useState<number>(p.long_run_day);
  const [seasons, setSeasons] = useState<DraftSeason[]>(() => loaded!.seasons.length ? loaded!.seasons.map(s => ({ ...s, on: true })) : [defaultSeason('xc'), defaultSeason('indoor'), defaultSeason('outdoor')]);
  const [hurt, setHurt] = useState(false);

  const next = () => setStep(s => s + 1);
  const back = () => setStep(s => Math.max(0, s - 1));

  const preview = (() => {
    const monday = weekStart(today);
    const d: RunnerData = {
      profile: { displayName: '', daysPerWeek: days, longRunDay: longDay, startMpw: mpw, startLongest: longest, experienceYears: years, planStart: monday },
      seasons: [], meets: [], activities: [], days: [], checkins: [], injuries: [], shoes: [], speedLevel: 0,
    };
    return [0, 1, 2, 3, 4].map(i => planWeek(d, addDays(monday, 7 * i), monday));
  })();

  async function finish() {
    const monday = weekStart(today);
    await act(async () => {
      for (const s of seasons.filter(s => s.on && s.start_date)) {
        await api.saveSeason(uid, { id: s.id, kind: s.kind, label: s.label, start_date: s.start_date, end_date: s.end_date || null, workout_days: s.workout_days });
      }
      for (const s of seasons.filter(s => !s.on && s.id)) await api.deleteSeason(uid, s.id!);
      await api.updateProfile(uid, {
        birth_year: birthYear, experience_years: years, start_mpw: mpw, start_longest: longest, days_per_week: days, long_run_day: longDay,
        plan_start: monday, onboarded: true, settings: { ...p.settings, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      });
    });
    if (hurt) location.hash = '/injury';
  }

  if (step === 0) return (
    <main className="page flow">
      <NavBar title="Setup" />
      <div className="stack" style={{ gap: 6, paddingTop: 8 }}>
        <h1 className="h1-flow">Put it on your Home Screen</h1>
        <p className="lead">It works like an app from there, and you’ll stay signed in.</p>
      </div>
      <section className="card rows">
        {[['Tap Share', <>The <Icon name="share" size={18} color="var(--blue)" /> button at the bottom of Safari.</>],
          ['Tap “Add to Home Screen”', 'Scroll down the list if you don’t see it.'],
          ['Open it from your Home Screen', 'Then finish setup there.']].map(([t, s], i) => (
          <div key={i} className="hstack" style={{ gap: 14, alignItems: 'flex-start', padding: '14px 16px' }}>
            <span className="center" style={{ width: 28, height: 28, borderRadius: 14, background: 'var(--ink)', color: 'var(--card)', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
            <span className="stack" style={{ gap: 4 }}><span style={{ fontWeight: 600 }}>{t}</span><span className="body2" style={{ fontSize: 15, lineHeight: '20px' }}>{s}</span></span>
          </div>
        ))}
      </section>
      <div className="spacer" />
      <button className="btn btn-gray" onClick={next}>Set up here in Safari instead</button>
    </main>
  );

  return (
    <main className="page flow">
      <NavBar title="Setup" onBack={step > 1 ? back : undefined} />
      <Progress step={step} total={TOTAL} label={`Setup step ${step} of ${TOTAL}`} />

      {step === 1 && <>
        <div className="stack" style={{ gap: 6, paddingTop: 8 }}><h1 className="h1-flow">A bit about you</h1><p className="lead">This sets safe limits for your plan.</p></div>
        <Stepper label="Birth year" value={birthYear} unit="" hint="Younger runners build a little more gently." onChange={setBirthYear} min={1990} max={2016} />
        <Stepper label="Years of running" value={years} unit="years" hint="Count seasons on a team or running on your own." onChange={setYears} min={0} max={15} step={0.5} />
      </>}

      {step === 2 && <>
        <div className="stack" style={{ gap: 6, paddingTop: 8 }}><h1 className="h1-flow">How much do you run now?</h1><p className="lead">Think about the last 4 weeks.</p></div>
        <Stepper label="Miles in a normal week" value={mpw} unit="mi / week" hint="Not sure? Guess low. The plan adjusts to what you really run." onChange={setMpw} max={80} />
        <Stepper label="Longest run" value={longest} unit="mi" hint="Your single longest run in the last month." onChange={setLongest} step={0.5} max={25} />
      </>}

      {step === 3 && <>
        <div className="stack" style={{ gap: 6, paddingTop: 8 }}><h1 className="h1-flow">Your week</h1><p className="lead">How many days can you run, and when is your long run?</p></div>
        <section className="card pad">
          <span style={{ fontSize: 15, fontWeight: 600 }}>Run days a week</span>
          <Seg label="Run days a week" value={String(days)} onChange={v => setDays(Number(v))} options={[3, 4, 5, 6, 7].map(n => ({ value: String(n), label: String(n) }))} />
        </section>
        <section className="card pad">
          <span style={{ fontSize: 15, fontWeight: 600 }}>Long run day</span>
          <Seg label="Long run day" value={String(longDay)} onChange={v => setLongDay(Number(v))} options={['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) => ({ value: String(i), label: l }))} />
        </section>
      </>}

      {step === 4 && <>
        <div className="stack" style={{ gap: 6, paddingTop: 8 }}><h1 className="h1-flow">Which seasons do you run?</h1><p className="lead">In season your coach leads. Between seasons the app builds you up for the next one.</p></div>
        <SeasonEditor seasons={seasons} onChange={setSeasons} />
      </>}

      {step === 5 && <>
        <div className="stack" style={{ gap: 6, paddingTop: 8 }}><h1 className="h1-flow">Anything hurting right now?</h1><p className="lead">Be honest. It changes what the plan asks of you.</p></div>
        <section className="card"><label className="formrow"><span>Something hurts</span><Toggle checked={hurt} onChange={setHurt} label="Something hurts" /></label></section>
        {hurt && <p className="small">After setup we’ll do a quick injury check.</p>}
      </>}

      {step === 6 && <>
        <div className="stack" style={{ gap: 6, paddingTop: 8 }}>
          <h1 className="h1-flow">Here’s your start</h1>
          <p className="lead">You said about {mpw} miles a week. We add a little each week, then a lighter week so your body catches up.</p>
        </div>
        <section className="card pad">
          <div className="hstack" style={{ justifyContent: 'space-between' }}><h2 style={{ fontSize: 17, fontWeight: 700 }}>First 5 weeks</h2><span className="small">miles per week</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 10, height: 140, alignItems: 'end' }}>
            {preview.map((w, i) => {
              const max = Math.max(...preview.map(x => x.target ?? 0), 1);
              return (
                <div key={i} className="stack" style={{ alignItems: 'center', gap: 6, justifyContent: 'flex-end', height: '100%' }}>
                  <span className="num" style={{ fontSize: 15, fontWeight: 700 }}>{w.target}</span>
                  <span style={{ width: '100%', height: `${((w.target ?? 0) / max) * 90}px`, borderRadius: '10px 10px 4px 4px', background: w.isDown ? 'var(--teal-t)' : 'var(--teal)' }} />
                  <span className="small">Wk {i + 1}</span>
                </div>
              );
            })}
          </div>
          <p className="small">It keeps adjusting to what you actually run.</p>
        </section>
        <section className="card" style={{ padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <Bubble icon="watch" />
          <span className="stack" style={{ gap: 2 }}><span style={{ fontSize: 15, fontWeight: 600 }}>Next: connect your watch</span><span className="small">So you never have to type a run in.</span></span>
        </section>
      </>}

      <div className="spacer" />
      {step < TOTAL ? <button className="btn btn-primary" onClick={next}>Continue</button>
        : <button className="btn btn-primary" onClick={finish}>Start my plan</button>}
    </main>
  );
}
