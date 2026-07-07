// ============================================================
// HOME BLOCK REGISTRY — the canonical list of home-screen blocks,
// their default order, and their metadata. Pure data (no React), so
// layout logic is unit-testable with zero UI overhead.
//
// Safety-critical blocks (Today, Week progress, Hip+speed status, Pain
// logger) are NON-hideable — they can be reordered but never turned off,
// so a corrupted or hand-edited setting can't bury the safety surfaces.
// Proposed blocks (real: false) are stubs, hidden by default, toggleable.
// ============================================================

export type BlockId =
  | 'today' | 'week' | 'hipspeed' | 'pain' | 'speed' | 'weeks'
  | 'nextweek' | 'races' | 'guardrails' | 'award' | 'backup' | 'evidence'
  // proposed stubs (Stage H):
  | 'notes' | 'checkin' | 'shoes' | 'coach' | 'weather';

export interface BlockMeta {
  id: BlockId;
  label: string;
  /** false = a proposed stub, not built yet (hidden by default). */
  real: boolean;
  /** false = can be reordered but never hidden (safety surfaces). */
  hideable: boolean;
  safetyCritical: boolean;
  /** Stub description shown in the layout editor. */
  desc?: string;
}

export const HOME_BLOCKS: BlockMeta[] = [
  { id: 'today',      label: 'Today',                real: true,  hideable: false, safetyCritical: true },
  { id: 'week',       label: 'Week progress',        real: true,  hideable: false, safetyCritical: true },
  { id: 'hipspeed',   label: 'Hip + speed status',   real: true,  hideable: false, safetyCritical: true },
  { id: 'pain',       label: 'Pain logger',          real: true,  hideable: false, safetyCritical: true },
  { id: 'speed',      label: 'Speed plan',           real: true,  hideable: true,  safetyCritical: false },
  { id: 'weeks',      label: 'The block',            real: true,  hideable: true,  safetyCritical: false },
  { id: 'nextweek',   label: 'Generate future weeks',real: true,  hideable: true,  safetyCritical: false },
  { id: 'races',      label: 'Races & projection',   real: true,  hideable: true,  safetyCritical: false },
  { id: 'guardrails', label: 'Guardrails',           real: true,  hideable: true,  safetyCritical: false },
  { id: 'award',      label: 'Award tracker',        real: true,  hideable: true,  safetyCritical: false },
  { id: 'backup',     label: 'Backup / restore',     real: true,  hideable: true,  safetyCritical: false },
  { id: 'evidence',   label: 'Evidence',             real: true,  hideable: true,  safetyCritical: false },
  // ── Proposed blocks (Stage H) — polished stubs, hidden by default ──
  { id: 'notes',   label: 'Daily notes',         real: false, hideable: true, safetyCritical: false, desc: 'Free-text note per run — how it felt, terrain, weather.' },
  { id: 'checkin', label: 'Weekly check-in',     real: false, hideable: true, safetyCritical: false, desc: 'Sleep, soreness, and RPE trend to catch overload early.' },
  { id: 'shoes',   label: 'Shoe mileage',        real: false, hideable: true, safetyCritical: false, desc: 'Rotate pairs and retire them at a mileage threshold.' },
  { id: 'coach',   label: 'Coach / PT thread',   real: false, hideable: true, safetyCritical: false, desc: 'Shared notes and clearance sign-off with your coach.' },
  { id: 'weather', label: 'Heat-adjusted effort',real: false, hideable: true, safetyCritical: false, desc: 'Nudge the easy HR target in heat and humidity.' },
];

/** Ids of the proposed stubs — hidden by default in a fresh layout. */
export const STUB_IDS: BlockId[] = HOME_BLOCKS.filter(b => !b.real).map(b => b.id);

export function blockMeta(id: string): BlockMeta | undefined {
  return HOME_BLOCKS.find(b => b.id === id);
}
