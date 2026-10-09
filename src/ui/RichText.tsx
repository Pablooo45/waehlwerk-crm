// Kleiner Editor für E-Mails mit Formatierung (fett, kursiv, Link, Liste) und sichere Anzeige von HTML.

import { Bold, Italic, Link as LinkIcon, List, RemoveFormatting } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cx } from './ui.tsx';

// Nur harmlose Tags und Attribute behalten (für den Editor; empfangene Mails zeigen wir zusätzlich im abgeschotteten Rahmen)
const ALLOWED = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'A', 'UL', 'OL', 'LI', 'DIV', 'SPAN', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'TABLE', 'TBODY', 'TR', 'TD', 'TH', 'IMG', 'HR']);

export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return '';
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (!ALLOWED.has(child.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(child.tagName)) {
          child.remove();
          continue;
        }
        child.replaceWith(...child.childNodes);
        continue;
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        const keep = (child.tagName === 'A' && name === 'href') || (child.tagName === 'IMG' && (name === 'src' || name === 'alt')) || name === 'colspan';
        if (!keep || /^\s*(javascript|data|vbscript):/i.test(attr.value)) child.removeAttribute(attr.name);
      }
      if (child.tagName === 'A') {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer nofollow');
      }
      walk(child);
    }
  };
  walk(root);
  return root.innerHTML;
}

export function htmlToText(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]+>/g, '');
  const doc = new DOMParser().parseFromString(
    html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '$&\n'),
    'text/html',
  );
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function RichTextEditor({ value, onChange, placeholder, minHeight = 220, ariaLabel = 'Text' }: { value: string; onChange: (html: string) => void; placeholder?: string; minHeight?: number; ariaLabel?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string>('');

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && value !== last.current) {
      el.innerHTML = sanitizeHtml(value);
      last.current = value;
    }
  }, [value]);

  const emit = () => {
    const html = ref.current?.innerHTML ?? '';
    last.current = html;
    onChange(html);
  };

  const cmd = (name: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(name, false, arg);
    emit();
  };

  return (
    <div className="rte">
      <div className="rte-bar" role="toolbar" aria-label="Formatierung">
        <button type="button" className="icon-btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('bold')} aria-label="Fett" title="Fett (Strg+B)"><Bold /></button>
        <button type="button" className="icon-btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('italic')} aria-label="Kursiv" title="Kursiv (Strg+I)"><Italic /></button>
        <button type="button" className="icon-btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('insertUnorderedList')} aria-label="Liste" title="Liste"><List /></button>
        <button
          type="button"
          className="icon-btn small"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const url = window.prompt('Link-Adresse (https://…)');
            if (url && /^https?:\/\//i.test(url.trim())) cmd('createLink', url.trim());
          }}
          aria-label="Link"
          title="Link"
        >
          <LinkIcon />
        </button>
        <button type="button" className="icon-btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('removeFormat')} aria-label="Formatierung entfernen" title="Formatierung entfernen"><RemoveFormatting /></button>
      </div>
      <div
        ref={ref}
        className={cx('rte-body', !value && 'empty')}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        style={{ minHeight }}
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          // nur reinen Text einfügen – keine fremden Formatierungen und Skripte
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
          emit();
        }}
        suppressContentEditableWarning
      />
    </div>
  );
}

// E-Mail-Inhalt sicher anzeigen: abgeschotteter Rahmen ohne Skripte, Höhe passt sich an
export function HtmlFrame({ html, className, maxHeight = 520 }: { html: string; className?: string; maxHeight?: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
    body{margin:0;font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d232b;background:transparent;word-wrap:break-word}
    p{margin:0 0 .7em} a{color:#2346a0} img{max-width:100%;height:auto} blockquote{margin:0 0 .7em;padding-left:.8em;border-left:3px solid #ccd}
    @media (prefers-color-scheme: dark){body{color:#e6e8ec} a{color:#9db4ff}}
  </style></head><body>${sanitizeHtml(html)}</body></html>`;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      try {
        const h = el.contentDocument?.body?.scrollHeight;
        if (h) setHeight(Math.min(maxHeight, h + 4));
      } catch {
        /* abgeschottet – Standardhöhe */
      }
    };
    el.addEventListener('load', measure);
    return () => el.removeEventListener('load', measure);
  }, [html, maxHeight]);
  // allow-same-origin nur zum Messen der Höhe; Skripte bleiben verboten
  return <iframe ref={ref} className={cx('html-frame', className)} title="E-Mail" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height }} />;
}
