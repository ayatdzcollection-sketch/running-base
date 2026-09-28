import { useState } from 'react';
import { AREA_LABEL, QUESTIONS, triage, type Answer, type InjuryArea, type TriageResult } from '../engine/index.ts';
import { api } from '../data/api.ts';
import { useStore } from '../data/store.tsx';
import { go } from '../app/router.ts';
import { Bubble, Icon, NavBar, Progress } from '../ui/kit.tsx';

const SUB: Record<InjuryArea, string> = {
  foot: 'Arch, heel, toes', ankle: 'Back of the ankle', shin: 'Front or inside', knee: 'Front, side, behind',
  thigh: 'Hamstring or quad', hip: 'Front or side', back: 'Or buttock', other: 'Anywhere else',
};
const OUTCOME = {
  run: { title: 'Run as planned', icon: 'check', bg: 'var(--green-t)', iconBg: '#1E8E4E', fg: 'var(--green-d)' },
  easy: { title: 'Run easy and shorter', icon: 'easy', bg: 'var(--amber-t)', iconBg: '#8A6500', fg: 'var(--amber-d)' },
  cross: { title: 'Cross-train today', icon: 'bike', bg: 'var(--blue-t)', iconBg: 'var(--blue)', fg: 'var(--blue-d)' },
  stop: { title: 'Stop. See a trainer or doctor.', icon: 'stop', bg: 'var(--red)', iconBg: 'rgba(255,255,255,0.2)', fg: '#FFE4E0' },
} as const;

