// Kleine UI-Bausteine

import { X } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { initials } from '../lib/format.ts';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" role="status">
      <span className="spinner" aria-hidden="true" />
      {label ? <span className="muted small">{label}</span> : <span className="sr-only">Lädt…</span>}
    </span>
  );
}

export function Loading({ label = 'Lädt…' }: { label?: string }) {
  return (
    <div className="center">
      <Spinner label={label} />
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function Dot({ color }: { color: string }) {
  return <span className="dot" style={{ background: color }} aria-hidden="true" />;
}

export function Tag({ color, children, tone, title }: { color?: string; children: ReactNode; tone?: 'green' | 'amber' | 'red' | 'blue' | 'soft'; title?: string }) {
  return (
    <span className={cx('tag', tone)} title={title}>
      {color ? <Dot color={color} /> : null}
      <span className="ellipsis">{children}</span>
    </span>
  );
}

export function Avatar({ name, color, large }: { name: string; color?: string; large?: boolean }) {
  return (
    <span className={cx('avatar', large && 'l')} style={{ background: color || '#5b6b7f' }} title={name} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
}: {
  value: T;
  tabs: { value: T; label: ReactNode; icon?: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={t.value === value} onClick={() => onChange(t.value)}>
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

// Kippschalter (an/aus) – für Einstellungen wie „Erreichbar“, „Pflichtfeld“, „Immer zeigen“
export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      title={label}
      className={cx('switch', checked && 'on')}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" aria-hidden="true" />
    </button>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('field', className)}>
      <label>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

// ---------- Modal ----------
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.icon-btn)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div
      className="backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cx('modal', wide && 'wide')} role="dialog" aria-modal="true" ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen">
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Inline-Fenster ----------
// Wie ein Modal, aber direkt im Seitenfluss – z. B. der E-Mail-/SMS-/Aktivitäts-Editor oben im
// Verlauf der Lead-Seite (so arbeitet Close: kein Fenster legt sich über den Lead).
export function InlinePanel({
  title,
  onClose,
  children,
  footer,
  className,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const fields = Array.from(box.querySelectorAll<HTMLElement>('input:not([type="hidden"]):not([type="checkbox"]):not([type="file"]), textarea, [contenteditable="true"]'));
    // erstes leeres Feld (z. B. Betreff statt der schon ausgefüllten Adresse)
    const empty = fields.find((f) => (f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement ? !f.value : !f.textContent?.trim()));
    (empty ?? fields[0])?.focus({ preventScroll: true });
    box.scrollIntoView({ block: 'nearest' });
  }, []);
  return (
    <div
      className={cx('inline-panel', className)}
      ref={ref}
      role="region"
      aria-label={typeof title === 'string' ? title : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="inline-panel-head">
        <h3>{title}</h3>
        <button type="button" className="icon-btn small" onClick={onClose} aria-label="Schließen" title="Schließen (Esc)">
          <X />
        </button>
      </div>
      <div className="inline-panel-body">{children}</div>
      {footer ? <div className="inline-panel-foot">{footer}</div> : null}
    </div>
  );
}

// ---------- Popover / Menü ----------
export function Popover({
  anchor,
  onClose,
  children,
  align = 'start',
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  align?: 'start' | 'end';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const p = ref.current.getBoundingClientRect();
    let top = a.bottom + 6;
    if (top + p.height > window.innerHeight - 8) top = Math.max(8, a.top - p.height - 6);
    let left = align === 'end' ? a.right - p.width : a.left;
    left = Math.min(Math.max(8, left), window.innerWidth - p.width - 8);
    setPos({ top, left });
  }, [anchor, align]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div className="popover" ref={ref} style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}>
      {children}
    </div>,
    document.body,
  );
}

export function useMenu() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = useCallback((e: { currentTarget: HTMLElement }) => setAnchor(e.currentTarget), []);
  const close = useCallback(() => setAnchor(null), []);
  return { anchor, open, close, isOpen: !!anchor };
}

export function MenuItem({ icon, children, onClick, danger }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" className={cx('menu-item', danger && 'danger')} onClick={onClick}>
      {icon}
      <span className="grow">{children}</span>
    </button>
  );
}

// ---------- Toasts & Bestätigungen ----------
interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}

interface UiApi {
  toast: (text: string, opts?: { kind?: 'info' | 'error'; action?: { label: string; run: () => void } }) => void;
  confirm: (text: string, opts?: { confirmLabel?: string; danger?: boolean; title?: string }) => Promise<boolean>;
}

const UiContext = createContext<UiApi | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<null | {
    text: string;
    title: string;
    confirmLabel: string;
    danger: boolean;
    resolve: (v: boolean) => void;
  }>(null);
  const seq = useRef(0);

  const toast = useCallback<UiApi['toast']>((text, opts = {}) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, text, kind: opts.kind ?? 'info', action: opts.action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.kind === 'error' ? 8000 : 4000);
  }, []);

  const confirm = useCallback<UiApi['confirm']>((text, opts = {}) => {
    return new Promise<boolean>((resolve) => {
      setDialog({
        text,
        title: opts.title ?? 'Bist du sicher?',
        confirmLabel: opts.confirmLabel ?? 'OK',
        danger: opts.danger ?? false,
        resolve,
      });
    });
  }, []);

  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  return (
    <UiContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('toast', t.kind === 'error' && 'error')}>
            <span>{t.text}</span>
            {t.action ? (
              <button
                type="button"
                onClick={() => {
                  t.action!.run();
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {dialog ? (
        <Modal
          title={dialog.title}
          onClose={() => close(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => close(false)}>
                Abbrechen
              </button>
              <button type="button" className={cx('btn', dialog.danger ? 'danger' : 'primary')} onClick={() => close(true)}>
                {dialog.confirmLabel}
              </button>
            </>
          }
        >
          <p>{dialog.text}</p>
        </Modal>
      ) : null}
    </UiContext.Provider>
  );
}

export function useUi(): UiApi {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('UiProvider fehlt');
  return ctx;
}

// ---------- Helfer-Hooks ----------
export function useInterval(fn: () => void, ms: number | null) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useInterval(() => setNow(Date.now()), ms);
  return now;
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

// Tastenkürzel (ignoriert Eingaben in Textfeldern, außer bei allowInInputs)
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true, allowInInputs = false) {
  const saved = useRef(map);
  saved.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      // Strg/Cmd + Umschalt + Taste wie in Close (z. B. 'mod+shift+d'); '?' & Co. bleiben ohne „shift+“
      const mod = e.ctrlKey || e.metaKey;
      const key = `${mod ? 'mod+' : ''}${mod && e.shiftKey ? 'shift+' : ''}${e.key.toLowerCase()}`;
      const fn = saved.current[key];
      if (!fn) return;
      if (typing && !allowInInputs && !key.startsWith('mod+')) return;
      fn(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, allowInInputs]);
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// In die Zwischenablage kopieren – mit Rückfall für Browser/Seiten, die die Clipboard-API sperren.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* weiter mit dem Rückfall */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
