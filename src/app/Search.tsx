// Suche oben (Strg+K): Leads, Smart Views, Seiten und Aktionen an einem Ort – wie die Suche in Close.

import { ArrowRight, Columns3, Hash, Pin, PhoneCall, Plus, Rows3, Search as SearchIcon, Settings } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { formatPhone, normalizePhone } from '../lib/format.ts';
import type { Lead } from '../lib/types.ts';
import { useDebounced, useHotkeys, useUi } from '../ui/ui.tsx';
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

const PAGES: { title: string; href: string; words: string }[] = [
  { title: 'Inbox', href: '#/inbox', words: 'inbox aufgaben benachrichtigungen' },
  { title: 'Leads', href: '#/leads', words: 'leads liste apotheken' },
  { title: 'Kontakte', href: '#/contacts', words: 'kontakte personen' },
  { title: 'Opportunities', href: '#/opportunities', words: 'opportunities pipeline deals angebote' },
  { title: 'Gespräche', href: '#/calls', words: 'gespräche anrufe aufnahmen abschriften' },
  { title: 'Termine', href: '#/meetings', words: 'termine kalender settings closings' },
  { title: 'Workflows', href: '#/workflows', words: 'workflows sequenzen automatisierung' },
  { title: 'Berichte', href: '#/reports', words: 'berichte reports zahlen auswertung' },
  { title: 'Alle Smart Views', href: '#/views', words: 'smart views listen filter' },
];

export function Search({ onNewLead, onDial }: { onNewLead: () => void; onDial: () => void }) {
  const { store, dial, ref, can, isAdmin } = useApp();
  const { toast } = useUi();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const dq = useDebounced(q, 160);
  const input = useRef<HTMLInputElement>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);

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

  useHotkeys({
    'mod+k': (e) => {
      e.preventDefault();
      input.current?.focus();
      setOpen(true);
    },
    '/': (e) => {
      e.preventDefault();
      input.current?.focus();
    },
  });

  const close = () => {
    setOpen(false);
    setQ('');
    input.current?.blur();
  };

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const out: Item[] = [];
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
      })
    );
    if (term) {
      ref.smartViews
        .filter((v) => v.name.toLowerCase().includes(term))
        .slice(0, 5)
        .forEach((v) => out.push({ key: `view-${v.id}`, group: 'Smart Views', icon: <Pin size={16} />, title: v.name, run: () => navigate(routeHref({ name: 'leads', viewId: v.id })) }));
      ref.pipelines
        .filter((p) => p.name.toLowerCase().includes(term))
        .forEach((p) => out.push({ key: `pipe-${p.id}`, group: 'Seiten', icon: <Columns3 size={16} />, title: `Pipeline ${p.name}`, run: () => navigate(routeHref({ name: 'opportunities', pipelineId: p.id })) }));
      PAGES.filter((p) => p.title.toLowerCase().includes(term) || p.words.includes(term)).forEach((p) =>
        out.push({ key: `page-${p.href}`, group: 'Seiten', icon: <ArrowRight size={16} />, title: p.title, run: () => navigate(p.href) })
      );
      SETTINGS_ITEMS.filter((s) => s.visible({ can, isAdmin }) && (s.label.toLowerCase().includes(term) || s.words.includes(term))).forEach((s) =>
        out.push({ key: `set-${s.id}`, group: 'Einstellungen', icon: <Settings size={16} />, title: s.label, hint: s.group, run: () => navigate(`#/settings/${s.id}`) })
      );
      if ('neuer lead anlegen'.includes(term) || term === 'neu') {
        out.push({ key: 'new-lead', group: 'Aktionen', icon: <Plus size={16} />, title: 'Neuen Lead anlegen', run: onNewLead });
      }
      if ('nummer wählen anrufen'.includes(term) && can('calling')) {
        out.push({ key: 'dialpad', group: 'Aktionen', icon: <Hash size={16} />, title: 'Nummer wählen', run: onDial });
      }
    }
    return out;
  }, [q, leads, ref, can, isAdmin, store, dial, onNewLead, onDial]);

  useEffect(() => setSel(0), [q]);

  const pick = (item: Item | undefined) => {
    if (!item) return;
    close();
    item.run();
  };

  let lastGroup = '';
  return (
    <div className="search">
      <SearchIcon />
      <input
        ref={input}
        className="input"
        value={q}
        placeholder="Suchen oder springen … (Strg+K)"
        aria-label="Suchen"
        aria-expanded={open && !!q.trim()}
        role="combobox"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSel((s) => Math.min(s + 1, items.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSel((s) => Math.max(s - 1, 0));
          } else if (e.key === 'Enter') {
            pick(items[sel]);
          } else if (e.key === 'Escape') {
            close();
          }
        }}
      />
      {open && q.trim() ? (
        <div className="search-results" role="listbox">
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? (lastGroup = it.group) : null;
            return (
              <div key={it.key} style={{ display: 'contents' }}>
                {head ? <div className="search-group">{head}</div> : null}
                <button type="button" role="option" aria-selected={i === sel} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setSel(i)} onClick={() => pick(it)}>
                  {it.icon}
                  <span className="grow ellipsis">
                    <strong>{it.title}</strong>
                    {it.hint ? <span className="muted small"> {it.hint}</span> : null}
                  </span>
                </button>
              </div>
            );
          })}
          {!items.length && !loading && dq === q ? <div className="small muted" style={{ padding: 10 }}>Nichts gefunden.</div> : null}
        </div>
      ) : null}
    </div>
  );
}
