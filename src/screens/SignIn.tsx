import { useRef, useState } from 'react';
import { api, db } from '../data/api.ts';
import { useStore } from '../data/store.tsx';
import { Icon, NavBar } from '../ui/kit.tsx';

// 6 digits = the pairing code shown after tapping the email link.
// 8 digits = an email code (once the project's email template carries one).
const OTP_LEN = 6;

export function SignIn() {
  const { toast } = useStore();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  async function send() {
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Enter your email address.');
    setBusy(true);
    try {
      await api.sendCode(email);
      setStep('code');
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (e) {
      const m = (e as Error).message;
      toast(/not authorized/i.test(m) ? 'Email sign-in isn’t set up for this address yet. Ask the team captain.' : m);
    } finally { setBusy(false); }
  }
  async function verify(v = code) {
    if (v.length < 6) return;
    setBusy(true);
    try { if (v.length === 6) await api.pair(email, v); else await api.verifyCode(email, v); }
    catch (e) { toast((e as Error).message || 'That code didn’t work.'); setCode(''); }
    finally { setBusy(false); }
  }

  if (step === 'code') {
    return (
      <main className="page flow">
        <NavBar title="Sign in" onBack={() => setStep('email')} />
        <div className="stack" style={{ gap: 6, paddingTop: 8 }}>
          <h1 className="h1-flow">Check your email</h1>
          <p className="lead">We sent an email to {email}. Tap the link in it. The page that opens shows a 6-digit code: type it here.</p>
        </div>
        <label className="field" style={{ position: 'relative' }}>
          <span>6-digit code</span>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${OTP_LEN}, minmax(0,1fr))`, gap: 6 }} onClick={() => codeRef.current?.focus()}>
            {Array.from({ length: OTP_LEN }, (_, i) => (
              <span key={i} className="center num" style={{ height: 56, borderRadius: 12, background: 'var(--card)', boxShadow: `inset 0 0 0 ${i === code.length ? 2 : 1}px ${i === code.length ? 'var(--ink)' : 'var(--field)'}`, fontSize: 28, fontWeight: 700 }}>{code[i] ?? ''}</span>
            ))}
          </div>
          <input ref={codeRef} inputMode="numeric" autoComplete="one-time-code" aria-label="Code from the email" value={code}
            onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 8); setCode(v); if (v.length === OTP_LEN) void verify(v); }}
            style={{ position: 'absolute', opacity: 0, inset: 0, height: '100%' }} />
        </label>
        <p className="small">Opened the link on this same screen? You’re already signed in; this page will update by itself.</p>
        <button className="btn btn-gray" onClick={send} disabled={busy}>Send a new link</button>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => verify()} disabled={busy || code.length < 6}>Continue</button>
      </main>
    );
  }

  return (
    <main className="page flow">
      <div className="spacer" />
      <div className="stack" style={{ gap: 18 }}>
        <span className="center" style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--ink)' }}><Icon name="logo" size={34} stroke={2.2} color="var(--card)" /></span>
        <h1 style={{ fontSize: 40, lineHeight: '44px', fontWeight: 700, letterSpacing: '-0.03em' }}>Run all year.<br />Stay healthy doing it.</h1>
        <p className="lead">A plan built around your school seasons. Your watch fills it in. You just run.</p>
      </div>
      <form className="stack" style={{ gap: 12, marginTop: 14 }} onSubmit={e => { e.preventDefault(); void send(); }}>
        <label className="field"><span>Email</span>
          <input className="input" type="email" autoComplete="email" placeholder="you@school.org" value={email} onChange={e => setEmail(e.target.value)} />
        </label>
      </form>
      <div className="spacer" />
      <button className="btn btn-primary" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
      <p className="small" style={{ textAlign: 'center' }}>No password. Only you can see your runs.</p>
    </main>
  );
}

export function RedeemInvite() {
  const { act, session, toast } = useStore();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  return (
    <main className="page flow">
      <NavBar title="Join" right={<button className="btn btn-cap" onClick={() => db.auth.signOut({ scope: 'local' })}>Sign out</button>} />
      <div className="stack" style={{ gap: 6, paddingTop: 8 }}>
        <h1 className="h1-flow">You’re in. One more thing.</h1>
        <p className="lead">This app is invite-only. Enter the code a teammate gave you.</p>
      </div>
      <label className="field"><span>Your first name</span><input className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="given-name" /></label>
      <label className="field"><span>Invite code</span><input className="input" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="BASE-XXXXX" autoCapitalize="characters" /></label>
      <p className="small">Signed in as {session?.user.email}</p>
      <div className="spacer" />
      <button className="btn btn-primary" onClick={() => {
        if (!name.trim() || !code.trim()) return toast('Add your name and the invite code.');
        void act(() => api.redeem(code, name.trim()));
      }}>Join</button>
    </main>
  );
}
