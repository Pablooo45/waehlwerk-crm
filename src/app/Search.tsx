// Suche wie in Close (Strg+K): ein Fenster oben in der Mitte – Leads, Smart Views, Seiten,
// Einstellungen und Aktionen an einem Ort. Ohne Eingabe zeigt es die häufigsten Sprünge.

import { ArrowRight, Columns3, Hash, Pin, PhoneCall, Plus, Rows3, Search as SearchIcon, Settings } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatPhone, normalizePhone } from '../lib/format.ts';
import type { Lead } from '../lib/types.ts';
import { pinnedViews } from '../lib/views.ts';
import { useDebounced, useUi } from '../ui/ui.tsx';
import { useApp } from './context.tsx';
import { leadHref, navigate, routeHref } from './router.ts';
import { SETTINGS_ITEMS } from '../features/settings/items.ts';

interface Item {
  key: string;
  group: string;
  icon: ReactNode;
  title: string;
  hint?: string;
  run: () => void;
}

export const PAGES: { title: string; href: string; words: string }[] = [
  { title: 'Inbox', href: '#/inbox', words: 'inbox aufgaben benachrichtigungen' },
  { title: 'Leads', href: '#/leads', words: 'leads liste apotheken' },
  { title: 'Kontakte', href: '#/contacts', words: 'kontakte personen' },
  { title: 'Opportunities', href: '#/opportunities', words: 'opportunities pipeline deals angebote' },
  { title: 'Gespräche', href: '#/calls', words: 'gespräche anrufe aufnahmen abschriften conversations' },
  { title: 'Live-Gespräche', href: '#/live', words: 'live mithören einflüstern aufschalten' },
  { title: 'Termine', href: '#/meetings', words: 'termine kalender settings closings meetings' },
  { title: 'Berichte', href: '#/reports', words: 'berichte reports zahlen auswertung' },
  { title: 'Workflows', href: '#/workflows', words: 'workflows sequenzen automatisierung' },
  { title: 'Alle Smart Views', href: '#/views', words: 'smart views listen filter' },
];

