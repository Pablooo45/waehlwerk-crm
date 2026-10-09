// Anpassen wie in Close: Status & Pipelines, eigene Felder, Anruf-Ergebnisse, Gesprächsleitfaden, Links am Lead.
// Überall dasselbe Muster: Liste zum Ziehen, „+ Neu“ oben rechts, ein Klick auf eine Zeile öffnet das Bearbeiten-Fenster.

import { Lock, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { slugKey } from '../../lib/perms.ts';
import type { CallOutcome, CustomField, CustomFieldType, FieldEntity, IntegrationLink, LeadStatus, OpportunityStatus, Pipeline, StatusKind } from '../../lib/types.ts';
import { cx, Field, MenuItem, Modal, Popover, Segmented, Switch, Tabs, Tag, useMenu, useUi } from '../../ui/ui.tsx';
import { StatusSelect } from '../common/bits.tsx';
import { ColorPicker, KIND_LABEL, resort, SortableList, useSaver } from './shared.tsx';

export default function Customize({ section }: { section: string }) {
  if (section === 'statuses' || section === 'pipelines') return <StatusesAndPipelines tab={section === 'pipelines' ? 'opp' : 'lead'} />;
  if (section === 'outcomes') return <Outcomes />;
  if (section === 'fields') return <Fields />;
  if (section === 'links') return <Links />;
  return <Script />;
}

const KIND_HINT: Record<StatusKind, string> = {
  open: 'Läuft noch',
  won: 'Zählt als gewonnen (Kunde, Abschluss)',
  lost: 'Zählt als verloren / abgeschlossen',
};

function SectionHead({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="cust-head">
      <div className="grow">
        <h2>{title}</h2>
        {children ? <p className="muted">{children}</p> : null}
      </div>
      {action}
    </div>
  );
}

// ---------- Status & Pipelines (eine Seite wie in Close) ----------
function StatusesAndPipelines({ tab }: { tab: 'lead' | 'opp' }) {
  return (
    <section className="section">
      <Tabs<'lead' | 'opp'>
        value={tab}
        onChange={(t) => {
          location.hash = t === 'opp' ? '#/settings/pipelines' : '#/settings/statuses';
        }}
        tabs={[
          { value: 'lead', label: 'Lead-Status' },
          { value: 'opp', label: 'Opportunity-Status & Pipelines' },
        ]}
      />
      <div className="mt-16">{tab === 'lead' ? <LeadStatuses /> : <Pipelines />}</div>
    </section>
  );
}

function LeadStatuses() {
  const { store, ref } = useApp();
  const save = useSaver();
  const [edit, setEdit] = useState<LeadStatus | 'new' | null>(null);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    store
      .reportStatusCounts()
      .then((rows) => setCounts(new Map(rows.map((r) => [r.status_id ?? '', r.cnt]))))
      .catch(() => undefined);
  }, [store, ref.statuses]);
  const list = ref.statuses;
  const reorder = (next: LeadStatus[]) =>
    save(async () => {
      for (const { item, sort } of resort(next, (s) => s.sort)) await store.saveConfig('lead_statuses', { id: item.id, sort });
    });
  return (
    <>
      <SectionHead
        title="Lead-Status"
        action={<button type="button" className="btn primary" onClick={() => setEdit('new')}><Plus /> Neuer Status</button>}
      >
        Wo ein Lead gerade steht. Reihenfolge per Ziehen ändern. „Gewonnen“ zählt als Kunde und wird vom Power Dialer übersprungen.
      </SectionHead>
      <SortableList
        label="Lead-Status"
        items={list}
        keyOf={(s) => s.id}
        onReorder={reorder}
        render={(s, handle) => (
          <>
            {handle}
            <button type="button" className="sort-main" onClick={() => setEdit(s)}>
              <span className="dot" style={{ background: s.color }} aria-hidden="true" />
              <strong className="grow ellipsis">{s.label}</strong>
              {s.is_default ? <Tag tone="blue">Standard für neue Leads</Tag> : null}
              {s.kind !== 'open' ? <Tag tone={s.kind === 'won' ? 'green' : 'soft'}>{KIND_LABEL[s.kind]}</Tag> : null}
              <span className="muted small num sort-count">{counts.get(s.id) ?? 0} Leads</span>
            </button>
            <button type="button" className="icon-btn small" onClick={() => setEdit(s)} aria-label={`${s.label} bearbeiten`}>
              <Pencil />
            </button>
          </>
        )}
      />
      {edit ? <LeadStatusModal status={edit === 'new' ? null : edit} count={edit === 'new' ? 0 : counts.get(edit.id) ?? 0} onClose={() => setEdit(null)} /> : null}
    </>
  );
}

