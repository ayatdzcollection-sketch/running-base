import { useState } from 'react';
import type { GlobalState, RunState } from '../lib/types';
import { buildBackup, parseBackup } from '../lib/storage';

interface Props {
  runState: RunState;
  globals: GlobalState;
  onRestore: (state: RunState, globals: GlobalState | null) => void;
}

export default function BackupRestore({ runState, globals, onRestore }: Props) {
  const [open, setOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [msg, setMsg] = useState('');

  function exportData() {
    // v2 envelope: run log + global speed-layer state in one blob.
    const text = JSON.stringify(buildBackup(runState, globals), null, 2);
    navigator.clipboard.writeText(text).then(
      () => setMsg('Copied to clipboard ✓'),
      () => setMsg('Copy failed — select and copy the text above manually'),
    );
  }

  function importData() {
    try {
      // Accepts both the new envelope and the original flat export.
      const { runs, globals: importedGlobals } = parseBackup(importText);
      onRestore(runs, importedGlobals);
      setMsg('Restored ✓ (Supabase sync will happen in background)');
      setImportText('');
    } catch {
      setMsg('Invalid format — paste the full exported JSON.');
    }
  }

  return (
    <section data-block="backup" className="card !rounded-2xl px-2 py-1.5 flex flex-col">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-2.5 py-2.5 text-left"
      >
        <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-slate-500">BACKUP / RESTORE</span>
        <span className="text-slate-600 text-[10px]">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-2.5 pb-3 space-y-3 border-t border-[#101a2c] pt-3">
          <p className="text-[11.5px] leading-relaxed text-slate-500">
            Safety net — export copies your log (runs + speed-plan state) as JSON; paste it back to
            restore. Useful when switching devices or for an offline backup; old-format exports still
            restore fine.
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

          {msg && <p className="text-xs text-teal-400">{msg}</p>}
        </div>
      )}
    </section>
  );
}
