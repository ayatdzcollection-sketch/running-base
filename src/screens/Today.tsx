import { useEffect, useRef, useState } from 'react';
import { STAGES, type DayView } from '../engine/index.ts';
import { api } from '../data/api.ts';
import { useStore } from '../data/store.tsx';
import { go } from '../app/router.ts';
import { dayLetter, duration, longDate, mi, pace, shortDay } from '../app/format.ts';
import { BigNum, Bubble, Icon, LargeTitle, Pill, Sheet, Why } from '../ui/kit.tsx';

const CHIP: Record<string, [string, string, string]> = {
  easy: ['Easy run', 'var(--teal-t)', 'var(--teal-d)'], long: ['Long run', 'var(--teal-t)', 'var(--teal-d)'],
  team: ['Team workout', 'var(--orange-t)', 'var(--orange-d)'], meet: ['Meet', 'var(--orange-t)', 'var(--orange-d)'],
  rest: ['Rest day', 'var(--line)', 'var(--body2)'], free: ['Free day', 'var(--line)', 'var(--body2)'],
  comeback: ['Comeback', 'var(--blue-t)', 'var(--blue-d)'], cross: ['Cross-train', 'var(--blue-t)', 'var(--blue-d)'],
  paused: ['Paused', 'var(--red-t)', 'var(--red-d)'],
};

const DONE_LABEL: Record<string, string> = { easy: 'Easy run', long: 'Long run', workout: 'Workout', race: 'Race', other: 'Run' };

function DayCell({ d, today }: { d: DayView; today: string }) {
  const k = d.planned.kind;
  let cls = 'cell', text: string = '';
  if (d.state === 'done') { cls += ' done'; text = mi(d.actualMiles); }
  else if (d.state === 'unknown') { cls += ' unknown'; text = '?'; }
  else if (d.state === 'skipped') { cls += ' skipped'; text = 'Skip'; }
  else if (d.state === 'marked') { cls += ' rest'; text = 'Off'; }
  else if (k === 'meet') { cls += ' meet'; text = 'Meet'; }
  else if (k === 'team') { text = 'Team'; }
  else if (k === 'rest' || k === 'free') { cls += ' rest'; text = k === 'free' ? 'Free' : 'Rest'; }
  else { cls += ' big'; text = mi(d.planned.miles); }
  const label = `${shortDay(d.date)}: ${d.planned.label}${d.planned.miles ? ` ${d.planned.miles} mi` : ''}, ${d.state === 'done' ? `ran ${d.actualMiles} mi` : d.state}`;
  return (
    <div className={`day${d.date === today ? ' today' : ''}`}>
      <span className="d">{dayLetter(d.date)}</span>
      <span className={cls} aria-label={label + (d.planned.override ? ' (changed)' : '')}>{text}{d.planned.override && <span className="chg" />}</span>
    </div>
  );
}

function PostRunSheet({ activityId, onClose }: { activityId: string; onClose: () => void }) {
  const { uid, today, act } = useStore();
  const [rpe, setRpe] = useState<number | null>(null);
  const [team, setTeam] = useState(false);
  const efforts = [[2, '1–2', 'Easy'], [4, '3–4', 'Steady'], [6, '5–6', 'Working'], [8, '7–8', 'Hard'], [10, '9–10', 'All out']] as const;
  async function save(pain: number | null, toInjury = false) {
    const ok = await act(async () => {
      await api.checkIn(uid, { date: today, moment: 'post_run', pain, rpe, activity_id: activityId });
      if (rpe || team) await api.updateRun(uid, activityId, { ...(rpe ? { rpe } : {}), ...(team ? { kind: 'workout' } : {}) });
    }, toInjury ? undefined : 'Saved. Nice work.');
    if (ok) { onClose(); if (toInjury) go('injury'); }
  }
  return (
    <Sheet onClose={onClose} white label="How did it feel?">
      <div className="stack" style={{ gap: 4 }}>
        <h2 style={{ fontSize: 24, lineHeight: '30px', fontWeight: 700 }}>Nice run. How did it feel?</h2>
        <p className="sec" style={{ fontSize: 15 }}>Two taps. This keeps your plan honest.</p>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <span className="stack"><span className="section-title" style={{ padding: 0 }}>How hard was it?</span><span className="small">1 is very easy, 10 is all out.</span></span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 6 }}>
          {efforts.map(([v, n, l]) => (
            <button key={v} className={`opt soft${rpe === v ? ' on' : ''}`} aria-pressed={rpe === v} onClick={() => setRpe(v)} style={{ height: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
              <span className="num" style={{ fontSize: 17, fontWeight: 700 }}>{n}</span><span style={{ fontSize: 12, opacity: 0.75 }}>{l}</span>
            </button>
          ))}
        </div>
      </div>
      <label className="hstack" style={{ justifyContent: 'space-between', minHeight: 44, gap: 12 }}>
        <span className="stack"><span style={{ fontSize: 15, fontWeight: 600 }}>This was a team workout</span><span className="small">Intervals, tempo, or a race</span></span>
        <span className="toggle"><input type="checkbox" aria-label="Team workout" checked={team} onChange={e => setTeam(e.target.checked)} /><span className="track" /><span className="knob" /></span>
      </label>
      <div className="stack" style={{ gap: 10 }}>
        <span className="section-title" style={{ padding: 0 }}>Anything hurting?</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 6 }}>
          <button className="opt on" style={{ height: 52, fontWeight: 600 }} onClick={() => save(0)}>Nope, save</button>
          <button className="opt soft" style={{ height: 52, fontWeight: 600 }} onClick={() => save(null, true)}>A little</button>
          <button className="opt soft" style={{ height: 52, fontWeight: 600 }} onClick={() => save(null, true)}>Yes</button>
        </div>
      </div>
      <button className="btn btn-gray" onClick={onClose}>Skip for now</button>
    </Sheet>
  );
}