function LeadStatusModal({ status, count, onClose }: { status: LeadStatus | null; count: number; onClose: () => void }) {
  const { store, ref } = useApp();
  const { confirm } = useUi();
  const save = useSaver();
  const [label, setLabel] = useState(status?.label ?? '');
  const [color, setColor] = useState(status?.color ?? '#4c63d9');
  const [kind, setKind] = useState<StatusKind>(status?.kind ?? 'open');
  const [isDefault, setDefault] = useState(status?.is_default ?? false);
  const others = ref.statuses.filter((s) => s.id !== status?.id);
  const [replacement, setReplacement] = useState<string | null>(others.find((s) => s.is_default)?.id ?? others[0]?.id ?? null);
  const [deleting, setDeleting] = useState(false);

  const submit = async () => {
    if (!label.trim()) return;
    const ok = await save(() =>
      status
        ? store.saveConfig('lead_statuses', { id: status.id, label: label.trim(), color, kind, is_default: isDefault })
        : store.saveConfig('lead_statuses', { label: label.trim(), color, kind, is_default: isDefault, sort: (ref.statuses.at(-1)?.sort ?? 0) + 10 }),
    );
    if (ok) onClose();
  };

  const remove = async () => {
    if (!status) return;
    if (!count) {
      if (!(await confirm(`Status „${status.label}“ löschen?`, { danger: true, confirmLabel: 'Löschen' }))) return;
      if (await save(() => store.deleteConfig('lead_statuses', status.id), 'Status gelöscht.')) onClose();
      return;
    }
    setDeleting(true);
  };

  // Wie in Close: Leads mit diesem Status bekommen vorher einen anderen
  const removeWithReplacement = async () => {
    if (!status) return;
    const ok = await save(async () => {
      if (replacement) {
        const ids = await store.listLeadIds({ conditions: [{ field: 'status', op: 'in', value: [status.id] }] }, { field: 'created_at', dir: 'asc' }, 100_000);
        for (let i = 0; i < ids.length; i += 500) await store.bulkUpdateLeads(ids.slice(i, i + 500), { status_id: replacement });
      }
      await store.deleteConfig('lead_statuses', status.id);
    }, 'Status gelöscht.');
    if (ok) onClose();
  };

  if (deleting && status) {
    return (
      <Modal
        title={`„${status.label}“ löschen`}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setDeleting(false)}>Zurück</button>
            <button type="button" className="btn danger" onClick={removeWithReplacement}>Status löschen</button>
          </>
        }
      >
        <div className="col gap-12">
          <p>{count === 1 ? '1 Lead hat' : `${count} Leads haben`} diesen Status. Welchen Status sollen sie stattdessen bekommen?</p>
          <StatusSelect value={replacement} onChange={setReplacement} statuses={others} allowEmpty />
          <p className="small muted">Smart Views, die nach „{status.label}“ filtern, bitte danach anpassen.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={status ? 'Lead-Status bearbeiten' : 'Neuer Lead-Status'}
      onClose={onClose}
      footer={
        <>
          {status ? (
            <button type="button" className="btn ghost danger-text" style={{ marginRight: 'auto' }} onClick={remove}>
              <Trash2 /> Löschen
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={submit} disabled={!label.trim()}>Speichern</button>
        </>
      }
    >
      <div className="col gap-16">
        <Field label="Name">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="z. B. Interessiert" />
        </Field>
        <Field label="Farbe">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <KindField value={kind} onChange={setKind} />
        <label className="switch-row">
          <span className="grow">
            <strong>Standard für neue Leads</strong>
            <span className="block small muted">Neu angelegte und importierte Leads bekommen diesen Status.</span>
          </span>
          <Switch checked={isDefault} onChange={setDefault} label="Standard für neue Leads" />
        </label>
      </div>
    </Modal>
  );
}

function KindField({ value, onChange }: { value: StatusKind; onChange: (k: StatusKind) => void }) {
  return (
    <Field label="Art" hint={KIND_HINT[value]}>
      <Segmented<StatusKind>
        value={value}
        onChange={onChange}
        label="Art"
        options={(['open', 'won', 'lost'] as StatusKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
      />
    </Field>
  );
}

function Pipelines() {
  const { store, ref } = useApp();
  const { confirm } = useUi();
  const save = useSaver();
  const [pipeId, setPipeId] = useState<string | null>(ref.pipelines[0]?.id ?? null);
  const [edit, setEdit] = useState<OpportunityStatus | 'new' | null>(null);
  const [pipeEdit, setPipeEdit] = useState<Pipeline | 'new' | null>(null);
  const pipeMenu = useMenu();
  const pipe = ref.pipelines.find((p) => p.id === pipeId) ?? ref.pipelines[0] ?? null;
  const list = ref.oppStatuses.filter((s) => s.pipeline_id === pipe?.id).sort((a, b) => a.sort - b.sort);
  const reorder = (next: OpportunityStatus[]) =>
    save(async () => {
      for (const { item, sort } of resort(next, (s) => s.sort)) await store.saveConfig('opportunity_statuses', { id: item.id, sort });
    });
  const removePipe = async () => {
    if (!pipe) return;
    if (!(await confirm(`Pipeline „${pipe.name}“ mit ${list.length} Phasen löschen? Opportunities darin verlieren ihre Phase.`, { danger: true, confirmLabel: 'Löschen' }))) return;
    if (await save(() => store.deleteConfig('pipelines', pipe.id), 'Pipeline gelöscht.')) setPipeId(null);
  };
  return (
    <>
      <SectionHead
        title="Opportunity-Status & Pipelines"
        action={<button type="button" className="btn" onClick={() => setPipeEdit('new')}><Plus /> Neue Pipeline</button>}
      >
        Jede Pipeline hat eigene Phasen, z. B. „Sales“ und „Setting → Closing“. Phasen per Ziehen sortieren.
      </SectionHead>
      {ref.pipelines.length ? (
        <div className="row wrap gap-8 pipe-switch">
          <Segmented<string> value={pipe?.id ?? ''} onChange={setPipeId} label="Pipeline" options={ref.pipelines.map((p) => ({ value: p.id, label: p.name }))} />
          <span className="grow" />
          {pipe ? (
            <>
              <button type="button" className="btn primary" onClick={() => setEdit('new')}><Plus /> Neue Phase</button>
              <button type="button" className="icon-btn" onClick={pipeMenu.open} aria-label="Pipeline umbenennen oder löschen" aria-haspopup="menu"><MoreHorizontal /></button>
            </>
          ) : null}
        </div>
      ) : null}
      {pipe ? (
        <div className="mt-12">
          <SortableList
            label={`Phasen von ${pipe.name}`}
            items={list}
            keyOf={(s) => s.id}
            onReorder={reorder}
            render={(s, handle) => (
              <>
                {handle}
                <button type="button" className="sort-main" onClick={() => setEdit(s)}>
                  <span className="dot" style={{ background: s.color }} aria-hidden="true" />
                  <strong className="grow ellipsis">{s.label}</strong>
                  {s.kind !== 'open' ? <Tag tone={s.kind === 'won' ? 'green' : 'soft'}>{KIND_LABEL[s.kind]}</Tag> : null}
                </button>
                <button type="button" className="icon-btn small" onClick={() => setEdit(s)} aria-label={`${s.label} bearbeiten`}>
                  <Pencil />
                </button>
              </>
            )}
          />
          {!list.length ? <p className="small muted mt-8">Noch keine Phasen.</p> : null}
        </div>
      ) : (
        <p className="muted">Noch keine Pipeline.</p>
      )}
      {pipeMenu.isOpen && pipe ? (
        <Popover anchor={pipeMenu.anchor} onClose={pipeMenu.close} align="end">
          <MenuItem icon={<Pencil />} onClick={() => { pipeMenu.close(); setPipeEdit(pipe); }}>Umbenennen</MenuItem>
          <MenuItem icon={<Trash2 />} danger onClick={() => { pipeMenu.close(); removePipe(); }}>Pipeline löschen</MenuItem>
        </Popover>
      ) : null}
      {edit && pipe ? <OppStatusModal status={edit === 'new' ? null : edit} pipeline={pipe} onClose={() => setEdit(null)} /> : null}
      {pipeEdit ? <PipelineModal pipeline={pipeEdit === 'new' ? null : pipeEdit} onClose={(id) => { setPipeEdit(null); if (id) setPipeId(id); }} /> : null}
    </>
  );
}

function PipelineModal({ pipeline, onClose }: { pipeline: Pipeline | null; onClose: (createdId?: string) => void }) {
  const { store, ref } = useApp();
  const save = useSaver();
  const [name, setName] = useState(pipeline?.name ?? '');
  const submit = async () => {
    if (!name.trim()) return;
    let created: string | undefined;
    const ok = await save(async () => {
      if (pipeline) {
        await store.saveConfig('pipelines', { id: pipeline.id, name: name.trim() });
        return;
      }
      const p = await store.saveConfig('pipelines', { name: name.trim(), sort: (ref.pipelines.at(-1)?.sort ?? 0) + 10 });
      created = p.id;
      const base: [string, StatusKind, string][] = [['Neu', 'open', '#4c63d9'], ['Gewonnen', 'won', '#0e8a5f'], ['Verloren', 'lost', '#b5473a']];
      for (const [i, [label, kind, color]] of base.entries()) {
        await store.saveConfig('opportunity_statuses', { pipeline_id: p.id, label, kind, color, sort: (i + 1) * 10 });
      }
    });
    if (ok) onClose(created);
  };
  return (
    <Modal
      title={pipeline ? 'Pipeline umbenennen' : 'Neue Pipeline'}
      onClose={() => onClose()}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onClose()}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={submit} disabled={!name.trim()}>Speichern</button>
        </>
      }
    >
      <Field label="Name" hint={pipeline ? undefined : 'Startet mit den Phasen Neu, Gewonnen und Verloren – danach frei anpassbar.'}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="z. B. Mitarbeitergewinnung" />
      </Field>
    </Modal>
  );
}

function OppStatusModal({ status, pipeline, onClose }: { status: OpportunityStatus | null; pipeline: Pipeline; onClose: () => void }) {
  const { store, ref } = useApp();
  const { confirm } = useUi();
  const save = useSaver();
  const [label, setLabel] = useState(status?.label ?? '');
  const [color, setColor] = useState(status?.color ?? '#4c63d9');
  const [kind, setKind] = useState<StatusKind>(status?.kind ?? 'open');
  const siblings = ref.oppStatuses.filter((s) => s.pipeline_id === pipeline.id);
  const submit = async () => {
    if (!label.trim()) return;
    const ok = await save(() =>
      status
        ? store.saveConfig('opportunity_statuses', { id: status.id, label: label.trim(), color, kind })
        : store.saveConfig('opportunity_statuses', { pipeline_id: pipeline.id, label: label.trim(), color, kind, sort: Math.max(0, ...siblings.map((s) => s.sort)) + 10 }),
    );
    if (ok) onClose();
  };
  const remove = async () => {
    if (!status || !(await confirm(`Phase „${status.label}“ löschen? Opportunities in dieser Phase verlieren sie.`, { danger: true, confirmLabel: 'Löschen' }))) return;
    if (await save(() => store.deleteConfig('opportunity_statuses', status.id), 'Phase gelöscht.')) onClose();
  };
  return (
    <Modal
      title={status ? `Phase bearbeiten (${pipeline.name})` : `Neue Phase in „${pipeline.name}“`}
      onClose={onClose}
      footer={
        <>
          {status ? (
            <button type="button" className="btn ghost danger-text" style={{ marginRight: 'auto' }} onClick={remove}>
              <Trash2 /> Löschen
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={submit} disabled={!label.trim()}>Speichern</button>
        </>
      }
    >
      <div className="col gap-16">
        <Field label="Name">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="z. B. Angebot verschickt" />
        </Field>
        <Field label="Farbe">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <KindField value={kind} onChange={setKind} />
      </div>
    </Modal>
  );
}

// ---------- Anruf-Ergebnisse ----------
function Outcomes() {
  const { store, ref } = useApp();
  const save = useSaver();
  const [edit, setEdit] = useState<CallOutcome | 'new' | null>(null);
  const list = ref.outcomes;
  const statusLabel = (id: string | null) => ref.statuses.find((s) => s.id === id)?.label;
  const reorder = (next: CallOutcome[]) =>
    save(async () => {
      for (const { item, sort } of resort(next, (o) => o.sort)) await store.saveConfig('call_outcomes', { key: item.key, sort });
    });
  return (
    <section className="section">
      <SectionHead title="Anruf-Ergebnisse" action={<button type="button" className="btn primary" onClick={() => setEdit('new')}><Plus /> Neues Ergebnis</button>}>
        Die Knöpfe nach jedem Anruf (Tasten 1–9 in dieser Reihenfolge). Jedes Ergebnis kann den Lead-Status setzen und eine Wiedervorlage anlegen.
      </SectionHead>
      <SortableList
        label="Anruf-Ergebnisse"
        items={list}
        keyOf={(o) => o.key}
        onReorder={reorder}
        render={(o, handle, i) => (
          <>
            {handle}
            <button type="button" className={cx('sort-main', !o.active && 'inactive')} onClick={() => setEdit(o)}>
              <span className="dot" style={{ background: o.color }} aria-hidden="true" />
              <span className="grow" style={{ minWidth: 0 }}>
                <strong className="block ellipsis">{o.label}</strong>
                <span className="block xs muted ellipsis">
                  {[
                    o.counts_as_connected ? 'zählt als erreicht' : null,
                    o.is_meeting ? 'zählt als Termin' : null,
                    o.next_status_id ? `Status → ${statusLabel(o.next_status_id) ?? '?'}` : null,
                    o.followup_days != null ? `Wiedervorlage ${FOLLOWUP_LABEL[String(o.followup_days)] ?? `in ${o.followup_days} Tagen`}` : null,
                  ]
                    .filter(Boolean)
                    .join(', ') || o.description || 'keine Automatik'}
                </span>
              </span>
              {!o.active ? <Tag tone="soft">aus</Tag> : i < 9 ? <kbd className="hide-touch">{i + 1}</kbd> : null}
            </button>
            <button type="button" className="icon-btn small" onClick={() => setEdit(o)} aria-label={`${o.label} bearbeiten`}>
              <Pencil />
            </button>
          </>
        )}
      />
      {edit ? <OutcomeModal outcome={edit === 'new' ? null : edit} onClose={() => setEdit(null)} /> : null}
    </section>
  );
}

const FOLLOWUP_LABEL: Record<string, string> = { '0': 'heute', '1': 'morgen', '2': 'in 2 Tagen', '7': 'in 1 Woche', '30': 'in 1 Monat' };

function OutcomeModal({ outcome, onClose }: { outcome: CallOutcome | null; onClose: () => void }) {
  const { store, ref } = useApp();
  const { confirm } = useUi();
  const save = useSaver();
  const [f, setF] = useState({
    label: outcome?.label ?? '',
    color: outcome?.color ?? '#4c63d9',
    description: outcome?.description ?? '',
    active: outcome?.active ?? true,
    counts_as_connected: outcome?.counts_as_connected ?? false,
    is_meeting: outcome?.is_meeting ?? false,
    next_status_id: outcome?.next_status_id ?? null,
    followup_days: outcome?.followup_days ?? null,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const submit = async () => {
    if (!f.label.trim()) return;
    const ok = await save(() =>
      outcome
        ? store.saveConfig('call_outcomes', { key: outcome.key, ...f, label: f.label.trim() })
        : store.saveConfig('call_outcomes', { key: slugKey(f.label, ref.outcomes.map((o) => o.key)), ...f, label: f.label.trim(), sort: (ref.outcomes.at(-1)?.sort ?? 0) + 10 }, true),
    );
    if (ok) onClose();
  };
  const remove = async () => {
    if (!outcome || !(await confirm(`„${outcome.label}“ löschen? Bisherige Anrufe verlieren dieses Ergebnis – meist ist „ausschalten“ besser.`, { danger: true, confirmLabel: 'Löschen' }))) return;
    if (await save(() => store.deleteConfig('call_outcomes', outcome.key), 'Ergebnis gelöscht.')) onClose();
  };
  return (
    <Modal
      title={outcome ? 'Anruf-Ergebnis bearbeiten' : 'Neues Anruf-Ergebnis'}
      onClose={onClose}
      wide
      footer={
        <>
          {outcome ? (
            <button type="button" className="btn ghost danger-text" style={{ marginRight: 'auto' }} onClick={remove}>
              <Trash2 /> Löschen
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={submit} disabled={!f.label.trim()}>Speichern</button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="form-grid">
          <Field label="Name">
            <input className="input" value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="z. B. Bereits Kunde" />
          </Field>
          <Field label="Beschreibung (für das Team)">
            <input className="input" value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Wann wählt man dieses Ergebnis?" />
          </Field>
        </div>
        <Field label="Farbe">
          <ColorPicker value={f.color} onChange={(v) => set('color', v)} />
        </Field>
        <div className="col gap-8">
          <label className="switch-row">
            <span className="grow"><strong>Aktiv</strong><span className="block small muted">Ausgeschaltete Ergebnisse stehen nach dem Anruf nicht mehr zur Wahl.</span></span>
            <Switch checked={f.active} onChange={(v) => set('active', v)} label="Aktiv" />
          </label>
          <label className="switch-row">
            <span className="grow"><strong>Zählt als erreicht</strong><span className="block small muted">In Berichten: Entscheider erreicht.</span></span>
            <Switch checked={f.counts_as_connected} onChange={(v) => set('counts_as_connected', v)} label="Zählt als erreicht" />
          </label>
          <label className="switch-row">
            <span className="grow"><strong>Zählt als Termin</strong><span className="block small muted">In Berichten: gelegtes Setting. Nach dem Anruf erscheint „Termin buchen“.</span></span>
            <Switch checked={f.is_meeting} onChange={(v) => set('is_meeting', v)} label="Zählt als Termin" />
          </label>
        </div>
        <div className="form-grid">
          <Field label="Danach Lead-Status setzen" hint="Wird nach dem Anruf vorgeschlagen.">
            <StatusSelect value={f.next_status_id} onChange={(v) => set('next_status_id', v)} statuses={ref.statuses} allowEmpty />
          </Field>
          <Field label="Danach Wiedervorlage">
            <select className="select" value={f.followup_days ?? ''} onChange={(e) => set('followup_days', e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">keine</option>
              <option value="0">heute</option>
              <option value="1">morgen</option>
              <option value="2">in 2 Tagen</option>
              <option value="7">in 1 Woche</option>
              <option value="30">in 1 Monat</option>
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Eigene Felder ----------
export const TYPE_LABEL: Record<CustomFieldType, string> = {
  text: 'Text',
  textarea: 'Langer Text',
  number: 'Zahl',
  date: 'Datum',
  datetime: 'Datum & Uhrzeit',
  choice: 'Auswahl (eine)',
  multichoice: 'Auswahl (mehrere)',
  checkbox: 'Ja/Nein',
  url: 'Link',
  user: 'Person (Benutzer)',
};

const ENTITY_LABEL: Record<FieldEntity, string> = { lead: 'Lead', contact: 'Kontakt', opportunity: 'Opportunity' };

function Fields() {
  const { store, ref } = useApp();
  const save = useSaver();
  const [entity, setEntity] = useState<FieldEntity>('lead');
  const [edit, setEdit] = useState<CustomField | 'new' | null>(null);
  const list = ref.customFields.filter((f) => f.entity === entity).sort((a, b) => a.sort - b.sort);
  const reorder = (next: CustomField[]) =>
    save(async () => {
      for (const { item, sort } of resort(next, (f) => f.sort)) await store.saveConfig('custom_fields', { key: item.key, sort });
    });
  return (
    <section className="section">
      <SectionHead title="Eigene Felder" action={<button type="button" className="btn primary" onClick={() => setEdit('new')}><Plus /> Neues {ENTITY_LABEL[entity]}-Feld</button>}>
        Zusätzliche Angaben an Leads, Kontakten und Opportunities. Die Reihenfolge hier ist die Reihenfolge am Lead. Felder erscheinen am
        Lead, sobald sie ausgefüllt sind – oder immer, wenn „Immer zeigen“ an ist.
      </SectionHead>
      <Tabs<FieldEntity>
        value={entity}
        onChange={setEntity}
        tabs={(Object.keys(ENTITY_LABEL) as FieldEntity[]).map((e) => ({ value: e, label: `${ENTITY_LABEL[e]} (${ref.customFields.filter((f) => f.entity === e).length})` }))}
      />
      <div className="mt-12">
        <SortableList
          label={`${ENTITY_LABEL[entity]}-Felder`}
          items={list}
          keyOf={(f) => f.key}
          onReorder={reorder}
          render={(f, handle) => (
            <>
              {handle}
              <button type="button" className="sort-main" onClick={() => setEdit(f)}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <strong className="block ellipsis">{f.label}</strong>
                  {f.choices.length ? <span className="block xs muted ellipsis">{f.choices.join(', ')}</span> : null}
                </span>
                {f.always_show ? <Tag tone="blue">immer zeigen</Tag> : null}
                {f.show_in_list ? <Tag tone="soft">Spalte</Tag> : null}
                {f.restricted ? <Tag tone="amber"><Lock size={11} aria-hidden="true" /> geschützt</Tag> : null}
                <span className="small muted field-type">{TYPE_LABEL[f.type]}</span>
              </button>
              <button type="button" className="icon-btn small" onClick={() => setEdit(f)} aria-label={`${f.label} bearbeiten`}>
                <Pencil />
              </button>
            </>
          )}
        />
        {!list.length ? <p className="small muted">Noch keine {ENTITY_LABEL[entity]}-Felder.</p> : null}
      </div>
      {edit ? <FieldModal field={edit === 'new' ? null : edit} entity={entity} onClose={() => setEdit(null)} /> : null}
    </section>
  );
}

function FieldModal({ field, entity, onClose }: { field: CustomField | null; entity: FieldEntity; onClose: () => void }) {
  const { store, ref } = useApp();
  const { confirm } = useUi();
  const save = useSaver();
  const [label, setLabel] = useState(field?.label ?? '');
  const [type, setType] = useState<CustomFieldType>(field?.type ?? 'text');
  const [choices, setChoices] = useState((field?.choices ?? []).join('\n'));
  const [description, setDescription] = useState(field?.description ?? '');
  const [alwaysShow, setAlwaysShow] = useState(field?.always_show ?? true);
  const [showInList, setShowInList] = useState(field?.show_in_list ?? false);
  const [restricted, setRestricted] = useState(field?.restricted ?? false);
  const hasChoices = type === 'choice' || type === 'multichoice';
  const choiceList = choices.split('\n').map((c) => c.trim()).filter(Boolean);
  const target = field?.entity ?? entity;

  const submit = async () => {
    if (!label.trim()) return;
    if (field && field.type !== type && !(await confirm(`Typ von „${field.label}“ von „${TYPE_LABEL[field.type]}“ auf „${TYPE_LABEL[type]}“ ändern? Werte, die nicht passen, werden nicht mehr richtig angezeigt.`, { confirmLabel: 'Typ ändern' }))) return;
    const row = { label: label.trim(), type, choices: hasChoices ? choiceList : [], description: description.trim(), always_show: alwaysShow, show_in_list: showInList, restricted };
    const ok = await save(() =>
      field
        ? store.saveConfig('custom_fields', { key: field.key, ...row })
        : store.saveConfig('custom_fields', { key: slugKey(label, ref.customFields.map((x) => x.key)), entity: target, sort: Math.max(0, ...ref.customFields.filter((x) => x.entity === target).map((x) => x.sort)) + 10, ...row }, true),
    );
    if (ok) onClose();
  };
  const remove = async () => {
    if (!field || !(await confirm(`Feld „${field.label}“ löschen? Die gespeicherten Werte bleiben im Hintergrund erhalten, sind aber nicht mehr sichtbar.`, { danger: true, confirmLabel: 'Löschen' }))) return;
    if (await save(() => store.deleteConfig('custom_fields', field.key), 'Feld gelöscht.')) onClose();
  };
  return (
    <Modal
      title={field ? `${ENTITY_LABEL[target]}-Feld bearbeiten` : `Neues ${ENTITY_LABEL[target]}-Feld`}
      onClose={onClose}
      wide
      footer={
        <>
          {field ? (
            <button type="button" className="btn ghost danger-text" style={{ marginRight: 'auto' }} onClick={remove}>
              <Trash2 /> Löschen
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={submit} disabled={!label.trim() || (hasChoices && !choiceList.length)}>Speichern</button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="form-grid">
          <Field label="Name">
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="z. B. Anzahl Filialen" />
          </Field>
          <Field label="Typ">
            <select className="select" value={type} onChange={(e) => setType(e.target.value as CustomFieldType)}>
              {(Object.keys(TYPE_LABEL) as CustomFieldType[]).map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </select>
          </Field>
        </div>
        {hasChoices ? (
          <Field label="Auswahlmöglichkeiten" hint="Eine pro Zeile. Umbenennen ändert bestehende Werte nicht.">
            <textarea className="textarea" rows={Math.min(10, Math.max(4, choiceList.length + 1))} value={choices} onChange={(e) => setChoices(e.target.value)} placeholder={'Empfehlung\nInbound\nKaltakquise-Liste'} />
          </Field>
        ) : null}
        <Field label="Hilfetext (optional)">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Erscheint, wenn man über den Feldnamen fährt" />
        </Field>
        <div className="col gap-8">
          {target === 'lead' ? (
            <label className="switch-row">
              <span className="grow"><strong>Immer am Lead zeigen</strong><span className="block small muted">Auch wenn das Feld leer ist. Sonst erscheint es erst, wenn jemand es ausfüllt (über „+“ bei Felder).</span></span>
              <Switch checked={alwaysShow} onChange={setAlwaysShow} label="Immer am Lead zeigen" />
            </label>
          ) : null}
          {target !== 'opportunity' ? (
            <label className="switch-row">
              <span className="grow"><strong>Als Spalte in Listen</strong><span className="block small muted">Standardmäßig als Spalte in {target === 'lead' ? 'Lead-Listen und Smart Views' : 'der Kontaktliste'}.</span></span>
              <Switch checked={showInList} onChange={setShowInList} label="Als Spalte in Listen" />
            </label>
          ) : null}
          <label className="switch-row">
            <span className="grow"><strong>Geschützt</strong><span className="block small muted">Nur Rollen mit dem Recht „Geschützte Felder bearbeiten“ dürfen den Wert ändern.</span></span>
            <Switch checked={restricted} onChange={setRestricted} label="Geschützt" />
          </label>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Gesprächsleitfaden ----------
function Script() {
  const { store, ref } = useApp();
  const save = useSaver();
  const [text, setText] = useState(ref.org.call_script);
  return (
    <section className="section">
      <SectionHead title="Gesprächsleitfaden">Erscheint im Power Dialer (Knopf „Leitfaden“). Kurz und in Stichpunkten ist am hilfreichsten.</SectionHead>
      <textarea className="textarea" style={{ minHeight: 320 }} value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" className="btn primary mt-16" disabled={text === ref.org.call_script} onClick={() => save(() => store.updateOrg({ call_script: text }), 'Leitfaden gespeichert.')}>
        Speichern
      </button>
    </section>
  );
}

// ---------- Links am Lead (Close: Integration Links) ----------
function Links() {
  const { store, ref } = useApp();
  const save = useSaver();
  const [edit, setEdit] = useState<IntegrationLink | 'new' | null>(null);
  const list = [...ref.integrationLinks].sort((a, b) => a.sort - b.sort);
  const reorder = (next: IntegrationLink[]) =>
    save(async () => {
      for (const { item, sort } of resort(next, (l) => l.sort)) await store.saveConfig('integration_links', { id: item.id, sort });
    });
  return (
    <section className="section">
      <SectionHead title="Links am Lead" action={<button type="button" className="btn primary" onClick={() => setEdit('new')}><Plus /> Neuer Link</button>}>
        Schnelllinks auf der Lead-Seite (links unten und im ⋯-Menü), z. B. Google-Suche, Maps oder Handelsregister.
      </SectionHead>
      <SortableList
        label="Links am Lead"
        items={list}
        keyOf={(l) => l.id}
        onReorder={reorder}
        render={(l, handle) => (
          <>
            {handle}
            <button type="button" className="sort-main" onClick={() => setEdit(l)}>
              <span className="grow" style={{ minWidth: 0 }}>
                <strong className="block">{l.name}</strong>
                <span className="block xs muted ellipsis">{l.url_template}</span>
              </span>
            </button>
            <button type="button" className="icon-btn small" onClick={() => setEdit(l)} aria-label={`${l.name} bearbeiten`}>
              <Pencil />
            </button>
          </>
        )}
      />
      {!list.length ? <p className="small muted">Noch keine Links.</p> : null}
      {edit ? <LinkModal link={edit === 'new' ? null : edit} onClose={() => setEdit(null)} /> : null}
    </section>
  );
}

function LinkModal({ link, onClose }: { link: IntegrationLink | null; onClose: () => void }) {
  const { store, ref } = useApp();
  const save = useSaver();
  const [name, setName] = useState(link?.name ?? '');
  const [url, setUrl] = useState(link?.url_template ?? '');
  const valid = /^https?:\/\/\S+$/.test(url.trim());
  const submit = async () => {
    if (!name.trim() || !valid) return;
    const ok = await save(() =>
      link
        ? store.saveConfig('integration_links', { id: link.id, name: name.trim(), url_template: url.trim() })
        : store.saveConfig('integration_links', { name: name.trim(), url_template: url.trim(), scope: 'lead', sort: (ref.integrationLinks.at(-1)?.sort ?? 0) + 10 }),
    );
    if (ok) onClose();
  };
  return (
    <Modal
      title={link ? 'Link bearbeiten' : 'Neuer Link'}
      onClose={onClose}
      wide
      footer={
        <>
          {link ? (
            <button type="button" className="btn ghost danger-text" style={{ marginRight: 'auto' }} onClick={async () => { if (await save(() => store.deleteConfig('integration_links', link.id), 'Link gelöscht.')) onClose(); }}>
              <Trash2 /> Löschen
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={submit} disabled={!name.trim() || !valid}>Speichern</button>
        </>
      }
    >
      <div className="col gap-12">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Handelsregister" />
        </Field>
        <Field label="Adresse" hint={url && !valid ? 'Muss mit https:// beginnen.' : 'Platzhalter wie {{lead.name}}, {{lead.address_city}}, {{lead.address_zip}} oder {{contact.phone}} werden mit den Werten des Leads gefüllt.'}>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.google.com/search?q={{lead.name}}" />
        </Field>
      </div>
    </Modal>
  );
}
