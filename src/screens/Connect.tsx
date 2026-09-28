import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, FUNCTIONS_URL } from '../data/api.ts';
import { useStore } from '../data/store.tsx';
import { go } from '../app/router.ts';
import { Bubble, Icon, NavBar, Why } from '../ui/kit.tsx';
import { shortDay } from '../app/format.ts';

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

function CopyLink({ value, label, hint }: { value: string; label: string; hint: string }) {
  const { toast } = useStore();
  const [done, setDone] = useState(false);
  return (
    <div className="card pad" style={{ gap: 10 }}>
      <span className="card-title">{label}</span>
      <span className="mono" style={{ fontSize: 13, lineHeight: '18px', color: 'var(--body2)', wordBreak: 'break-all', padding: '10px 12px', borderRadius: 12, background: 'var(--bg)' }}>{value}</span>
      <button className="btn btn-tint" style={{ height: 50, borderRadius: 25, fontSize: 16 }} onClick={() => navigator.clipboard.writeText(value).then(() => { setDone(true); toast(`${label} copied`); })}>
        <Icon name={done ? 'check' : 'copy'} size={18} stroke={2.2} />{done ? 'Copied' : 'Copy'}
      </button>
      <p className="hint">{hint}</p>
    </div>
  );
}

function Taps({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className="card rows" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
      {steps.map((s, i) => (
        <li key={i} className="tapstep"><span className="n">{i + 1}</span><span className="t">{s}</span></li>
      ))}
    </ol>
  );
}
const K = ({ children }: { children: ReactNode }) => <span className="kbd">{children}</span>;

function Guide({ title, steps, step, setStep, onClose, children, next, nextLabel, nextDisabled }: {
  title: string; steps: number; step: number; setStep: (n: number) => void; onClose: () => void;
  children: ReactNode; next: () => void; nextLabel: string; nextDisabled?: boolean;
}) {
  return (
    <main className="page flow">
      <NavBar title={title} onBack={() => (step === 0 ? onClose() : setStep(step - 1))} right={<button className="btn btn-cap" onClick={onClose}>Close</button>} />
      <div className="stepper-dots" aria-label={`Step ${step + 1} of ${steps}`}>{Array.from({ length: steps }, (_, i) => <span key={i} className={i === step ? 'on' : ''} />)}</div>
      {children}
      <div className="spacer" />
      <button className="btn btn-primary" onClick={next} disabled={nextDisabled}>{nextLabel}</button>
    </main>
  );
}

