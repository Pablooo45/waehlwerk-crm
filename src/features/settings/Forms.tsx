// Eigene Aktivitäten (in Close „Custom Activities“), z. B. „Setting: Kundengewinnung“ oder „Wiedervorlage“.
// Wie in Close: Liste der Aktivitäten → Klick öffnet die Aktivität mit ihren Feldern; alles speichert sofort.

import { Archive, ArchiveRestore, ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { slugKey } from '../../lib/perms.ts';
import type { ActivityField, ActivityType, CustomFieldType } from '../../lib/types.ts';
import { cx, Empty, Field, Modal, Switch, Tag, useUi } from '../../ui/ui.tsx';
import { TYPE_LABEL } from './Customize.tsx';
import { ColorPicker, resort, SortableList, useSaver } from './shared.tsx';

const FIELD_TYPES: CustomFieldType[] = ['text', 'textarea', 'number', 'date', 'datetime', 'choice', 'multichoice', 'checkbox', 'user'];
const DURATIONS: [string, string][] = [
  ['', '– nichts setzen –'],
  ['1 day', '1 Tag'],
  ['7 days', '1 Woche'],
  ['14 days', '2 Wochen'],
  ['1 month', '1 Monat'],
  ['3 months', '3 Monate'],
  ['6 months', '6 Monate'],
  ['12 months', '12 Monate'],
];

export default function Forms() {
  const { store, ref } = useApp();
  const save = useSaver();
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const list = ref.activityTypes.filter((t) => showArchived || !t.archived).sort((a, b) => a.sort - b.sort);
  const current = ref.activityTypes.find((t) => t.id === selected) ?? null;

  const create = async () => {
    let id: string | null = null;
    const ok = await save(async () => {
      const t = await store.saveConfig('activity_types', {
        name: `Neue Aktivität ${ref.activityTypes.length + 1}`,
        description: '',
        color: '#2346a0',
        fields: [{ key: 'notiz', label: 'Notiz', type: 'textarea' }],
        archived: false,
        sort: (ref.activityTypes.at(-1)?.sort ?? 0) + 10,
      });
      id = t.id;
    });
    if (ok && id) setSelected(id);
  };

  const reorder = (next: ActivityType[]) =>
    save(async () => {
      for (const { item, sort } of resort(next, (t) => t.sort)) await store.saveConfig('activity_types', { id: item.id, sort });
    });

  if (current) return <ActivityTypeEditor key={current.id} type={current} onBack={() => setSelected(null)} />;

  return (
    <section className="section">
      <div className="cust-head">
        <div className="grow">
          <h2>Eigene Aktivitäten</h2>
          <p className="muted">
            Strukturierte Einträge wie Closes „Custom Activities“ – z. B. ein Setting-Protokoll oder eine Wiedervorlage. Am Lead über
            „Aktivität“ ausfüllen; sie erscheinen im Verlauf, lassen sich filtern und in Berichten auswerten.
          </p>
        </div>
        <button type="button" className="btn primary" onClick={create}>
          <Plus /> Neue Aktivität
        </button>
      </div>
      {list.length ? (
        <SortableList
          label="Eigene Aktivitäten"
          items={list}
          keyOf={(t) => t.id}
          onReorder={reorder}
          render={(t, handle) => (
            <>
              {handle}
              <button type="button" className={cx('sort-main', t.archived && 'inactive')} onClick={() => setSelected(t.id)}>
                <span className="dot" style={{ background: t.color }} aria-hidden="true" />
                <span className="grow" style={{ minWidth: 0 }}>
                  <strong className="block ellipsis">{t.name}</strong>
                  {t.description ? <span className="block xs muted ellipsis">{t.description}</span> : null}
                </span>
                {t.archived ? <Tag tone="soft">archiviert</Tag> : null}
                <span className="small muted field-type">{t.fields.length === 1 ? '1 Feld' : `${t.fields.length} Felder`}</span>
              </button>
              <button type="button" className="icon-btn small" onClick={() => setSelected(t.id)} aria-label={`${t.name} bearbeiten`}>
                <Pencil />
              </button>
            </>
          )}
        />
      ) : (
        <Empty title="Noch keine eigenen Aktivitäten" action={<button type="button" className="btn primary" onClick={create}><Plus /> Neue Aktivität</button>} />
      )}
      {ref.activityTypes.some((t) => t.archived) ? (
        <label className="check small mt-12">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> archivierte zeigen
        </label>
      ) : null}
    </section>
  );
}

function ActivityTypeEditor({ type, onBack }: { type: ActivityType; onBack: () => void }) {
  const { store } = useApp();
  const { confirm } = useUi();
  const save = useSaver();
  const [name, setName] = useState(type.name);
  const [description, setDescription] = useState(type.description);
  const [edit, setEdit] = useState<number | 'new' | null>(null);
  useEffect(() => {
    setName(type.name);
    setDescription(type.description);
  }, [type.name, type.description]);

  const put = (patch: Partial<ActivityType>) => save(() => store.saveConfig('activity_types', { id: type.id, ...patch }));
  const setFields = (fields: ActivityField[]) => put({ fields });

  const remove = async () => {
    if (!(await confirm(`„${type.name}“ löschen? Geht nur, solange noch nichts damit erfasst wurde – sonst bitte archivieren.`, { danger: true, confirmLabel: 'Löschen' }))) return;
    if (await save(() => store.deleteConfig('activity_types', type.id), 'Aktivität gelöscht.')) onBack();
  };

  return (
    <section className="section">
      <button type="button" className="btn small ghost back-link" onClick={onBack}>
        <ArrowLeft /> Alle eigenen Aktivitäten
      </button>
      <div className="cust-head mt-8">
        <div className="grow col gap-8">
          <input
            className="input title-input"
            value={name}
            aria-label="Name der Aktivität"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== type.name && put({ name: name.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <input
            className="input"
            value={description}
            aria-label="Beschreibung"
            placeholder="Wann wird die Aktivität ausgefüllt? (optional)"
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => description !== type.description && put({ description })}
          />
          <ColorPicker value={type.color} onChange={(c) => put({ color: c })} />
        </div>
        <div className="row gap-8">
          <button type="button" className="btn" onClick={() => save(() => store.saveConfig('activity_types', { id: type.id, archived: !type.archived }), type.archived ? 'Wieder aktiv.' : 'Archiviert – am Lead nicht mehr auswählbar.')}>
            {type.archived ? <ArchiveRestore /> : <Archive />} {type.archived ? 'Wiederherstellen' : 'Archivieren'}
          </button>
          <button type="button" className="btn ghost danger-text" onClick={remove}>
            <Trash2 /> Löschen
          </button>
        </div>
      </div>

      <div className="row mt-16">
        <h3 className="grow">Felder ({type.fields.length})</h3>
        <button type="button" className="btn primary" onClick={() => setEdit('new')}>
          <Plus /> Feld
        </button>
      </div>
      <div className="mt-8">
        <SortableList
          label={`Felder von ${type.name}`}
          items={type.fields}
          keyOf={(f) => f.key}
          onReorder={setFields}
          render={(f, handle, i) => (
            <>
              {handle}
              <button type="button" className="sort-main" onClick={() => setEdit(i)}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <strong className="block ellipsis">{f.label}</strong>
                  {f.choices?.length ? <span className="block xs muted ellipsis">{f.choices.join(', ')}</span> : f.description ? <span className="block xs muted ellipsis">{f.description}</span> : null}
                </span>
                {f.required ? <Tag tone="amber">Pflicht</Tag> : null}
                {f.creates_task ? <Tag tone="blue">Wiedervorlage</Tag> : null}
                {f.sets_lead_date?.field ? <Tag tone="blue">setzt Datum</Tag> : null}
                <span className="small muted field-type">{TYPE_LABEL[f.type as CustomFieldType] ?? f.type}</span>
              </button>
              <button type="button" className="icon-btn small" onClick={() => setEdit(i)} aria-label={`${f.label} bearbeiten`}>
                <Pencil />
              </button>
            </>
          )}
        />
        {!type.fields.length ? <p className="small muted">Ohne Felder ist die Aktivität ein reiner Haken im Verlauf (z. B. „Auf LinkedIn vernetzt“).</p> : null}
      </div>
      {edit !== null ? (
        <ActivityFieldModal
          field={edit === 'new' ? null : type.fields[edit]}
          others={type.fields}
          onClose={() => setEdit(null)}
          onSave={async (f) => {
            const next = edit === 'new' ? [...type.fields, f] : type.fields.map((x, j) => (j === edit ? f : x));
            if (await setFields(next)) setEdit(null);
          }}
          onDelete={
            edit === 'new'
              ? undefined
              : async () => {
                  if (await setFields(type.fields.filter((_, j) => j !== edit))) setEdit(null);
                }
          }
        />
      ) : null}
    </section>
  );
}

function ActivityFieldModal({
  field,
  others,
  onClose,
  onSave,
  onDelete,
}: {
  field: ActivityField | null;
  others: ActivityField[];
  onClose: () => void;
  onSave: (f: ActivityField) => void;
  onDelete?: () => void;
}) {
  const { ref } = useApp();
  const { confirm } = useUi();
  const [label, setLabel] = useState(field?.label ?? '');
  const [type, setType] = useState<ActivityField['type']>(field?.type ?? 'text');
  const [choices, setChoices] = useState((field?.choices ?? []).join('\n'));
  const [required, setRequired] = useState(!!field?.required);
  const [description, setDescription] = useState(field?.description ?? '');
  const [createsTask, setCreatesTask] = useState(!!field?.creates_task);
  const [leadDate, setLeadDate] = useState(field?.sets_lead_date ?? null);
  const hasChoices = type === 'choice' || type === 'multichoice';
  const choiceList = choices.split('\n').map((c) => c.trim()).filter(Boolean);
  const dateFields = ref.customFields.filter((f) => f.entity === 'lead' && (f.type === 'date' || f.type === 'datetime'));

  const submit = () => {
    if (!label.trim()) return;
    onSave({
      key: field?.key ?? slugKey(label, others.map((f) => f.key)),
      label: label.trim(),
      type,
      ...(hasChoices ? { choices: choiceList } : {}),
      ...(required ? { required: true } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...((type === 'date' || type === 'datetime') && createsTask ? { creates_task: true } : {}),
      ...(type === 'choice' && leadDate?.field ? { sets_lead_date: leadDate } : {}),
    });
  };

  return (
    <Modal
      title={field ? 'Feld bearbeiten' : 'Neues Feld'}
      onClose={onClose}
      wide
      footer={
        <>
          {onDelete ? (
            <button
              type="button"
              className="btn ghost danger-text"
              style={{ marginRight: 'auto' }}
              onClick={async () => {
                if (await confirm(`Feld „${field?.label}“ entfernen? Schon erfasste Werte bleiben gespeichert, werden aber nicht mehr gezeigt.`, { danger: true, confirmLabel: 'Entfernen' })) onDelete();
              }}
            >
              <Trash2 /> Entfernen
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
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="z. B. Apothekentyp" />
          </Field>
          <Field label="Typ">
            <select className="select" value={type} onChange={(e) => setType(e.target.value as ActivityField['type'])}>
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </select>
          </Field>
        </div>
        {hasChoices ? (
          <Field label="Auswahlmöglichkeiten" hint="Eine pro Zeile.">
            <textarea className="textarea" rows={Math.min(10, Math.max(4, choiceList.length + 1))} value={choices} onChange={(e) => setChoices(e.target.value)} />
          </Field>
        ) : null}
        <Field label="Hilfetext (optional)">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Erscheint unter dem Feld" />
        </Field>
        <label className="switch-row">
          <span className="grow"><strong>Pflichtfeld</strong><span className="block small muted">Ohne dieses Feld lässt sich die Aktivität nicht speichern (Entwürfe gehen immer).</span></span>
          <Switch checked={required} onChange={setRequired} label="Pflichtfeld" />
        </label>
        {type === 'date' || type === 'datetime' ? (
          <label className="switch-row">
            <span className="grow"><strong>Wiedervorlage anlegen</strong><span className="block small muted">Legt zu diesem Zeitpunkt automatisch eine Aufgabe „Wiedervorlage“ an.</span></span>
            <Switch checked={createsTask} onChange={setCreatesTask} label="Wiedervorlage anlegen" />
          </label>
        ) : null}
        {type === 'choice' && choiceList.length ? (
          <div className="panel">
            <div className="panel-head"><h3>Lead-Datum setzen (optional)</h3></div>
            <div className="panel-body col gap-8">
              <p className="small muted" style={{ margin: 0 }}>Je nach Auswahl ein Datumsfeld am Lead setzen – z. B. „Gesperrt bis“ = heute + 3 Monate.</p>
              <Field label="Datumsfeld am Lead">
                <select className="select" value={leadDate?.field ?? ''} onChange={(e) => setLeadDate(e.target.value ? { field: e.target.value, map: leadDate?.map ?? {} } : null)}>
                  <option value="">– aus –</option>
                  {dateFields.map((df) => (
                    <option key={df.key} value={df.key}>{df.label}</option>
                  ))}
                </select>
              </Field>
              {leadDate?.field
                ? choiceList.map((c) => (
                    <div key={c} className="row small">
                      <span className="grow">{c}</span>
                      <span className="muted">heute +</span>
                      <select
                        className="select"
                        style={{ width: 150 }}
                        value={leadDate.map[c] ?? ''}
                        onChange={(e) => {
                          const map = { ...leadDate.map };
                          if (e.target.value) map[c] = e.target.value;
                          else delete map[c];
                          setLeadDate({ field: leadDate.field, map });
                        }}
                      >
                        {DURATIONS.map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </div>
                  ))
                : null}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
