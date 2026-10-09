// Formulare (in Close „Custom Activities“), z. B. „Setting: Kundengewinnung“ oder „Wiedervorlage“.

import { Archive, ArchiveRestore, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { slugKey } from '../../lib/perms.ts';
import type { ActivityField, ActivityType, CustomFieldType } from '../../lib/types.ts';
import { cx, Empty, Field, Tag, useUi } from '../../ui/ui.tsx';
import { TYPE_LABEL } from './Customize.tsx';
import { ColorInput, SortButtons, useSaver } from './shared.tsx';

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
  const list = ref.activityTypes.filter((t) => showArchived || !t.archived);
  const [selected, setSelected] = useState<string | null>(list[0]?.id ?? null);
  const current = ref.activityTypes.find((t) => t.id === selected) ?? null;

  const create = async () => {
    let id: string | null = null;
    const ok = await save(async () => {
      const t = await store.saveConfig('activity_types', { name: `Neues Formular ${ref.activityTypes.length + 1}`, description: '', color: '#2346a0', fields: [{ key: 'notiz', label: 'Notiz', type: 'textarea' }], archived: false, sort: (ref.activityTypes.at(-1)?.sort ?? 0) + 10 });
      id = t.id;
    });
    if (ok && id) setSelected(id);
  };

  return (
    <section className="section">
      <div className="row wrap" style={{ marginBottom: 6 }}>
        <h2 className="grow">Formulare</h2>
        <label className="check small"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> archivierte zeigen</label>
        <button type="button" className="btn primary" onClick={create}>
          <Plus /> Formular anlegen
        </button>
      </div>
      <p className="muted">
        Strukturierte Gesprächsnotizen wie in Close („Custom Activities“): Die Felder füllt ihr direkt am Lead aus, sie erscheinen im
        Verlauf und lassen sich in Berichten auswerten. Ein Datumsfeld kann automatisch eine Wiedervorlage anlegen.
      </p>
      {list.length ? (
        <div className="roles-layout">
          <div className="roles-list" role="list">
            {list.map((t) => (
              <button key={t.id} type="button" role="listitem" className={cx('role-item', t.id === current?.id && 'active')} onClick={() => setSelected(t.id)}>
                <span className="dot" style={{ background: t.color }} aria-hidden="true" />
                <span className="grow">
                  <strong>{t.name}</strong>
                  <span className="block xs muted">{t.fields.length} Felder{t.archived ? ', archiviert' : ''}</span>
                </span>
              </button>
            ))}
          </div>
          {current ? <FormEditor key={current.id + current.updated_at} type={current} onDeleted={() => setSelected(null)} /> : <p className="muted">Formular auswählen.</p>}
        </div>
      ) : (
        <Empty title="Noch keine Formulare" action={<button type="button" className="btn primary" onClick={create}><Plus /> Formular anlegen</button>} />
      )}
    </section>
  );
}

