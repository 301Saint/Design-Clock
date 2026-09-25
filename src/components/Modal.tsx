import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, sub, onClose, children, footer, wide, className = '', closeOnBackdrop = true }: {
  title?: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
  closeOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only the top-most dialog reacts.
      const overlays = document.querySelectorAll('.overlay');
      if (overlays[overlays.length - 1] !== ref.current?.parentElement) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    // Focus the first autofocus target, or the dialog itself.
    requestAnimationFrame(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current;
      if (el && !ref.current?.contains(document.activeElement)) el.focus();
    });
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''} ${className}`} ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
        {title !== undefined && (
          <div className="modal-head">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3>{title}</h3>
              {sub && <div className="sub">{sub}</div>}
            </div>
            <button className="btn ghost sm icon" onClick={onClose} aria-label="Close" tabIndex={-1}><X size={15} /></button>
          </div>
        )}
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}
