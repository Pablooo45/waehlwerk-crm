// Dubletten finden und zusammenführen (gleiche Nummer, E-Mail oder Name + PLZ).

import { GitMerge, X } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync, useLookups } from '../../app/hooks.ts';
import { leadHref } from '../../app/router.ts';
import { bus } from '../../lib/bus.ts';
import { formatDate, formatPhone } from '../../lib/format.ts';
import type { DuplicatePair, Lead } from '../../lib/types.ts';
import { Empty, errMsg, Loading, useUi } from '../../ui/ui.tsx';
import { StatusTag } from '../common/bits.tsx';

export default function Duplicates() {
  const { store } = useApp();
  const pairs = useAsync(async () => {
    const list = await store.findDuplicates(null, 200);
    const ids = [...new Set(list.flatMap((p) => [p.lead_a, p.lead_b]))];
    const leads = await store.getLeads(ids);
    return { list, leads: new Map(leads.map((l) => [l.id, l])) };
  }, [store], ['leads']);

  return (
    <section className="section">
      <h2>Dubletten</h2>
      <p className="muted">
        Leads mit gleicher Telefonnummer, gleicher E-Mail-Adresse oder gleichem Namen und PLZ. Beim Zusammenführen bleibt der gewählte
        Lead bestehen; Kontakte, Anrufe, Notizen, E-Mails, Aufgaben, Termine und Opportunities des anderen wandern dorthin.
      </p>
      {pairs.loading && !pairs.data ? (
        <Loading />
      ) : !pairs.data?.list.length ? (
        <Empty title="Keine Dubletten gefunden">Alles sauber.</Empty>
      ) : (
        <div className="col gap-12">
          {pairs.data.list.map((p) => {
            const a = pairs.data!.leads.get(p.lead_a);
            const b = pairs.data!.leads.get(p.lead_b);
            return a && b ? <PairCard key={`${p.lead_a}|${p.lead_b}`} pair={p} a={a} b={b} onDone={pairs.reload} /> : null;
          })}
        </div>
      )}
    </section>
  );
}

export function PairCard({ pair, a, b, onDone }: { pair: DuplicatePair; a: Lead; b: Lead; onDone: () => void }) {
  const { store } = useApp();
  const { toast, confirm } = useUi();
  const { name } = useLookups();
  const [busy, setBusy] = useState(false);

  const merge = async (keep: Lead, drop: Lead) => {
    if (!(await confirm(`„${drop.name}“ in „${keep.name}“ zusammenführen? Das lässt sich nicht rückgängig machen.`, { confirmLabel: 'Zusammenführen' }))) return;
    setBusy(true);
    try {
      await store.mergeLeads(keep.id, drop.id);
      toast('Zusammengeführt.');
      bus.emit('leads');
      onDone();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    setBusy(true);
    try {
      await store.dismissDuplicate(a.id, b.id);
      onDone();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const side = (l: Lead, other: Lead) => (
    <div className="dup-side">
      <a href={leadHref(l.id)} className="strong">{l.name}</a>
      <div className="small muted">{[l.address_zip, l.address_city].filter(Boolean).join(' ')}</div>
      <div className="row wrap gap-4 mt-4">
        <StatusTag statusId={l.status_id} />
        <span className="small">Zuständig: {name(l.owner_id)}</span>
      </div>
      <ul className="plain-list small mt-4">
        {(l.contacts ?? []).slice(0, 3).map((c) => (
          <li key={c.id}>{c.name || 'Kontakt'}{c.phones[0] ? `, ${formatPhone(c.phones[0].number)}` : ''}</li>
        ))}
      </ul>
      <div className="xs muted mt-4">{l.call_count} Anrufe, angelegt {formatDate(l.created_at)}</div>
      <button type="button" className="btn small mt-8" disabled={busy} onClick={() => merge(l, other)}>
        <GitMerge size={15} /> Diesen behalten
      </button>
    </div>
  );

  return (
    <div className="panel">
      <div className="panel-head row">
        <span className="grow small"><strong>Mögliche Dublette:</strong> {pair.reasons}</span>
        <button type="button" className="btn small ghost" disabled={busy} onClick={dismiss}>
          <X size={15} /> Keine Dublette
        </button>
      </div>
      <div className="panel-body dup-grid">
        {side(a, b)}
        {side(b, a)}
      </div>
    </div>
  );
}
