import { useState } from 'react';
import { addDays } from '../engine/index.ts';
import { api, type ActivityRow } from '../data/api.ts';
import { useStore } from '../data/store.tsx';
import { monthShort, mi, shortDay, duration } from '../app/format.ts';
import { Bubble, LargeTitle } from '../ui/kit.tsx';
import { AddRunSheet } from './AddRun.tsx';

const SOURCE: Record<string, [string, string]> = {
  watch: ['watch', 'from Apple Watch'], claude: ['spark', 'added by Claude'], manual: ['pencil', 'added by hand'], import: ['pencil', 'from the old app'],
};

export function History({ onAdd }: { onAdd: (date?: string) => void }) {
  const { snap, loaded, uid, today, act } = useStore();
  const [sel, setSel] = useState<number | null>(null);
  const [edit, setEdit] = useState<ActivityRow | null>(null);
  if (!snap || !loaded) return null;

  const weeks = snap.history.slice(-12);
  const max = Math.max(10, ...weeks.map(w => w.miles));
  const best = weeks.reduce((b, w) => (w.miles > b.miles ? w : b), weeks[0] ?? { start: today, miles: 0, estimatedMiles: 0, reliability: 'none' as const });
  const shown = sel != null ? weeks[sel] : best;
  const marks = new Map(loaded.runner.days.map(d => [d.date, d.status]));
  const byDate = new Map<string, ActivityRow[]>();
  for (const a of loaded.activities) byDate.set(a.date, [...(byDate.get(a.date) ?? []), a]);

  // Recent weeks, newest first (this week included).
  const recent = [snap.week.start, ...[...snap.history].reverse().slice(0, 7).map(h => h.start)];

  return (
    <main className="page">
      <LargeTitle title="History" />
      {weeks.length > 0 && (
        <section className="card pad">
          <div className="hstack" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="stack" style={{ gap: 2 }}>
              <span className="small">Week of {shortDay(shown.start).split(', ')[1]}</span>
              <span className="num" style={{ fontSize: 28, lineHeight: '32px', fontWeight: 700 }}>{mi(shown.miles)} <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--sec)' }}>mi</span></span>
            </div>
            <span className="small" style={{ textAlign: 'right' }}>{shown === best && sel == null ? 'Best week' : shown.reliability === 'none' ? 'No data' : shown.estimatedMiles ? `${mi(shown.estimatedMiles)} from checked-off days` : shown.reliability === 'partial' ? 'Some days missing' : ''}</span>
          </div>
          <div className="chart" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0,1fr))` }}>
            {weeks.map((w, i) => {
              if (w.reliability === 'none' && w.miles === 0) return (
                <button key={w.start} className="bar" aria-label={`${w.start}: no data`} onClick={() => setSel(i)} style={{ alignItems: 'center' }}>
                  <span className="unk" style={{ width: 18, height: 18, fontSize: 10, borderWidth: 1.5 }}>?</span>
                </button>
              );
              const real = w.miles - w.estimatedMiles;
              const on = (sel ?? weeks.indexOf(best)) === i;
              return (
                <button key={w.start} className={`bar${on ? ' sel' : ''}`} aria-label={`Week of ${w.start}: ${w.miles} miles`} onClick={() => setSel(i)}>
                  {w.estimatedMiles > 0 && <span className="est" style={{ height: `${(w.estimatedMiles / max) * 112}px` }} />}
                  {real > 0 && <span className="real" style={{ height: `${(real / max) * 112}px` }} />}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${weeks.length}, minmax(0,1fr))`, gap: 5 }}>
            {weeks.map((w, i) => <span key={w.start} className="small" style={{ fontSize: 11 }}>{i === 0 || monthShort(w.start) !== monthShort(weeks[i - 1].start) ? monthShort(w.start) : ''}</span>)}
          </div>
          <div className="legend">
            <span><i style={{ background: 'var(--blue)' }} />Logged</span>
            {weeks.some(w => w.estimatedMiles) && <span><i style={{ background: 'repeating-linear-gradient(135deg, #C7D3FA 0 3px, #E3E9FD 3px 5px)' }} />Checked off, plan miles</span>}
            <span><i style={{ border: '1.5px dashed var(--unk)', borderRadius: 5 }} />No data</span>
          </div>
        </section>
      )}

      {recent.map(ws => {
        const days = [0, 1, 2, 3, 4, 5, 6].map(k => addDays(ws, k)).filter(d => d <= today).reverse();
        const rows: React.ReactNode[] = [];
        let gap: string[] = [];
        const flush = () => {
          if (!gap.length) return;
          const g = [...gap].reverse();
          rows.push(
            <div key={'gap' + g[0]} className="row">
              <span className="unk" aria-hidden="true">?</span>
              <span className="grow"><span className="label">{g.length === 1 ? shortDay(g[0]) : `${shortDay(g[0]).split(',')[0]} – ${shortDay(g[g.length - 1]).split(',')[0]}`}</span><span className="sub">{g.length === 1 ? 'No data' : `${g.length} days with no data`}</span></span>
              <button className="pill tint" onClick={() => onAdd(g[0])}><span>Add</span></button>
              <button className="pill cap" onClick={() => act(() => api.markDays(uid, g, 'rest'), g.length > 1 ? 'Marked as rest days' : 'Marked as rest')}><span>Rest</span></button>
            </div>,
          );
          gap = [];
        };
        for (const d of days) {
          const acts = byDate.get(d) ?? [];
          const mark = marks.get(d);
          if (!acts.length && !mark) { if (d !== today) gap.push(d); continue; }
          flush();
          for (const a of acts) {
            const [icon, src] = SOURCE[a.source] ?? SOURCE.manual;
            rows.push(
              <button key={a.id} className="row" onClick={() => setEdit(a)}>
                <Bubble icon={icon as never} bg="var(--bg)" fg="var(--body2)" small />
                <span className="grow"><span className="label">{shortDay(d)}</span><span className="sub">{a.kind === 'workout' ? 'Team workout' : a.kind === 'race' ? 'Race' : a.kind === 'long' ? 'Long run' : 'Run'} · {a.distance_estimated ? 'checked off, plan miles' : src}{a.duration_s ? ` · ${duration(a.duration_s)}` : ''}</span></span>
                <span className="num" style={{ fontSize: 17, fontWeight: 600 }}>{mi(Number(a.distance_mi))}</span>
              </button>,
            );
          }
          if (!acts.length && mark) rows.push(
            <div key={'m' + d} className="row"><span className="unk" style={{ borderStyle: 'solid', borderColor: 'var(--field)' }} aria-hidden="true">–</span>
              <span className="grow"><span className="label">{shortDay(d)}</span><span className="sub">{mark === 'skipped' ? 'Skipped' : mark[0].toUpperCase() + mark.slice(1)}</span></span></div>,
          );
        }
        flush();
        if (!rows.length) return null;
        const total = days.reduce((s, d) => s + (byDate.get(d) ?? []).reduce((t, a) => t + Number(a.distance_mi), 0), 0);
        return (
          <section key={ws} className="group">
            <div className="hstack" style={{ justifyContent: 'space-between', padding: '0 16px' }}>
              <h2 className="section-title" style={{ padding: 0 }}>{ws === snap.week.start ? 'This week' : `${shortDay(ws).split(', ')[1]} – ${shortDay(addDays(ws, 6)).split(', ')[1]}`}</h2>
              <span className="small num">{total ? `${mi(Math.round(total * 10) / 10)} mi` : 'No data'}</span>
            </div>
            <div className="card rows">{rows}</div>
          </section>
        );
      })}
      {edit && <AddRunSheet edit={edit} onClose={() => setEdit(null)} />}
    </main>
  );
}
