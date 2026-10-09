// Power Dialer wie in Close: oben die Dialer-Leiste (Fortschritt, Pause, Überspringen, Beenden),
// darunter die ganz normale Lead-Seite des aktuellen Leads – Notizen, Felder, Verlauf, alles griffbereit.

import { BookOpenText, Pause, Phone, Play, SkipForward, Square, Zap } from 'lucide-react';
import { useApp, usePhone } from '../../app/context.tsx';
import { formatPhone } from '../../lib/format.ts';
import { cx, Empty, Loading, Popover, useHotkeys, useMenu } from '../../ui/ui.tsx';
import { WrapUp } from '../calling/WrapUp.tsx';
import LeadPage from '../leads/LeadPage.tsx';
import { useDialer } from './DialerContext.tsx';

export default function DialerPage() {
  const d = useDialer();
  const snap = usePhone();
  const { ref } = useApp();
  const scriptMenu = useMenu();
  const lead = d.lead;
  const calling = !!snap.call;

  // wie in Close: Strg/Cmd + Umschalt + X = nächster Lead / weiter, Strg/Cmd + . = Pause
  useHotkeys(
    {
      'mod+shift+x': (e) => {
        e.preventDefault();
        if (d.phase === 'paused') d.resume();
        else if (!calling) d.skip();
      },
      'mod+.': (e) => {
        e.preventDefault();
        if (!calling) d.pause();
      },
    },
    d.active && d.phase !== 'wrapup',
    true,
  );

  if (!d.active) {
    return (
      <div className="page">
        <div className="panel">
          <Empty title="Kein Power Dialer aktiv" action={<a className="btn primary" href="#/leads">Zu den Leads</a>}>
            Öffne eine Smart View und klicke auf „Anrufen“. Dann wird Lead für Lead automatisch angerufen – du
            siehst jeweils die Lead-Seite und protokollierst nur noch das Ergebnis.
          </Empty>
        </div>
      </div>
    );
  }

  const progress = d.queue.length ? Math.min(100, ((d.index + 1) / d.queue.length) * 100) : 0;
  const phones = (lead?.contacts ?? []).flatMap((c) => c.phones.filter((p) => p.type !== 'fax').map((p) => ({ c, p })));
  const state =
    d.phase === 'done' ? 'Liste abtelefoniert'
    : d.phase === 'loading' ? 'Lädt den nächsten Lead …'
    : d.phase === 'preparing' ? `Wählt in ${d.countdown} s${d.number ? ` ${formatPhone(d.number)}` : ''} …`
    : d.phase === 'countdown' ? `Nächster Lead in ${d.countdown} s …`
    : d.phase === 'paused' ? d.message ?? 'Pausiert'
    : d.phase === 'wrapup' ? 'Ergebnis eintragen'
    : calling ? (snap.call?.state === 'open' ? 'Im Gespräch' : 'Klingelt …')
    : '';

  return (
    <div className="dialer-page">
      <div className={cx('dialer-bar', d.phase === 'paused' && 'paused')} role="region" aria-label="Power Dialer">
        <div className="dialer-bar-title">
          <Zap size={18} aria-hidden="true" />
          <span className="ellipsis">
            <strong>Power Dialer</strong> <span className="muted">{d.name}</span>
          </span>
        </div>
        <div className="dialer-bar-progress">
          <span className="small num">Lead {Math.max(0, d.index + 1)} von {d.queue.length}</span>
          <div className="dialer-progress" aria-hidden="true">
            <div style={{ width: `${progress}%` }} />
          </div>
        </div>
        <span className="dialer-state small" aria-live="polite">{state}</span>
        <span className="grow" />
        <span className="small muted hide-mobile num">
          {d.stats.dials} Anwahlen, {d.stats.reached} erreicht, {d.stats.meetings} {d.stats.meetings === 1 ? 'Termin' : 'Termine'}
        </span>
        <button type="button" className="btn small" onClick={scriptMenu.open} aria-haspopup="dialog">
          <BookOpenText /> Leitfaden
        </button>
        {d.phase === 'paused' ? (
          <button type="button" className="btn small call" onClick={d.resume} title="Weiter (Strg + Umschalt + X)">
            <Play /> Weiter
          </button>
        ) : (
          <button type="button" className="btn small" onClick={d.pause} disabled={d.phase === 'calling' || d.phase === 'wrapup' || d.phase === 'done'} title="Pause (Strg + .)">
            <Pause /> Pause
          </button>
        )}
        <button type="button" className="btn small" onClick={d.skip} disabled={calling || d.phase === 'wrapup' || d.phase === 'done'} title="Überspringen (Strg + Umschalt + X)">
          <SkipForward /> Überspringen
        </button>
        <button type="button" className="btn small ghost" onClick={d.stop} disabled={calling}>
          <Square /> Beenden
        </button>
      </div>

      {d.phase === 'preparing' || (d.phase === 'paused' && phones.length > 1 && !calling) ? (
        <div className="dialer-numbers">
          {d.phase === 'preparing' ? (
            <button type="button" className="btn small call" onClick={() => d.callNow()}>
              <Phone /> Jetzt anrufen
            </button>
          ) : null}
          {phones.length > 1 ? (
            <>
              <span className="small muted">Andere Nummer:</span>
              {phones.map(({ c, p }) => (
                <button key={`${c.id}${p.number}`} type="button" className={cx('btn small', d.number === p.number && 'active')} onClick={() => d.callNow(p.number, c)}>
                  <Phone /> {formatPhone(p.number)} <span className="muted">{c.name}</span>
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      {d.phase === 'wrapup' && snap.ended ? (
        <div className="dialer-wrapup">
          <WrapUp key={snap.ended.id} ended={snap.ended} inDialer onDone={(o) => d.afterWrapup(o)} />
        </div>
      ) : null}

      {d.phase === 'done' ? (
        <div className="page">
          <div className="panel">
            <Empty title="Liste abtelefoniert" action={<a className="btn primary" href="#/leads">Nächste Liste wählen</a>}>
              {d.stats.dials} Anwahlen, {d.stats.reached} Entscheider erreicht, {d.stats.meetings} Termine gelegt.
              {d.stats.skipped ? ` ${d.stats.skipped} Leads übersprungen (ohne Nummer, gerade erst angerufen oder von Kollegen in Bearbeitung).` : ''}
            </Empty>
          </div>
        </div>
      ) : lead ? (
        <LeadPage id={lead.id} key={lead.id} />
      ) : (
        <Loading label="Nächster Lead …" />
      )}

      {scriptMenu.isOpen ? (
        <Popover anchor={scriptMenu.anchor} onClose={scriptMenu.close} align="end">
          <div className="script-pop">
            <strong>Gesprächsleitfaden</strong>
            {ref.org.call_script ? (
              <div className="script">{ref.org.call_script}</div>
            ) : (
              <p className="muted small">Noch kein Leitfaden. Admins hinterlegen ihn unter Einstellungen → Gesprächsleitfaden.</p>
            )}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}