export function InjuryCheck() {
  const { uid, today, act } = useStore();
  const [area, setArea] = useState<InjuryArea | null>(null);
  const [picked, setPicked] = useState<InjuryArea>('shin');
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [result, setResult] = useState<TriageResult | null>(null);
  const [pain, setPain] = useState(3);

  const qs = area ? QUESTIONS[area] : [];

  function answer(id: string, v: Answer) {
    const next = { ...answers, [id]: v };
    setAnswers(next);
    if (i + 1 < qs.length) setI(i + 1);
    else setResult(triage(area!, next));
  }

  async function save() {
    if (!area || !result) return;
    const ok = await act(async () => {
      await api.checkIn(uid, { date: today, moment: 'post_run', pain: typeof answers.pain === 'number' ? answers.pain : null, pain_area: area });
      if (result.outcome !== 'run') await api.saveInjury(uid, { area, started_on: today, answers, outcome: result.outcome, likely: result.likely });
    }, result.outcome === 'run' ? 'Saved. Enjoy the run.' : 'Your plan is updated');
    if (ok) go('today');
  }

  if (result && area) {
    const o = OUTCOME[result.outcome];
    const light = result.outcome !== 'stop';
    return (
      <main className="page flow">
        <NavBar title="Injury check" onBack={() => { setResult(null); setI(qs.length - 1); }} />
        <section style={{ background: o.bg, borderRadius: 28, padding: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Bubble icon={o.icon as never} bg={o.iconBg} fg="#FFFFFF" size={48} />
          <span className="eyebrow" style={{ color: light ? o.fg : '#FFE4E0', fontWeight: 700 }}>Today’s answer</span>
          <h1 style={{ fontSize: 32, lineHeight: '36px', fontWeight: 700, letterSpacing: '-0.02em', color: light ? 'var(--ink)' : '#FFFFFF' }}>{o.title}</h1>
          <p style={{ fontSize: 17, lineHeight: '23px', color: light ? 'var(--body2)' : '#FFE4E0' }}>{result.today}</p>
        </section>
        {result.likely && (
          <section className="card pad" style={{ gap: 8 }}>
            <span className="section-title" style={{ padding: 0 }}>Most likely</span>
            <h2 style={{ fontSize: 20, lineHeight: '25px', fontWeight: 700 }}>{result.likely}</h2>
            <p className="body2" style={{ fontSize: 15, lineHeight: '20px' }}>{result.reasons.join('. ')}. Only a doctor or athletic trainer can say for sure.</p>
          </section>
        )}
        <section className="card pad" style={{ gap: 10 }}>
          <div className="hstack" style={{ gap: 8 }}><Icon name="stop" color="var(--red)" /><span style={{ fontSize: 15, fontWeight: 700 }}>See your trainer or a doctor if</span></div>
          <ul className="body2" style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 15, lineHeight: '20px' }}>
            {result.seeSomeoneIf.map(s => <li key={s}>{s}</li>)}
          </ul>
        </section>
        <p className="small" style={{ padding: '0 16px' }}>This is a check-in, not a diagnosis. We’ll ask how it feels each morning.</p>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={save}>{result.outcome === 'run' ? 'Done' : result.outcome === 'stop' ? 'Pause my plan' : 'Update my plan'}</button>
      </main>
    );
  }

  if (!area) return (
    <main className="page flow">
      <NavBar title="Injury check" onBack={() => history.back()} />
      <Progress step={1} total={5} label="Part 1" />
      <div className="stack" style={{ gap: 6, paddingTop: 8 }}>
        <h1 className="h1-flow">Where does it hurt?</h1>
        <p className="lead">A few quick questions. Then we tell you if running today is a good idea.</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
        {(Object.keys(AREA_LABEL) as InjuryArea[]).map(a => (
          <button key={a} className={`opt${picked === a ? ' on' : ''}`} aria-pressed={picked === a} onClick={() => setPicked(a)}
            style={{ textAlign: 'left', padding: 14, minHeight: 72, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, position: 'relative' }}>
            <span style={{ fontSize: 17, fontWeight: 600 }}>{AREA_LABEL[a]}</span><span style={{ fontSize: 13, opacity: 0.7 }}>{SUB[a]}</span>
          </button>
        ))}
      </div>
      <div className="spacer" />
      <button className="btn btn-primary" onClick={() => { setArea(picked); setI(0); setAnswers({}); }}>Next</button>
    </main>
  );

  const q = qs[i];
  return (
    <main className="page flow">
      <NavBar title="Injury check" onBack={() => (i === 0 ? setArea(null) : setI(i - 1))} />
      <Progress step={Math.min(5, 1 + Math.ceil(((i + 1) / qs.length) * 4))} total={5} label={`Question ${i + 1} of ${qs.length}`} />
      <div className="stack" style={{ gap: 10, paddingTop: 8 }}>
        <span className="eyebrow" style={{ fontWeight: 700 }}>{AREA_LABEL[area]} · question {i + 1} of {qs.length}</span>
        <h1 className="h1-flow">{q.text}</h1>
        {q.help && <p className="lead">{q.help}</p>}
      </div>
      {q.type === 'scale' && <>
        <div className="card pad" style={{ alignItems: 'center' }}>
          <span className="num" style={{ fontSize: 64, fontWeight: 700, lineHeight: '64px' }}>{pain}</span>
          <input type="range" min={0} max={10} step={1} value={pain} onChange={e => setPain(Number(e.target.value))} aria-label="Pain from 0 to 10" style={{ width: '100%', accentColor: 'var(--ink)', height: 44 }} />
          <div className="hstack small" style={{ justifyContent: 'space-between', width: '100%' }}><span>0 · nothing</span><span>10 · worst</span></div>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => answer(q.id, pain)}>Next</button>
      </>}
      {q.type === 'yesno' && (
        <div className="stack" style={{ gap: 8 }}>
          {[['Yes', true], ['No', false]].map(([l, v]) => (
            <button key={String(l)} className={`opt${answers[q.id] === v ? ' on' : ''}`} onClick={() => answer(q.id, v as boolean)}
              style={{ minHeight: 60, padding: '0 16px 0 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 17, fontWeight: 600 }}>
              {l as string}<span className="radio">{answers[q.id] === v && <Icon name="check" size={14} stroke={3} />}</span>
            </button>
          ))}
        </div>
      )}
      {q.type === 'choice' && (
        <div className="stack" style={{ gap: 8 }}>
          {q.choices!.map(c => (
            <button key={c.value} className={`opt${answers[q.id] === c.value ? ' on' : ''}`} onClick={() => answer(q.id, c.value)}
              style={{ minHeight: 60, padding: '0 16px 0 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 17, fontWeight: 600 }}>
              {c.label}<span className="radio">{answers[q.id] === c.value && <Icon name="check" size={14} stroke={3} />}</span>
            </button>
          ))}
        </div>
      )}
      <div className="spacer" />
      <p className="small" style={{ textAlign: 'center' }}>Only you can see your answers.</p>
    </main>
  );
}
