// Provisionsmodelle fürs Team: Vorlagen, die jede Person unter „Verdienst“ für sich auswählt (und dort anpassen kann).
// Wer wie viel verdient, sieht hier niemand – nur die Person selbst auf ihrer Seite „Verdienst“.

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync } from '../../app/hooks.ts';
import { bus } from '../../lib/bus.ts';
import { describeTerms, euroInput, parseEuro } from '../../lib/earnings.ts';
import { formatMoney } from '../../lib/format.ts';
import type { CommissionModel } from '../../lib/types.ts';
import { errMsg, Field, Loading, Modal, useUi } from '../../ui/ui.tsx';
import { rowsFromTiers, TierEditor, tiersFromRows } from '../earnings/TierEditor.tsx';
import { resort, SortableList } from './shared.tsx';

export default function Commission() {
  const { store } = useApp();
  const { toast } = useUi();
  const q = useAsync(() => store.listCommissionModels(), [store], ['earnings']);
  const [edit, setEdit] = useState<CommissionModel | 'new' | null>(null);
  const list = q.data ?? [];

  const reorder = async (next: CommissionModel[]) => {
    q.setData(() => next);
    try {
      for (const { item, sort } of resort(next, (m) => m.sort)) await store.saveCommissionModel({ ...item, sort });
      bus.emit('earnings');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
      q.reload();
    }
  };

  return (
    <section className="section">
      <div className="cust-head">
        <div className="grow">
          <h2>Provisionsmodelle</h2>
          <p className="muted">
            Vorlagen fürs Team. Jede Person wählt unter „Verdienst“ ihr Modell, trägt ihr Fixgehalt ein und kann das Modell für sich anpassen. Was jemand
            verdient, sieht nur diese Person.
          </p>
        </div>
        <button type="button" className="btn primary" onClick={() => setEdit('new')}>
          <Plus /> Neues Modell
        </button>
      </div>
      {q.loading && !q.data ? <Loading /> : null}
      {q.error ? <div className="callout err">{q.error}</div> : null}
      {list.length ? (
        <SortableList
          label="Provisionsmodelle"
          items={list}
          keyOf={(m) => m.id}
          onReorder={reorder}
          render={(m, handle) => (
            <>
              {handle}
              <button type="button" className="sort-main" onClick={() => setEdit(m)}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <strong className="block">{m.name}</strong>
                  <span className="block xs muted ellipsis">
                    {describeTerms(m, formatMoney)}
                    {m.deal_value ? `, Dealwert ${formatMoney(m.deal_value)}` : ''}
                  </span>
                </span>
              </button>
              <button type="button" className="icon-btn small" onClick={() => setEdit(m)} aria-label={`${m.name} bearbeiten`}>
                <Pencil />
              </button>
            </>
          )}
        />
      ) : q.data ? (
        <p className="small muted">Noch keine Vorlagen. Lege euer Provisionsmodell einmal an, dann kann es jeder unter „Verdienst“ auswählen.</p>
      ) : null}
      {edit ? (
        <ModelModal
          model={edit === 'new' ? null : edit}
          nextSort={(list.at(-1)?.sort ?? 0) + 10}
          onClose={(changed) => {
            setEdit(null);
            if (changed) q.reload();
          }}
        />
      ) : null}
    </section>
  );
}

function ModelModal({ model, nextSort, onClose }: { model: CommissionModel | null; nextSort: number; onClose: (changed: boolean) => void }) {
  const { store } = useApp();
  const { toast, confirm } = useUi();
  const [name, setName] = useState(model?.name ?? '');
  const [description, setDescription] = useState(model?.description ?? '');
  const [rows, setRows] = useState(rowsFromTiers(model?.tiers ?? []));
  const [perDeal, setPerDeal] = useState(model?.per_deal ? euroInput(model.per_deal) : '');
  const [dealValue, setDealValue] = useState(model?.deal_value ? euroInput(model.deal_value) : '');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const tiers = tiersFromRows(rows);
  const nPer = parseEuro(perDeal);
  const nDeal = parseEuro(dealValue);
  const bad = (n: number | null) => n != null && (!Number.isFinite(n) || n < 0);
  const problem = !name.trim() ? 'Bitte einen Namen eintragen.' : bad(nPer) || bad(nDeal) ? 'Bitte nur Beträge ab 0 € eintragen, z. B. 6.500.' : tiers.error;

  const save = async () => {
    if (busy) return;
    if (problem) {
      setTried(true);
      return;
    }
    setBusy(true);
    try {
      await store.saveCommissionModel({
        id: model?.id,
        name: name.trim(),
        description: description.trim(),
        tiers: tiers.tiers,
        per_deal: nPer ?? 0,
        deal_value: nDeal ?? 0,
        sort: model?.sort ?? nextSort,
      });
      bus.emit('earnings');
      toast(model ? 'Gespeichert.' : `„${name.trim()}“ angelegt.`);
      onClose(true);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!model) return;
    if (!(await confirm(`„${model.name}“ löschen? Wer das Modell schon gewählt hat, behält seine Zahlen – nur die Vorlage verschwindet.`, { danger: true, confirmLabel: 'Löschen' }))) return;
    try {
      await store.deleteCommissionModel(model.id);
      bus.emit('earnings');
      toast('Gelöscht.');
      onClose(true);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  return (
    <Modal
      title={model ? 'Provisionsmodell bearbeiten' : 'Neues Provisionsmodell'}
      onClose={() => onClose(false)}
      wide
      footer={
        <>
          {model ? (
            <button type="button" className="btn ghost danger-text" style={{ marginRight: 'auto' }} onClick={remove}>
              <Trash2 /> Löschen
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => onClose(false)}>
            Abbrechen
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={busy}>
            Speichern
          </button>
        </>
      }
    >
      <form
        className="col gap-16"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Name">
          <input id="model-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Stufenprovision Closer" />
        </Field>
        <Field label="Beschreibung (optional)">
          <input id="model-description" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="z. B. für alle Closer ab Oktober" />
        </Field>
        <div className="col gap-12">
          <div>
            <h3>Stufen nach Monatsumsatz</h3>
            <p className="small muted">
              Ab diesem Umsatz im Monat gilt der Prozentsatz für den ganzen Umsatz des Monats. Ein fester Satz ist eine Stufe ab 0 €; ohne Stufen gibt es nur den
              Betrag je Kunde.
            </p>
          </div>
          <TierEditor rows={rows} onChange={setRows} idPrefix="model-tier" />
        </div>
        <div className="form-grid">
          <Field label="Fester Betrag je Kunde (optional)">
            <span className="affix">
              <input id="model-per-deal" className="input" inputMode="decimal" value={perDeal} onChange={(e) => setPerDeal(e.target.value)} placeholder="0" />
              <span aria-hidden="true">€</span>
            </span>
          </Field>
          <Field label="Standard-Dealwert" hint="Vorschlag beim Eintragen eines Kunden.">
            <span className="affix">
              <input id="model-deal-value" className="input" inputMode="decimal" value={dealValue} onChange={(e) => setDealValue(e.target.value)} placeholder="6.500" />
              <span aria-hidden="true">€</span>
            </span>
          </Field>
        </div>
        {tried && problem ? (
          <p className="small danger-text" role="alert">
            {problem}
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
