import { useState } from 'react';

interface Props {
  onConfirm: (code: string) => void;
}

export default function AccessCodeModal({ onConfirm }: Props) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  function submit() {
    const trimmed = code.trim();
    if (trimmed.length < 4) {
      setError('Use at least 4 characters.');
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 space-y-5">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-100">
            Set your access code
          </h2>
          <p className="mt-1 text-sm text-slate-400 leading-relaxed">
            This code partitions your log in the database. Type the same code on
            any device to see the same data.
          </p>
        </div>

        {/* Security disclaimer */}
        <div className="rounded-lg bg-rose-950/40 border border-rose-900/50 p-3 text-xs text-rose-300 leading-relaxed">
          <strong className="text-rose-200">Heads up. This is convenience, not real security.</strong>{' '}
          The database key is embedded in the page (that's normal for Supabase static
          sites). Anyone who guesses your code can read your log. Fine for a training
          journal; don't use a password you care about.
        </div>

        <input
          className="w-full bg-ink border border-border rounded-lg px-4 py-3 text-slate-100
                     font-display text-base placeholder:text-slate-600 outline-none
                     focus:border-teal-500/70 transition"
          type="text"
          placeholder="e.g. runner2026 or a PIN"
          value={code}
          onChange={e => { setCode(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && submit()}
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />

        {error && <p className="text-xs text-rose-400">{error}</p>}

        <button
          onClick={submit}
          className="w-full rounded-lg bg-teal-600 hover:bg-teal-500 active:scale-[0.98]
                     text-white font-display font-semibold py-3 transition-all"
        >
          Start tracking
        </button>
      </div>
    </div>
  );
}
