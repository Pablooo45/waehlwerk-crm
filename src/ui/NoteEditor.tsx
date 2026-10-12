// Notiz-Editor wie in Close: fett, kursiv, unterstrichen, Listen, Links – und @Erwähnungen von Kollegen.
// Gespeichert wird immer der Text (für Suche, Benachrichtigungen, Export) und – nur wenn formatiert – das HTML.

import { Bold, Italic, Link as LinkIcon, List, ListOrdered, Underline } from 'lucide-react';
import { forwardRef, type ReactNode, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Profile } from '../lib/types.ts';
import { sanitizeHtml } from './RichText.tsx';
import { Avatar, cx } from './ui.tsx';

export interface NoteEditorHandle {
  focus: () => void;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Klartext → HTML für den Editor (Zeilenumbrüche bleiben erhalten) */
export function noteTextToHtml(text: string): string {
  return esc(text).replace(/\n/g, '<br>');
}

const BLOCKS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'TR']);

/** HTML aus dem Editor → Klartext: Listen mit Spiegelstrich bzw. Nummer, Erwähnungen als @Name */
export function noteHtmlToText(html: string): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';
  let out = '';
  const newline = () => {
    if (out && !out.endsWith('\n')) out += '\n';
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.tagName === 'BR') {
      out += '\n';
      return;
    }
    const block = BLOCKS.has(node.tagName);
    if (block) newline();
    if (node.tagName === 'LI') {
      const parent = node.parentElement;
      out += parent?.tagName === 'OL' ? `${[...parent.children].indexOf(node) + 1}. ` : '• ';
    }
    node.childNodes.forEach(walk);
    if (block) newline();
  };
  root.childNodes.forEach(walk);
  return out
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Enthält das HTML echte Formatierung (sonst reicht der Text)? */
export function hasFormatting(html: string): boolean {
  return /<(strong|b|em|i|u|ul|ol|a)\b/i.test(html);
}

/** Für das Speichern: Text immer, HTML nur bei Formatierung */
export function noteValue(html: string): { body: string; body_html: string | null } {
  const clean = sanitizeHtml(html);
  return { body: noteHtmlToText(clean), body_html: hasFormatting(clean) ? clean : null };
}

