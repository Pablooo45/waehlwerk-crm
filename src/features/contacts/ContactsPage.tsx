// Kontakte: alle Ansprechpartner über alle Leads – suchen, nach Rolle filtern, direkt anrufen.

import { Download, Mail, Search } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync, useLookups } from '../../app/hooks.ts';
import { leadHref, navigate } from '../../app/router.ts';
import { downloadText, toCsv } from '../../lib/csv.ts';
import { formatPhone } from '../../lib/format.ts';
import type { Contact } from '../../lib/types.ts';
import { Empty, errMsg, Loading, Tag, useDebounced, useUi } from '../../ui/ui.tsx';
import { CallButton, StatusTag } from '../common/bits.tsx';

const PAGE = 50;

export default function ContactsPage() {
  const { store, ref, can } = useApp();
  const { toast } = useUi();
  const { name } = useLookups();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [role, setRole] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const roleField = ref.customFields.find((f) => f.entity === 'contact' && f.key === 'contact_role');
  const contactFields = ref.customFields.filter((f) => f.entity === 'contact' && f.show_in_list && f.key !== 'contact_role');

  const data = useAsync(() => store.listContacts({ q: dq, role: role || null, page: { offset: 0, limit } }), [store, dq, role, limit], ['leads']);
  const rows = data.data?.rows ?? [];
  const total = data.data?.total ?? 0;

  const exportCsv = async () => {
    try {
      const all: Contact[] = [];
      for (let offset = 0; offset < 50000; offset += 500) {
        const part = await store.listContacts({ q: dq, role: role || null, page: { offset, limit: 500 } });
        all.push(...part.rows);
        if (part.rows.length < 500) break;
      }
      const cfs = ref.customFields.filter((f) => f.entity === 'contact');
      const header = ['Name', 'Position', 'Firma', 'Zuständig', 'Telefon', 'Weitere Nummern', 'E-Mail', ...cfs.map((f) => f.label)];
      const lines = all.map((c) => [
        c.name,
        c.title ?? '',
        c.lead?.name ?? '',
        c.lead?.owner_id ? name(c.lead.owner_id) : '',
        c.phones[0] ? formatPhone(c.phones[0].number) : '',
        c.phones.slice(1).map((p) => formatPhone(p.number)).join(', '),
        c.emails.map((e) => e.email).join(', '),
        ...cfs.map((f) => {
          const v = c.custom?.[f.key];
          return Array.isArray(v) ? v.join(', ') : String(v ?? '');
        }),
      ]);
      if (__DEMO_BUILD__) {
        toast(`${all.length} Kontakte wären exportiert worden. In der Demo-Vorschau sind Downloads gesperrt.`);
        return;
      }
      downloadText(`kontakte-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([header, ...lines]));
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          Kontakte <span className="muted num" style={{ fontWeight: 500 }}>{data.data ? total.toLocaleString('de-DE') : ''}</span>
        </h1>
        {can('export') ? (
          <button type="button" className="btn" onClick={exportCsv} disabled={!total}>
            <Download /> Export
          </button>
        ) : null}
      </div>

      <div className="filterbar">
        <div className="search" style={{ maxWidth: 340, flex: '1 1 220px' }}>
          <Search />
          <input className="input" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Name, Firma, Nummer oder E-Mail" aria-label="Kontakte durchsuchen" />
        </div>
        {roleField ? (
          <select className="select" style={{ width: 'auto' }} value={role} onChange={(e) => { setRole(e.target.value); setLimit(PAGE); }} aria-label={roleField.label}>
            <option value="">Alle Rollen</option>
            {roleField.choices.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        ) : null}
      </div>

      {data.error ? <div className="callout err">{data.error}</div> : null}
      {data.loading && !data.data ? (
        <Loading />
      ) : !rows.length ? (
        <div className="panel">
          <Empty title="Keine Kontakte gefunden">{q || role ? 'Suche oder Filter ändern.' : 'Kontakte legst du am Lead an.'}</Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Firma</th>
                <th className="hide-mobile">Telefon</th>
                <th className="hide-mobile">E-Mail</th>
                {roleField ? <th className="hide-mobile">{roleField.label}</th> : null}
                {contactFields.map((f) => (
                  <th key={f.key} className="hide-mobile">{f.label}</th>
                ))}
                <th aria-label="Anrufen" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const roles = (c.custom?.contact_role as string[] | undefined) ?? [];
                const phone = c.phones[0];
                return (
                  <tr key={c.id} className="clickable" onClick={() => navigate(leadHref(c.lead_id))}>
                    <td>
                      <div className="strong">{c.name || 'Ohne Namen'}</div>
                      {c.title ? <div className="xs muted">{c.title}</div> : null}
                      {phone ? <div className="show-mobile xs num">{formatPhone(phone.number)}</div> : null}
                    </td>
                    <td>
                      {c.lead ? (
                        <div className="col gap-4" style={{ alignItems: 'flex-start' }}>
                          <a href={leadHref(c.lead.id)} onClick={(e) => e.stopPropagation()}>{c.lead.name}</a>
                          <StatusTag statusId={c.lead.status_id} />
                        </div>
                      ) : null}
                    </td>
                    <td className="hide-mobile num nowrap">
                      {phone ? formatPhone(phone.number) : <span className="muted">–</span>}
                      {c.phones.length > 1 ? <span className="xs muted"> +{c.phones.length - 1}</span> : null}
                    </td>
                    <td className="hide-mobile">
                      {c.emails[0] ? (
                        <a href={`mailto:${c.emails[0].email}`} onClick={(e) => e.stopPropagation()} className="row gap-4">
                          <Mail size={14} /> {c.emails[0].email}
                        </a>
                      ) : (
                        <span className="muted">–</span>
                      )}
                    </td>
                    {roleField ? (
                      <td className="hide-mobile">
                        <div className="row wrap gap-4">
                          {roles.map((r) => (
                            <Tag key={r} tone={r === 'Decision Maker' ? 'green' : 'soft'}>{r}</Tag>
                          ))}
                        </div>
                      </td>
                    ) : null}
                    {contactFields.map((f) => {
                      const v = c.custom?.[f.key];
                      return <td key={f.key} className="hide-mobile">{Array.isArray(v) ? v.join(', ') : String(v ?? '')}</td>;
                    })}
                    <td onClick={(e) => e.stopPropagation()} style={{ width: 44 }}>
                      {phone && can('calling') ? (
                        <CallButton number={phone.number} leadId={c.lead_id} contactId={c.id} leadName={c.lead?.name ?? null} contactName={c.name} small />
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
    </div>
  );
}
