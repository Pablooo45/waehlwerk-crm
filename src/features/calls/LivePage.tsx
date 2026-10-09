// Live-Gespräche: Wer telefoniert gerade, wer ist erreichbar – mit Mithören, Einflüstern und Aufschalten.

import { Ear, Headphones, Megaphone, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import { useApp, usePhone } from '../../app/context.tsx';
import { useAsync, useLookups } from '../../app/hooks.ts';
import { leadHref } from '../../app/router.ts';
import { formatDuration, formatPhone, formatRelative } from '../../lib/format.ts';
import { MONITOR_HINT, MONITOR_LABEL, type MonitorMode } from '../../lib/phone/types.ts';
import type { LiveCall, Profile } from '../../lib/types.ts';
import { Avatar, cx, Empty, errMsg, Loading, useInterval, useNow, useUi } from '../../ui/ui.tsx';
import { functionLabel } from '../settings/Team.tsx';
import { ConversationTabs } from './ConversationTabs.tsx';

type Presence = 'call' | 'ready' | 'dnd' | 'offline';

const PRESENCE_TEXT: Record<Presence, string> = {
  call: 'Im Gespräch',
  ready: 'Erreichbar',
  dnd: 'Nicht stören',
  offline: 'Offline',
};

export default function LivePage() {
  const { store, ref, me, can, phone, isAdmin } = useApp();
  const { toast } = useUi();
  const snap = usePhone();
  const { profileById } = useLookups();
  const now = useNow(1000);
  const live = useAsync(() => store.liveCalls(), [store], ['calls']);
  const presence = useAsync(() => store.teamPresence(), [store]);
  useInterval(() => {
    live.reload();
    presence.reload();
  }, 5000);

  const canListen = can('call_coach_listen');
  const canBarge = can('call_coach_barge');
  const calls = live.data ?? [];
  const busyUsers = new Set(calls.filter((c) => c.answered_at || c.status === 'ringing').map((c) => c.user_id));

  const presenceOf = (p: Profile): Presence => {
    if (busyUsers.has(p.id)) return 'call';
    const row = presence.data?.find((x) => x.id === p.id);
    const seen = row?.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    if (now - seen > 3 * 60_000) return 'offline';
    return (row?.available ?? p.available) ? 'ready' : 'dnd';
  };

  const team = ref.profiles.filter((p) => p.active);
  const order: Presence[] = ['call', 'ready', 'dnd', 'offline'];
  const sortedTeam = [...team].sort((a, b) => order.indexOf(presenceOf(a)) - order.indexOf(presenceOf(b)) || a.full_name.localeCompare(b.full_name));

  const join = async (c: LiveCall, mode: MonitorMode) => {
    try {
      await phone.monitor(
        {
          callId: c.call_id,
          agentName: profileById.get(c.user_id ?? '')?.full_name ?? null,
          leadId: c.lead_id,
          leadName: c.lead_name,
          number: c.direction === 'inbound' ? c.from_number : c.to_number,
        },
        mode,
      );
      toast(MONITOR_HINT[mode]);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const monitoring = snap.call?.monitor?.callId ?? null;
  const counts = order.map((k) => [k, team.filter((p) => presenceOf(p) === k).length] as const);

  return (
    <div className="page live-page">
      <div className="page-head">
        <h1>Gespräche</h1>
      </div>
      <ConversationTabs value="live" liveCount={calls.length} />

      {!ref.org.conference_mode ? (
        <div className="callout">
          <Headphones />
          <span>
            Mithören, Einflüstern und Aufschalten funktionieren nur, wenn Gespräche als Konferenz laufen.
            {isAdmin ? <> Einschalten unter <a href="#/settings/telephony">Einstellungen → Telefonie</a>.</> : ' Bitte einen Admin, den Konferenz-Modus einzuschalten.'}
          </span>
        </div>
      ) : null}

      <section className="section">
        <div className="row wrap">
          <h2 className="grow">Team</h2>
          <div className="row wrap gap-8 small muted">
            {counts.map(([k, n]) => (
              <span key={k} className="row gap-4"><span className={cx('presence-dot', k)} aria-hidden="true" />{PRESENCE_TEXT[k]} {n}</span>
            ))}
          </div>
        </div>
        <div className="team-board">
          {sortedTeam.map((p) => {
            const st = presenceOf(p);
            const call = calls.find((c) => c.user_id === p.id);
            const seen = presence.data?.find((x) => x.id === p.id)?.last_seen_at;
            return (
              <div key={p.id} className={cx('team-card', st)}>
                <Avatar name={p.full_name || p.email} color={p.color} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="strong ellipsis">{p.full_name || p.email}{p.id === me.id ? ' (du)' : ''}</div>
                  <div className="xs muted ellipsis">{functionLabel(p.team_function)}</div>
                </div>
                <div className="team-state">
                  <span className={cx('presence-dot', st)} aria-hidden="true" />
                  <span className="small">
                    {st === 'call' && call?.answered_at ? formatDuration(Math.round((now - new Date(call.answered_at).getTime()) / 1000)) : PRESENCE_TEXT[st]}
                  </span>
                  {st === 'offline' && seen ? <span className="xs muted">{formatRelative(seen)}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <h2>Laufende Gespräche</h2>
        {live.loading && !live.data ? (
          <Loading />
        ) : !calls.length ? (
          <Empty title="Gerade telefoniert niemand">Sobald jemand im Team ein Gespräch führt, erscheint es hier – mit Dauer und Coaching-Knöpfen.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Mitarbeiter</th>
                  <th>Gesprächspartner</th>
                  <th className="hide-mobile">Dauer</th>
                  <th className="hide-mobile">Status</th>
                  <th aria-label="Coaching" />
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => {
                  const agent = profileById.get(c.user_id ?? '');
                  const own = c.user_id === me.id;
                  const answered = !!c.answered_at;
                  const dur = Math.round((now - new Date(c.answered_at ?? c.started_at).getTime()) / 1000);
                  const disabled = !answered || !c.conference || !!snap.call || own;
                  const why = own ? 'Dein eigenes Gespräch' : !c.conference ? 'Läuft nicht als Konferenz – Coaching nicht möglich' : snap.call ? 'Du bist gerade selbst im Gespräch' : !answered ? 'Noch nicht verbunden' : '';
                  return (
                    <tr key={c.call_id} className={cx(monitoring === c.call_id && 'selected')}>
                      <td>
                        <span className="row gap-8">
                          <Avatar name={agent?.full_name ?? '?'} color={agent?.color} />
                          <span className="strong">{agent?.full_name ?? 'Unbekannt'}</span>
                        </span>
                      </td>
                      <td>
                        <span className="row gap-4">
                          {c.direction === 'inbound' ? <PhoneIncoming size={15} aria-label="Eingehend" /> : <PhoneOutgoing size={15} aria-label="Ausgehend" />}
                          {c.lead_id ? <a href={leadHref(c.lead_id)}>{c.lead_name ?? 'Lead'}</a> : <span className="num">{formatPhone(c.direction === 'inbound' ? c.from_number : c.to_number)}</span>}
                        </span>
                        <div className="show-mobile xs muted num">{formatDuration(dur)}</div>
                      </td>
                      <td className="hide-mobile num">{formatDuration(dur)}</td>
                      <td className="hide-mobile">{answered ? <span className="tag green">verbunden</span> : <span className="tag amber">klingelt</span>}</td>
                      <td>
                        <div className="row gap-4 nowrap" title={why}>
                          {canListen ? (
                            <>
                              <button type="button" className="btn small" disabled={disabled} onClick={() => join(c, 'listen')}>
                                <Ear size={15} /> {MONITOR_LABEL.listen}
                              </button>
                              <button type="button" className="btn small hide-mobile" disabled={disabled} onClick={() => join(c, 'whisper')}>
                                <Headphones size={15} /> {MONITOR_LABEL.whisper}
                              </button>
                            </>
                          ) : null}
                          {canBarge ? (
                            <button type="button" className="btn small hide-mobile" disabled={disabled} onClick={() => join(c, 'barge')}>
                              <Megaphone size={15} /> {MONITOR_LABEL.barge}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="xs muted mt-8">
          Mithören: niemand hört dich. Einflüstern: nur dein Kollege hört dich. Aufschalten: alle hören dich. Du kannst während des Gesprächs oben in der Leiste umschalten.
        </p>
      </section>
    </div>
  );
}