// ── Apple Watch ────────────────────────────────────────────────────
export function ConnectWatch() {
  const { code, live, make, revoke } = useCode('shortcut');
  const { loaded, refresh } = useStore();
  const [step, setStep] = useState(live ? 5 : 0);
  const link = code ? `${FUNCTIONS_URL}/ingest/${code}` : null;
  const lastWatch = loaded?.activities.filter(a => a.source === 'watch').sort((a, b) => (a.start_at ?? a.date).localeCompare(b.start_at ?? b.date)).pop();
  const startCount = useRef<number | null>(null);
  const watchCount = loaded?.activities.filter(a => a.source === 'watch').length ?? 0;

  // Step 4: listen for the test run.
  useEffect(() => {
    if (step !== 3) return;
    if (startCount.current == null) startCount.current = watchCount;
    const id = setInterval(() => void refresh(), 4000);
    return () => clearInterval(id);
  }, [step, refresh, watchCount]);
  const heard = step === 3 && startCount.current != null && watchCount > startCount.current;
  const pinged = !!live?.last_used_at && Date.now() - Date.parse(live.last_used_at) < 10 * 60_000;

  if (step === 5) return (
    <main className="page flow">
      <NavBar title="Apple Watch" onBack={() => history.back()} />
      <div className="stack" style={{ gap: 14, alignItems: 'center', textAlign: 'center', paddingTop: 12 }}>
        <Bubble icon="watch" size={64} />
        <h1 className="h1-flow">Your watch is connected</h1>
        <p className="lead">Every run you finish on your Apple Watch shows up in the app by itself.</p>
      </div>
      <div className="card pad" style={{ gap: 6 }}>
        <span className="card-title">Last run received</span>
        <span className="hint">{lastWatch ? `${lastWatch.distance_mi} mi on ${shortDay(lastWatch.date)}` : 'Nothing yet. Finish a run on your watch.'}</span>
      </div>
      <Why label="A run didn’t show up?">
        <p>Your iPhone keeps health data locked while it’s locked, so a run can arrive the next time you unlock it.</p>
        <p>Still missing? Open Shortcuts and check that the automation is on and set to <b>Run Immediately</b>. You can always add a run by hand with the + button.</p>
      </Why>
      <div className="spacer" />
      <button className="btn btn-gray" onClick={() => setStep(1)}>Set it up again</button>
      <button className="btn btn-danger" onClick={() => confirm('Disconnect your watch? Runs will stop coming in until you set it up again.') && revoke().then(() => setStep(0))}>Disconnect</button>
    </main>
  );

  const close = () => history.back();
  if (step === 0) return (
    <Guide title="Apple Watch" steps={5} step={0} setStep={setStep} onClose={close} next={() => setStep(1)} nextLabel="Start">
      <div className="stack" style={{ gap: 14, alignItems: 'center', textAlign: 'center', paddingTop: 8 }}>
        <Bubble icon="watch" size={64} />
        <h1 className="h1-flow">Runs log themselves</h1>
        <p className="lead">When you finish a run on your Apple Watch, your iPhone sends the distance and time here. No typing.</p>
      </div>
      <div className="card rows">
        <div className="tapstep"><span className="n">1</span><span className="t">Copy your personal link</span></div>
        <div className="tapstep"><span className="n">2</span><span className="t">Build a small Shortcut (2 actions)</span></div>
        <div className="tapstep"><span className="n">3</span><span className="t">Run it once to test</span></div>
        <div className="tapstep"><span className="n">4</span><span className="t">Make it run after every workout</span></div>
      </div>
      <p className="hint" style={{ textAlign: 'center' }}>About 5 minutes, on your iPhone. You’ll use the Shortcuts app that came with it.</p>
    </Guide>
  );

  if (step === 1) return (
    <Guide title="Step 1 of 4" steps={5} step={1} setStep={setStep} onClose={close} next={() => setStep(2)} nextLabel="I copied it" nextDisabled={!link}>
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="h1-flow">Copy your link</h1>
        <p className="lead">This link is how the Shortcut adds runs to <b>your</b> account. Keep it private, like a password.</p>
      </div>
      {link
        ? <CopyLink value={link} label="Your link" hint="You’ll paste it in step 2." />
        : <button className="btn btn-tint" onClick={make}>{live ? 'Make a new link (the old one stops working)' : 'Make my link'}</button>}
    </Guide>
  );

  if (step === 2) return (
    <Guide title="Step 2 of 4" steps={5} step={2} setStep={setStep} onClose={close} next={() => setStep(3)} nextLabel="I built it">
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="h1-flow">Build the Shortcut</h1>
        <p className="lead">Open the <b>Shortcuts</b> app and follow along.</p>
      </div>
      <p className="section-title" style={{ padding: '0 4px' }}>Action 1: find your latest workout</p>
      <Taps steps={[
        <>Tap <K>+</K> in the top corner to start a new shortcut.</>,
        <>Tap <K>Search Actions</K>, type <b>Find Health Samples</b>, and tap it.</>,
        <>Tap the blue word after “Find”, and choose <K>Workouts</K>.</>,
        <>Below it, set <K>Sort by</K> to Start Date and <K>Order</K> to Latest First. Turn on <K>Limit</K> and set it to 1. (Skip “Add Filter”.)</>,
      ]} />
      <p className="section-title" style={{ padding: '0 4px' }}>Action 2: send it to the app</p>
      <Taps steps={[
        <>Search <b>Get Contents of URL</b> and tap it.</>,
        <>Tap <K>URL</K> and paste your link from step 1.</>,
        <>Tap the <K>›</K> arrow. Set <K>Method</K> to POST and <K>Request Body</K> to JSON.</>,
        <>Tap <K>Add new field</K> → <K>Text</K>. Key: <b className="mono">start</b>. For the value, tap <K>Health Samples</K>, then tap it again and pick <K>Start Date</K>.</>,
        <>Add two more the same way: <b className="mono">end</b> = <K>End Date</K>, and <b className="mono">distance</b> = <K>Distance</K>.</>,
        <>Tap the name at the top and call it <b>Send run to Base</b>. Tap <K>Done</K>.</>,
      ]} />
      <Why label="Stuck on a step?">
        <p>The value picker: after you tap in the value box, a bar of variables appears above the keyboard. Tap <b>Health Samples</b>, then tap the blue <b>Health Samples</b> bubble again to pick which detail (Start Date, End Date, Distance).</p>
        <p>You can also ask Claude to walk you through it with this screen open.</p>
      </Why>
    </Guide>
  );

  if (step === 3) return (
    <Guide title="Step 3 of 4" steps={5} step={3} setStep={setStep} onClose={close} next={() => setStep(4)} nextLabel={heard ? 'Next' : 'Skip the test'}>
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="h1-flow">Test it once</h1>
        <p className="lead">In Shortcuts, tap <b>Send run to Base</b> to run it. Allow Health access when your iPhone asks.</p>
      </div>
      <div className="card pad">
        <div className="live">
          <span className={`pulse${heard ? ' ok' : ''}`} />
          <span className="stack">
            <span style={{ fontWeight: 600 }}>{heard ? 'It works!' : pinged ? 'Got a message, checking it…' : 'Waiting for your test…'}</span>
            <span className="hint">{heard && lastWatch ? `Received ${lastWatch.distance_mi} mi from ${shortDay(lastWatch.date)}. It’s in your History.` : 'This updates by itself. It sends your most recent workout.'}</span>
          </span>
        </div>
      </div>
      {pinged && !heard && (
        <Why label="It sent something but no run appeared">
          <p>Check the three JSON keys are spelled exactly <b className="mono">start</b>, <b className="mono">end</b>, <b className="mono">distance</b>, and that each value is a Health Samples detail (not the whole Health Samples).</p>
          <p>Your latest workout also needs a distance (a run or walk, not strength training).</p>
        </Why>
      )}
    </Guide>
  );

  return (
    <Guide title="Step 4 of 4" steps={5} step={4} setStep={setStep} onClose={close} next={() => setStep(5)} nextLabel="Done">
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="h1-flow">Make it automatic</h1>
        <p className="lead">Now tell your iPhone to run it after every run. iPhone makes you do this part yourself.</p>
      </div>
      <Taps steps={[
        <>In Shortcuts, tap <K>Automation</K> at the bottom, then <K>+</K>.</>,
        <>Scroll to <K>Apple Watch Workout</K> and tap it.</>,
        <>Choose <K>Ends</K>, tap <K>Choose</K> next to Workout, and pick <K>Running</K>.</>,
        <>Pick <K>Run Immediately</K>, then tap <K>Next</K>.</>,
        <>Choose <b>Send run to Base</b>. Done.</>,
      ]} />
      <p className="hint" style={{ padding: '0 4px' }}>Your iPhone keeps health data locked while it’s locked, so a run can show up the next time you unlock it.</p>
    </Guide>
  );
}

