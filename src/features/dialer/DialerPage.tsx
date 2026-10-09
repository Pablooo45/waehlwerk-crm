import { CalendarPlus, ExternalLink, Pause, Phone, Play, SkipForward, Square, Zap } from 'lucide-react';
import { useState } from 'react';
import { useApp, usePhone } from '../../app/context.tsx';
import { useAsync, useLookups } from '../../app/hooks.ts';
import { leadHref } from '../../app/router.ts';
import { formatPhone, formatRelative } from '../../lib/format.ts';
import { Empty, Loading, Tag, useHotkeys } from '../../ui/ui.tsx';
import { OutcomeTag, StatusTag } from '../common/bits.tsx';
import { phoneTypeLabel } from '../common/forms.tsx';
import { WrapUp } from '../calling/WrapUp.tsx';
import { BookMeetingModal } from '../meetings/BookMeeting.tsx';
import { useDialer } from './DialerContext.tsx';

export default function DialerPage() {
  const d = useDialer();
  const snap = usePhone();
  const { ref, store } = useApp();
  const { name } = useLookups();
  const [book, setBook] = useState(false);
  const lead = d.lead;
  const recent = useAsync(() => (lead ? store.timeline(lead.id, 12) : Promise.resolve([])), [lead?.id, store]);

  useHotkeys(
    {
      p: () => (d.phase === 'paused' ? d.resume() : d.pause()),
      s: () => d.skip(),
    },
    d.active && d.phase !== 'wrapup',
  );

  if (!d.active) {
    return (
      <div className="page">
        <div className="panel">
          <Empty title="Kein Power Dialer aktiv" action={<a className="btn primary" href="#/leads">Zu den Leads</a>}>
            Öffne eine Liste oder Smart View und klicke auf „Power Dialer starten“. Dann wird Lead für Lead automatisch
            angerufen – du protokollierst nur noch das Ergebnis.
          </Empty>
        </div>
      </div>
    );
  }

  const progress = d.queue.length ? Math.min(100, ((d.index + 1) / d.queue.length) * 100) : 0;
  const calling = !!snap.call;
  const contacts = lead?.contacts ?? [];
  const phones = contacts.flatMap((c) => c.phones.filter((p) => p.type !== 'fax').map((p) => ({ c, p })));
  const notes = (recent.data ?? []).filter((t) => t.kind === 'note' || (t.kind === 'call' && (t.data.note || t.data.outcome))).slice(0, 5);

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="row">
          <Zap size={20} color="var(--cross)" /> Power Dialer: {d.name}
        </h1>
        <span className="muted small num">
          Lead {Math.max(0, d.index + 1)} von {d.queue.length}
        </span>
        {d.phase === 'paused' ? (
          <button type="button" className="btn call" onClick={d.resume}>
            <Play /> Weiter <kbd className="hide-touch">P</kbd>
          </button>
        ) : (
          <button type="button" className="btn" onClick={d.pause} disabled={d.phase === 'calling' || d.phase === 'wrapup' || d.phase === 'done'}>
            <Pause /> Pause <kbd className="hide-touch">P</kbd>
          </button>
        )}
        <button type="button" className="btn" onClick={d.skip} disabled={calling || d.phase === 'wrapup' || d.phase === 'done'}>
          <SkipForward /> Überspringen <kbd className="hide-touch">S</kbd>
        </button>
        <button type="button" className="btn ghost" onClick={d.stop} disabled={calling}>
          <Square /> Beenden
        </button>
      </div>

      <div className="dialer-progress" style={{ marginBottom: 16 }} aria-hidden="true">
        <div style={{ width: `${progress}%` }} />
      </div>

      <div className="dialer">
        <div className="col gap-16">
          {d.phase === 'done' ? (
            <div className="panel">
              <Empty title="Liste abtelefoniert" action={<a className="btn primary" href="#/leads">Nächste Liste wählen</a>}>
                {d.stats.dials} Anwahlen, {d.stats.reached} Entscheider erreicht, {d.stats.meetings} Termine gelegt.
                {d.stats.skipped ? ` ${d.stats.skipped} Leads übersprungen (ohne Nummer, gerade erst angerufen oder von Kollegen in Bearbeitung).` : ''}
              </Empty>
            </div>
          ) : d.phase === 'loading' && !lead ? (
            <div className="panel"><Loading label="Nächster Lead…" /></div>
          ) : lead ? (
            <>
              {d.phase === 'wrapup' && snap.ended ? (
                <WrapUp key={snap.ended.id} ended={snap.ended} inDialer onDone={(o) => d.afterWrapup(o)} />
              ) : null}
              <div className="panel dialer-lead">
                <div className="row wrap" style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <h2>{lead.name}</h2>
                    <div className="lead-meta">
                      <StatusTag statusId={lead.status_id} />
                      {lead.address_city ? <span>{[lead.address_zip, lead.address_city].filter(Boolean).join(' ')}</span> : null}
                      {lead.last_call_at ? (
                        <span>
                          Zuletzt angerufen {formatRelative(lead.last_call_at)} <OutcomeTag outcome={lead.last_call_outcome} />
                        </span>
                      ) : (
                        <span>Noch nie angerufen</span>
                      )}
                      {lead.owner_id ? <span>Zuständig: {name(lead.owner_id)}</span> : null}
                    </div>
                  </div>
                  <a className="btn small" href={leadHref(lead.id)} target="_blank" rel="noopener">
                    <ExternalLink /> Lead öffnen
                  </a>
                </div>

                <div className="mt-16">
                  {d.phase === 'preparing' ? (
                    <div className="callout ok">
                      <Phone />
                      <span>
                        Wählt in <strong className="num">{d.countdown}</strong> s {d.number ? formatPhone(d.number) : ''}…{' '}
                        <button type="button" className="btn small call" onClick={() => d.callNow()}>Jetzt anrufen</button>
                      </span>
                    </div>
                  ) : d.phase === 'countdown' ? (
                    <div className="callout">
                      <SkipForward />
                      <span>
                        Nächster Lead in <strong className="num">{d.countdown}</strong> s…
                      </span>
                    </div>
                  ) : d.phase === 'paused' ? (
                    <div className="callout warn">
                      <Pause />
                      <span>{d.message ?? 'Pausiert. Mit „Weiter“ geht es beim aktuellen Lead weiter.'}</span>
                    </div>
                  ) : null}
                </div>

                <div className="form-grid mt-16">
                  {contacts.map((c) => (
                    <div key={c.id} className="stat">
                      <strong>{c.name || 'Ohne Namen'}</strong>
                      {c.title ? <span className="muted small"> – {c.title}</span> : null}
                      {c.phones.map((p) => (
                        <div key={p.number} className="phone-line">
                          <span className="number num">{formatPhone(p.number)}</span>
                          <span className="xs muted">{phoneTypeLabel(p.type)}</span>
                          {d.number === p.number ? <Tag tone="green">wird gewählt</Tag> : null}
                        </div>
                      ))}
                      {c.emails[0] ? <div className="small muted">{c.emails[0].email}</div> : null}
                    </div>
                  ))}
                </div>

                {phones.length > 1 && !calling && d.phase !== 'wrapup' ? (
                  <div className="row wrap mt-16">
                    <span className="small muted">Andere Nummer wählen:</span>
                    {phones.map(({ c, p }) => (
                      <button key={`${c.id}${p.number}`} type="button" className="btn small" onClick={() => d.callNow(p.number, c)}>
                        <Phone /> {formatPhone(p.number)}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="row wrap mt-16">
                  <button type="button" className="btn" onClick={() => setBook(true)}>
                    <CalendarPlus /> Termin buchen
                  </button>
                </div>

                {ref.customFields.some((f) => lead.custom?.[f.key] != null && lead.custom?.[f.key] !== '') ? (
                  <dl className="kv mt-16">
                    {ref.customFields
                      .filter((f) => lead.custom?.[f.key] != null && lead.custom?.[f.key] !== '')
                      .map((f) => (
                        <div key={f.key} style={{ display: 'contents' }}>
                          <dt>{f.label}</dt>
                          <dd>{String(lead.custom[f.key])}</dd>
                        </div>
                      ))}
                  </dl>
                ) : null}
                {lead.description ? <p className="mt-16" style={{ whiteSpace: 'pre-wrap' }}>{lead.description}</p> : null}
              </div>

              {notes.length ? (
                <div className="panel">
                  <div className="panel-head"><h3>Letzte Notizen & Anrufe</h3></div>
                  <div className="list">
                    {notes.map((t) => (
                      <div className="list-item" key={`${t.kind}${t.id}`} style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 2 }}>
                        <span className="xs muted">
                          {formatRelative(t.at)}, {name(t.user_id)}
                        </span>
                        {t.kind === 'note' ? <span style={{ whiteSpace: 'pre-wrap' }}>{t.data.body}</span> : null}
                        {t.kind === 'call' ? (
                          <span className="row wrap">
                            <OutcomeTag outcome={t.data.outcome} /> {t.data.note}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="col gap-16">
          <div className="panel">
            <div className="panel-head"><h3>Diese Sitzung</h3></div>
            <div className="panel-body">
              <div className="stat-row">
                <div className="stat"><div className="v num">{d.stats.dials}</div><div className="k">Anwahlen</div></div>
                <div className="stat"><div className="v num">{d.stats.reached}</div><div className="k">Erreicht</div></div>
                <div className="stat"><div className="v num">{d.stats.meetings}</div><div className="k">Termine</div></div>
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><h3>Gesprächsleitfaden</h3></div>
            <div className="panel-body">
              {ref.org.call_script ? (
                <div className="script">{ref.org.call_script}</div>
              ) : (
                <p className="muted small">Noch kein Leitfaden. Admins können ihn unter Einstellungen → Gesprächsleitfaden hinterlegen.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {book && lead ? <BookMeetingModal lead={lead} contact={d.contact} onClose={() => setBook(false)} /> : null}
    </div>
  );
}
