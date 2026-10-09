// Telefon-Menü wie in Close (Telefon-Symbol neben dem Namen oben links):
// Erreichbarkeit, Nummer wählen, eigene Nummer, Audio- und Weiterleitungs-Einstellungen.

import { Hash, PhoneCall, Settings2, Stethoscope } from 'lucide-react';
import { useState } from 'react';
import { formatPhone, normalizePhone } from '../lib/format.ts';
import { Keypad } from '../features/calling/CallBar.tsx';
import { cx, errMsg, Modal, Switch, useUi } from '../ui/ui.tsx';
import { useApp, usePhone } from './context.tsx';

export function usePhoneLine() {
  const snap = usePhone();
  const { me } = useApp();
  const lineClass = snap.call ? (snap.call.state === 'open' ? 'live' : 'busy') : snap.status === 'ready' ? (me.available ? 'ready' : 'dnd') : snap.status === 'error' ? 'error' : '';
  const phoneText = snap.call
    ? snap.call.state === 'open' ? 'Im Gespräch' : 'Wählt …'
    : snap.status === 'ready' ? (me.available ? 'Erreichbar' : 'Nicht stören') : snap.status === 'starting' ? 'Verbindet …' : snap.status === 'unconfigured' ? 'Telefonie nicht eingerichtet' : snap.status === 'offline' ? 'Getrennt' : snap.status === 'error' ? 'Telefon-Fehler' : 'Telefon aus';
  return { lineClass, phoneText };
}

export function useToggleAvailable() {
  const { me, store, reloadRef } = useApp();
  const { toast } = useUi();
  return async () => {
    try {
      await store.updateMyProfile({ available: !me.available });
      await reloadRef();
      toast(me.available ? 'Nicht stören: Anrufe gehen an Kollegen, Weiterleitung oder Mailbox.' : 'Du bist wieder erreichbar.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };
}

// Nummer eintippen und anrufen – im Telefon-Menü und als eigenes Fenster
function DialForm({ onDone, autoFocus }: { onDone?: () => void; autoFocus?: boolean }) {
  const { dial, store, can } = useApp();
  const [number, setNumber] = useState('');
  const [pad, setPad] = useState(false);
  const valid = !!normalizePhone(number);
  if (!can('calling')) return <p className="small muted">Deine Rolle darf nicht telefonieren.</p>;
  const go = async () => {
    if (!valid) return;
    const match = await store.findLeadByPhone(number).catch(() => null);
    const ok = await dial({
      number,
      leadId: match?.lead.id ?? null,
      contactId: match?.contact?.id ?? null,
      leadName: match?.lead.name ?? null,
      contactName: match?.contact?.name ?? null,
    });
    if (ok) onDone?.();
  };
  return (
    <div className="col gap-8">
      <div className="row gap-6">
        <input
          className="input num"
          type="tel"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          placeholder="Nummer, z. B. 069 123456"
          aria-label="Telefonnummer"
          autoFocus={autoFocus}
        />
        <button type="button" className="btn call" onClick={go} disabled={!valid} aria-label={valid ? `${formatPhone(number)} anrufen` : 'Anrufen'} title="Anrufen">
          <PhoneCall />
        </button>
      </div>
      <button type="button" className={cx('btn small ghost', pad && 'active')} onClick={() => setPad(!pad)} aria-expanded={pad} style={{ alignSelf: 'flex-start' }}>
        <Hash size={14} /> Tastenfeld
      </button>
      {pad ? <Keypad onDigit={(d) => setNumber((n) => n + d)} /> : null}
    </div>
  );
}

export function PhonePanel({ onClose }: { onClose: () => void }) {
  const { me, ref, demo } = useApp();
  const snap = usePhone();
  const { lineClass, phoneText } = usePhoneLine();
  const toggle = useToggleAvailable();
  const own = me.phone_number ?? ref.org.default_caller_id;
  const detail = demo
    ? 'Demo – Anrufe werden nur simuliert.'
    : snap.message ?? (me.available ? 'Anrufe klingeln bei dir im Browser.' : 'Anrufe gehen an Kollegen, Weiterleitung oder Mailbox.');
  return (
    <div className="phone-pop">
      <div className="phone-pop-status">
        <span className={cx('line-dot', lineClass)} aria-hidden="true" />
        <div className="grow">
          <strong>{phoneText}</strong>
          <div className="xs muted">{detail}</div>
        </div>
        <Switch checked={me.available} onChange={toggle} label="Für Anrufe erreichbar" />
      </div>
      <div className="phone-pop-dial">
        <div className="phone-pop-label">Nummer wählen</div>
        <DialForm onDone={onClose} />
      </div>
      <div className="phone-pop-foot">
        {own ? <span className="xs muted">Du rufst an mit {formatPhone(own)}</span> : null}
        <a href="#/settings/profile" onClick={onClose}><Settings2 size={15} /> Audio & Weiterleitung</a>
        <a href="#/settings/diagnose" onClick={onClose}><Stethoscope size={15} /> Verbindung testen</a>
      </div>
    </div>
  );
}

export function DialpadModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Nummer wählen" onClose={onClose}>
      <DialForm onDone={onClose} autoFocus />
    </Modal>
  );
}
