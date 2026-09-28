import { useState } from 'react';
import { api, FUNCTIONS_URL } from '../data/api.ts';
import { useStore } from '../data/store.tsx';
import { go } from '../app/router.ts';
import { Icon, NavBar } from '../ui/kit.tsx';

// The raw code is only returned once by the server. Keep it on this phone so
// the runner can copy it again; making a new one turns the old one off.
const KEY = (k: string) => `bb-code-${k}`;
const saved = (k: string) => { try { return localStorage.getItem(KEY(k)); } catch { return null; } };

function useCode(kind: 'shortcut' | 'mcp') {
  const { loaded, act, uid } = useStore();
  const [code, setCode] = useState<string | null>(() => saved(kind));
  const live = loaded?.tokens.find(t => t.kind === kind);
  const usable = code && live && code.endsWith(live.hint) ? code : null;
  const make = async () => {
    let raw = '';
    const ok = await act(async () => { raw = await api.createToken(kind); });
    if (ok) { try { localStorage.setItem(KEY(kind), raw); } catch { /* private mode */ } setCode(raw); }
  };
  const revoke = () => act(async () => { await api.revokeToken(uid, kind); try { localStorage.removeItem(KEY(kind)); } catch { /* */ } setCode(null); }, 'Turned off');
  return { code: usable, live, make, revoke };
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="hstack" style={{ gap: 14, alignItems: 'flex-start', padding: '14px 16px' }}>
      <span className="center" style={{ width: 28, height: 28, borderRadius: 14, background: 'var(--ink)', color: 'var(--card)', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>{n}</span>
      <span className="stack" style={{ gap: 6, flexGrow: 1, minWidth: 0 }}><span style={{ fontSize: 17, fontWeight: 600 }}>{title}</span><span className="body2" style={{ fontSize: 15, lineHeight: '21px' }}>{children}</span></span>
    </div>
  );
}

function CopyBox({ value, label }: { value: string; label: string }) {
  const { toast } = useStore();
  return (
    <span className="hstack" style={{ gap: 8, marginTop: 4 }}>
      <span style={{ flexGrow: 1, minWidth: 0, height: 44, padding: '0 12px', borderRadius: 12, background: 'var(--bg)', display: 'flex', alignItems: 'center', fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
      <button className="btn btn-tint btn-icon" aria-label={`Copy ${label}`} onClick={() => navigator.clipboard.writeText(value).then(() => toast(`${label} copied`))}><Icon name="copy" size={18} /></button>
    </span>
  );
}

export function ConnectWatch() {
  const { code, live, make, revoke } = useCode('shortcut');
  const { toast, refresh } = useStore();
  const url = `${FUNCTIONS_URL}/ingest`;
  async function test() {
    if (!code) return;
    const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${code}`, 'content-type': 'application/json' }, body: JSON.stringify({ test: true }) });
    toast(r.ok ? 'Your code works. Now run the Shortcut once on your iPhone.' : 'That code was turned off. Make a new one.');
    void refresh();
  }
  return (
    <main className="page flow">
      <NavBar title="Apple Watch" onBack={() => history.back()} />
      <div className="stack" style={{ gap: 6, paddingTop: 4 }}>
        <h1 className="h1-flow">Runs in, no typing</h1>
        <p className="lead">Your iPhone sends each run here when you end it on your watch. About 5 minutes to set up.</p>
      </div>
      <section className="card rows">
        <Step n={1} title="Get your code">
          {code ? <>Copy it. The Shortcut uses it to add runs to your account.<CopyBox value={code} label="Code" /></>
            : <>{live ? 'You made a code on another phone. Make a new one here (the old one stops working).' : 'This code lets your Shortcut add runs to your account.'}
              <button className="btn btn-tint" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={make}>{live ? 'Make a new code' : 'Make my code'}</button></>}
        </Step>
        <Step n={2} title="Build the Shortcut">
          In Shortcuts, tap + and add these actions:<br />
          • <b>Find Health Samples</b>: Type <i>Workouts</i>, sort by Start Date, latest first, limit 1.<br />
          • <b>Get Contents of URL</b>: this address, Method <i>POST</i>, header <i>Authorization</i> = <i>Bearer</i> + your code, JSON body: <i>start</i> = Start Date, <i>end</i> = End Date, <i>distance</i> = Distance (mi).
          <CopyBox value={url} label="Address" />
        </Step>
        <Step n={3} title="Make it automatic">
          Shortcuts → Automation → + → <b>Apple Watch Workout</b> → <b>Ends</b> → Running → <b>Run Immediately</b> → pick your Shortcut. iPhone makes you do this part by hand.
        </Step>
      </section>
      <p className="small" style={{ padding: '0 16px' }}>Health data is locked while your iPhone is locked, so a run can show up when you next unlock it.</p>
      <div className="spacer" />
      {code && <button className="btn btn-gray" onClick={test}>Test my code</button>}
      {live && <button className="btn btn-danger" onClick={() => confirm('Turn off the watch connection?') && revoke()}>Turn off</button>}
      <button className="btn btn-primary" onClick={() => go('today')}>Done</button>
    </main>
  );
}

export function ConnectClaude() {
  const { code, live, make, revoke } = useCode('mcp');
  const link = code ? `${FUNCTIONS_URL}/mcp/${code}` : null;
  return (
    <main className="page flow">
      <NavBar title="Claude" onBack={() => history.back()} />
      <div className="stack" style={{ gap: 6, paddingTop: 4 }}>
        <h1 className="h1-flow">Let Claude help</h1>
        <p className="lead">Optional. You need your own Claude account.</p>
      </div>
      <section className="card pad">
        <span className="section-title" style={{ padding: 0 }}>Claude can</span>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 15, lineHeight: '20px' }}>
          {['Add runs you tell it about', 'Fill in days with no data', 'Spot problems and explain your plan', 'Walk you through an injury check'].map(s => (
            <li key={s} className="hstack" style={{ gap: 10, alignItems: 'flex-start' }}><Icon name="check" size={18} color="var(--teal-d)" stroke={2.2} /><span>{s}</span></li>
          ))}
        </ul>
        <p className="small">It can’t see anyone else’s data. Turn it off here any time.</p>
      </section>
      <section className="card rows">
        <Step n={1} title="Get your connector link">
          {link ? <>Treat it like a password.<CopyBox value={link} label="Link" /></>
            : <><span>{live ? 'You made a link on another phone. Make a new one here (the old one stops working).' : 'A private link just for you.'}</span>
              <button className="btn btn-tint" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={make}>{live ? 'Make a new link' : 'Make my link'}</button></>}
        </Step>
        <Step n={2} title="Add it in Claude">
          In Claude: <b>Customize → Connectors → Add custom connector</b>. Name it Bulletproof Base, paste the link, choose <b>No sign-in</b>, and add.
        </Step>
        <Step n={3} title="Try it">Ask Claude: “What’s my run today?” or “I ran 6 with the team Tuesday.”</Step>
      </section>
      <div className="spacer" />
      {live && <button className="btn btn-danger" onClick={() => confirm('Turn off Claude and delete this link?') && revoke()}>Turn off and delete link</button>}
      <button className="btn btn-primary" onClick={() => go('you')}>Done</button>
    </main>
  );
}
