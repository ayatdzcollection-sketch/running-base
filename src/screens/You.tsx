import { useState } from 'react';
import { api, db } from '../data/api.ts';
import { useStore } from '../data/store.tsx';
import { go } from '../app/router.ts';
import { Bubble, Group, LargeTitle, Row, Seg, Sheet } from '../ui/kit.tsx';

export function You() {
  const { loaded, snap, uid, act, toast, today } = useStore();
  const [days, setDays] = useState(false);
  const [about, setAbout] = useState(false);
  const [shoe, setShoe] = useState(false);
  const [name, setName] = useState('');
  if (!loaded || !snap) return null;
  const p = loaded.profile;
  const watch = loaded.tokens.find(t => t.kind === 'shortcut');
  const claude = loaded.tokens.find(t => t.kind === 'mcp');
  const seasonsLine = loaded.seasons.map(s => s.label).join(', ') || 'No seasons yet';

  async function download() {
    const data = await api.exportAll(uid);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `bulletproof-base-${today}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="page">
      <LargeTitle title="You" right={<span className="center" style={{ width: 44, height: 44, borderRadius: 22, background: 'var(--ink)', color: 'var(--card)', fontWeight: 600 }}>{(p.display_name || '?')[0].toUpperCase()}</span>} />
      <p className="sec" style={{ fontSize: 15, marginTop: -8 }}>{p.display_name} · {seasonsLine}</p>

      <Group title="Connections">
        <Row label="Apple Watch" sub={watch ? (watch.last_used_at ? `Last heard from ${new Date(watch.last_used_at).toLocaleDateString()}` : 'Set up, waiting for a run') : 'Not connected'}
          lead={<Bubble icon="watch" small />} action={watch ? undefined : 'Set up'} onClick={() => go('watch')} />
        <Row label="Claude" sub={claude ? 'Connected' : 'Optional'} lead={<Bubble icon="spark" bg="var(--bg)" fg="var(--body2)" small />}
          action={claude ? undefined : 'Connect'} onClick={() => go('claude')} />
      </Group>

      <Group title="Training">
        <Row label="Seasons" value={loaded.seasons.length} onClick={() => go('seasons')} />
        <Row label="Run days" value={`${p.days_per_week} a week`} onClick={() => setDays(true)} />
        <Row label="About you" sub={`${p.birth_year ? `Born ${p.birth_year}` : 'Birth year not set'} · ${p.experience_years ?? '?'} years running`} onClick={() => setAbout(true)} />
      </Group>

      <Group title="Shoes">
        {snap.shoes.map(s => (
          <Row key={s.id} label={s.name} value={`${s.miles} mi`} badge={s.over ? <span className="badge">Past {s.retireAt} mi</span> : undefined}
            onClick={() => confirm(`Retire ${s.name}? Its miles stop counting.`) && act(() => api.saveShoe(uid, { id: s.id, name: s.name, start_date: loaded.shoes.find(x => x.id === s.id)!.start_date, retired_at: today }), 'Shoe retired')} />
        ))}
        <Row label="Add a pair" action="Add" onClick={() => setShoe(true)} />
      </Group>

      {loaded.changes.length > 0 && (
        <Group title="Changes by Claude">
          {loaded.changes.slice(0, 5).map(c => (
            <Row key={c.id} label={c.summary} sub={`${new Date(c.at).toLocaleDateString()}${c.undone_at ? ' · undone' : ''}`} />
          ))}
        </Group>
      )}
      {loaded.changes.length > 0 && <p className="small" style={{ padding: '0 16px', marginTop: -8 }}>Ask Claude to “undo that” to reverse a change. Changed plan days also have an Undo on Today.</p>}

      {loaded.invite && (
        <Group title="Invite a teammate">
          <Row label={<span className="num" style={{ letterSpacing: '0.04em', fontWeight: 600 }}>{loaded.invite}</span>} sub="They enter this after signing in."
            action="Copy" onClick={() => navigator.clipboard.writeText(loaded.invite!).then(() => toast('Invite code copied'))} />
        </Group>
      )}

      <Group>
        <Row label="Sign in on another device" sub="Shows a one-time code" onClick={() => go('pair')} />
        <Row label="Download my data" onClick={download} />
        <Row label="Sign out" danger onClick={() => confirm('Sign out on this phone?') && db.auth.signOut({ scope: 'local' })} />
      </Group>

      {days && (
        <Sheet onClose={() => setDays(false)} white label="Run days">
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Run days a week</h2>
          <Seg label="Run days" value={String(p.days_per_week)} options={[3, 4, 5, 6, 7].map(n => ({ value: String(n), label: String(n) }))}
            onChange={v => act(() => api.updateProfile(uid, { days_per_week: Number(v) }), 'Saved')} />
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Long run day</h2>
          <Seg label="Long run day" value={String(p.long_run_day)} options={['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) => ({ value: String(i), label: l }))}
            onChange={v => act(() => api.updateProfile(uid, { long_run_day: Number(v) }), 'Saved')} />
          <button className="btn btn-primary" onClick={() => setDays(false)}>Done</button>
        </Sheet>
      )}
      {about && (
        <Sheet onClose={() => setAbout(false)} white label="About you">
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>About you</h2>
          <p className="small">These set safe limits. Runners 15 and under get a lower weekly ceiling.</p>
          <label className="field"><span>Birth year</span>
            <input className="input" inputMode="numeric" defaultValue={p.birth_year ?? ''} placeholder="e.g. 2010" onBlur={e => { const v = Number(e.target.value); if (v >= 1990 && v <= 2020) void act(() => api.updateProfile(uid, { birth_year: v }), 'Saved'); }} />
          </label>
          <label className="field"><span>Years of running</span>
            <input className="input" inputMode="decimal" defaultValue={p.experience_years ?? ''} onBlur={e => { const v = Number(e.target.value); if (v >= 0 && v <= 20) void act(() => api.updateProfile(uid, { experience_years: v }), 'Saved'); }} />
          </label>
          <button className="btn btn-primary" onClick={() => setAbout(false)}>Done</button>
        </Sheet>
      )}
      {shoe && (
        <Sheet onClose={() => setShoe(false)} white label="Add a pair">
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Add a pair</h2>
          <label className="field"><span>Name</span><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Pegasus 41" autoFocus /></label>
          <p className="small">Miles count from today. We’ll remind you around 300 miles.</p>
          <button className="btn btn-primary" onClick={async () => {
            if (!name.trim()) return toast('Give the shoe a name.');
            if (await act(() => api.saveShoe(uid, { name: name.trim(), start_date: today, retire_at: 300 }), 'Shoe added')) { setShoe(false); setName(''); }
          }}>Add</button>
        </Sheet>
      )}
    </main>
  );
}