export function SearchPalette({ onClose, onNewLead, onDial }: { onClose: () => void; onNewLead: () => void; onDial: () => void }) {
  const { store, dial, ref, me, can, isAdmin } = useApp();
  const { toast } = useUi();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const dq = useDebounced(q, 140);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (!dq.trim()) {
      setLeads([]);
      return;
    }
    let alive = true;
    setLoading(true);
    store
      .searchLeads(dq, 8)
      .then((r) => alive && setLeads(r))
      .catch((e) => toast(String(e), { kind: 'error' }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [dq, store, toast]);

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const out: Item[] = [];
    if (!term) {
      // Ohne Eingabe: das, was man am häufigsten braucht
      out.push({ key: 'new-lead', group: 'Aktionen', icon: <Plus size={16} />, title: 'Neuen Lead anlegen', hint: 'Strg + Umschalt + L', run: onNewLead });
      if (can('calling')) out.push({ key: 'dialpad', group: 'Aktionen', icon: <Hash size={16} />, title: 'Nummer wählen', run: onDial });
      pinnedViews(ref.smartViews, me.settings.pinnedViews, me.settings.hiddenViews)
        .slice(0, 6)
        .forEach((v) => out.push({ key: `view-${v.id}`, group: 'Smart Views', icon: <Pin size={16} />, title: v.name, run: () => navigate(routeHref({ name: 'leads', viewId: v.id })) }));
      PAGES.slice(0, 8).forEach((p) => out.push({ key: `page-${p.href}`, group: 'Springen zu', icon: <ArrowRight size={16} />, title: p.title, run: () => navigate(p.href) }));
      return out;
    }
    const asNumber = normalizePhone(q);
    if (asNumber && /^[+0-9 ()/-]+$/.test(q.trim()) && can('calling')) {
      out.push({
        key: 'dial',
        group: 'Aktionen',
        icon: <PhoneCall size={16} />,
        title: `${formatPhone(asNumber)} anrufen`,
        run: async () => {
          const match = await store.findLeadByPhone(asNumber).catch(() => null);
          dial({ number: asNumber, leadId: match?.lead.id ?? null, contactId: match?.contact?.id ?? null, leadName: match?.lead.name ?? null, contactName: match?.contact?.name ?? null });
        },
      });
    }
    leads.forEach((l) =>
      out.push({
        key: `lead-${l.id}`,
        group: 'Leads',
        icon: <Rows3 size={16} />,
        title: l.name,
        hint: [l.address_city, l.contacts?.[0]?.name].filter(Boolean).join(', '),
        run: () => navigate(leadHref(l.id)),
      }),
    );
    ref.smartViews
      .filter((v) => v.name.toLowerCase().includes(term))
      .slice(0, 5)
      .forEach((v) => out.push({ key: `view-${v.id}`, group: 'Smart Views', icon: <Pin size={16} />, title: v.name, run: () => navigate(routeHref({ name: 'leads', viewId: v.id })) }));
    ref.pipelines
      .filter((p) => p.name.toLowerCase().includes(term))
      .forEach((p) => out.push({ key: `pipe-${p.id}`, group: 'Springen zu', icon: <Columns3 size={16} />, title: `Pipeline ${p.name}`, run: () => navigate(routeHref({ name: 'opportunities', pipelineId: p.id })) }));
    PAGES.filter((p) => p.title.toLowerCase().includes(term) || p.words.includes(term)).forEach((p) =>
      out.push({ key: `page-${p.href}`, group: 'Springen zu', icon: <ArrowRight size={16} />, title: p.title, run: () => navigate(p.href) }),
    );
    SETTINGS_ITEMS.filter((s) => s.visible({ can, isAdmin }) && (s.label.toLowerCase().includes(term) || s.words.includes(term))).forEach((s) =>
      out.push({ key: `set-${s.id}`, group: 'Einstellungen', icon: <Settings size={16} />, title: s.label, hint: s.group, run: () => navigate(`#/settings/${s.id}`) }),
    );
    if ('neuer lead anlegen'.includes(term) || term === 'neu') {
      out.push({ key: 'new-lead', group: 'Aktionen', icon: <Plus size={16} />, title: 'Neuen Lead anlegen', run: onNewLead });
    }
    if ('nummer wählen anrufen'.includes(term) && can('calling')) {
      out.push({ key: 'dialpad', group: 'Aktionen', icon: <Hash size={16} />, title: 'Nummer wählen', run: onDial });
    }
    return out;
  }, [q, leads, ref, me.settings, can, isAdmin, store, dial, onNewLead, onDial]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const pick = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  let lastGroup = '';
  return createPortal(
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Suchen">
        <div className="palette-input">
          <SearchIcon aria-hidden="true" />
          <input
            ref={input}
            value={q}
            placeholder="Lead, Kontakt, Nummer, Smart View oder Seite …"
            aria-label="Suchen"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(items[sel]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          />
          <kbd className="hide-touch">Esc</kbd>
        </div>
        <div className="palette-list" role="listbox" id="palette-list" ref={list}>
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? (lastGroup = it.group) : null;
            return (
              <div key={it.key} style={{ display: 'contents' }}>
                {head ? <div className="search-group">{head}</div> : null}
                <button type="button" role="option" aria-selected={i === sel} onMouseMove={() => sel !== i && setSel(i)} onClick={() => pick(it)}>
                  {it.icon}
                  <span className="grow ellipsis">
                    <strong>{it.title}</strong>
                    {it.hint ? <span className="muted small"> {it.hint}</span> : null}
                  </span>
                  {i === sel ? <kbd className="hide-touch">Enter</kbd> : null}
                </button>
              </div>
            );
          })}
          {!items.length && !loading && dq === q ? <div className="small muted palette-empty">Nichts gefunden. Tipp: Firmenname, Ort, Ansprechpartner oder Telefonnummer.</div> : null}
          {loading && !items.length ? <div className="small muted palette-empty">Sucht …</div> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
