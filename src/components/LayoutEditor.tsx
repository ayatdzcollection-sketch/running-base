import { useState } from 'react';
import { HOME_BLOCKS, DEFAULT_HIDDEN_IDS, type BlockId } from '../config/homeBlocks';
import { sanitizeOrder, sanitizeHidden, moveBlock, toggleHidden } from '../lib/layout';

// Home layout editor (Settings → Home layout). Real <button> reorder controls
// give a keyboard-complete flow with no drag dependency; DOM order equals the
// stored order, so screen readers and the home screen stay in sync. Safety
// blocks (Today, Week, Hip+speed, Pain) are non-hideable — shown with a
// "pinned" pill instead of an on/off toggle.

interface Props {
  layoutOrder: string[] | undefined;
  layoutOff: string[] | undefined;
  onChange: (order: BlockId[], off: BlockId[]) => void;
}

export default function LayoutEditor({ layoutOrder, layoutOff, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [announce, setAnnounce] = useState('');

  const order = sanitizeOrder(layoutOrder, HOME_BLOCKS);
  const off = sanitizeHidden(layoutOff, HOME_BLOCKS);
  const shown = order.filter(id => !off.includes(id)).length;

  function move(id: BlockId, dir: -1 | 1) {
    const next = moveBlock(order, id, dir);
    onChange(next, off);
    const pos = next.indexOf(id) + 1;
    setAnnounce(`${HOME_BLOCKS.find(b => b.id === id)?.label} moved ${dir < 0 ? 'up' : 'down'}, position ${pos} of ${next.length}`);
  }
  function toggle(id: BlockId) {
    const next = toggleHidden(off, id, HOME_BLOCKS);
    onChange(order, next);
    setAnnounce(`${HOME_BLOCKS.find(b => b.id === id)?.label} ${next.includes(id) ? 'hidden' : 'shown'}`);
  }
  function resetLayout() {
    // Registry default order, secondary widgets hidden. Safety blocks are
    // already non-hideable, so this can never bury a safety surface.
    onChange(HOME_BLOCKS.map(b => b.id), [...DEFAULT_HIDDEN_IDS]);
    setAnnounce('Home layout reset to default');
  }
  const isDefault = order.join(',') === HOME_BLOCKS.map(b => b.id).join(',')
    && [...off].sort().join(',') === [...DEFAULT_HIDDEN_IDS].sort().join(',');

  return (
    <div className="rounded-xl border border-border bg-[#0b1220] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left"
      >
        <span className="font-display text-[13px] font-semibold text-slate-200 shrink-0">Home layout</span>
        <span className="flex-1 min-w-0 text-[11.5px] text-slate-500 text-right truncate">{shown} shown · {order.length - shown} hidden</span>
        <span className="shrink-0 w-3 text-center text-[10px] text-slate-600">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-3.5 pb-2">
          <span className="block text-[11px] leading-relaxed text-slate-600 pt-0.5 pb-1.5">
            Reorder blocks or hide them. Some extras are off by default — turn on what you want. Safety blocks stay pinned.
          </span>
          <div aria-live="polite" className="sr-only">{announce}</div>
          {order.map((id, i) => {
            const b = HOME_BLOCKS.find(x => x.id === id)!;
            const isOff = off.includes(id);
            return (
              <div key={id} className="flex items-center gap-2.5 py-[7px] border-b border-[#101a2c] last:border-0">
                <div className="shrink-0 flex flex-col gap-0.5">
                  <button
                    onClick={() => move(id, -1)} disabled={i === 0} aria-label={`Move ${b.label} up`}
                    className="w-7 h-5 rounded-md bg-[#0b1220] border border-border grid place-items-center text-[8px] text-slate-400 disabled:text-[#26303f] hover:enabled:border-slate-600 transition"
                  >▲</button>
                  <button
                    onClick={() => move(id, 1)} disabled={i === order.length - 1} aria-label={`Move ${b.label} down`}
                    className="w-7 h-5 rounded-md bg-[#0b1220] border border-border grid place-items-center text-[8px] text-slate-400 disabled:text-[#26303f] hover:enabled:border-slate-600 transition"
                  >▼</button>
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-px">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[13px] ${b.real ? 'text-slate-200' : isOff ? 'text-slate-500' : 'text-slate-300'}`}>{b.label}</span>
                    {!b.real && (
                      <span className="inline-flex px-1.5 rounded-full font-display text-[9px] font-semibold tracking-[0.06em] bg-slate-500/[0.12] text-slate-500 border border-border">SOON</span>
                    )}
                  </div>
                  {b.desc && <span className="text-[11px] leading-tight text-slate-600">{b.desc}</span>}
                </div>
                {b.hideable ? (
                  <button
                    onClick={() => toggle(id)}
                    aria-pressed={!isOff}
                    className={`shrink-0 h-8 min-w-[54px] px-3 rounded-lg font-display text-xs font-semibold transition ${
                      !isOff ? 'bg-teal-500/[0.12] text-teal-300 border border-teal-500/35' : 'bg-transparent text-slate-500 border border-border'}`}
                  >{isOff ? 'Off' : 'On'}</button>
                ) : (
                  <span className="shrink-0 h-8 min-w-[54px] px-3 grid place-items-center rounded-lg text-[11px] text-slate-600 border border-border">pinned</span>
                )}
              </div>
            );
          })}
          <div className="flex justify-end pt-2">
            <button
              onClick={resetLayout}
              disabled={isDefault}
              className="text-[11px] text-slate-500 hover:text-slate-300 disabled:text-slate-700 disabled:cursor-not-allowed transition"
            >Reset to default order</button>
          </div>
        </div>
      )}
    </div>
  );
}
