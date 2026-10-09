import { Phone, PhoneOff } from 'lucide-react';
import { useEffect } from 'react';
import { useApp, usePhone } from '../../app/context.tsx';
import { leadHref, navigate } from '../../app/router.ts';
import { formatPhone } from '../../lib/format.ts';

export function IncomingCall() {
  const snap = usePhone();
  const { phone, me } = useApp();
  const inc = snap.incoming;

  // Benachrichtigung, wenn das CRM im Hintergrund ist
  useEffect(() => {
    if (!inc || document.visibilityState === 'visible') return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || me.settings.notifications === false) return;
    const n = new Notification('Eingehender Anruf', {
      body: inc.leadName ? `${inc.leadName} (${formatPhone(inc.number)})` : formatPhone(inc.number),
      tag: inc.id,
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return () => n.close();
  }, [inc, me.settings.notifications]);

  if (!inc) return null;
  return (
    <div className="incoming" role="alertdialog" aria-label="Eingehender Anruf">
      <div className="ring">
        <Phone size={16} /> {inc.transferFrom ? `Weiterleitung von ${inc.transferFrom}` : 'Eingehender Anruf'}
      </div>
      <h2>{inc.leadName || formatPhone(inc.number)}</h2>
      <div className="muted">
        {[inc.contactName, inc.leadName ? formatPhone(inc.number) : 'Unbekannte Nummer'].filter(Boolean).join(', ')}
      </div>
      <div className="actions">
        <button type="button" className="btn danger large" onClick={() => phone.reject()}>
          <PhoneOff /> Ablehnen
        </button>
        <button
          type="button"
          className="btn call large"
          onClick={() => {
            phone.accept();
            if (inc.leadId) navigate(leadHref(inc.leadId));
          }}
        >
          <Phone /> Annehmen
        </button>
      </div>
    </div>
  );
}
