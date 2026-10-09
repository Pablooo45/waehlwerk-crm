// Alle Smart Views: anheften, umbenennen, teilen, kopieren, löschen – wie die Smart-View-Liste in Close.

import { Copy, Eye, EyeOff, Pencil, Pin, PinOff, Plus, Search, Trash2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync, useLookups } from '../../app/hooks.ts';
import { navigate, routeHref } from '../../app/router.ts';
import { describeCondition } from '../../lib/filters.ts';
import type { SmartView } from '../../lib/types.ts';
import { cx, Empty, errMsg, Field, Modal, Tag, useUi } from '../../ui/ui.tsx';
import { pinnedViews } from '../../lib/views.ts';

export default function ViewsPage() {
  const { store, ref, me, can, reloadRef } = useApp();
  const { toast, confirm } = useUi();
  const { name } = useLookups();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<SmartView | null>(null);
  const team = can('manage_team_smart_views');

  const pins = me.settings.pinnedViews ?? [];
  const hidden = me.settings.hiddenViews ?? [];
  const pinnedIds = new Set(pinnedViews(ref.smartViews, pins, hidden).map((v) => v.id));

  const counts = useAsync(async () => {
    const out = new Map<string, number>();
    // nacheinander in kleinen Gruppen, damit die Datenbank nicht auf einmal 30 Zählungen bekommt
    const views = ref.smartViews;
    for (let i = 0; i < views.length; i += 4) {
      const part = views.slice(i, i + 4);
      const res = await Promise.all(part.map((v) => store.countLeads(v.filters).catch(() => -1)));
      part.forEach((v, j) => out.set(v.id, res[j]));
    }
    return out;
  }, [store, ref.smartViews], ['leads']);

  const term = q.trim().toLowerCase();
  const list = useMemo(
    () => ref.smartViews.filter((v) => !term || v.name.toLowerCase().includes(term) || v.description.toLowerCase().includes(term)),
    [ref.smartViews, term],
  );
  const groups = [
    { key: 'pinned', title: 'In der Seitenleiste', items: list.filter((v) => pinnedIds.has(v.id)) },
    { key: 'team', title: 'Team', items: list.filter((v) => !pinnedIds.has(v.id) && v.shared) },
    { key: 'mine', title: 'Nur für mich', items: list.filter((v) => !pinnedIds.has(v.id) && !v.shared) },
  ].filter((g) => g.items.length);

  const saveSettings = async (patch: { pinnedViews?: string[]; hiddenViews?: string[] }) => {
    try {
      await store.updateMyProfile({ settings: { ...me.settings, ...patch } });
      await reloadRef();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const togglePin = (v: SmartView) => {
    if (pinnedIds.has(v.id)) {
      if (pins.includes(v.id)) saveSettings({ pinnedViews: pins.filter((x) => x !== v.id) });
      else saveSettings({ hiddenViews: [...hidden, v.id] });
    } else if (v.pinned && hidden.includes(v.id)) {
      saveSettings({ hiddenViews: hidden.filter((x) => x !== v.id) });
    } else {
      saveSettings({ pinnedViews: [...pins, v.id] });
    }
  };

  const duplicate = async (v: SmartView) => {
    try {
      const copy = await store.saveSmartView({ name: `${v.name} (Kopie)`, description: v.description, filters: v.filters, sort: v.sort, columns: v.columns, shared: false, pinned: false });
      await saveSettings({ pinnedViews: [...pins, copy.id] });
      toast('Kopie angelegt – nur für dich sichtbar.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const remove = async (v: SmartView) => {
    if (!(await confirm(`Smart View „${v.name}“ löschen? Die Leads bleiben erhalten.`, { danger: true, confirmLabel: 'Löschen' }))) return;
    try {
      await store.deleteSmartView(v.id);
      await reloadRef();
      toast('Gelöscht.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const canEdit = (v: SmartView) => v.created_by === me.id || team;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Smart Views <span className="muted num" style={{ fontWeight: 500 }}>{ref.smartViews.length}</span></h1>
        <button type="button" className="btn primary" onClick={() => navigate('#/leads')}>
          <Plus /> Neue Smart View
        </button>
      </div>
      <p className="muted small" style={{ marginTop: -6 }}>
        Gespeicherte Lead-Filter. Neue Smart Views legst du in der Leadliste an: filtern, dann „Als Smart View speichern“. Mit der Stecknadel bestimmst du, was links in deiner Seitenleiste steht.
      </p>

      <div className="search" style={{ maxWidth: 360, margin: '12px 0 16px' }}>
        <Search />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Smart Views durchsuchen" aria-label="Smart Views durchsuchen" />
      </div>

      {!groups.length ? (
        <Empty title={term ? 'Nichts gefunden' : 'Noch keine Smart Views'}>{term ? 'Anderen Suchbegriff versuchen.' : 'Filtere die Leadliste und speichere die Ansicht.'}</Empty>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="section">
            <h2>{g.title} <span className="muted num small">{g.items.length}</span></h2>
            <div className="panel">
              <div className="list">
                {g.items.map((v) => {
                  const n = counts.data?.get(v.id);
                  const isPinned = pinnedIds.has(v.id);
                  return (
                    <div key={v.id} className="list-item view-row">
                      <button
                        type="button"
                        className={cx('icon-btn small', isPinned && 'active')}
                        onClick={() => togglePin(v)}
                        aria-pressed={isPinned}
                        aria-label={isPinned ? 'Aus der Seitenleiste nehmen' : 'In die Seitenleiste'}
                        title={isPinned ? 'Aus der Seitenleiste nehmen' : 'In die Seitenleiste'}
                      >
                        {isPinned ? <PinOff /> : <Pin />}
                      </button>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="row wrap gap-8">
                          <a href={routeHref({ name: 'leads', viewId: v.id })} className="strong">{v.name}</a>
                          {v.shared ? <Tag tone="soft"><Users size={12} /> Team</Tag> : <Tag tone="soft"><EyeOff size={12} /> privat</Tag>}
                          {v.pinned ? <Tag tone="blue" title="Für alle angeheftet">fürs Team angeheftet</Tag> : null}
                        </div>
                        {v.description ? <div className="small muted">{v.description}</div> : null}
                        <div className="xs muted mt-4 ellipsis">
                          {v.filters.conditions.length
                            ? v.filters.conditions.map((c) => describeCondition(c, ref)).join(v.filters.match === 'any' ? ' oder ' : ', ')
                            : 'Alle Leads'}
                          {v.filters.q ? `, Suche „${v.filters.q}“` : ''}
                        </div>
                        <div className="xs muted">von {name(v.created_by)}</div>
                      </div>
                      <span className="num view-count" title="Leads in dieser Ansicht">
                        {n === undefined ? '…' : n < 0 ? '–' : n.toLocaleString('de-DE')}
                      </span>
                      <div className="row gap-4">
                        <a className="icon-btn small" href={routeHref({ name: 'leads', viewId: v.id })} aria-label="Öffnen" title="Öffnen">
                          <Eye />
                        </a>
                        <button type="button" className="icon-btn small" onClick={() => duplicate(v)} aria-label="Kopieren" title="Als eigene Kopie">
                          <Copy />
                        </button>
                        {canEdit(v) ? (
                          <>
                            <button type="button" className="icon-btn small" onClick={() => setEditing(v)} aria-label="Bearbeiten" title="Name, Beschreibung, Freigabe">
                              <Pencil />
                            </button>
                            <button type="button" className="icon-btn small" onClick={() => remove(v)} aria-label="Löschen" title="Löschen">
                              <Trash2 />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ))
      )}

      {editing ? <ViewMetaModal view={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

export function ViewMetaModal({ view, onClose }: { view: SmartView; onClose: () => void }) {
  const { store, reloadRef, can } = useApp();
  const { toast } = useUi();
  const team = can('manage_team_smart_views');
  const [name, setName] = useState(view.name);
  const [description, setDescription] = useState(view.description);
  const [shared, setShared] = useState(view.shared);
  const [pinned, setPinned] = useState(view.pinned);

  const save = async () => {
    if (!name.trim()) return;
    try {
      await store.saveSmartView({ ...view, name: name.trim(), description: description.trim(), shared, pinned: shared && pinned });
      await reloadRef();
      toast('Gespeichert.');
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  return (
    <Modal
      title="Smart View bearbeiten"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={save} disabled={!name.trim()}>Speichern</button>
        </>
      }
    >
      <div className="col gap-12">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Beschreibung" hint="Wofür ist die Liste? Sehen alle in der Übersicht.">
          <textarea className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={shared} disabled={!team && !view.shared} onChange={(e) => setShared(e.target.checked)} />
          Für das ganze Team sichtbar
        </label>
        {team ? (
          <label className="check">
            <input type="checkbox" checked={pinned && shared} disabled={!shared} onChange={(e) => setPinned(e.target.checked)} />
            Bei allen in der Seitenleiste anheften
          </label>
        ) : !view.shared ? (
          <p className="xs muted">Für das Team freigeben darf nur, wer das Recht „Smart Views fürs Team“ hat.</p>
        ) : null}
      </div>
    </Modal>
  );
}
