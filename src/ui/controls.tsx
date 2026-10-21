// Small shared controls: an on/off switch, a labelled slider, and a popover
// that opens under its button (menus, the mixer) and closes on a click outside
// or Escape.

import { useEffect, useRef, useState, type ReactNode } from 'react';

/** A checkbox drawn as a switch. With `label`, the whole label toggles it. */
export function Switch(p: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label?: ReactNode;
  title?: string;
  disabled?: boolean;
  /** Half on: some of a group are on. */
  indeterminate?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!p.indeterminate;
  }, [p.indeterminate]);
  const input = (
    <input
      ref={ref}
      type="checkbox"
      className="switch"
      role="switch"
      checked={p.checked}
      disabled={p.disabled}
      aria-label={p.ariaLabel}
      onChange={(e) => p.onChange(e.target.checked)}
      title={p.label ? undefined : p.title}
    />
  );
  if (!p.label) return input;
  return (
    <label className={`switch-label${p.className ? ` ${p.className}` : ''}`} title={p.title}>
      {input}
      {p.label}
    </label>
  );
}

export function Slider(p: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  /** How the value reads, when not just the number and unit. */
  format?: (v: number) => string;
}) {
  return (
    <label className="slider">
      <span>{p.label}</span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
      <output>{p.format ? p.format(p.value) : `${p.value}${p.unit}`}</output>
    </label>
  );
}

/** A button that opens a panel under it. The panel gets `close` to shut itself (after picking a menu item, say). */
export function Popover(p: {
  button: ReactNode;
  title?: string;
  ariaLabel?: string;
  className?: string;
  align?: 'left' | 'right';
  /** Opens upward, for buttons at the bottom of the window. */
  up?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);
  return (
    <div className={`popover${p.className ? ` ${p.className}` : ''}`} ref={ref}>
      <button className={`popover-button${open ? ' open' : ''}`} onClick={() => setOpen((o) => !o)} title={p.title} aria-label={p.ariaLabel} aria-expanded={open}>
        {p.button}
      </button>
      {open && <div className={`popover-panel ${p.align ?? 'left'}${p.up ? ' up' : ''}`}>{p.children(() => setOpen(false))}</div>}
    </div>
  );
}
