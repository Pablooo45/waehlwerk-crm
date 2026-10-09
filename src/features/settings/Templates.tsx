// E-Mail- und SMS-Vorlagen mit Platzhaltern; geteilte Vorlagen fürs Team.

import { Lock, Mail, MessageCircle, Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context.tsx';
import type { EmailTemplate } from '../../lib/types.ts';
import { HtmlFrame, RichTextEditor, textToHtml } from '../../ui/RichText.tsx';
import { Field, Segmented, Tag, useUi } from '../../ui/ui.tsx';
import { useSaver } from './shared.tsx';

export const PLACEHOLDERS = [
  ['{{ contact.name }}', 'Name des Kontakts'],
  ['{{ contact.first_name }}', 'Vorname'],
  ['{{ contact.last_name }}', 'Nachname'],
  ['{{ lead.name }}', 'Firma / Apotheke'],
  ['{{ lead.address_city }}', 'Ort'],
  ['{{ user.name }}', 'Dein Name'],
  ['{{ user.first_name }}', 'Dein Vorname'],
  ['{{ user.email }}', 'Deine E-Mail'],
  ['{{ organization.name }}', 'Firmenname'],
];

type Kind = 'email' | 'sms';

export default function Templates() {
  const { store, ref, me, can } = useApp();
  const { confirm } = useUi();
  const save = useSaver();
  const [kind, setKind] = useState<Kind>('email');
  const [edit, setEdit] = useState<Partial<EmailTemplate> | null>(null);
  const list = ref.templates.filter((t) => (t.kind ?? 'email') === kind);
  const team = can('manage_team_templates');
  const canEdit = (t: EmailTemplate) => t.created_by === me.id || team;

  const submit = async () => {
    if (!edit?.name?.trim()) return;
    const row: Partial<EmailTemplate> = {
      id: edit.id,
      name: edit.name.trim(),
      kind,
      subject: kind === 'sms' ? '' : edit.subject ?? '',
      body: edit.body ?? '',
      is_html: kind === 'email' ? edit.is_html ?? true : false,
      shared: !!edit.shared,
    };
    if (await save(() => store.saveConfig('email_templates', row), 'Vorlage gespeichert.')) setEdit(null);
  };

  return (
    <section className="section">
      <div className="row wrap" style={{ marginBottom: 6 }}>
        <h2 className="grow">Vorlagen</h2>
        <Segmented<Kind>
          value={kind}
          onChange={(k) => {
            setKind(k);
            setEdit(null);
          }}
          label="Art"
          options={[
            { value: 'email', label: <><Mail size={15} /> E-Mail</> },
            { value: 'sms', label: <><MessageCircle size={15} /> SMS</> },
          ]}
        />
        <button type="button" className="btn" onClick={() => setEdit({ name: '', subject: '', body: '', is_html: kind === 'email', shared: team })}>
          <Plus /> Vorlage
        </button>
      </div>
      <p className="muted">
        Geteilte Vorlagen sieht das ganze Team; teilen darf, wer das Recht „Vorlagen fürs Team“ hat. Platzhalter werden beim Einfügen mit den Daten des Leads gefüllt.
      </p>
      <div className="panel">
        {list.map((t) => (
          <div className="list-item clickable" key={t.id} onClick={() => canEdit(t) && setEdit(t)} title={canEdit(t) ? 'Bearbeiten' : 'Nur ansehen'}>
            <span className="grow">
              <strong>{t.name}</strong> {t.shared ? <Tag tone="soft"><Users size={12} aria-hidden="true" /> Team</Tag> : <Tag tone="soft">privat</Tag>}
              <div className="xs muted ellipsis">{kind === 'email' ? t.subject : t.body}</div>
            </span>
            {canEdit(t) ? (
              <button
                type="button"
                className="icon-btn small"
                aria-label="Löschen"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (await confirm(`Vorlage „${t.name}“ löschen?`, { danger: true, confirmLabel: 'Löschen' })) save(() => store.deleteConfig('email_templates', t.id));
                }}
              >
                <Trash2 />
              </button>
            ) : (
              <Lock size={14} aria-label="nur lesen" />
            )}
          </div>
        ))}
        {!list.length ? <div className="panel-body small muted">Noch keine {kind === 'email' ? 'E-Mail' : 'SMS'}-Vorlagen.</div> : null}
      </div>
      {edit ? (
        <div className="col gap-12 mt-16 panel panel-body">
          <div className="form-grid">
            <Field label="Name">
              <input className="input" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Sichtbar für">
              <select className="select" value={edit.shared ? 'team' : 'me'} onChange={(e) => setEdit({ ...edit, shared: e.target.value === 'team' })}>
                <option value="me">Nur mich</option>
                <option value="team" disabled={!team}>Ganzes Team{team ? '' : ' (kein Recht)'}</option>
              </select>
            </Field>
          </div>
          {kind === 'email' ? (
            <Field label="Betreff">
              <input className="input" value={edit.subject ?? ''} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
            </Field>
          ) : null}
          <Field label={kind === 'email' ? 'Text' : `Text (${(edit.body ?? '').length} Zeichen${(edit.body ?? '').length > 160 ? `, ${Math.ceil((edit.body ?? '').length / 153)} SMS` : ''})`}>
            {kind === 'email' ? (
              <RichTextEditor
                value={edit.is_html === false ? textToHtml(edit.body ?? '') : edit.body ?? ''}
                onChange={(html) => setEdit((cur) => ({ ...cur!, body: html, is_html: true }))}
                placeholder="Guten Tag {{ contact.name }}, …"
              />
            ) : (
              <textarea className="textarea" style={{ minHeight: 120 }} value={edit.body ?? ''} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
            )}
          </Field>
          <details>
            <summary className="small">Platzhalter</summary>
            <div className="placeholders mt-8">
              {PLACEHOLDERS.map(([p, l]) => (
                <button key={p} type="button" className="chip" onClick={() => setEdit({ ...edit, body: `${edit.body ?? ''}${kind === 'email' ? ` ${p}` : ` ${p}`}` })} title={l}>
                  <code>{p}</code> <span className="muted">{l}</span>
                </button>
              ))}
            </div>
          </details>
          {kind === 'email' && edit.body ? (
            <details>
              <summary className="small">Vorschau</summary>
              <HtmlFrame html={edit.is_html === false ? textToHtml(edit.body) : edit.body} className="mt-8" />
            </details>
          ) : null}
          <div className="row">
            <button type="button" className="btn primary" onClick={submit} disabled={!edit.name?.trim()}>Speichern</button>
            <button type="button" className="btn" onClick={() => setEdit(null)}>Abbrechen</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
