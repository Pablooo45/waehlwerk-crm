// Leadliste mit Smart Views: Filter (alle/eine Bedingung), frei wählbare Spalten, Sammelaktionen wie in Close.

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Columns3,
  Download,
  Filter,
  Mail,
  MoreHorizontal,
  Pencil,
  Save,
  Search,
  Trash2,
  Workflow as WorkflowIcon,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync } from '../../app/hooks.ts';
import { leadHref, navigate } from '../../app/router.ts';
import { bus } from '../../lib/bus.ts';
import { downloadText, toCsv } from '../../lib/csv.ts';
import { describeCondition, emptyFilter } from '../../lib/filters.ts';
import { formatDateTime, formatRelative } from '../../lib/format.ts';
import { fromLocalInput, nextWorkday, toLocalInput } from '../../lib/dates.ts';
import type { Condition, FilterSet, ID, Lead, LeadInput, SmartView, SortField, SortSpec } from '../../lib/types.ts';
import { cx, Empty, errMsg, Field, Loading, MenuItem, Modal, Popover, useDebounced, useMenu, useUi } from '../../ui/ui.tsx';
import { CallButton, StatusTag } from '../common/bits.tsx';
import { FieldInput, shapeOf } from '../common/fields.tsx';
import { firstPhone, useDialer } from '../dialer/DialerContext.tsx';
import { EnrollInWorkflowModal } from '../workflows/WorkflowPage.tsx';
import { defaultColumns, type LeadColumn, leadColumns } from './columns.tsx';
import { FilterEditor } from './FilterEditor.tsx';

const PAGE = 50;
const DEFAULT_SORT: SortSpec = { field: 'created_at', dir: 'desc' };
const MAX_BULK = 10000;

