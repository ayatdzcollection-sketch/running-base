import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, FUNCTIONS_URL } from '../data/api.ts';
import { useStore } from '../data/store.tsx';
import { go } from '../app/router.ts';
import { Bubble, Icon, NavBar, Why } from '../ui/kit.tsx';
import { shortDay } from '../app/format.ts';
import { HealthSync, isNative, type HealthStatus } from '../native/health.ts';

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
type Method = 'puls' | 'hae' | 'shortcut';
const HAE_URL = 'https://apps.apple.com/app/id1115567069';
const PULS_URL = 'https://apps.apple.com/us/app/pulshealth/id6757657354';

function MethodCard({ title, badge, body, onClick, icon }: { title: string; badge?: string; body: string; onClick: () => void; icon: 'watch' | 'spark' | 'share' }) {
  return (
    <button className="card row" style={{ alignItems: 'flex-start', padding: 16, borderRadius: 24 }} onClick={onClick}>
      <Bubble icon={icon} small />
      <span className="grow" style={{ gap: 4 }}>
        <span className="hstack" style={{ gap: 8 }}><span className="label" style={{ fontWeight: 700 }}>{title}</span>{badge && <span className="badge" style={{ background: 'var(--green-t)', color: 'var(--green-d)' }}>{badge}</span>}</span>
        <span className="sub" style={{ fontSize: 14, lineHeight: '19px' }}>{body}</span>
      </span>
      <Icon name="chev" size={16} color="#9C9CA3" stroke={2} />
    </button>
  );
}

/** Inside the iPhone app: read runs straight from Apple Health. */
function NativeHealth() {
  const { refresh, toast } = useStore();
  const [st, setSt] = useState<HealthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => HealthSync.status().then(setSt, () => setSt(null));
  useEffect(() => { void load(); }, []);
  async function connect() {
    setBusy(true);
    try {
      const raw = await api.createToken('shortcut');
      const { sent } = await HealthSync.connect({ endpoint: `${FUNCTIONS_URL}/ingest/${raw}` });
      toast(sent ? `Connected. Brought in ${sent} run${sent === 1 ? '' : 's'}.` : 'Connected. New runs will show up by themselves.');
      await refresh();
    } catch (e) { toast((e as Error).message || 'Couldn’t connect to Health.'); }
    finally { setBusy(false); void load(); }
  }
  async function syncNow() {
    setBusy(true);
    try { const { sent } = await HealthSync.syncNow(); toast(sent ? `Brought in ${sent} run${sent === 1 ? '' : 's'}.` : 'You’re up to date.'); await refresh(); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); void load(); }
  }
  const connected = !!st?.connected;
  return (
    <main className="page flow">
      <NavBar title="Apple Watch" onBack={() => history.back()} />
      <div className="stack" style={{ gap: 14, alignItems: 'center', textAlign: 'center', paddingTop: 12 }}>
        <Bubble icon="watch" size={64} />
        <h1 className="h1-flow">{connected ? 'Runs log themselves' : 'Connect Apple Health'}</h1>
        <p className="lead">{connected
          ? 'When you finish a run on your Apple Watch, this app picks it up from Apple Health in the background.'
          : 'This app reads your runs straight from Apple Health: distance, time and heart rate. Your runs from the last 90 days come in too.'}</p>
      </div>
      {connected && (
        <div className="card pad" style={{ gap: 6 }}>
          <span className="card-title">Last check</span>
          <span className="hint">{st?.lastSync ? `${new Date(st.lastSync).toLocaleString()} · ${st.lastCount} new run${st.lastCount === 1 ? '' : 's'}` : 'Not yet'}</span>
        </div>
      )}
      <Why label="What does it read?">
        <p>Only running workouts: when, how far, how long, and your heart rate. It never writes to Health and never reads anything else.</p>
        <p>If iPhone asks, turn on <b>Workouts</b>, <b>Walking + Running Distance</b> and <b>Heart Rate</b>. You can change this later in Settings → Health → Data Access.</p>
      </Why>
      <div className="spacer" />
      {connected ? <>
        <button className="btn btn-gray" onClick={syncNow} disabled={busy}>{busy ? 'Checking…' : 'Check for new runs now'}</button>
        <button className="btn btn-danger" onClick={() => confirm('Stop reading runs from Apple Health?') && HealthSync.disconnect().then(load)}>Disconnect</button>
      </> : <button className="btn btn-primary" onClick={connect} disabled={busy || st?.available === false}>{busy ? 'Connecting…' : 'Connect Apple Health'}</button>}
      {st?.available === false && <p className="small" style={{ textAlign: 'center' }}>Apple Health isn’t available on this device.</p>}
    </main>
  );
}

