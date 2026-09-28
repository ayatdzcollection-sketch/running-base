import { LEVELS, STAGES, daysBetween } from '../engine/index.ts';
import { api } from '../data/api.ts';
import { useStore } from '../data/store.tsx';
import { go } from '../app/router.ts';
import { monthShort, shortDay } from '../app/format.ts';
import { Icon, LargeTitle, Section, Why } from '../ui/kit.tsx';

export function Plan() {
  const { snap, loaded, uid, today, act } = useStore();
  if (!snap || !loaded) return null;
  const y = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) >= 7 ? 0 : 1);
  const from = `${y}-07-01`, to = `${y + 1}-06-30`;
  const span = daysBetween(from, to);
  const pos = (d: string) => Math.max(0, Math.min(100, (daysBetween(from, d) / span) * 100));
  const seasons = loaded.runner.seasons.filter(s => (s.endDate ?? '9999') >= from && s.startDate <= to);
  const openSeason = seasons.find(s => !s.endDate && s.startDate <= today);
  const sp = snap.speed;

  return (
    <main className="page">
      <LargeTitle title="Plan" right={<button className="btn btn-cap" onClick={() => go('seasons')}>Seasons</button>} />

      <Section title="Your year" hint="Orange is a school season: your coach leads. Green is between seasons: the app builds you up. The line is today.">
      <section className="card pad">
        <span className="small">Jul {y} → Jun {y + 1}</span>
        <div role="img" aria-label="Seasons across the school year" style={{ position: 'relative', height: 30, borderRadius: 9, background: 'var(--teal-t)' }}>
          {seasons.map(s => {
            const a = pos(s.startDate);
            const b = s.endDate ? pos(s.endDate) : Math.min(100, pos(today) + 14);
            const future = s.startDate > today;
            return <span key={s.id} style={{
              position: 'absolute', top: 0, bottom: 0, left: `${a}%`, width: `${Math.max(2, b - a)}%`, borderRadius: 6,
              background: future ? 'repeating-linear-gradient(135deg, var(--orange-t) 0 6px, transparent 6px 10px)' : s.endDate ? 'var(--orange)' : 'linear-gradient(to right, var(--orange) 70%, transparent)',
              boxShadow: future ? 'inset 0 0 0 1.5px var(--orange)' : undefined,
            }} />;
          })}
          <span aria-hidden="true" style={{ position: 'absolute', left: `calc(${pos(today)}% - 1.5px)`, top: -6, bottom: -6, width: 3, borderRadius: 2, background: 'var(--ink)' }} />
        </div>
        <div className="hstack" style={{ justifyContent: 'space-between' }}>{['Jul', 'Sep', 'Nov', 'Jan', 'Mar', 'May'].map(m => <span key={m} className="small">{m}</span>)}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '10px 12px' }}>
          <Legend swatch={{ background: 'var(--teal-t)' }} name="Building" sub="Between seasons" />
          {seasons.map(s => <Legend key={s.id} swatch={s.startDate > today ? { boxShadow: 'inset 0 0 0 1.5px var(--orange)' } : { background: 'var(--orange)' }}
            name={s.label + (s.startDate <= today && (!s.endDate || s.endDate >= today) ? ' · now' : '')}
            sub={`${monthShort(s.startDate)} ${Number(s.startDate.slice(8))} – ${s.endDate ? `${monthShort(s.endDate)} ${Number(s.endDate.slice(8))}` : 'no end date'}`} />)}
        </div>
        {openSeason && (
          <button onClick={() => go('seasons')} className="hstack" style={{ gap: 10, minHeight: 52, padding: '10px 12px', borderRadius: 14, background: 'var(--orange-t)', border: 0, textAlign: 'left', color: 'var(--ink)' }}>
            <Icon name="cal" size={18} color="var(--orange-d)" />
            <span style={{ fontSize: 15, lineHeight: '20px', flexGrow: 1 }}>When does {openSeason.label} end? Add it so your break and next build line up.</span>
            <span className="tail-pill" style={{ background: 'var(--card)', color: 'var(--orange-d)' }}>Add date</span>
          </button>
        )}
        {!seasons.length && <button className="btn btn-tint" onClick={() => go('seasons')}>Add your school seasons</button>}
      </section>

      </Section>

      <Section title="Coming up" hint="About how many miles each week will be. The plan updates as you log runs.">
        <div className="card rows">
          {[{ start: snap.week.start, label: 'This week', target: snap.week.target, kind: snap.phase.kind === 'coach' ? 'Coach mode' : snap.week.isDown ? 'Lighter week' : snap.phase.kind === 'break' ? 'Break' : 'Build', meets: snap.week.days.filter(d => d.planned.kind === 'meet').map(d => d.planned.label) },
            ...snap.upcoming.slice(0, 3).map((u, i) => ({ ...u, label: i === 0 ? 'Next week' : u.label }))].map(w => (
            <div key={w.start} className="row">
              <span className="grow"><span className="label" style={{ fontWeight: 600 }}>{w.label}</span><span className="sub">{w.label === 'This week' || w.label === 'Next week' ? `${shortDay(w.start).split(', ')[1]} · ` : ''}{w.kind}</span></span>
              {w.meets.length > 0 && <span className="badge" style={{ background: 'var(--orange-t)', color: 'var(--orange-d)' }}>{w.meets.length > 1 ? `${w.meets.length} meets` : 'Meet'}</span>}
              <span className="num" style={{ fontSize: 17, fontWeight: 700, minWidth: 44, textAlign: 'right' }}>{w.target != null ? `~${Math.round(w.target)}` : '–'}</span>
            </div>
          ))}
        </div>
        <Why label="How are these numbers picked?">
          {snap.phase.kind === 'coach'
            ? <><p>In season, the aim is your usual week: the middle of your last 3 fully logged weeks. Your coach sets the hard days; the app fills in easy days around them.</p><p>Days with no data never lower it.</p></>
            : <><p>Weeks go up about 10% at a time, and every 5th week is lighter so your body catches up.</p><p>If you run a lot less than planned in a fully logged week, the next week starts from what you actually ran. Days with no data never lower it.</p></>}
        </Why>
      </Section>

      <Section title="Speed work" hint="Faster running unlocks one step at a time, after runs where nothing hurt." right={<span className="small">Level {sp.level} of 7</span>}>
      <section className="card pad">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 4 }}>
          {LEVELS.slice(1).map(l => <span key={l.n} style={{ height: 8, borderRadius: 4, background: l.n <= sp.level ? 'var(--blue)' : 'var(--line)' }} />)}
        </div>
        {sp.level > 0 && <p style={{ fontSize: 15, lineHeight: '20px' }}><strong style={{ fontWeight: 600 }}>Now: {sp.name.toLowerCase()}.</strong> <span className="body2">{LEVELS[sp.level].detail}</span></p>}
        {sp.next && <p style={{ fontSize: 15, lineHeight: '20px' }}><strong style={{ fontWeight: 600 }}>Next: {sp.next.name.toLowerCase()}.</strong> <span className="body2">{sp.eligible ? sp.next.detail : sp.blockedBy}</span></p>}
        {sp.eligible && sp.next && <button className="btn btn-tint" onClick={() => act(() => api.setSpeedLevel(uid, sp.next!.n, today), `${sp.next!.name} unlocked`)}>Unlock {sp.next.name.toLowerCase()}</button>}
        {!sp.eligible && sp.next && !sp.blockedBy?.startsWith('In season') && !snap.injury && (
          <p className="small">Pain-free check-ins: {sp.progress} of {sp.needed}. After a run, tap <b>Check in</b> on Today and answer “Nope” for pain.</p>
        )}
      </section>
      </Section>

      {snap.injury?.stage && (
        <section className="card pad">
          <h2 className="card-title">Comeback stages</h2>
          {STAGES.map(s => <p key={s.n} className={s.n === snap.injury!.stage!.n ? '' : 'sec'} style={{ fontSize: 15, fontWeight: s.n === snap.injury!.stage!.n ? 600 : 400 }}>{s.n}. {s.title}, {s.minutes} min: {s.detail}</p>)}
        </section>
      )}
    </main>
  );
}

function Legend({ swatch, name, sub }: { swatch: React.CSSProperties; name: string; sub: string }) {
  return (
    <div className="stack" style={{ gap: 2 }}>
      <span className="hstack" style={{ gap: 6, fontSize: 13, fontWeight: 700 }}><span style={{ width: 10, height: 10, borderRadius: 3, flexShrink: 0, ...swatch }} />{name}</span>
      <span className="small" style={{ paddingLeft: 16, fontSize: 12 }}>{sub}</span>
    </div>
  );
}
