// ============================================================
// HOME BLOCK REGISTRY — the canonical list of home-screen blocks,
// their default order, and their metadata. Pure data (no React), so
// layout logic is unit-testable with zero UI overhead.
//
// Safety-critical blocks (Today, Week progress, Hip+speed status, Pain
// logger) are NON-hideable — they can be reordered but never turned off,
// so a corrupted or hand-edited setting can't bury the safety surfaces.
// Secondary widgets (notes, check-in, shoes, coach log, heat) are real and
// functional but HIDDEN BY DEFAULT (defaultHidden) so the default home stays
// focused — the user opts into them from Settings → Home layout.
// ============================================================

export type BlockId =
  | 'today' | 'week' | 'hipspeed' | 'pain' | 'speed' | 'weeks'
  | 'adaptive' | 'nextweek' | 'races' | 'guardrails' | 'award' | 'backup' | 'evidence'
  // proposed stubs (Stage H):
  | 'notes' | 'checkin' | 'shoes' | 'coach' | 'weather';

export interface BlockMeta {
  id: BlockId;
  label: string;
  /** false = a proposed stub, not built yet. All blocks ship real now. */
  real: boolean;
  /** false = can be reordered but never hidden (safety surfaces). */
  hideable: boolean;
  safetyCritical: boolean;
  /** true = real and functional, but off in a fresh layout (opt-in). */
  defaultHidden?: boolean;
  /** Short description shown in the layout editor. */
  desc?: string;
}

export const HOME_BLOCKS: BlockMeta[] = [
  { id: 'today',      label: 'Today',                real: true,  hideable: false, safetyCritical: true },
  { id: 'week',       label: 'Week progress',        real: true,  hideable: false, safetyCritical: true },
  { id: 'hipspeed',   label: 'Hip + speed status',   real: true,  hideable: false, safetyCritical: true },
  { id: 'pain',       label: 'Pain logger',          real: true,  hideable: false, safetyCritical: true },
  { id: 'adaptive',   label: 'Training response',    real: true,  hideable: true,  safetyCritical: false },
  { id: 'speed',      label: 'Speed plan',           real: true,  hideable: true,  safetyCritical: false },
  { id: 'weeks',      label: 'The block',            real: true,  hideable: true,  safetyCritical: false },
  { id: 'nextweek',   label: 'Generate future weeks',real: true,  hideable: true,  safetyCritical: false },
  { id: 'races',      label: 'Races & projection',   real: true,  hideable: true,  safetyCritical: false },
  { id: 'guardrails', label: 'Guardrails',           real: true,  hideable: true,  safetyCritical: false },
  { id: 'award',      label: 'Award tracker',        real: true,  hideable: true,  safetyCritical: false },
  { id: 'backup',     label: 'Backup / restore',     real: true,  hideable: true,  safetyCritical: false },
  { id: 'evidence',   label: 'Evidence',             real: true,  hideable: true,  safetyCritical: false },
  // ── Secondary widgets (Stage H → v4) — real, functional, off by default ──
  { id: 'notes',   label: 'Daily notes',         real: true, hideable: true, safetyCritical: false, defaultHidden: true, desc: 'Free-text note per day: how it felt, terrain, weather.' },
  { id: 'checkin', label: 'Weekly check-in',     real: true, hideable: true, safetyCritical: false, defaultHidden: true, desc: 'Sleep, soreness, energy and stress to catch overload early. Advisory only.' },
  { id: 'shoes',   label: 'Shoe mileage',        real: true, hideable: true, safetyCritical: false, defaultHidden: true, desc: 'Track pairs and retire them at a mileage threshold. Advisory only.' },
  { id: 'coach',   label: 'Coach / PT log',      real: true, hideable: true, safetyCritical: false, defaultHidden: true, desc: 'A private log of what your coach or PT said. Nothing is sent.' },
  { id: 'weather', label: 'Heat-adjusted effort',real: true, hideable: true, safetyCritical: false, defaultHidden: true, desc: 'Slow the pace to hold effort in heat. Never changes a cap or gate.' },
];

/** Ids hidden in a fresh layout — real but opt-in secondary widgets. */
export const DEFAULT_HIDDEN_IDS: BlockId[] = HOME_BLOCKS.filter(b => b.defaultHidden).map(b => b.id);

export function blockMeta(id: string): BlockMeta | undefined {
  return HOME_BLOCKS.find(b => b.id === id);
}
