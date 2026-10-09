// Textfeld mit @-Erwähnungen: Beim Tippen von „@“ erscheint eine Auswahl der Kollegen.
// Erwähnte Personen bekommen eine Benachrichtigung in ihrer Inbox.

import { forwardRef, type ReactNode, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Profile } from '../lib/types.ts';
import { Avatar, cx } from './ui.tsx';

export interface MentionInputHandle {
  focus: () => void;
}

export function mentionsIn(text: string, profiles: Profile[]): string[] {
  return profiles.filter((p) => p.full_name && text.includes(`@${p.full_name}`)).map((p) => p.id);
}

export const MentionInput = forwardRef<MentionInputHandle, {
  value: string;
  onChange: (v: string) => void;
  profiles: Profile[];
  placeholder?: string;
  rows?: number;
  onSubmit?: () => void;
  ariaLabel?: string;
  className?: string;
  id?: string;
}>(function MentionInput({ value, onChange, profiles, placeholder, rows = 3, onSubmit, ariaLabel = 'Text', className, id }, ref) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [sel, setSel] = useState(0);

  useImperativeHandle(ref, () => ({ focus: () => ta.current?.focus() }), []);

  const matches = useMemo(() => {
    if (!query) return [];
    const q = query.text.toLowerCase();
    return profiles.filter((p) => p.active && (p.full_name.toLowerCase().includes(q) || p.email.startsWith(q))).slice(0, 6);
  }, [query, profiles]);

  const detect = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const m = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(before);
    if (m) {
      setQuery({ start: caret - m[2].length - 1, text: m[2] });
      setSel(0);
    } else setQuery(null);
  };

  const insert = (p: Profile) => {
    if (!query) return;
    const caret = ta.current?.selectionStart ?? value.length;
    const next = `${value.slice(0, query.start)}@${p.full_name} ${value.slice(caret)}`;
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = query.start + p.full_name.length + 2;
      ta.current?.focus();
      ta.current?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className={cx('mention', className)}>
      <textarea
        ref={ta}
        id={id}
        className="textarea"
        rows={rows}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={(e) => {
          if (query && matches.length) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, matches.length - 1));
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              insert(matches[sel]);
              return;
            }
            if (e.key === 'Escape') {
              setQuery(null);
              return;
            }
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
      />
      {query && matches.length ? (
        <div className="mention-pop" role="listbox">
          {matches.map((p, i) => (
            <button key={p.id} type="button" role="option" aria-selected={i === sel} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p)}>
              <Avatar name={p.full_name || p.email} color={p.color} />
              {p.full_name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
});

// Text mit hervorgehobenen @Namen anzeigen
export function MentionText({ text, profiles }: { text: string; profiles: Profile[] }) {
  const names = profiles.filter((p) => p.full_name).map((p) => p.full_name).sort((a, b) => b.length - a.length);
  if (!names.length) return <>{text}</>;
  const re = new RegExp(`@(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<span key={m.index} className="mention-tag">@{m[1]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
