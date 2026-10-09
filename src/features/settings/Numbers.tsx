// Telefonnummern: wer klingelt, Rufzeiten, Telefonmenü, Weiterleitung – wie Gruppennummern in Close.

import { Clock, Pencil, PhoneForwarded, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { formatPhone, normalizePhone } from '../../lib/format.ts';
import type { BusinessHours, IvrMenu, PhoneNumberRow } from '../../lib/types.ts';
import { cx, Empty, Field, Modal, Segmented, Tag } from '../../ui/ui.tsx';
import { useSaver } from './shared.tsx';

const DAYS: [string, string][] = [
  ['mon', 'Mo'],
  ['tue', 'Di'],
  ['wed', 'Mi'],
  ['thu', 'Do'],
  ['fri', 'Fr'],
  ['sat', 'Sa'],
  ['sun', 'So'],
];

export function describeRouting(n: PhoneNumberRow, ref: ReturnType<typeof useApp>['ref']): string {
  const who = n.group_id
    ? `Gruppe „${ref.groups.find((g) => g.id === n.group_id)?.name ?? '?'}“`
    : n.members.length
    ? n.members.map((id) => ref.profiles.find((p) => p.id === id)?.full_name.split(' ')[0] ?? '?').join(', ')
    : 'ganzes Team';
  const how = n.ring_mode === 'round_robin' ? 'reihum' : 'gleichzeitig';
  return `${who}, ${how}, ${n.ring_timeout} s`;
}

function hoursText(h: BusinessHours | null): string {
  if (!h) return 'immer erreichbar';
  const parts = DAYS.filter(([d]) => h[d]?.length).map(([d, l]) => `${l} ${h[d].map(([a, b]) => `${a}–${b}`).join(', ')}`);
  return parts.length ? parts.join('; ') : 'nie erreichbar';
}

export default function Numbers() {
  const { store, ref, isAdmin, demo } = useApp();
  const save = useSaver();
  const [editing, setEditing] = useState<PhoneNumberRow | null>(null);
  const [syncing, setSyncing] = useState(false);

  const sync = async () => {
    setSyncing(true);
    await save(() => store.admin('twilio_sync_numbers'), 'Nummern von Twilio aktualisiert.');
    setSyncing(false);
  };

  return (
    <>
      <section className="section">
        <div className="row wrap" style={{ marginBottom: 6 }}>
          <h2 className="grow">Telefonnummern</h2>
          {isAdmin ? (
            <button type="button" className="btn" onClick={sync} disabled={syncing || demo}>
              <RefreshCw className={syncing ? 'spin' : undefined} /> Von Twilio laden
            </button>
          ) : null}
        </div>
        <p className="muted">
          Für jede Nummer legst du fest, wer bei einem Anruf klingelt, zu welchen Zeiten, und was außerhalb passiert. Bekannte
          Anrufer landen zuerst beim zuständigen Kollegen. Neue Nummern kaufst du in Twilio und lädst sie dann hier.
        </p>
        {ref.phoneNumbers.length ? (
          <div className="col gap-12">
            {ref.phoneNumbers.map((n) => (
              <div key={n.number} className="panel number-card">
                <div className="panel-head row wrap">
                  <strong className="num">{formatPhone(n.number)}</strong>
                  <span className="grow">{n.label}</span>
                  {n.sms_capable ? <Tag tone="soft">SMS</Tag> : null}
                  {n.ivr ? <Tag tone="blue">Telefonmenü</Tag> : null}
                  {n.available_to_all ? <Tag tone="soft">Absender für alle</Tag> : null}
                  <button type="button" className="btn small" onClick={() => setEditing(n)}>
                    <Pencil size={15} /> Einstellen
                  </button>
                </div>
                <div className="panel-body number-facts">
                  <span><Users size={15} aria-hidden="true" /> {describeRouting(n, ref)}</span>
                  <span><Clock size={15} aria-hidden="true" /> {hoursText(n.business_hours)}</span>
                  <span>
                    <PhoneForwarded size={15} aria-hidden="true" />{' '}
                    {n.forward_to && n.forward_mode !== 'never'
                      ? `Weiterleitung an ${formatPhone(n.forward_to)} ${n.forward_mode === 'always' ? '(immer)' : n.forward_mode === 'no_answer' ? '(wenn niemand abnimmt)' : '(außerhalb der Zeiten)'}`
                      : n.outside_hours_action === 'voicemail' ? 'sonst Mailbox' : 'keine Weiterleitung'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="Noch keine Nummer">
            In Twilio unter Phone Numbers → Buy a number eine deutsche Nummer kaufen (für Ortsnummern verlangt Twilio eine Adresse im
            Vorwahlbereich), dann hier „Von Twilio laden“.
          </Empty>
        )}
      </section>
      {editing ? <NumberModal number={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

type Target = 'team' | 'group' | 'people';

function NumberModal({ number, onClose }: { number: PhoneNumberRow; onClose: () => void }) {
  const { store, ref } = useApp();
  const save = useSaver();
  const [n, setN] = useState<PhoneNumberRow>(structuredClone(number));
  const [target, setTarget] = useState<Target>(number.group_id ? 'group' : number.members.length ? 'people' : 'team');
  const [hoursOn, setHoursOn] = useState(!!number.business_hours);
  const [ivrOn, setIvrOn] = useState(!!number.ivr);
  const set = (patch: Partial<PhoneNumberRow>) => setN((cur) => ({ ...cur, ...patch }));
  const hours: BusinessHours = n.business_hours ?? { mon: [['08:00', '18:00']], tue: [['08:00', '18:00']], wed: [['08:00', '18:00']], thu: [['08:00', '18:00']], fri: [['08:00', '16:00']] };
  const ivr: IvrMenu = n.ivr ?? { greeting: 'Willkommen. Für den Vertrieb drücken Sie die 1.', options: [{ digit: '1', label: 'Vertrieb', action: 'ring', target: null }], timeout_action: 'ring' };
  const forwardOk = !n.forward_to || !!normalizePhone(n.forward_to);

  const submit = async () => {
    const row: PhoneNumberRow = {
      ...n,
      members: target === 'people' ? n.members : [],
      group_id: target === 'group' ? n.group_id ?? ref.groups[0]?.id ?? null : null,
      business_hours: hoursOn ? hours : null,
      ivr: ivrOn ? ivr : null,
      forward_to: n.forward_to ? normalizePhone(n.forward_to) : null,
    };
    if (await save(() => store.saveConfig('phone_numbers', row), 'Nummer gespeichert.')) onClose();
  };

  const setDay = (day: string, value: [string, string][] | null) => {
    const next = { ...hours };
    if (value) next[day] = value;
    else delete next[day];
    set({ business_hours: next });
  };

  const setOption = (i: number, patch: Partial<IvrMenu['options'][number]>) =>
    set({ ivr: { ...ivr, options: ivr.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) } });

  return (
    <Modal
      title={`${formatPhone(number.number)} einstellen`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={submit} disabled={!forwardOk}>Speichern</button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="form-grid">
          <Field label="Bezeichnung">
            <input className="input" value={n.label} onChange={(e) => set({ label: e.target.value })} placeholder="z. B. Zentrale, Opener-Team" />
          </Field>
          <Field label="Als Absendernummer">
            <label className="check">
              <input type="checkbox" checked={n.available_to_all} onChange={(e) => set({ available_to_all: e.target.checked })} />
              Alle dürfen mit dieser Nummer anrufen
            </label>
          </Field>
        </div>

        <fieldset className="fieldset">
          <legend>Wer klingelt bei einem Anruf?</legend>
          <Segmented<Target>
            value={target}
            onChange={setTarget}
            label="Wer klingelt"
            options={[
              { value: 'team', label: 'Ganzes Team' },
              { value: 'group', label: 'Gruppe' },
              { value: 'people', label: 'Bestimmte Personen' },
            ]}
          />
          {target === 'group' ? (
            <select className="select mt-8" value={n.group_id ?? ''} onChange={(e) => set({ group_id: e.target.value || null })}>
              {ref.groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          ) : null}
          {target === 'people' ? (
            <div className="row wrap gap-12 mt-8">
              {ref.profiles.filter((p) => p.active).map((p) => (
                <label key={p.id} className="check">
                  <input
                    type="checkbox"
                    checked={n.members.includes(p.id)}
                    onChange={(e) => set({ members: e.target.checked ? [...n.members, p.id] : n.members.filter((x) => x !== p.id) })}
                  />
                  {p.full_name || p.email}
                </label>
              ))}
            </div>
          ) : null}
          <div className="form-grid mt-12">
            <Field label="Klingeln">
              <select className="select" value={n.ring_mode} onChange={(e) => set({ ring_mode: e.target.value as PhoneNumberRow['ring_mode'] })}>
                <option value="simultaneous">Bei allen gleichzeitig</option>
                <option value="round_robin">Reihum, einer nach dem anderen</option>
              </select>
            </Field>
            <Field label="Klingeldauer">
              <select className="select" value={n.ring_timeout} onChange={(e) => set({ ring_timeout: Number(e.target.value) })}>
                {[10, 15, 20, 25, 30, 45, 60].map((s) => (
                  <option key={s} value={s}>{s} Sekunden{n.ring_mode === 'round_robin' ? ' je Person' : ''}</option>
                ))}
              </select>
            </Field>
          </div>
          <label className="check mt-8">
            <input type="checkbox" checked={n.route_to_owner} onChange={(e) => set({ route_to_owner: e.target.checked })} />
            Bekannte Anrufer zuerst beim zuständigen Kollegen klingeln lassen
          </label>
          <p className="xs muted mt-8">Wer „Nicht stören“ eingestellt hat, wird übersprungen – oder aufs Handy weitergeleitet, wenn das im Profil hinterlegt ist.</p>
        </fieldset>

        <fieldset className="fieldset">
          <legend>Rufzeiten</legend>
          <label className="check">
            <input type="checkbox" checked={hoursOn} onChange={(e) => setHoursOn(e.target.checked)} />
            Nur zu bestimmten Zeiten klingeln lassen (Berliner Zeit)
          </label>
          {hoursOn ? (
            <>
              <div className="hours-grid mt-8">
                {DAYS.map(([d, label]) => {
                  const slot = hours[d]?.[0];
                  return (
                    <div key={d} className={cx('hours-row', !slot && 'off')}>
                      <label className="check">
                        <input type="checkbox" checked={!!slot} onChange={(e) => setDay(d, e.target.checked ? [['08:00', '18:00']] : null)} />
                        {label}
                      </label>
                      {slot ? (
                        <span className="row gap-4">
                          <input className="input" type="time" value={slot[0]} onChange={(e) => setDay(d, [[e.target.value, slot[1]]])} aria-label={`${label} von`} />
                          <span>bis</span>
                          <input className="input" type="time" value={slot[1]} onChange={(e) => setDay(d, [[slot[0], e.target.value]])} aria-label={`${label} bis`} />
                        </span>
                      ) : (
                        <span className="small muted">geschlossen</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <Field label="Außerhalb der Rufzeiten" className="mt-12">
                <select className="select" value={n.outside_hours_action} onChange={(e) => set({ outside_hours_action: e.target.value as PhoneNumberRow['outside_hours_action'] })}>
                  <option value="voicemail">Mailbox</option>
                  <option value="forward">An die Weiterleitungsnummer</option>
                  <option value="ring">Trotzdem klingeln lassen</option>
                </select>
              </Field>
            </>
          ) : null}
        </fieldset>

        <fieldset className="fieldset">
          <legend>Weiterleitung</legend>
          <div className="form-grid">
            <Field label="Nummer" hint={forwardOk ? 'z. B. ein Handy oder das Büro-Festnetz' : 'Die Nummer ist ungültig.'}>
              <input className="input" type="tel" value={n.forward_to ?? ''} onChange={(e) => set({ forward_to: e.target.value })} placeholder="0151 …" />
            </Field>
            <Field label="Wann">
              <select className="select" value={n.forward_mode} onChange={(e) => set({ forward_mode: e.target.value as PhoneNumberRow['forward_mode'] })} disabled={!n.forward_to}>
                <option value="never">Nie</option>
                <option value="no_answer">Wenn im CRM niemand abnimmt</option>
                <option value="outside_hours">Außerhalb der Rufzeiten</option>
                <option value="always">Immer (CRM klingelt nicht)</option>
              </select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="fieldset">
          <legend>Telefonmenü</legend>
          <label className="check">
            <input type="checkbox" checked={ivrOn} onChange={(e) => setIvrOn(e.target.checked)} />
            Anrufer wählen per Taste („Für … drücken Sie die 1“)
          </label>
          {ivrOn ? (
            <div className="col gap-8 mt-8">
              <Field label="Ansage">
                <textarea className="textarea" value={ivr.greeting} onChange={(e) => set({ ivr: { ...ivr, greeting: e.target.value } })} />
              </Field>
              {ivr.options.map((o, i) => (
                <div key={i} className="row wrap ivr-option">
                  <select className="select" style={{ width: 80 }} value={o.digit} onChange={(e) => setOption(i, { digit: e.target.value })} aria-label="Taste">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d) => (
                      <option key={d} value={d}>Taste {d}</option>
                    ))}
                  </select>
                  <input className="input" style={{ maxWidth: 180 }} value={o.label} onChange={(e) => setOption(i, { label: e.target.value })} placeholder="Bezeichnung" />
                  <select className="select" style={{ maxWidth: 200 }} value={o.action} onChange={(e) => setOption(i, { action: e.target.value as IvrMenu['options'][number]['action'], target: null })}>
                    <option value="ring">Wie oben klingeln</option>
                    <option value="group">Gruppe</option>
                    <option value="user">Person</option>
                    <option value="voicemail">Mailbox</option>
                    <option value="forward">Weiterleiten an Nummer</option>
                  </select>
                  {o.action === 'group' ? (
                    <select className="select" style={{ maxWidth: 180 }} value={o.target ?? ''} onChange={(e) => setOption(i, { target: e.target.value })}>
                      <option value="">– Gruppe –</option>
                      {ref.groups.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  ) : null}
                  {o.action === 'user' ? (
                    <select className="select" style={{ maxWidth: 180 }} value={o.target ?? ''} onChange={(e) => setOption(i, { target: e.target.value })}>
                      <option value="">– Person –</option>
                      {ref.profiles.filter((p) => p.active).map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name}</option>
                      ))}
                    </select>
                  ) : null}
                  {o.action === 'forward' ? (
                    <input className="input" style={{ maxWidth: 170 }} value={o.target ?? ''} onChange={(e) => setOption(i, { target: e.target.value })} placeholder="Nummer" />
                  ) : null}
                  <button type="button" className="icon-btn small" aria-label="Option entfernen" onClick={() => set({ ivr: { ...ivr, options: ivr.options.filter((_, j) => j !== i) } })}>
                    <Trash2 />
                  </button>
                </div>
              ))}
              <div className="row wrap">
                <button
                  type="button"
                  className="btn small"
                  disabled={ivr.options.length >= 9}
                  onClick={() => {
                    const used = ivr.options.map((o) => o.digit);
                    const digit = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].find((d) => !used.includes(d)) ?? '0';
                    set({ ivr: { ...ivr, options: [...ivr.options, { digit, label: '', action: 'ring', target: null }] } });
                  }}
                >
                  <Plus /> Option
                </button>
                <label className="small row gap-4">
                  Ohne Tastendruck:
                  <select className="select" value={ivr.timeout_action ?? 'ring'} onChange={(e) => set({ ivr: { ...ivr, timeout_action: e.target.value as 'ring' | 'voicemail' } })}>
                    <option value="ring">wie oben klingeln</option>
                    <option value="voicemail">Mailbox</option>
                  </select>
                </label>
              </div>
            </div>
          ) : null}
        </fieldset>

        <div className="form-grid">
          <Field label="Begrüßung vor dem Klingeln" hint="Optional, wird vorgelesen. Leer = direkt klingeln.">
            <input className="input" value={n.greeting_text ?? ''} onChange={(e) => set({ greeting_text: e.target.value || null })} placeholder="z. B. Willkommen bei Salus Digital" />
          </Field>
          <Field label="Eingehende Anrufe aufnehmen">
            <select className="select" value={n.record_inbound === null ? '' : n.record_inbound ? 'yes' : 'no'} onChange={(e) => set({ record_inbound: e.target.value === '' ? null : e.target.value === 'yes' })}>
              <option value="">Wie in den Aufnahme-Einstellungen</option>
              <option value="yes">Immer</option>
              <option value="no">Nie</option>
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}