export const NoteEditor = forwardRef<NoteEditorHandle, {
  value: string; // HTML
  onChange: (html: string) => void;
  profiles: Profile[];
  placeholder?: string;
  onSubmit?: () => void;
  ariaLabel?: string;
  id?: string;
  autoFocus?: boolean;
  minHeight?: number;
  className?: string;
}>(function NoteEditor({ value, onChange, profiles, placeholder, onSubmit, ariaLabel = 'Notiz', id, autoFocus, minHeight = 92, className }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);
  const [query, setQuery] = useState<{ text: string; x: number; y: number } | null>(null);
  const [sel, setSel] = useState(0);

  useImperativeHandle(ref, () => ({ focus: () => box.current?.focus() }), []);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && value !== last.current) {
      el.innerHTML = sanitizeHtml(value);
      last.current = value;
    }
  }, [value]);

  useLayoutEffect(() => {
    if (!autoFocus || !box.current) return;
    box.current.focus();
    // Schreibmarke ans Ende
    const r = document.createRange();
    r.selectNodeContents(box.current);
    r.collapse(false);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
  }, [autoFocus]);

  const emit = () => {
    const html = box.current?.innerHTML ?? '';
    last.current = html;
    onChange(html);
  };

  const cmd = (name: string, arg?: string) => {
    box.current?.focus();
    document.execCommand(name, false, arg);
    emit();
  };

  const addLink = () => {
    const url = window.prompt('Link-Adresse (https://…)');
    if (url && /^https?:\/\/\S+$/i.test(url.trim())) cmd('createLink', url.trim());
  };

  const matches = useMemo(() => {
    if (!query) return [];
    const q = query.text.toLowerCase();
    return profiles.filter((p) => p.active && (p.full_name.toLowerCase().includes(q) || p.email.startsWith(q))).slice(0, 6);
  }, [query, profiles]);

  // „@Na…“ direkt vor der Schreibmarke?
  const detect = () => {
    const s = window.getSelection();
    const host = box.current;
    if (!s || !s.rangeCount || !s.isCollapsed || !host) return setQuery(null);
    const r = s.getRangeAt(0);
    const node = r.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || !host.contains(node)) return setQuery(null);
    const before = (node.textContent ?? '').slice(0, r.startOffset);
    const m = /(^|[\s ])@([\p{L}\p{N}._-]{0,30})$/u.exec(before);
    if (!m) return setQuery(null);
    const rect = r.getBoundingClientRect();
    const hb = host.getBoundingClientRect();
    setQuery({ text: m[2], x: Math.max(0, rect.left - hb.left), y: rect.bottom - hb.top });
    setSel(0);
  };

  const insert = (p: Profile) => {
    const s = window.getSelection();
    if (!s || !s.rangeCount || !query) return;
    const r = s.getRangeAt(0);
    const node = r.startContainer;
    const end = r.startOffset;
    const range = document.createRange();
    range.setStart(node, Math.max(0, end - query.text.length - 1));
    range.setEnd(node, end);
    range.deleteContents();
    const tag = document.createElement('span');
    tag.className = 'mention-tag';
    tag.contentEditable = 'false';
    tag.dataset.user = p.id;
    tag.textContent = `@${p.full_name}`;
    const space = document.createTextNode(' ');
    range.insertNode(space);
    range.insertNode(tag);
    const after = document.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    s.removeAllRanges();
    s.addRange(after);
    setQuery(null);
    emit();
  };

  const empty = !noteHtmlToText(value).trim() && !/<(ul|ol|li)\b/i.test(value);
  const tool = (label: string, icon: ReactNode, onClick: () => void, keys?: string) => (
    <button type="button" className="icon-btn small" onMouseDown={(e) => e.preventDefault()} onClick={onClick} aria-label={label} title={keys ? `${label} (${keys})` : label}>
      {icon}
    </button>
  );

  return (
    <div className={cx('rte note-editor', className)}>
      <div className="rte-bar" role="toolbar" aria-label="Formatierung">
        {tool('Fett', <Bold />, () => cmd('bold'), 'Strg+B')}
        {tool('Kursiv', <Italic />, () => cmd('italic'), 'Strg+I')}
        {tool('Unterstrichen', <Underline />, () => cmd('underline'), 'Strg+U')}
        <span className="rte-sep" aria-hidden="true" />
        {tool('Liste', <List />, () => cmd('insertUnorderedList'))}
        {tool('Nummerierte Liste', <ListOrdered />, () => cmd('insertOrderedList'))}
        {tool('Link', <LinkIcon />, addLink, 'Strg+K')}
      </div>
      <div className="mention">
        <div
          ref={box}
          id={id}
          className={cx('rte-body note-body', empty && 'is-empty')}
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          data-placeholder={placeholder}
          style={{ minHeight }}
          onInput={() => {
            emit();
            detect();
          }}
          onKeyUp={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) detect();
          }}
          onKeyDown={(e) => {
            if (query && matches.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((x) => Math.min(x + 1, matches.length - 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((x) => Math.max(x - 1, 0));
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insert(matches[sel]);
                return;
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                setQuery(null);
                return;
              }
            }
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key === 'Enter' && onSubmit) {
              e.preventDefault();
              emit();
              onSubmit();
              return;
            }
            if (mod && e.key.toLowerCase() === 'k') {
              e.preventDefault();
              addLink();
            }
          }}
          onPaste={(e) => {
            // nur reinen Text einfügen – keine fremden Formatierungen und Skripte
            e.preventDefault();
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
            emit();
          }}
          onBlur={() => {
            emit();
            setTimeout(() => setQuery(null), 150);
          }}
          suppressContentEditableWarning
        />
        {query && matches.length ? (
          <div className="mention-pop" role="listbox" style={{ left: Math.min(query.x, 260), top: query.y + 4 }}>
            {matches.map((p, i) => (
              <button key={p.id} type="button" role="option" aria-selected={i === sel} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p)}>
                <Avatar name={p.full_name || p.email} color={p.color} />
                {p.full_name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
});

/** Notiz anzeigen: formatiert (HTML, bereinigt) oder als Text mit hervorgehobenen @Namen */
export function NoteHtml({ html }: { html: string }) {
  // eslint-disable-next-line react/no-danger -- bereinigt: nur harmlose Tags und Attribute
  return <div className="tl-body note-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />;
}
