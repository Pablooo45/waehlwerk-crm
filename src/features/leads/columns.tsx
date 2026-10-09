// Spalten der Leadliste (wie in Close frei wählbar, je Smart View gespeichert).

import type { ReactNode } from 'react';
import { formatDate, formatPhone, formatRelative } from '../../lib/format.ts';
import type { Lead, RefData, SortField } from '../../lib/types.ts';
import { DueTag, OutcomeTag, StatusTag } from '../common/bits.tsx';
import { formatFieldValue, shapeOf } from '../common/fields.tsx';

export interface LeadColumn {
  key: string;
  label: string;
  group: string;
  sort?: SortField;
  render: (l: Lead) => ReactNode;
  text: (l: Lead) => string;
}

export function leadColumns(ref: Pick<RefData, 'customFields' | 'profiles' | 'statuses' | 'outcomes'>): LeadColumn[] {
  const name = (id: string | null) => {
    if (!id) return '';
    const p = ref.profiles.find((x) => x.id === id);
    return p ? p.full_name || p.email : '';
  };
  const muted = (v: string) => (v ? v : <span className="muted">–</span>);
  const firstContact = (l: Lead) => l.contacts?.[0];
  const cols: LeadColumn[] = [
    { key: 'status', label: 'Status', group: 'Lead', render: (l) => <StatusTag statusId={l.status_id} />, text: (l) => ref.statuses.find((s) => s.id === l.status_id)?.label ?? '' },
    { key: 'owner', label: 'Zuständig', group: 'Lead', render: (l) => muted(name(l.owner_id)), text: (l) => name(l.owner_id) },
    { key: 'opener', label: 'Opener', group: 'Lead', render: (l) => muted(name(l.opener_id)), text: (l) => name(l.opener_id) },
    {
      key: 'last_call',
      label: 'Letzter Anruf',
      group: 'Aktivität',
      sort: 'last_call_at',
      render: (l) =>
        l.last_call_at ? (
          <div className="col gap-4" style={{ alignItems: 'flex-start' }}>
            <span>{formatRelative(l.last_call_at)}</span>
            <OutcomeTag outcome={l.last_call_outcome} />
          </div>
        ) : (
          <span className="muted">noch nie</span>
        ),
      text: (l) => (l.last_call_at ? formatDate(l.last_call_at) : ''),
    },
    { key: 'next_task', label: 'Nächste Aufgabe', group: 'Aktivität', sort: 'next_task_due', render: (l) => (l.next_task_due ? <DueTag due={l.next_task_due} /> : <span className="muted">–</span>), text: (l) => (l.next_task_due ? formatDate(l.next_task_due) : '') },
    { key: 'next_meeting', label: 'Nächster Termin', group: 'Aktivität', sort: 'next_meeting_at', render: (l) => muted(l.next_meeting_at ? formatDate(l.next_meeting_at) : ''), text: (l) => (l.next_meeting_at ? formatDate(l.next_meeting_at) : '') },
    { key: 'call_count', label: 'Anrufe', group: 'Aktivität', sort: 'call_count', render: (l) => <span className="num">{l.call_count}</span>, text: (l) => String(l.call_count) },
    { key: 'last_activity', label: 'Letzte Aktivität', group: 'Aktivität', sort: 'last_activity_at', render: (l) => muted(l.last_activity_at ? formatRelative(l.last_activity_at) : ''), text: (l) => (l.last_activity_at ? formatDate(l.last_activity_at) : '') },
    { key: 'created', label: 'Angelegt', group: 'Lead', sort: 'created_at', render: (l) => formatDate(l.created_at), text: (l) => formatDate(l.created_at) },
    { key: 'contact', label: 'Ansprechpartner', group: 'Kontakt', render: (l) => muted(firstContact(l)?.name ?? ''), text: (l) => firstContact(l)?.name ?? '' },
    { key: 'phone', label: 'Telefon', group: 'Kontakt', render: (l) => <span className="num nowrap">{formatPhone(firstContact(l)?.phones[0]?.number ?? '') || '–'}</span>, text: (l) => formatPhone(firstContact(l)?.phones[0]?.number ?? '') },
    { key: 'email', label: 'E-Mail', group: 'Kontakt', render: (l) => muted(firstContact(l)?.emails[0]?.email ?? ''), text: (l) => firstContact(l)?.emails[0]?.email ?? '' },
    { key: 'city', label: 'Ort', group: 'Adresse', render: (l) => muted(l.address_city ?? ''), text: (l) => l.address_city ?? '' },
    { key: 'zip', label: 'PLZ', group: 'Adresse', render: (l) => muted(l.address_zip ?? ''), text: (l) => l.address_zip ?? '' },
    { key: 'state', label: 'Bundesland (Adresse)', group: 'Adresse', render: (l) => muted(l.address_state ?? ''), text: (l) => l.address_state ?? '' },
    { key: 'source', label: 'Quelle', group: 'Lead', render: (l) => muted(l.source ?? ''), text: (l) => l.source ?? '' },
    { key: 'dnc', label: 'Nicht anrufen', group: 'Lead', render: (l) => (l.do_not_call ? <span className="tag red">nicht anrufen</span> : ''), text: (l) => (l.do_not_call ? 'ja' : '') },
  ];
  for (const f of ref.customFields.filter((x) => x.entity === 'lead')) {
    const shape = shapeOf(f);
    cols.push({
      key: `custom:${f.key}`,
      label: f.label,
      group: 'Eigene Felder',
      render: (l) => muted(formatFieldValue(shape, l.custom?.[f.key], ref.profiles as RefData['profiles'])),
      text: (l) => formatFieldValue(shape, l.custom?.[f.key], ref.profiles as RefData['profiles']),
    });
  }
  return cols;
}

export function defaultColumns(ref: Pick<RefData, 'customFields'>): string[] {
  return ['status', 'owner', 'last_call', 'next_task', 'call_count', ...ref.customFields.filter((f) => f.entity === 'lead' && f.show_in_list).map((f) => `custom:${f.key}`)];
}