export function ConnectWatch() {
  return isNative() ? <NativeHealth /> : <WebWatch />;
}

function WebWatch() {
  const { code, live, make, revoke } = useCode('shortcut');
  const { loaded, refresh } = useStore();
  const [method, setMethod] = useState<Method | null>(null);
  const [step, setStep] = useState(live ? 99 : 0);
  const link = code ? `${FUNCTIONS_URL}/ingest/${code}` : null;
  const watchRuns = loaded?.activities.filter(a => a.source === 'watch') ?? [];
  const lastWatch = [...watchRuns].sort((a, b) => (a.start_at ?? a.date).localeCompare(b.start_at ?? b.date)).pop();
  const startCount = useRef<number | null>(null);
  const testing = step === 3;

  useEffect(() => {
    if (!testing) return;
    if (startCount.current == null) startCount.current = watchRuns.length;
    const id = setInterval(() => void refresh(), 4000);
    return () => clearInterval(id);
  }, [testing, refresh, watchRuns.length]);
  const heard = testing && startCount.current != null && watchRuns.length > startCount.current;
  const pinged = !!live?.last_used_at && Date.now() - Date.parse(live.last_used_at) < 10 * 60_000;
  const close = () => history.back();
  const total = 4;

  // Connected
  if (step === 99) return (
    <main className="page flow">
      <NavBar title="Apple Watch" onBack={close} />
      <div className="stack" style={{ gap: 14, alignItems: 'center', textAlign: 'center', paddingTop: 12 }}>
        <Bubble icon="watch" size={64} />
        <h1 className="h1-flow">Your watch is connected</h1>
        <p className="lead">Runs you finish on your Apple Watch show up in the app by themselves.</p>
      </div>
      <div className="card pad" style={{ gap: 6 }}>
        <span className="card-title">Last run received</span>
        <span className="hint">{lastWatch ? `${lastWatch.distance_mi} mi on ${shortDay(lastWatch.date)}` : 'Nothing yet. Finish a run on your watch.'}</span>
      </div>
      <Why label="A run didn’t show up?">
        <p>Your iPhone keeps health data locked while it’s locked, so a run can arrive the next time you unlock it.</p>
        <p>PulsHealth sends when iOS wakes it, usually within minutes; opening it sends right away. Health Auto Export sends on its own schedule (every hour, for example). With the Shortcut, check the automation is on and set to <b>Run Immediately</b>.</p>
        <p>You can always add or fix a run by hand with the + button.</p>
      </Why>
      <div className="spacer" />
      <button className="btn btn-gray" onClick={() => { setMethod(null); setStep(0); }}>Set it up again</button>
      <button className="btn btn-danger" onClick={() => confirm('Disconnect your watch? Runs stop coming in until you set it up again.') && revoke().then(() => setStep(0))}>Disconnect</button>
    </main>
  );

  // Choose a method
  if (step === 0 || !method) return (
    <main className="page flow">
      <NavBar title="Apple Watch" onBack={close} />
      <div className="stack" style={{ gap: 6, paddingTop: 4 }}>
        <h1 className="h1-flow">How should runs get in?</h1>
        <p className="lead">Pick one. You can switch later.</p>
      </div>
      <MethodCard icon="watch" title="PulsHealth" badge="Free · recommended" onClick={() => { setMethod('puls'); setStep(1); }}
        body="A free App Store app that sends every run by itself, with time and heart rate. About 2 minutes to set up." />
      <MethodCard icon="watch" title="Health Auto Export" onClick={() => { setMethod('hae'); setStep(1); }}
        body="Does the same job, with its own sync schedule. Needs its Premium upgrade (free 7-day trial)." />
      <MethodCard icon="share" title="Free Shortcut" onClick={() => { setMethod('shortcut'); setStep(1); }}
        body="Built into your iPhone. Adds up the distance from the hour before, so a walk right before a run can count. You can fix it in History." />
      <MethodCard icon="spark" title="Just tell Claude" onClick={() => go('claude')}
        body="No phone setup. Say “I ran 6 with the team today” and it logs it. Or tap + in the app." />
    </main>
  );

  const guide = (title: string, body: ReactNode, next: () => void, label: string, disabled?: boolean) => (
    <Guide title={title} steps={total} step={step - 1} setStep={n => setStep(n + 1)} onClose={() => setStep(0)} next={next} nextLabel={label} nextDisabled={disabled}>{body}</Guide>
  );

  // Step 1 (PulsHealth): it asks for a server address and a token separately
  if (step === 1 && method === 'puls') return guide('Step 1 of 3', <>
    <div className="stack" style={{ gap: 6 }}>
      <h1 className="h1-flow">Your two codes</h1>
      <p className="lead">PulsHealth asks for a <b>server address</b> and a <b>token</b>. The token links runs to <b>your</b> account, so keep it private, like a password.</p>
    </div>
    <CopyLink value={`${FUNCTIONS_URL}/ingest`} label="Server address" hint="The same for everyone." />
    {code
      ? <CopyLink value={code} label="Your token" hint="Private to you. You’ll paste both in the next step; come back here to copy each one." />
      : <button className="btn btn-tint" onClick={make}>{live ? 'Make a new token (the old one stops working)' : 'Make my token'}</button>}
  </>, () => setStep(2), 'Next', !code);

  // Step 1: link (the other methods)
  if (step === 1) return guide(`Step 1 of 3`, <>
    <div className="stack" style={{ gap: 6 }}>
      <h1 className="h1-flow">Copy your link</h1>
      <p className="lead">This link is how runs get into <b>your</b> account. Keep it private, like a password.</p>
    </div>
    {link
      ? <CopyLink value={link} label="Your link" hint="You’ll paste it in the next step." />
      : <button className="btn btn-tint" onClick={make}>{live ? 'Make a new link (the old one stops working)' : 'Make my link'}</button>}
  </>, () => setStep(2), 'I copied it', !link);

  // Step 2: set up the sender
  if (step === 2 && method === 'puls') return guide('Step 2 of 3', <>
    <div className="stack" style={{ gap: 6 }}>
      <h1 className="h1-flow">Set up PulsHealth</h1>
      <p className="lead">It reads your workouts from Apple Health and sends them here by itself.</p>
    </div>
    <a className="btn btn-tint" style={{ height: 50, borderRadius: 25 }} href={PULS_URL} target="_blank" rel="noreferrer">Get PulsHealth (free)</a>
    <Taps steps={[
      <>Open it and tap <K>Get Started</K>.</>,
      <>On <K>Your Server</K>, skip the QR code. Under <b>Or enter it by hand</b>, paste the <b>server address</b> in the URL box and <b>your token</b> in <K>Bearer token</K>.</>,
      <>Tap <K>Test Connection</K>. It should say <b>Connected</b>. Then <K>Continue</K>.</>,
      <>On <K>Data Types</K>, keep <b>Workouts</b> on. You can turn the rest off; only runs are used.</>,
      <>Allow Health access when your iPhone asks, including <K>Workouts</K> and <K>Heart Rate</K>.</>,
      <>Finish. It sends your past runs, then new ones as you finish them.</>,
    ]} />
    <Why label="Test Connection failed?">
      <p><b>Token rejected</b> means the token was pasted wrong or is old. Copy it again from the last step.</p>
      <p><b>Can’t reach the server</b> usually means the address has a typo. It must start with <b className="mono">https://</b>.</p>
      <p>Everything is sent only to Bulletproof Base. Walks and bike rides are skipped.</p>
    </Why>
  </>, () => setStep(3), 'Next: test it');

  if (step === 2 && method === 'hae') return guide('Step 2 of 3', <>
    <div className="stack" style={{ gap: 6 }}>
      <h1 className="h1-flow">Set up Health Auto Export</h1>
      <p className="lead">It reads your workouts and sends them here on a schedule.</p>
    </div>
    <a className="btn btn-tint" style={{ height: 50, borderRadius: 25 }} href={HAE_URL} target="_blank" rel="noreferrer">Get Health Auto Export</a>
    <Taps steps={[
      <>Open it and allow Health access, including <K>Workouts</K>.</>,
      <>Start the Premium trial or upgrade. Automatic sending is a Premium feature.</>,
      <>Go to <K>Automations</K> and tap <K>+</K> (New Automation). Choose <K>REST API</K>.</>,
      <>Name it <b>Bulletproof Base</b>. In <K>URL</K>, paste your link.</>,
      <>Set <K>Data Type</K> to <b>Workouts</b> and <K>Export Format</K> to <b>JSON</b>. Turn off <K>Include Route Data</K>.</>,
      <>Set how often it syncs, for example every <b>1 hour</b>. Turn the automation on and save.</>,
    ]} />
    <Why label="Something looks different?">
      <p>Only three things matter: the <b>URL</b> is your link, the data is <b>Workouts</b>, and the format is <b>JSON</b>. Headers aren’t needed. Only runs are saved; walks and bike rides are skipped.</p>
    </Why>
  </>, () => setStep(3), 'Next: test it');

  if (step === 2) return guide('Step 2 of 3', <>
    <div className="stack" style={{ gap: 6 }}>
      <h1 className="h1-flow">Build the Shortcut</h1>
      <p className="lead">Open the <b>Shortcuts</b> app, tap <K>+</K>, and add these 3 actions.</p>
    </div>
    <p className="section-title" style={{ padding: '0 4px' }}>1 · Find your recent distance</p>
    <Taps steps={[
      <>Search <b>Find Health Samples</b> and tap it.</>,
      <>Tap the blue word after “Find” and choose <K>Walking + Running Distance</K>.</>,
      <>Tap <K>Add Filter</K>: <K>Start Date</K> <K>is in the last</K> <b>1 hour</b>. (Use 2 hours if your runs are longer than an hour.)</>,
    ]} />
    <p className="section-title" style={{ padding: '0 4px' }}>2 · Add it up</p>
    <Taps steps={[
      <>Search <b>Calculate Statistics</b> and tap it. Set it to <K>Sum</K> of <K>Health Samples</K>.</>,
    ]} />
    <p className="section-title" style={{ padding: '0 4px' }}>3 · Send it</p>
    <Taps steps={[
      <>Search <b>Get Contents of URL</b>, tap it, and paste your link in <K>URL</K>.</>,
      <>Tap the <K>›</K> arrow. <K>Method</K>: POST. <K>Request Body</K>: JSON.</>,
      <>Tap <K>Add new field</K> → <K>Text</K>. Key <b className="mono">distance</b>, value: pick <K>Statistics</K> from the bar above the keyboard.</>,
      <>Add another <K>Text</K> field: key <b className="mono">start</b>, value: <K>Current Date</K>.</>,
      <>Name the shortcut <b>Send run to Base</b> and tap <K>Done</K>.</>,
    ]} />
    <Why label="Why “the last hour”?">
      <p>iPhone’s Shortcuts can’t read a workout directly, so this adds up the distance your watch recorded in the hour before it runs. Since it runs right when you finish, that’s your run. A walk just before it can sneak in; tap the run in History to fix it.</p>
    </Why>
  </>, () => setStep(3), 'Next: test it');

  // Step 3: live test
  if (step === 3) return guide('Step 3 of 3', <>
    <div className="stack" style={{ gap: 6 }}>
      <h1 className="h1-flow">Test it once</h1>
      <p className="lead">{method === 'puls'
        ? <>Open <b>PulsHealth</b> and keep it open a minute. It sends your recent runs, which should show up below.</>
        : method === 'hae'
        ? <>In Health Auto Export, open your automation and tap <b>Manual Export</b> (or wait for the next sync). It sends your recent runs.</>
        : <>In Shortcuts, tap <b>Send run to Base</b>. Allow Health access when your iPhone asks.</>}</p>
    </div>
    <div className="card pad">
      <div className="live">
        <span className={`pulse${heard ? ' ok' : ''}`} />
        <span className="stack">
          <span style={{ fontWeight: 600 }}>{heard ? 'It works!' : pinged ? 'Got a message, checking it…' : 'Waiting for your test…'}</span>
          <span className="hint">{heard && lastWatch ? `Received ${lastWatch.distance_mi} mi from ${shortDay(lastWatch.date)}. It’s in your History.` : 'This updates by itself.'}</span>
        </span>
      </div>
    </div>
    {pinged && !heard && (
      <Why label="It sent something but no run appeared">
        {method !== 'shortcut'
          ? <p>Only runs are saved. If your recent workouts were walks or rides, finish a run and it’ll come through.{method === 'hae' && <> Check the format is <b>JSON</b> and the data type is <b>Workouts</b>.</>}</p>
          : <><p>Check the keys are spelled exactly <b className="mono">distance</b> and <b className="mono">start</b>.</p><p>If you haven’t walked or run in the last hour, the distance is 0 and nothing is saved. That’s fine; it’ll work after your next run.</p></>}
      </Why>
    )}
    {method === 'shortcut' && <p className="hint" style={{ padding: '0 4px' }}>Next you’ll make it run by itself after every run.</p>}
  </>, () => (method === 'shortcut' ? setStep(4) : setStep(99)), heard ? (method === 'shortcut' ? 'Next' : 'Done') : 'Skip the test');

  // Step 4 (Shortcut only): automation
  return guide('Last step', <>
    <div className="stack" style={{ gap: 6 }}>
      <h1 className="h1-flow">Make it automatic</h1>
      <p className="lead">Tell your iPhone to run it every time you finish a run. iPhone makes you do this part yourself.</p>
    </div>
    <Taps steps={[
      <>In Shortcuts, tap <K>Automation</K>, then <K>+</K>.</>,
      <>Scroll to <K>Apple Watch Workout</K> and tap it.</>,
      <>Choose <K>Ends</K>, tap <K>Choose</K> next to Workout, and pick <K>Running</K>.</>,
      <>Pick <K>Run Immediately</K>, then <K>Next</K>, and choose <b>Send run to Base</b>.</>,
    ]} />
  </>, () => setStep(99), 'Done');
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