// ── Claude ─────────────────────────────────────────────────────────
export function ConnectClaude() {
  const { code, live, make, revoke } = useCode('mcp');
  const link = code ? `${FUNCTIONS_URL}/mcp/${code}` : null;
  return (
    <main className="page flow">
      <NavBar title="Claude" onBack={() => history.back()} />
      <div className="stack" style={{ gap: 14, alignItems: 'center', textAlign: 'center', paddingTop: 4 }}>
        <Bubble icon="spark" size={64} bg="var(--bg)" fg="var(--body2)" />
        <h1 className="h1-flow">Talk to your plan</h1>
        <p className="lead">Connect Claude and just tell it things: “I ran 6 with the team today”, “move my long run to Sunday”, “why is this week lighter?”</p>
      </div>
      <div className="card rows">
        {[
          ['Logs runs and notes', 'From what you tell it, in plain words.'],
          ['Changes your plan', 'Shows you the change first; you say yes. Always undoable.'],
          ['Explains and checks', 'Why a number is what it is, and whether anything looks off.'],
        ].map(([t, s]) => (
          <div key={t} className="row"><Icon name="check" size={18} color="var(--teal-d)" stroke={2.4} /><span className="grow"><span className="label" style={{ fontWeight: 600 }}>{t}</span><span className="sub">{s}</span></span></div>
        ))}
      </div>
      {link
        ? <CopyLink value={link} label="Your connector link" hint="Private to you. Anyone with it can read and change your training, so don’t share it." />
        : <button className="btn btn-tint" onClick={make}>{live ? 'Make a new link (the old one stops working)' : 'Make my link'}</button>}
      {link && (
        <>
          <div className="sechead"><div className="stack"><h2>Add it in Claude</h2><p>On claude.ai or the Claude app (needs your own Claude account).</p></div></div>
          <Taps steps={[
            <>Open <b>Customize → Connectors</b> and tap <K>Add custom connector</K>.</>,
            <>Name it <b>Bulletproof Base</b> and paste your link.</>,
            <>Choose <K>No sign-in</K>, then <K>Add</K>.</>,
            <>In a chat, ask: <b>“What’s my run today?”</b></>,
          ]} />
          <a className="btn btn-gray" href="https://claude.ai/customize/connectors" target="_blank" rel="noreferrer">Open Claude connectors</a>
        </>
      )}
      <div className="spacer" />
      {live && <button className="btn btn-danger" onClick={() => confirm('Disconnect Claude? The link stops working right away.') && revoke()}>Disconnect Claude</button>}
      <button className="btn btn-primary" onClick={() => go('you')}>Done</button>
    </main>
  );
}
