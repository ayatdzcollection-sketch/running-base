import { useEffect, useState } from 'react';
import { api } from '../data/api.ts';
import { Icon } from '../ui/kit.tsx';

/** Shown in a browser that just signed in (e.g. Safari after the email
 *  link): a short code to sign in the Home Screen app or another device. */
export function Handoff({ onDone, fromLink }: { onDone: () => void; fromLink: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const make = () => { setErr(null); setCode(null); api.makePairingCode().then(setCode, e => setErr((e as Error).message)); };
  useEffect(make, []);
  return (
    <main className="page flow">
      <div className="spacer" />
      <div className="stack" style={{ gap: 14, alignItems: 'center', textAlign: 'center' }}>
        <span className="center" style={{ width: 64, height: 64, borderRadius: 32, background: 'var(--teal-t)' }}><Icon name="check" size={32} stroke={2.4} color="var(--teal-d)" /></span>
        <h1 className="h1-flow">{fromLink ? 'You’re signed in' : 'Sign in on another device'}</h1>
        <p className="lead">{fromLink ? 'Using the app from your Home Screen? Type this code there.' : 'On the other device, enter your email, then type this code.'}</p>
        <div className="card" style={{ padding: '18px 26px', marginTop: 6 }}>
          <span className="num" style={{ fontSize: 44, fontWeight: 700, letterSpacing: '0.12em' }}>{code ? `${code.slice(0, 3)} ${code.slice(3)}` : err ? '–' : '···'}</span>
        </div>
        <p className="small">{err ?? 'Works once, for 10 minutes.'}</p>
        <button className="btn btn-tint" onClick={make}>New code</button>
      </div>
      <div className="spacer" />
      <button className="btn btn-primary" onClick={onDone}>{fromLink ? 'Continue in this browser' : 'Done'}</button>
    </main>
  );
}
