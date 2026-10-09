// Anpassen: Lead-Status, Pipelines, Anruf-Ergebnisse, eigene Felder, Gesprächsleitfaden, Links am Lead.

import { Lock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { slugKey } from '../../lib/perms.ts';
import type { CallOutcome, CustomField, CustomFieldType, FieldEntity, IntegrationLink, LeadStatus, OpportunityStatus, Pipeline, StatusKind } from '../../lib/types.ts';
import { Field, Segmented, Tag, useUi } from '../../ui/ui.tsx';
import { StatusSelect } from '../common/bits.tsx';
import { ColorInput, KIND_LABEL, SortButtons, useSaver } from './shared.tsx';

export default function Customize({ section }: { section: string }) {
  if (section === 'statuses') return <Statuses />;
  if (section === 'outcomes') return <Outcomes />;
  if (section === 'pipelines') return <Pipelines />;
  if (section === 'fields') return <Fields />;
  if (section === 'links') return <Links />;
  return <Script />;
}

function Statuses() {
  const { store, ref } = useApp();
  const { confirm } = useUi();
  const save = useSaver();
  const list = ref.statuses;
  const put = (s: Partial<LeadStatus> & { id: string }) => save(() => store.saveConfig('lead_statuses', s));
  const swap = (a: LeadStatus, b: LeadStatus) => save(async () => {
    await store.saveConfig('lead_statuses', { id: a.id, sort: b.sort });
    await store.saveConfig('lead_statuses', { id: b.id, sort: a.sort });
  });
  return (
    <section className="section">
      <h2>Lead-Status</h2>
      <p className="muted">Die Phasen, in denen ein Lead stehen kann. „Gewonnen“ zählt als Kunde (wird vom Power Dialer übersprungen), „verloren“ als abgeschlossen.</p>
      <div className="panel">
        {list.map((s, i) => (
          <div className="list-item" key={s.id}>
            <ColorInput value={s.color} onChange={(v) => put({ id: s.id, color: v })} />
            <input className="input grow" defaultValue={s.label} aria-label="Bezeichnung" onBlur={(e) => e.target.value.trim() && e.target.value !== s.label && put({ id: s.id, label: e.target.value.trim() })} />
            <select className="select" style={{ width: 120 }} value={s.kind} onChange={(e) => put({ id: s.id, kind: e.target.value as StatusKind })} aria-label="Art">
              {(['open', 'won', 'lost'] as StatusKind[]).map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
            <label className="check small nowrap" title="Neue Leads bekommen diesen Status">
              <input type="radio" name="default-status" checked={s.is_default} onChange={() => put({ id: s.id, is_default: true })} />
              Standard
            </label>
            <SortButtons onUp={i > 0 ? () => swap(s, list[i - 1]) : undefined} onDown={i < list.length - 1 ? () => swap(s, list[i + 1]) : undefined} />
            <button
              type="button"
              className="icon-btn small"
              aria-label="Löschen"
              onClick={async () => {
                if (await confirm(`Status „${s.label}“ löschen? Leads mit diesem Status verlieren ihn.`, { danger: true, confirmLabel: 'Löschen' })) {
                  save(() => store.deleteConfig('lead_statuses', s.id));
                }
              }}
            >
              <Trash2 />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn mt-16" onClick={() => save(() => store.saveConfig('lead_statuses', { label: `Neuer Status ${list.length + 1}`, sort: (list.at(-1)?.sort ?? 0) + 10, color: '#64748b', kind: 'open', is_default: false }))}>
        <Plus /> Status hinzufügen
      </button>
    </section>
  );
}

function Outcomes() {
  const { store, ref } = useApp();
  const { confirm } = useUi();
  const save = useSaver();
  const list = ref.outcomes;
  const [label, setLabel] = useState('');
  const put = (o: Partial<CallOutcome> & { key: string }) => save(() => store.saveConfig('call_outcomes', o));
  const swap = (a: CallOutcome, b: CallOutcome) => save(async () => {
    await store.saveConfig('call_outcomes', { key: a.key, sort: b.sort });
    await store.saveConfig('call_outcomes', { key: b.key, sort: a.sort });
  });
  return (
    <section className="section">
      <h2>Anruf-Ergebnisse</h2>
      <p className="muted">
        Die Knöpfe nach jedem Anruf (Tasten 1–9). „Erreicht“ zählt in Berichten als Entscheider erreicht, „Termin“ als gelegtes Setting.
        Status und Wiedervorlage werden danach automatisch vorgeschlagen.
      </p>
      <div className="col gap-12">
        {list.map((o, i) => (
          <div className="panel" key={o.key}>
            <div className="panel-head row wrap">
              <ColorInput value={o.color} onChange={(v) => put({ key: o.key, color: v })} />
              <input className="input" style={{ maxWidth: 260 }} defaultValue={o.label} aria-label="Bezeichnung" onBlur={(e) => e.target.value.trim() && e.target.value !== o.label && put({ key: o.key, label: e.target.value.trim() })} />
              <span className="kbd-hint">Taste {i + 1}</span>
              <span className="grow" />
              <label className="check small"><input type="checkbox" checked={o.active} onChange={(e) => put({ key: o.key, active: e.target.checked })} /> aktiv</label>
              <SortButtons onUp={i > 0 ? () => swap(o, list[i - 1]) : undefined} onDown={i < list.length - 1 ? () => swap(o, list[i + 1]) : undefined} />
              <button
                type="button"
                className="icon-btn small"
                aria-label="Löschen"
                onClick={async () => {
                  if (await confirm(`„${o.label}“ löschen? Bisherige Anrufe verlieren dieses Ergebnis. Besser: deaktivieren.`, { danger: true, confirmLabel: 'Löschen' })) {
                    save(() => store.deleteConfig('call_outcomes', o.key));
                  }
                }}
              >
                <Trash2 />
              </button>
            </div>
            <div className="panel-body col gap-8">
              <input className="input" defaultValue={o.description} placeholder="Beschreibung, z. B. Entscheider nicht am Apparat (Gatekeeper, Mailbox)" aria-label="Beschreibung" onBlur={(e) => e.target.value !== o.description && put({ key: o.key, description: e.target.value })} />
              <div className="row wrap gap-16">
                <label className="check small"><input type="checkbox" checked={o.counts_as_connected} onChange={(e) => put({ key: o.key, counts_as_connected: e.target.checked })} /> zählt als erreicht</label>
                <label className="check small"><input type="checkbox" checked={o.is_meeting} onChange={(e) => put({ key: o.key, is_meeting: e.target.checked })} /> zählt als Termin</label>
                <span className="row gap-4 small">
                  Status danach
                  <span style={{ width: 190 }}><StatusSelect value={o.next_status_id} onChange={(v) => put({ key: o.key, next_status_id: v })} statuses={ref.statuses} allowEmpty /></span>
                </span>
                <span className="row gap-4 small">
                  Wiedervorlage
                  <select className="select" style={{ width: 140 }} value={o.followup_days ?? ''} onChange={(e) => put({ key: o.key, followup_days: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">keine</option>
                    <option value="0">heute</option>
                    <option value="1">morgen</option>
                    <option value="2">in 2 Tagen</option>
                    <option value="7">in 1 Woche</option>
                    <option value="30">in 1 Monat</option>
                  </select>
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="row mt-16">
        <input className="input" style={{ maxWidth: 280 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Neues Ergebnis, z. B. Bereits Kunde" />
        <button
          type="button"
          className="btn"
          disabled={!label.trim()}
          onClick={() =>
            save(() =>
              store.saveConfig('call_outcomes', { key: slugKey(label, list.map((o) => o.key)), label: label.trim(), description: '', sort: (list.at(-1)?.sort ?? 0) + 10, color: '#64748b', active: true, counts_as_connected: false, is_meeting: false, next_status_id: null, followup_days: null }, true)
            ).then((ok) => ok && setLabel(''))}
        >
          <Plus /> Hinzufügen
        </button>
      </div>
    </section>
  );
}

function Pipelines() {
  const { store, ref } = useApp();
  const { confirm } = useUi();
  const save = useSaver();
  const [name, setName] = useState('');
  const addPipeline = async () => {
    if (!name.trim()) return;
    const ok = await save(async () => {
      const p = await store.saveConfig('pipelines', { name: name.trim(), sort: (ref.pipelines.at(-1)?.sort ?? 0) + 10 });
      const base: [string, StatusKind, string][] = [['Neu', 'open', '#4c7bd9'], ['Gewonnen', 'won', '#178a3e'], ['Verloren', 'lost', '#b5473a']];
      for (const [i, [label, kind, color]] of base.entries()) {
        await store.saveConfig('opportunity_statuses', { pipeline_id: p.id, label, kind, color, sort: (i + 1) * 10 });
      }
    });
    if (ok) setName('');
  };
  return (
    <section className="section">
      <h2>Pipelines</h2>
      <p className="muted">Mehrere Pipelines wie in Close, z. B. „Sales“ und „Setting → Closing“. Jede hat eigene Phasen; „gewonnen“ zählt in Berichten als Abschluss.</p>
      <div className="col gap-16">
        {ref.pipelines.map((p) => (
          <PipelineCard
            key={p.id}
            pipeline={p}
            onDelete={async () => {
              const used = ref.oppStatuses.filter((s) => s.pipeline_id === p.id).length;
              if (await confirm(`Pipeline „${p.name}“ mit ${used} Phasen löschen? Opportunities darin verlieren ihre Phase.`, { danger: true, confirmLabel: 'Löschen' })) {
                save(() => store.deleteConfig('pipelines', p.id));
              }
            }}
          />
        ))}
      </div>
      <div className="row mt-16">
        <input className="input" style={{ maxWidth: 260 }} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPipeline()} placeholder="Neue Pipeline" />
        <button type="button" className="btn" disabled={!name.trim()} onClick={addPipeline}>
          <Plus /> Pipeline anlegen
        </button>
      </div>
    </section>
  );
}

function PipelineCard({ pipeline, onDelete }: { pipeline: Pipeline; onDelete: () => void }) {
  const { store, ref } = useApp();
  const { confirm } = useUi();
  const save = useSaver();
  const list = ref.oppStatuses.filter((s) => s.pipeline_id === pipeline.id).sort((a, b) => a.sort - b.sort);
  const put = (s: Partial<OpportunityStatus> & { id: string }) => save(() => store.saveConfig('opportunity_statuses', s));
  const swap = (a: OpportunityStatus, b: OpportunityStatus) => save(async () => {
    await store.saveConfig('opportunity_statuses', { id: a.id, sort: b.sort });
    await store.saveConfig('opportunity_statuses', { id: b.id, sort: a.sort });
  });
  return (
    <div className="panel">
      <div className="panel-head row">
        <input className="input grow" defaultValue={pipeline.name} aria-label="Name der Pipeline" onBlur={(e) => e.target.value.trim() && e.target.value !== pipeline.name && save(() => store.saveConfig('pipelines', { id: pipeline.id, name: e.target.value.trim() }))} />
        <button type="button" className="icon-btn small" aria-label="Pipeline löschen" onClick={onDelete}>
          <Trash2 />
        </button>
      </div>
      {list.map((s, i) => (
        <div className="list-item" key={s.id}>
          <ColorInput value={s.color} onChange={(v) => put({ id: s.id, color: v })} />
          <input className="input grow" defaultValue={s.label} aria-label="Phase" onBlur={(e) => e.target.value.trim() && e.target.value !== s.label && put({ id: s.id, label: e.target.value.trim() })} />
          <select className="select" style={{ width: 120 }} value={s.kind} onChange={(e) => put({ id: s.id, kind: e.target.value as StatusKind })} aria-label="Art">
            {(['open', 'won', 'lost'] as StatusKind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
          <SortButtons onUp={i > 0 ? () => swap(s, list[i - 1]) : undefined} onDown={i < list.length - 1 ? () => swap(s, list[i + 1]) : undefined} />
          <button
            type="button"
            className="icon-btn small"
            aria-label="Phase löschen"
            onClick={async () => {
              if (await confirm(`Phase „${s.label}“ löschen?`, { danger: true, confirmLabel: 'Löschen' })) save(() => store.deleteConfig('opportunity_statuses', s.id));
            }}
          >
            <Trash2 />
          </button>
        </div>
      ))}
      <div className="panel-body">
        <button type="button" className="btn small" onClick={() => save(() => store.saveConfig('opportunity_statuses', { pipeline_id: pipeline.id, label: `Neue Phase ${list.length + 1}`, sort: (list.at(-1)?.sort ?? 0) + 10, color: '#64748b', kind: 'open' }))}>
          <Plus /> Phase
        </button>
      </div>
    </div>
  );
}

export const TYPE_LABEL: Record<CustomFieldType, string> = {
  text: 'Text',
  textarea: 'Langer Text',
  number: 'Zahl',
  date: 'Datum',
  datetime: 'Datum & Uhrzeit',
  choice: 'Auswahl',
  multichoice: 'Mehrfachauswahl',
  checkbox: 'Ja/Nein',
  url: 'Link',
  user: 'Person',
};

const ENTITY_LABEL: Record<FieldEntity, string> = { lead: 'Lead', contact: 'Kontakt', opportunity: 'Opportunity' };

function Fields() {
  const { store, ref } = useApp();
  const { confirm } = useUi();
  const save = useSaver();
  const [entity, setEntity] = useState<FieldEntity>('lead');
  const list = ref.customFields.filter((f) => f.entity === entity);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const put = (f: Partial<CustomField> & { key: string }) => save(() => store.saveConfig('custom_fields', f));
  const swap = (a: CustomField, b: CustomField) => save(async () => {
    await store.saveConfig('custom_fields', { key: a.key, sort: b.sort });
    await store.saveConfig('custom_fields', { key: b.key, sort: a.sort });
  });
  return (
    <section className="section">
      <h2>Eigene Felder</h2>
      <p className="muted">Zusätzliche Angaben an Leads, Kontakten und Opportunities. Lead-Felder lassen sich in Smart Views filtern und als Spalte zeigen.</p>
      <Segmented<FieldEntity>
        value={entity}
        onChange={setEntity}
        label="Felder für"
        options={(Object.keys(ENTITY_LABEL) as FieldEntity[]).map((e) => ({ value: e, label: `${ENTITY_LABEL[e]} (${ref.customFields.filter((f) => f.entity === e).length})` }))}
      />
      <div className="col gap-8 mt-12">
        {list.map((f, i) => (
          <div className="panel" key={f.key}>
            <div className="panel-head row wrap">
              <input className="input" style={{ width: 220, flex: 'none' }} defaultValue={f.label} aria-label="Feldname" onBlur={(e) => e.target.value.trim() && e.target.value !== f.label && put({ key: f.key, label: e.target.value.trim() })} />
              <Tag tone="soft">{TYPE_LABEL[f.type]}</Tag>
              {f.restricted ? <Tag tone="amber"><Lock size={12} aria-hidden="true" /> geschützt</Tag> : null}
              <span className="grow" />
              {entity === 'lead' ? (
                <label className="check small"><input type="checkbox" checked={f.show_in_list} onChange={(e) => put({ key: f.key, show_in_list: e.target.checked })} /> als Spalte</label>
              ) : null}
              <label className="check small" title="Nur Rollen mit dem Recht „Geschützte Felder bearbeiten“ dürfen den Wert ändern">
                <input type="checkbox" checked={f.restricted} onChange={(e) => put({ key: f.key, restricted: e.target.checked })} /> geschützt
              </label>
              <SortButtons onUp={i > 0 ? () => swap(f, list[i - 1]) : undefined} onDown={i < list.length - 1 ? () => swap(f, list[i + 1]) : undefined} />
              <button
                type="button"
                className="icon-btn small"
                aria-label="Löschen"
                onClick={async () => {
                  if (await confirm(`Feld „${f.label}“ löschen? Gespeicherte Werte bleiben im Hintergrund erhalten.`, { danger: true, confirmLabel: 'Löschen' })) save(() => store.deleteConfig('custom_fields', f.key));
                }}
              >
                <Trash2 />
              </button>
            </div>
            {f.type === 'choice' || f.type === 'multichoice' ? (
              <div className="panel-body">
                <input
                  className="input"
                  defaultValue={f.choices.join(', ')}
                  placeholder="Auswahlmöglichkeiten, durch Komma getrennt"
                  aria-label="Auswahlmöglichkeiten"
                  onBlur={(e) => {
                    const choices = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
                    if (choices.join('|') !== f.choices.join('|')) put({ key: f.key, choices });
                  }}
                />
              </div>
            ) : null}
          </div>
        ))}
        {!list.length ? <p className="small muted">Noch keine Felder für {ENTITY_LABEL[entity]}s.</p> : null}
      </div>
      <div className="row wrap mt-16">
        <input className="input" style={{ maxWidth: 240 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Feldname, z. B. Anzahl Filialen" />
        <select className="select" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value as CustomFieldType)} aria-label="Feldtyp">
          {(Object.keys(TYPE_LABEL) as CustomFieldType[]).map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={!label.trim()}
          onClick={() =>
            save(() =>
              store.saveConfig('custom_fields', { key: slugKey(label, ref.customFields.map((x) => x.key)), entity, label: label.trim(), description: '', type, choices: [], sort: (list.at(-1)?.sort ?? 0) + 10, show_in_list: false, restricted: false }, true)
            ).then((ok) => ok && setLabel(''))}
        >
          <Plus /> Feld hinzufügen
        </button>
      </div>
    </section>
  );
}

function Script() {
  const { store, ref } = useApp();
  const save = useSaver();
  const [text, setText] = useState(ref.org.call_script);
  return (
    <section className="section">
      <h2>Gesprächsleitfaden</h2>
      <p className="muted">Erscheint im Power Dialer und in der Anrufleiste. Kurz und in Stichpunkten ist am hilfreichsten.</p>
      <textarea className="textarea" style={{ minHeight: 320 }} value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" className="btn primary mt-16" disabled={text === ref.org.call_script} onClick={() => save(() => store.updateOrg({ call_script: text }), 'Leitfaden gespeichert.')}>
        Speichern
      </button>
    </section>
  );
}

function Links() {
  const { store, ref } = useApp();
  const save = useSaver();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const put = (l: Partial<IntegrationLink> & { id: string }) => save(() => store.saveConfig('integration_links', l));
  const valid = /^https?:\/\/\S+$/.test(url.trim());
  return (
    <section className="section">
      <h2>Links am Lead</h2>
      <p className="muted">
        Schnelllinks auf der Lead-Seite, z. B. Google-Suche oder Maps. Platzhalter wie <code>{'{{lead.name}}'}</code>, <code>{'{{lead.address_city}}'}</code>,{' '}
        <code>{'{{lead.address_zip}}'}</code> oder <code>{'{{lead.custom.inhaber}}'}</code> werden mit den Werten des Leads gefüllt.
      </p>
      <div className="panel">
        {ref.integrationLinks.map((l) => (
          <div className="list-item" key={l.id}>
            <input className="input" style={{ width: 180, flex: 'none' }} defaultValue={l.name} aria-label="Name" onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && put({ id: l.id, name: e.target.value.trim() })} />
            <input className="input grow" defaultValue={l.url_template} aria-label="Adresse" onBlur={(e) => /^https?:\/\//.test(e.target.value) && e.target.value !== l.url_template && put({ id: l.id, url_template: e.target.value.trim() })} />
            <button type="button" className="icon-btn small" aria-label="Löschen" onClick={() => save(() => store.deleteConfig('integration_links', l.id))}>
              <Trash2 />
            </button>
          </div>
        ))}
        {!ref.integrationLinks.length ? <div className="panel-body small muted">Noch keine Links.</div> : null}
      </div>
      <div className="form-grid mt-16">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Handelsregister" />
        </Field>
        <Field label="Adresse" hint={url && !valid ? 'Muss mit https:// beginnen.' : undefined}>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.google.com/search?q={{lead.name}}" />
        </Field>
      </div>
      <button
        type="button"
        className="btn mt-8"
        disabled={!name.trim() || !valid}
        onClick={() => save(() => store.saveConfig('integration_links', { name: name.trim(), url_template: url.trim(), scope: 'lead', sort: (ref.integrationLinks.at(-1)?.sort ?? 0) + 10 })).then((ok) => {
          if (ok) {
            setName('');
            setUrl('');
          }
        })}
      >
        <Plus /> Link hinzufügen
      </button>
    </section>
  );
}
