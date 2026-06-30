import { useState } from 'react';
import type { RunState } from '../lib/types';

interface Props {
  runState: RunState;
  onRestore: (state: RunState) => void;
}

export default function BackupRestore({ runState, onRestore }: Props) {
  const [open, setOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [msg, setMsg] = useState('');

  function exportData() {
    const text = JSON.stringify(runState, null, 2);
    navigator.clipboard.writeText(text).then(
      () => setMsg('Copied to clipboard ✓'),
      () => setMsg('Copy failed — select and copy the text above manually'),
    );
  }

  function importData() {
    try {
      const parsed = JSON.parse(importText);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad format');
      onRestore(parsed as RunState);
      setMsg('Restored ✓ (Supabase sync will happen in background)');
      setImportText('');
    } catch {
      setMsg('Invalid format — paste the full exported JSON.');
    }
  }

  return (
    <div className="card space-y-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between py-1 text-left hover:opacity-80 transition"
      >
        <span className="text-xs text-slate-600">Backup / restore</span>
        <span className="text-slate-700 text-xs">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <p className="text-xs text-slate-600">
            Safety net — Supabase is the primary sync. Export copies your log as
            JSON; import reads it back. Useful if you switch Supabase projects or want an offline backup.
          </p>

          <button
            onClick={exportData}
            className="w-full rounded-lg border border-border py-2 text-xs
                       text-slate-400 hover:border-slate-600 hover:text-slate-300
                       transition-all active:scale-[0.98]"
          >
            Copy my progress as text
          </button>

          <div className="space-y-2">
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder="Paste exported JSON here to restore…"
              rows={4}
              className="w-full bg-ink border border-border rounded-lg px-3 py-2
                         text-xs text-slate-400 font-mono placeholder:text-slate-700
                         outline-none focus:border-teal-500/40 resize-none transition"
            />
            <button
              onClick={importData}
              disabled={!importText.trim()}
              className="w-full rounded-lg border border-border py-2 text-xs
                         text-slate-400 hover:border-slate-600 hover:text-slate-300
                         disabled:opacity-30 disabled:cursor-not-allowed
                         transition-all active:scale-[0.98]"
            >
              Paste to restore
            </button>
          </div>

          {msg && <p className="text-xs text-teal-500">{msg}</p>}
        </div>
      )}
    </div>
  );
}