export function Today({ onAdd }: { onAdd: (date?: string) => void }) {
  const { snap, loaded, uid, today, act } = useStore();
  const [postRun, setPostRun] = useState<string | null>(null);
  const handled = useRef<string>('');

  // Move the comeback along when the check-ins say so.
  const inj = snap?.injury;
  useEffect(() => {
    if (!inj) return;
    const key = `${inj.injury.id}:${inj.injury.stage}:${inj.shouldAdvance}:${inj.shouldResolve}`;
    if (handled.current === key) return;
    handled.current = key;
    if (inj.shouldResolve) void act(() => api.updateInjury(uid, inj.injury.id, { status: 'resolved' }), 'You’re back to your full plan');
    else if (inj.shouldAdvance) void act(() => api.updateInjury(uid, inj.injury.id, { stage: inj.injury.stage + 1, stage_since: today }), 'Moved up a stage');
  }, [inj, uid, today, act]);

  if (!snap || !loaded) return null;
  const t = snap.todayPlan;
  const doneToday = t.done;
  const checkedIn = loaded.runner.checkins.some(c => c.date === today && c.moment === 'post_run');
  const hasWatch = loaded.tokens.some(k => k.kind === 'shortcut');
  const chip = CHIP[t.kind] ?? CHIP.easy;
  const todayOverride = snap.week.days.find(d => d.date === today)?.planned.override;
  const todayNotes = (loaded.runner.notes ?? []).filter(n => n.date === today);
  const issue = snap.issues.find(i => i.level !== 'info');
  const phaseDot = snap.phase.kind === 'coach' ? 'var(--orange)' : snap.phase.kind === 'break' ? '#8E8E93' : 'var(--teal)';
  const morning = async (pain: number) => act(() => api.checkIn(uid, { date: today, moment: 'morning', pain, pain_area: inj?.injury.area ?? null }), 'Check-in saved');
  const morningDone = loaded.runner.checkins.some(c => c.date === today && c.moment === 'morning');

  return (
    <main className="page">
      <LargeTitle title="Today" eyebrow={longDate(today)} right={
        <button onClick={() => go('you')} aria-label="Your profile and settings" className="btn center" style={{ width: 44, height: 44, borderRadius: 22, background: 'var(--ink)', color: 'var(--card)', fontSize: 17 }}>
          {(loaded.profile.display_name || '?').slice(0, 1).toUpperCase()}
        </button>} />

      <div className="hstack wrap" style={{ gap: 8, rowGap: 0 }}>
        <span className="phase"><span className="dot" style={{ background: phaseDot }} />{snap.phase.label} · Wk {snap.phase.week}</span>

      </div>

      {inj && (
        <section className="card pad">
          <div className="hstack" style={{ justifyContent: 'space-between' }}>
            <span className="hstack" style={{ gap: 8, fontSize: 15, fontWeight: 700 }}><span className="dot" style={{ background: inj.mode === 'paused' ? 'var(--red)' : 'var(--blue)' }} />{inj.headline}</span>
            {inj.stage && <span className="small">Stage {inj.stage.n} of {STAGES.length}</span>}
          </div>
          {inj.stage && <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, minmax(0,1fr))`, gap: 4 }}>
            {STAGES.map(s => <span key={s.n} style={{ height: 8, borderRadius: 4, background: s.n <= inj.stage!.n ? 'var(--blue)' : 'var(--blue-t)' }} />)}
          </div>}
          <p className="small">{inj.detail}</p>
          {inj.mode === 'paused' && <button className="btn btn-tint" onClick={() => act(() => api.updateInjury(uid, inj.injury.id, { cleared_by_clinician: true, stage: 1, stage_since: today }), 'Comeback plan started')}>I’m cleared by my trainer or doctor</button>}
          {inj.mode !== 'paused' && !morningDone && <>
            <span style={{ fontSize: 15, fontWeight: 600 }}>How does it feel this morning? (0–10)</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 6 }}>
              {[[1, '0–1'], [3, '2–3'], [5, '4–6'], [8, '7+']].map(([v, l]) => <button key={l} className="opt soft num" style={{ height: 48, fontWeight: 600 }} onClick={() => morning(v as number)}>{l}</button>)}
            </div>
          </>}
          {inj.mode !== 'paused' && <button className="btn btn-gray" style={{ height: 44 }} onClick={() => confirm('Mark this injury as healed and go back to your full plan?') && act(() => api.updateInjury(uid, inj.injury.id, { status: 'resolved' }), 'Back to your full plan')}>It’s healed</button>}
        </section>
      )}

      <section className="hero">
        <div className="hstack" style={{ justifyContent: 'space-between' }}>
          <span className="chip" style={{ background: doneToday.length ? 'var(--teal-t)' : chip[1], color: doneToday.length ? 'var(--teal-d)' : chip[2] }}>
            {doneToday.length > 0 && <Icon name="check" size={14} stroke={2.6} />}{doneToday.length ? `${DONE_LABEL[doneToday[doneToday.length - 1].kind] ?? 'Run'} · done` : chip[0]}
          </span>
        </div>
        {doneToday.length
          ? <BigNum n={mi(doneToday.reduce((s, a) => s + a.distanceMi, 0))} unit="miles" />
          : t.miles != null ? <BigNum n={mi(t.miles)} unit="miles" /> : t.minutes != null ? <BigNum n={t.minutes} unit="min" /> : <h2 style={{ fontSize: 28, lineHeight: '33px', fontWeight: 700, letterSpacing: '-0.02em' }}>{t.title}</h2>}
        {doneToday.length > 0 && (
          <p className="body2" style={{ fontSize: 15 }}>
            {[duration(doneToday[0].durationS), pace(doneToday[0].distanceMi, doneToday[0].durationS), doneToday[0].avgHr ? `avg HR ${doneToday[0].avgHr}` : null].filter(Boolean).join(' · ') || 'Logged'}
          </p>
        )}
        {!doneToday.length && <p style={{ fontSize: 17, lineHeight: '23px' }}>{t.guidance}</p>}
        {t.why.length > 0 && !doneToday.length && (
          <Why label={t.kind === 'rest' ? 'Why a rest day?' : 'Why this run?'}>
            {t.why.map((w, i) => <p key={i}>{w}</p>)}
            {snap.phase.kind === 'coach' && <p>In season your coach plans the hard days. This app only suggests your easy days and keeps an eye on the total.</p>}
          </Why>
        )}
        {todayOverride && !doneToday.length && (
          <div className="hstack" style={{ gap: 10, padding: '10px 12px', borderRadius: 14, background: 'var(--blue-t)' }}>
            <Icon name={todayOverride.source === 'claude' ? 'spark' : 'pencil'} size={18} color="var(--blue)" />
            <span style={{ flexGrow: 1, fontSize: 14, lineHeight: '19px', color: 'var(--blue-d)' }}>
              Changed {todayOverride.source === 'claude' ? 'by Claude' : 'by you'}{todayOverride.note ? `: ${todayOverride.note}` : ''}. Was {todayOverride.was.kind === 'rest' ? 'rest' : `${todayOverride.was.miles ?? ''} mi ${todayOverride.was.kind}`}.
            </span>
            <Pill kind="cap" onClick={() => act(() => api.resetDay(uid, today), 'Back to the original plan')}>Undo</Pill>
          </div>
        )}
        <div className="divider" />
        {doneToday.length ? (
          <div className="hstack" style={{ gap: 12 }}>
            <Bubble icon="check" bg="var(--teal-t)" fg="var(--teal-d)" />
            <span className="stack" style={{ flexGrow: 1 }}><span style={{ fontSize: 15, fontWeight: 600 }}>{checkedIn ? 'Checked in' : 'How did it go?'}</span><span className="small">{checkedIn ? 'Thanks. See you tomorrow.' : 'Two taps: effort and pain.'}</span></span>
            {!checkedIn && <Pill onClick={() => setPostRun(doneToday[doneToday.length - 1].id)}>Check in</Pill>}
          </div>
        ) : (
          <div className="hstack" style={{ gap: 12 }}>
            <Bubble icon="watch" />
            <span className="stack" style={{ flexGrow: 1, minWidth: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{hasWatch ? 'Waiting for your watch' : 'Ran today?'}</span>
              <span className="small">{hasWatch ? 'Your run appears here when you finish it.' : 'Log it here, or let your watch do it for you.'}</span>
            </span>
            <Pill icon="plus" onClick={() => onAdd(today)}>Add</Pill>
          </div>
        )}
      </section>

      {snap.phase.kind !== 'break' && (
        <section className="card" style={{ padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="stack" style={{ gap: 8 }}>
            <div className="hstack" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h2 className="card-title">This week</h2>
              <span className="sec num" style={{ fontSize: 15 }}>{snap.week.target != null ? `${mi(snap.week.actual)} of about ${Math.round(snap.week.target)} mi` : `${mi(snap.week.actual)} mi so far`}</span>
            </div>
            {snap.week.target != null && (
              <div aria-hidden="true" style={{ height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (snap.week.actual / Math.max(1, snap.week.target)) * 100)}%`, background: 'var(--blue)', borderRadius: 3 }} />
              </div>
            )}
          </div>
          <div className="week">{snap.week.days.map(d => <DayCell key={d.date} d={d} today={today} />)}</div>
          <div className="week-legend" aria-hidden="true">
            <span><i style={{ background: 'var(--blue)' }} />Ran</span>
            <span><i style={{ background: 'var(--bg)', boxShadow: 'inset 0 0 0 1px var(--field)' }} />Planned miles</span>
            <span><i style={{ border: '1.5px dashed var(--unk)' }} />No data yet</span>
            {snap.week.days.some(d => d.planned.override) && <span><i style={{ background: 'var(--blue)', borderRadius: 5, width: 6, height: 6 }} />Changed</span>}
          </div>
          {snap.gap ? <>
            <div className="divider" />
            <div className="hstack" style={{ gap: 10 }}>
              <span className="unk xs" aria-hidden="true">?</span>
              <span className="small" style={{ flexGrow: 1 }}>No data {shortDay(snap.gap.from).split(', ')[1]}–{shortDay(snap.gap.to).split(', ')[1]}. That never shrinks your plan.</span>
              <Pill onClick={() => onAdd(snap.gap!.from)}>Fill in</Pill>
            </div>
          </> : <div style={{ height: 8 }} />}
        </section>
      )}

      {todayNotes.length > 0 && (
        <section className="card pad" style={{ gap: 8 }}>
          <span className="card-title">Today’s note{todayNotes.length > 1 ? 's' : ''}</span>
          {todayNotes.map(n => <p key={n.id} className="note">{n.body}</p>)}
        </section>
      )}

      {issue && (
        <section className="card" style={{ padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Bubble icon={issue.level === 'warn' ? 'stop' : 'info'} bg={issue.level === 'warn' ? 'var(--red-t)' : 'var(--amber-t)'} fg={issue.level === 'warn' ? 'var(--red)' : 'var(--amber-d)'} small />
          <span className="stack" style={{ gap: 2 }}><span className="eyebrow" style={{ fontSize: 11 }}>Heads up</span><span style={{ fontSize: 15, fontWeight: 600 }}>{issue.title}</span><span className="small">{issue.detail}</span></span>
        </section>
      )}

      {!inj && (
        <button className="card row" style={{ padding: '12px 16px', borderRadius: 24 }} onClick={() => go('injury')}>
          <Bubble icon="stop" bg="var(--red-t)" fg="var(--red)" small />
          <span className="grow"><span className="label" style={{ fontWeight: 600 }}>Something hurting?</span><span className="sub">A 1-minute check tells you if running today is OK.</span></span>
          <Icon name="chev" size={16} color="#9C9CA3" stroke={2} />
        </button>
      )}

      {postRun && <PostRunSheet activityId={postRun} onClose={() => setPostRun(null)} />}
    </main>
  );
}