export default function LeadsPage({ viewId }: { viewId: string | null }) {
  const { store, ref, me, can, reloadRef } = useApp();
  const { toast, confirm } = useUi();
  const dialer = useDialer();
  const view = ref.smartViews.find((v) => v.id === viewId) ?? null;
  const allCols = useMemo(() => leadColumns(ref), [ref]);
  const viewColumns = (v: SmartView | null) => (v?.columns?.length ? v.columns : me.settings.leadColumns?.length ? me.settings.leadColumns : defaultColumns(ref));

  const [filter, setFilter] = useState<FilterSet>(view?.filters ?? emptyFilter());
  const [sort, setSort] = useState<SortSpec>(view?.sort?.field ? view.sort : DEFAULT_SORT);
  const [columns, setColumns] = useState<string[]>(viewColumns(view));
  const [q, setQ] = useState(view?.filters.q ?? '');
  const dq = useDebounced(q, 300);
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [editing, setEditing] = useState<{ index: number | null; anchor: HTMLElement } | null>(null);
  const [modal, setModal] = useState<null | 'save' | 'edit' | 'email' | 'workflow'>(null);
  const [bulkIds, setBulkIds] = useState<ID[]>([]);
  const more = useMenu();
  const colMenu = useMenu();
  const bulkMenu = useMenu();

  useEffect(() => {
    setFilter(view?.filters ?? emptyFilter());
    setSort(view?.sort?.field ? view.sort : DEFAULT_SORT);
    setColumns(viewColumns(view));
    setQ(view?.filters.q ?? '');
    setSelected(new Set());
    setAllMatching(false);
    setLimit(PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, view]);

  const effective = useMemo<FilterSet>(() => ({ ...filter, q: dq }), [filter, dq]);
  const data = useAsync(() => store.listLeads(effective, sort, { offset: 0, limit }), [effective, sort, limit, store], ['leads', 'ref']);
  const rows = data.data?.rows ?? [];
  const total = data.data?.total ?? 0;
  const shown: LeadColumn[] = columns.map((k) => allCols.find((c) => c.key === k)).filter((c): c is LeadColumn => !!c);

  const canEditView = !!view && (view.created_by === me.id || can('manage_team_smart_views'));
  const baseColumns = viewColumns(view);
  const changed =
    JSON.stringify({ ...filter, q }) !== JSON.stringify({ ...(view?.filters ?? emptyFilter()), q: view?.filters.q ?? '' }) ||
    JSON.stringify(sort) !== JSON.stringify(view?.sort?.field ? view.sort : DEFAULT_SORT) ||
    (!!view && JSON.stringify(columns) !== JSON.stringify(baseColumns));

  const setCondition = (index: number | null, c: Condition) => {
    const conditions = [...filter.conditions];
    if (index === null) conditions.push(c);
    else conditions[index] = c;
    setFilter({ ...filter, conditions });
    setEditing(null);
    setLimit(PAGE);
    setAllMatching(false);
  };

  const removeCondition = (index: number) => {
    setFilter({ ...filter, conditions: filter.conditions.filter((_, i) => i !== index) });
    setLimit(PAGE);
    setAllMatching(false);
  };

  const sortBy = (field: SortField) => {
    setSort((s) => (s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: field === 'name' ? 'asc' : 'desc' }));
  };
  const sortIcon = (field: SortField) => (sort.field === field ? sort.dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} /> : null);

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => {
    setAllMatching(false);
    setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)));
  };
  const toggle = (id: string) => {
    setAllMatching(false);
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const count = allMatching ? Math.min(total, MAX_BULK) : selected.size;
  const clearSelection = () => {
    setSelected(new Set());
    setAllMatching(false);
  };

  const resolveIds = async (): Promise<ID[]> => (allMatching ? store.listLeadIds(effective, sort, MAX_BULK) : [...selected]);

  const openBulk = async (m: 'edit' | 'email' | 'workflow') => {
    bulkMenu.close();
    try {
      setBulkIds(await resolveIds());
      setModal(m);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const bulkDelete = async () => {
    bulkMenu.close();
    if (!(await confirm(`${count.toLocaleString('de-DE')} Leads mit allen Kontakten, Notizen und Aufgaben löschen? Anrufe bleiben in der Anrufliste erhalten.`, { danger: true, confirmLabel: 'Endgültig löschen' }))) return;
    try {
      const ids = await resolveIds();
      const n = await store.deleteLeads(ids);
      toast(`${n} Leads gelöscht.`);
      clearSelection();
      bus.emit('leads');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const startDialer = async (onlySelected: boolean) => {
    const ids = onlySelected ? await resolveIds() : undefined;
    dialer.start({ name: view?.name ?? 'Leads', filter: effective, sort, ids });
  };

  const exportCsv = async (onlySelected: boolean) => {
    try {
      let all: Lead[] = [];
      if (onlySelected && !allMatching) {
        all = await store.getLeads([...selected]);
      } else {
        for (let offset = 0; offset < 50000; offset += 500) {
          const part = await store.listLeads(effective, sort, { offset, limit: 500 });
          all.push(...part.rows);
          if (part.rows.length < 500) break;
        }
      }
      const cols = allCols;
      const header = ['Firma', 'Straße', 'Website', ...cols.map((c) => c.label), 'Weitere Nummern'];
      const lines = all.map((l) => [
        l.name,
        l.address_street ?? '',
        l.url ?? '',
        ...cols.map((c) => c.text(l)),
        (l.contacts ?? []).flatMap((x) => x.phones).slice(1).map((p) => p.number).join(', '),
      ]);
      if (__DEMO_BUILD__) {
        toast(`${all.length} Leads wären exportiert worden. In der Demo-Vorschau sind Downloads gesperrt.`);
        return;
      }
      downloadText(`leads-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([header, ...lines]));
      toast(`${all.length} Leads exportiert.`);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const deleteView = async () => {
    if (!view || !(await confirm(`Smart View „${view.name}“ löschen? Die Leads bleiben erhalten.`, { danger: true, confirmLabel: 'Löschen' }))) return;
    try {
      await store.deleteSmartView(view.id);
      await reloadRef();
      navigate('#/leads');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const applyColumns = async (next: string[]) => {
    setColumns(next);
    if (!view) {
      try {
        await store.updateMyProfile({ settings: { ...me.settings, leadColumns: next } });
        await reloadRef();
      } catch (e) {
        toast(errMsg(e), { kind: 'error' });
      }
    }
  };

  const anyBulk = can('bulk_edit') || can('bulk_email') || can('bulk_workflow') || (can('bulk_delete') && can('delete_leads'));

  return (
    <div className="page leads-page">
      <div className="page-head">
        <h1 className="grow">
          {view?.name ?? 'Alle Leads'} <span className="muted num" style={{ fontWeight: 500 }}>{data.data ? total.toLocaleString('de-DE') : ''}</span>
          {view?.description ? <span className="block small muted" style={{ fontWeight: 400 }}>{view.description}</span> : null}
        </h1>
        {changed ? (
          <button type="button" className="btn" onClick={() => setModal('save')}>
            <Save /> {view && canEditView ? 'Ansicht speichern' : 'Als Smart View speichern'}
          </button>
        ) : null}
        <button type="button" className="icon-btn" onClick={more.open} aria-label="Weitere Aktionen">
          <MoreHorizontal />
        </button>
        {can('calling') ? (
          <button type="button" className="btn call" onClick={() => startDialer(false)} disabled={!total || dialer.active}>
            <Zap /> Power Dialer
          </button>
        ) : null}
      </div>

      <div className="filterbar">
        <div className="search" style={{ maxWidth: 300, flex: '1 1 200px' }}>
          <Search />
          <input className="input" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); setAllMatching(false); }} placeholder="In dieser Liste suchen…" aria-label="In dieser Liste suchen" />
        </div>
        {filter.conditions.length > 1 ? (
          <select
            className="select small"
            style={{ width: 'auto' }}
            value={filter.match ?? 'all'}
            onChange={(e) => setFilter({ ...filter, match: e.target.value as 'all' | 'any' })}
            aria-label="Verknüpfung der Filter"
          >
            <option value="all">Alle Bedingungen</option>
            <option value="any">Mindestens eine</option>
          </select>
        ) : null}
        {filter.conditions.map((c, i) => (
          <span key={i} className="chip">
            <button type="button" onClick={(e) => setEditing({ index: i, anchor: e.currentTarget })}>
              {describeCondition(c, ref)}
            </button>
            <button type="button" aria-label="Filter entfernen" onClick={() => removeCondition(i)}>
              <X size={14} />
            </button>
          </span>
        ))}
        <button type="button" className="btn small" onClick={(e) => setEditing({ index: null, anchor: e.currentTarget })}>
          <Filter /> Filter
        </button>
        {filter.conditions.length || q ? (
          <button type="button" className="btn ghost small" onClick={() => { setFilter(emptyFilter()); setQ(''); }}>
            Zurücksetzen
          </button>
        ) : null}
        <span className="grow" />
        <button type="button" className="btn small ghost" onClick={colMenu.open} title="Spalten auswählen">
          <Columns3 /> Spalten
        </button>
      </div>

      {selected.size || allMatching ? (
        <div className="bulkbar">
          <strong>{count.toLocaleString('de-DE')} ausgewählt</strong>
          {!allMatching && allOnPage && total > rows.length ? (
            <button type="button" className="btn small ghost" style={{ color: 'inherit', textDecoration: 'underline' }} onClick={() => setAllMatching(true)}>
              Alle {Math.min(total, MAX_BULK).toLocaleString('de-DE')} auswählen
            </button>
          ) : null}
          {anyBulk ? (
            <button type="button" className="btn small" onClick={bulkMenu.open}>
              Aktionen <ChevronDown size={14} />
            </button>
          ) : null}
          {can('calling') ? (
            <button type="button" className="btn small call" onClick={() => startDialer(true)} disabled={dialer.active}>
              <Zap /> Diese anrufen
            </button>
          ) : null}
          {can('export') ? (
            <button type="button" className="btn small" onClick={() => exportCsv(true)}>
              <Download /> Export
            </button>
          ) : null}
          <span className="spacer" />
          <button type="button" className="btn small ghost" style={{ color: 'inherit' }} onClick={clearSelection}>
            Auswahl aufheben
          </button>
        </div>
      ) : null}

      {data.error ? <div className="callout err">{data.error}</div> : null}

      {data.loading && !data.data ? (
        <Loading />
      ) : !rows.length ? (
        <div className="panel">
          <Empty title="Keine Leads gefunden">
            {filter.conditions.length || q ? 'Filter anpassen oder zurücksetzen.' : 'Leg den ersten Lead an oder importiere eine Liste unter Einstellungen → Import.'}
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="check">
                  <input type="checkbox" aria-label="Alle auswählen" checked={allOnPage} onChange={toggleAll} />
                </th>
                <th>
                  <button type="button" onClick={() => sortBy('name')}>Firma {sortIcon('name')}</button>
                </th>
                {shown.map((c) => (
                  <th key={c.key} className="hide-mobile">
                    {c.sort ? <button type="button" onClick={() => sortBy(c.sort!)}>{c.label} {sortIcon(c.sort)}</button> : c.label}
                  </th>
                ))}
                <th aria-label="Anrufen" />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const target = firstPhone(l);
                const on = allMatching || selected.has(l.id);
                return (
                  <tr key={l.id} className={cx('clickable', on && 'selected')} onClick={() => navigate(leadHref(l.id))}>
                    <td className="check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`${l.name} auswählen`} checked={on} onChange={() => toggle(l.id)} />
                    </td>
                    <td className="lead-cell">
                      <a href={leadHref(l.id)} className="lead-name" onClick={(e) => e.stopPropagation()}>{l.name}</a>
                      <div className="xs muted ellipsis" style={{ maxWidth: 320 }}>
                        {[l.address_city, l.contacts?.[0]?.name].filter(Boolean).join(', ')}
                      </div>
                      <div className="show-mobile row wrap gap-4 mt-4">
                        <StatusTag statusId={l.status_id} />
                        <span className="xs muted">{l.last_call_at ? `Letzter Anruf: ${formatRelative(l.last_call_at)}` : 'Noch nie angerufen'}</span>
                      </div>
                    </td>
                    {shown.map((c) => (
                      <td key={c.key} className="hide-mobile nowrap-cell">{c.render(l)}</td>
                    ))}
                    <td onClick={(e) => e.stopPropagation()} style={{ width: 44 }}>
                      {target && can('calling') && !l.do_not_call ? (
                        <CallButton number={target.number} leadId={l.id} contactId={target.contact.id} leadName={l.name} contactName={target.contact.name} small />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length < total ? (
        <div className="center" style={{ padding: 16 }}>
          <button type="button" className="btn" onClick={() => setLimit(limit + PAGE)} disabled={data.loading}>
            Weitere laden ({(total - rows.length).toLocaleString('de-DE')} übrig)
          </button>
        </div>
      ) : null}

      {editing ? (
        <Popover anchor={editing.anchor} onClose={() => setEditing(null)}>
          <FilterEditor initial={editing.index !== null ? filter.conditions[editing.index] : undefined} onApply={(c) => setCondition(editing.index, c)} onCancel={() => setEditing(null)} />
        </Popover>
      ) : null}

      {colMenu.isOpen ? (
        <Popover anchor={colMenu.anchor} onClose={colMenu.close} align="end">
          <ColumnChooser all={allCols} value={columns} onChange={applyColumns} />
        </Popover>
      ) : null}

      {bulkMenu.isOpen ? (
        <Popover anchor={bulkMenu.anchor} onClose={bulkMenu.close}>
          {can('bulk_edit') ? <MenuItem icon={<Pencil />} onClick={() => openBulk('edit')}>Feld ändern (Status, Zuständig …)</MenuItem> : null}
          {can('bulk_email') ? <MenuItem icon={<Mail />} onClick={() => openBulk('email')}>E-Mail an alle senden</MenuItem> : null}
          {can('bulk_workflow') || can('manage_workflows') ? <MenuItem icon={<WorkflowIcon />} onClick={() => openBulk('workflow')}>In Workflow aufnehmen</MenuItem> : null}
          {can('bulk_delete') && can('delete_leads') ? <MenuItem icon={<Trash2 />} danger onClick={bulkDelete}>Löschen</MenuItem> : null}
        </Popover>
      ) : null}

      {more.isOpen ? (
        <Popover anchor={more.anchor} onClose={more.close} align="end">
          {can('export') ? (
            <MenuItem icon={<Download />} onClick={() => { more.close(); exportCsv(false); }}>
              Liste als CSV exportieren
            </MenuItem>
          ) : null}
          <MenuItem icon={<Columns3 />} onClick={() => { more.close(); navigate('#/views'); }}>
            Alle Smart Views
          </MenuItem>
          {canEditView ? (
            <>
              <MenuItem icon={<Pencil />} onClick={() => { more.close(); setModal('save'); }}>
                Ansicht umbenennen / freigeben
              </MenuItem>
              <MenuItem icon={<Trash2 />} danger onClick={() => { more.close(); deleteView(); }}>
                Smart View löschen
              </MenuItem>
            </>
          ) : null}
        </Popover>
      ) : null}

      {modal === 'save' ? <SaveViewModal existing={canEditView ? view : null} filter={{ ...filter, q }} sort={sort} columns={columns} onClose={() => setModal(null)} /> : null}
      {modal === 'edit' ? <BulkEditModal ids={bulkIds} onClose={() => setModal(null)} onDone={clearSelection} /> : null}
      {modal === 'email' ? <BulkEmailModal ids={bulkIds} onClose={() => setModal(null)} onDone={clearSelection} /> : null}
      {modal === 'workflow' ? <EnrollInWorkflowModal leadIds={bulkIds} onClose={() => { setModal(null); clearSelection(); }} /> : null}
    </div>
  );
}

function ColumnChooser({ all, value, onChange }: { all: LeadColumn[]; value: string[]; onChange: (v: string[]) => void }) {
  const groups = [...new Set(all.map((c) => c.group))];
  const move = (key: string, d: -1 | 1) => {
    const i = value.indexOf(key);
    const j = i + d;
    if (i < 0 || j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="col-chooser">
      <div className="menu-label">Angezeigt (Reihenfolge)</div>
      {value.map((k) => {
        const c = all.find((x) => x.key === k);
        if (!c) return null;
        return (
          <div key={k} className="row gap-4 col-chooser-row">
            <input type="checkbox" checked onChange={() => onChange(value.filter((x) => x !== k))} aria-label={`${c.label} ausblenden`} />
            <span className="grow small">{c.label}</span>
            <button type="button" className="icon-btn small" onClick={() => move(k, -1)} aria-label="Nach links"><ArrowUp /></button>
            <button type="button" className="icon-btn small" onClick={() => move(k, 1)} aria-label="Nach rechts"><ArrowDown /></button>
          </div>
        );
      })}
      {groups.map((g) => {
        const rest = all.filter((c) => c.group === g && !value.includes(c.key));
        if (!rest.length) return null;
        return (
          <div key={g}>
            <div className="menu-label">{g}</div>
            {rest.map((c) => (
              <label key={c.key} className="check col-chooser-row">
                <input type="checkbox" checked={false} onChange={() => onChange([...value, c.key])} />
                <span className="small">{c.label}</span>
              </label>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function SaveViewModal({ existing, filter, sort, columns, onClose }: { existing: SmartView | null; filter: FilterSet; sort: SortSpec; columns: string[]; onClose: () => void }) {
  const { store, reloadRef, can, me } = useApp();
  const { toast } = useUi();
  const team = can('manage_team_smart_views');
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [shared, setShared] = useState(existing?.shared ?? false);
  const [pinned, setPinned] = useState(existing?.pinned ?? false);
  const [asNew, setAsNew] = useState(!existing);

  const save = async () => {
    if (!name.trim()) return;
    try {
      const v = await store.saveSmartView({
        id: asNew ? undefined : existing?.id,
        name: name.trim(),
        description: description.trim(),
        filters: filter,
        sort,
        columns,
        shared,
        pinned: shared && pinned && team,
      });
      // Eigene, neue Ansicht direkt in die Seitenleiste
      if (asNew && !(shared && pinned)) {
        await store.updateMyProfile({ settings: { ...me.settings, pinnedViews: [...(me.settings.pinnedViews ?? []), v.id] } });
      }
      await reloadRef();
      toast('Smart View gespeichert.');
      onClose();
      navigate(`#/leads?view=${v.id}`);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  return (
    <Modal
      title="Smart View speichern"
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
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Hessen – noch nie angerufen" autoFocus />
        </Field>
        <Field label="Beschreibung (optional)">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Wofür ist die Liste?" />
        </Field>
        <label className="check">
          <input type="checkbox" checked={shared} disabled={!team} onChange={(e) => setShared(e.target.checked)} />
          Für das ganze Team sichtbar
        </label>
        {!team ? <p className="xs muted">Für das Team freigeben darf nur, wer das Recht „Smart Views fürs Team“ hat. Deine Ansicht ist nur für dich.</p> : null}
        {team && shared ? (
          <label className="check">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            Bei allen in der Seitenleiste anheften
          </label>
        ) : null}
        {existing ? (
          <label className="check">
            <input type="checkbox" checked={asNew} onChange={(e) => setAsNew(e.target.checked)} />
            Als neue Ansicht speichern (die bisherige bleibt)
          </label>
        ) : null}
      </div>
    </Modal>
  );
}

// ---------- Sammelaktionen ----------

type BulkField = 'status_id' | 'owner_id' | 'source' | 'address_state' | 'do_not_call' | `custom:${string}`;

function BulkEditModal({ ids, onClose, onDone }: { ids: ID[]; onClose: () => void; onDone: () => void }) {
  const { store, ref, can } = useApp();
  const { toast } = useUi();
  const fields = ref.customFields.filter((f) => f.entity === 'lead' && (!f.restricted || can('edit_restricted_fields')));
  const [field, setField] = useState<BulkField>('status_id');
  const [value, setValue] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const custom = field.startsWith('custom:') ? fields.find((f) => `custom:${f.key}` === field) : undefined;

  const apply = async () => {
    let patch: LeadInput;
    if (custom) patch = { custom: { [custom.key]: value === '' ? null : value } };
    else if (field === 'do_not_call') patch = { do_not_call: value === true };
    else patch = { [field]: value === '' ? null : value } as LeadInput;
    setBusy(true);
    try {
      const n = await store.bulkUpdateLeads(ids, patch);
      toast(`${n.toLocaleString('de-DE')} Leads geändert.`);
      bus.emit('leads');
      onDone();
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${ids.length.toLocaleString('de-DE')} Leads ändern`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={apply} disabled={busy}>Übernehmen</button>
        </>
      }
    >
      <div className="col gap-12">
        <Field label="Feld">
          <select className="select" value={field} onChange={(e) => { setField(e.target.value as BulkField); setValue(e.target.value === 'do_not_call' ? true : null); }}>
            <optgroup label="Lead">
              <option value="status_id">Status</option>
              <option value="owner_id">Zuständig</option>
              <option value="source">Quelle</option>
              <option value="address_state">Bundesland (Adresse)</option>
              <option value="do_not_call">Nicht anrufen</option>
            </optgroup>
            {fields.length ? (
              <optgroup label="Eigene Felder">
                {fields.map((f) => <option key={f.key} value={`custom:${f.key}`}>{f.label}</option>)}
              </optgroup>
            ) : null}
          </select>
        </Field>
        <Field label="Neuer Wert" hint="Leer lassen, um den Wert zu löschen.">
          {field === 'status_id' ? (
            <select className="select" value={String(value ?? '')} onChange={(e) => setValue(e.target.value || null)}>
              <option value="">– kein Status –</option>
              {ref.statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          ) : field === 'owner_id' ? (
            <select className="select" value={String(value ?? '')} onChange={(e) => setValue(e.target.value || null)}>
              <option value="">– niemand –</option>
              {ref.profiles.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
            </select>
          ) : field === 'do_not_call' ? (
            <select className="select" value={value === true ? 'ja' : 'nein'} onChange={(e) => setValue(e.target.value === 'ja')}>
              <option value="ja">ja – nicht mehr anrufen</option>
              <option value="nein">nein – wieder anrufen</option>
            </select>
          ) : custom ? (
            <FieldInput field={shapeOf(custom)} value={value} onChange={setValue} />
          ) : (
            <input className="input" value={String(value ?? '')} onChange={(e) => setValue(e.target.value)} />
          )}
        </Field>
      </div>
    </Modal>
  );
}

function BulkEmailModal({ ids, onClose, onDone }: { ids: ID[]; onClose: () => void; onDone: () => void }) {
  const { store, ref } = useApp();
  const { toast } = useUi();
  const templates = ref.templates.filter((t) => t.kind === 'email');
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [later, setLater] = useState(false);
  const [sendAt, setSendAt] = useState(toLocalInput(nextWorkday(1, 9)));
  const [busy, setBusy] = useState(false);
  const tpl = templates.find((t) => t.id === templateId);

  const send = async () => {
    if (!tpl) return;
    setBusy(true);
    try {
      const r = await store.bulkEmail(ids, tpl.id, later ? fromLocalInput(sendAt) : null);
      toast(`${r.queued.toLocaleString('de-DE')} E-Mails ${later ? `geplant für ${formatDateTime(fromLocalInput(sendAt))}` : 'werden gesendet'}${r.skipped ? `, ${r.skipped} ohne E-Mail-Adresse übersprungen` : ''}.`);
      bus.emit('leads');
      onDone();
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`E-Mail an ${ids.length.toLocaleString('de-DE')} Leads`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={send} disabled={busy || !tpl}>{later ? 'Planen' : 'Senden'}</button>
        </>
      }
    >
      {!templates.length ? (
        <p className="muted">Für Sammel-E-Mails brauchst du eine Vorlage. <a href="#/settings/templates">Vorlage anlegen</a></p>
      ) : (
        <div className="col gap-12">
          <Field label="Vorlage" hint="Geht an den ersten Kontakt mit E-Mail-Adresse. Platzhalter werden je Lead ausgefüllt.">
            <select className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          {tpl ? (
            <div className="quote small">
              <strong>{tpl.subject}</strong>
            </div>
          ) : null}
          <div className="row wrap gap-8">
            <label className="check">
              <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} />
              Später senden
            </label>
            {later ? <input className="input small" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} aria-label="Sendezeitpunkt" /> : null}
          </div>
          <p className="xs muted">Gesendet wird über das verbundene Postfach, verteilt über einige Minuten – so landet nichts im Spam.</p>
        </div>
      )}
    </Modal>
  );
}
