import { useEffect, useState, type ReactNode } from 'react';
import { go, type Route } from '../app/router.ts';

const PATHS = {
  today: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  plan: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  history: <path d="M5 20v-8M12 20V5M19 20v-5" />,
  you: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20c1.4-3.5 4.3-5 7.5-5s6.1 1.5 7.5 5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  watch: <><rect x="6.5" y="6" width="11" height="12" rx="3" /><path d="M9 6l.7-3h4.6l.7 3" /><path d="M9 18l.7 3h4.6l.7-3" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  chev: <path d="M9 6l6 6-6 6" />,
  back: <path d="M15 6l-6 6 6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  stop: <><path d="M8.5 3h7l5 5v7l-5 5h-7l-5-5V8z" /><path d="M12 8v5" /><path d="M12 16.2v.1" /></>,
  bike: <><circle cx="6" cy="16" r="3.5" /><circle cx="18" cy="16" r="3.5" /><path d="M6 16l4.5-7H15l3 7" /><path d="M9 6h3" /><path d="M12.5 9L10 16" /></>,
  easy: <><path d="M4 12h16" /><path d="M14 6l6 6-6 6" /></>,
  pencil: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  share: <><path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" /></>,
  bell: <><path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 004 0" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="3" /><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" /></>,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />,
  cal: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.6v.1" /></>,
  shoe: <path d="M3 16c0-3 1-7 3-9l3 3c2 0 4 1 6 2l5 1.5c1 .3 1 2.5 1 3.5H3z" />,
  logo: <><path d="M4 17l5-5 4 3 7-8" /><path d="M15 7h5v5" /></>,
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, stroke = 1.8, color = 'currentColor' }: { name: IconName; size?: number; stroke?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {PATHS[name]}
    </svg>
  );
}

export function Bubble({ icon, bg = 'var(--blue-t)', fg = 'var(--blue)', small, size }: { icon: IconName; bg?: string; fg?: string; small?: boolean; size?: number }) {
  return (
    <span className={`bubble${small ? ' sm' : ''}`} style={{ background: bg, ...(size ? { width: size, height: size, borderRadius: size / 2 } : {}) }}>
      <Icon name={icon} size={small ? 17 : size ? size * 0.55 : 20} color={fg} />
    </span>
  );
}

export function LargeTitle({ title, eyebrow, right }: { title: string; eyebrow?: string; right?: ReactNode }) {
  // A glass bar with the small title fades in once the large one scrolls away.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 56);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <>
      <div className={`topbar${scrolled ? ' on' : ''}`} aria-hidden="true">{title}</div>
      <header className="largetitle">
        <div className="stack" style={{ gap: 2 }}>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
        </div>
        {right}
      </header>
    </>
  );
}

/** A section heading with one plain line saying what the section is for. */
export function Section({ title, hint, right, children }: { title: string; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="stack" style={{ gap: 10 }}>
      <div className="sechead">
        <div className="stack"><h2>{title}</h2>{hint && <p>{hint}</p>}</div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Tap to read more: keeps screens short while every number stays explained. */
export function Why({ label = 'What does this mean?', children }: { label?: string; children: ReactNode }) {
  return (
    <details className="why">
      <summary>{label}</summary>
      <div>{children}</div>
    </details>
  );
}

export function NavBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="navbar">
      {onBack ? <button className="btn btn-cap btn-icon" aria-label="Back" onClick={onBack}><Icon name="back" stroke={2.2} /></button> : <span style={{ width: 44 }} />}
      <span className="title">{title}</span>
      {right ?? <span style={{ width: 44 }} />}
    </header>
  );
}

export function Progress({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <div className="progress" aria-label={label} style={{ gridTemplateColumns: `repeat(${total}, minmax(0,1fr))` }}>
      {Array.from({ length: total }, (_, i) => <span key={i} className={i < step ? 'on' : ''} />)}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="toggle">
      <input type="checkbox" aria-label={label} checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="track" /><span className="knob" />
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(o => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Pill({ children, onClick, kind = 'tint', icon, label }: { children: ReactNode; onClick: () => void; kind?: 'tint' | 'cap'; icon?: IconName; label?: string }) {
  return (
    <button className={`pill ${kind}`} onClick={onClick} aria-label={label}>
      <span>{icon && <Icon name={icon} size={15} stroke={2.2} />}{children}</span>
    </button>
  );
}

export function Row({ label, sub, value, onClick, lead, badge, action, danger }: {
  label: ReactNode; sub?: ReactNode; value?: ReactNode; onClick?: () => void; lead?: ReactNode; badge?: ReactNode; action?: string; danger?: boolean;
}) {
  const inner = (
    <>
      {lead}
      <span className="grow"><span className="label">{label}</span>{sub && <span className="sub">{sub}</span>}</span>
      {badge}
      {action ? <span className="tail-pill">{action}</span> : <>
        {value != null && <span className="val num">{value}</span>}
        {onClick && !danger && <Icon name="chev" size={16} color="#9C9CA3" stroke={2} />}
      </>}
    </>
  );
  return onClick
    ? <button className={`row${danger ? ' danger' : ''}`} onClick={onClick}>{inner}</button>
    : <div className={`row${danger ? ' danger' : ''}`}>{inner}</div>;
}

export function Group({ title, hint, children, right }: { title?: string; hint?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="group" style={{ gap: 8 }}>
      {(title || right) && (
        <div className="sechead">
          <div className="stack">{title && <h2>{title}</h2>}{hint && <p>{hint}</p>}</div>
          {right}
        </div>
      )}
      <div className="card rows">{children}</div>
    </section>
  );
}

export function Sheet({ children, onClose, white, label }: { children: ReactNode; onClose: () => void; white?: boolean; label: string }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-label={label} className={`sheet${white ? ' white' : ''}`}>
        <span className="grabber" />
        {children}
      </section>
    </>
  );
}

const TABS: { route: Route; label: string; icon: IconName }[] = [
  { route: 'today', label: 'Today', icon: 'today' },
  { route: 'plan', label: 'Plan', icon: 'plan' },
  { route: 'history', label: 'History', icon: 'history' },
  { route: 'you', label: 'You', icon: 'you' },
];
export function TabBar({ active, onAdd }: { active: Route; onAdd: () => void }) {
  return (
    <>
      <div className="tabfade" />
      <nav className="tabbar" aria-label="Main">
        <div className="tabs">
          {TABS.map(t => (
            <button key={t.route} className="tab" aria-current={active === t.route ? 'page' : undefined} onClick={() => go(t.route)}>
              <Icon name={t.icon} size={22} stroke={active === t.route ? 2 : 1.8} />{t.label}
            </button>
          ))}
        </div>
        <button className="fab" aria-label="Add a run" onClick={onAdd}><Icon name="plus" size={24} stroke={2.2} /></button>
      </nav>
    </>
  );
}

export function BigNum({ n, unit }: { n: ReactNode; unit: string }) {
  return <div className="bignum"><span className="n">{n}</span><span className="u">{unit}</span></div>;
}