function FormEditor({ type, onDeleted }: { type: ActivityType; onDeleted: () => void }) {
  const { store, ref } = useApp();
  const { confirm } = useUi();
  const save = useSaver();
  const [name, setName] = useState(type.name);
  const [description, setDescription] = useState(type.description);
  const [color, setColor] = useState(type.color);
  const [fields, setFields] = useState<ActivityField[]>(structuredClone(type.fields));
  const dirty = useMemo(
    () => name !== type.name || description !== type.description || color !== type.color || JSON.stringify(fields) !== JSON.stringify(type.fields),
    [name, description, color, fields, type],
  );
  const dateFields = ref.customFields.filter((f) => f.entity === 'lead' && (f.type === 'date' || f.type === 'datetime'));

  const update = (i: number, patch: Partial<ActivityField>) => setFields((cur) => cur.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, dir: -1 | 1) =>
    setFields((cur) => {
      const next = [...cur];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next;
    });

  const submit = () =>
    save(() => store.saveConfig('activity_types', { id: type.id, name: name.trim() || type.name, description, color, fields: fields.filter((f) => f.label.trim()) }), 'Formular gespeichert.');

  const remove = async () => {
    if (!(await confirm(`Formular „${type.name}“ löschen? Geht nur, solange noch nichts damit ausgefüllt wurde – sonst bitte archivieren.`, { danger: true, confirmLabel: 'Löschen' }))) return;
    if (await save(() => store.deleteConfig('activity_types', type.id), 'Formular gelöscht.')) onDeleted();
  };

  return (
    <div className="role-editor">
      <div className="form-grid">
        <Field label="Name">
          <div className="row">
            <ColorInput value={color} onChange={setColor} />
            <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </Field>
        <Field label="Beschreibung">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Wann wird das Formular ausgefüllt?" />
        </Field>
      </div>

      <h3 className="mt-16">Felder</h3>
      <div className="col gap-8 mt-8">
        {fields.map((f, i) => (
          <div key={f.key} className="panel form-field-edit">
            <div className="panel-head row wrap">
              <input className="input" style={{ flex: '1 1 220px' }} value={f.label} onChange={(e) => update(i, { label: e.target.value })} aria-label="Feldname" />
              <select className="select" style={{ width: 170 }} value={f.type} onChange={(e) => update(i, { type: e.target.value as ActivityField['type'] })} aria-label="Feldtyp">
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                ))}
              </select>
              <label className="check small"><input type="checkbox" checked={!!f.required} onChange={(e) => update(i, { required: e.target.checked })} /> Pflicht</label>
              <SortButtons onUp={i > 0 ? () => move(i, -1) : undefined} onDown={i < fields.length - 1 ? () => move(i, 1) : undefined} />
              <button type="button" className="icon-btn small" aria-label="Feld entfernen" onClick={() => setFields((cur) => cur.filter((_, j) => j !== i))}>
                <Trash2 />
              </button>
            </div>
            <div className="panel-body col gap-8">
              {f.type === 'choice' || f.type === 'multichoice' ? (
                <input
                  className="input"
                  defaultValue={(f.choices ?? []).join(', ')}
                  placeholder="Auswahlmöglichkeiten, durch Komma getrennt"
                  aria-label="Auswahlmöglichkeiten"
                  onBlur={(e) => update(i, { choices: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
                />
              ) : null}
              <input className="input" value={f.description ?? ''} onChange={(e) => update(i, { description: e.target.value || undefined })} placeholder="Hilfetext (optional)" aria-label="Hilfetext" />
              {f.type === 'date' || f.type === 'datetime' ? (
                <label className="check small">
                  <input type="checkbox" checked={!!f.creates_task} onChange={(e) => update(i, { creates_task: e.target.checked || undefined })} />
                  Legt zu diesem Zeitpunkt automatisch eine Wiedervorlage-Aufgabe an
                </label>
              ) : null}
              {f.type === 'choice' && (f.choices ?? []).length ? (
                <details className="automation">
                  <summary className="small">
                    Lead-Datum setzen {f.sets_lead_date?.field ? <Tag tone="blue">aktiv</Tag> : null}
                  </summary>
                  <div className="col gap-8 mt-8">
                    <Field label="Datumsfeld am Lead">
                      <select
                        className="select"
                        value={f.sets_lead_date?.field ?? ''}
                        onChange={(e) => update(i, { sets_lead_date: e.target.value ? { field: e.target.value, map: f.sets_lead_date?.map ?? {} } : undefined })}
                      >
                        <option value="">– aus –</option>
                        {dateFields.map((df) => (
                          <option key={df.key} value={df.key}>{df.label}</option>
                        ))}
                      </select>
                    </Field>
                    {f.sets_lead_date?.field
                      ? (f.choices ?? []).map((c) => (
                        <div key={c} className="row small">
                          <span className="grow">{c}</span>
                          <span className="muted">heute +</span>
                          <select
                            className="select"
                            style={{ width: 150 }}
                            value={f.sets_lead_date?.map[c] ?? ''}
                            onChange={(e) => {
                              const map = { ...(f.sets_lead_date?.map ?? {}) };
                              if (e.target.value) map[c] = e.target.value;
                              else delete map[c];
                              update(i, { sets_lead_date: { field: f.sets_lead_date!.field, map } });
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
                </details>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn small mt-8"
        onClick={() => setFields((cur) => [...cur, { key: slugKey(`feld ${cur.length + 1}`, cur.map((f) => f.key)), label: '', type: 'text' }])}
      >
        <Plus /> Feld hinzufügen
      </button>

      <div className="row wrap mt-16">
        <button type="button" className="btn primary" onClick={submit} disabled={!dirty}>
          Speichern
        </button>
        <button type="button" className="btn" onClick={() => save(() => store.saveConfig('activity_types', { id: type.id, archived: !type.archived }), type.archived ? 'Wieder aktiv.' : 'Archiviert.')}>
          {type.archived ? <ArchiveRestore /> : <Archive />} {type.archived ? 'Wiederherstellen' : 'Archivieren'}
        </button>
        <button type="button" className="btn ghost" onClick={remove}>
          <Trash2 /> Löschen
        </button>
      </div>
    </div>
  );
}
