import { CalendarDays, Link2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync, useLookups } from '../../app/hooks.ts';
import { leadHref } from '../../app/router.ts';
import { bus } from '../../lib/bus.ts';
import { addDays, isoDay, startOfDay, startOfWeek } from '../../lib/dates.ts';
import { formatLongDay, formatRelative, formatTime } from '../../lib/format.ts';
import type { Meeting } from '../../lib/types.ts';
import { Empty, errMsg, Loading, Popover, Segmented, Tag, useMenu, useUi } from '../../ui/ui.tsx';
import { LeadPicker } from '../common/forms.tsx';
import { MeetingActions } from '../leads/Timeline.tsx';

type Range = 'week' | 'next' | '30' | 'past';
type Who = 'all' | 'host' | 'setby';

export default function MeetingsPage() {
  const { store, ref, me } = useApp();
  const { toast } = useUi();
  const [range, setRange] = useState<Range>('week');
  const [who, setWho] = useState<Who>('all');
  const [syncing, setSyncing] = useState(false);

  const bounds = (() => {
    const today = startOfDay();
    switch (range) {
      case 'week':
        return { from: today, to: addDays(startOfWeek(), 7) };
      case 'next':
        return { from: addDays(startOfWeek(), 7), to: addDays(startOfWeek(), 14) };
      case '30':
        return { from: today, to: addDays(today, 31) };
      case 'past':
        return { from: addDays(today, -30), to: new Date() };
    }
  })();

  const q = useAsync(
    () => store.listMeetings({ from: bounds.from, to: bounds.to, includeCanceled: true }),
    [range, store],
    ['meetings'],
  );

  const rows = (q.data ?? [])
    .filter((m) => (who === 'host' ? m.host_user_id === me.id : who === 'setby' ? m.set_by === me.id : true))
    .sort((a, b) => (range === 'past' ? (a.starts_at < b.starts_at ? 1 : -1) : a.starts_at < b.starts_at ? -1 : 1));

  const groups = new Map<string, Meeting[]>();
  for (const m of rows) {
    const key = isoDay(new Date(m.starts_at));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await store.syncCalendars(true);
      bus.emit('meetings');
      if (r.errors?.length) toast(`Abgleich mit Fehlern: ${r.errors.join(', ')}`, { kind: 'error' });
      else toast('Kalender abgeglichen.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const google = ref.org.gcal_calendars.length > 0;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Termine</h1>
        {google ? (
          <span className="small muted">
            Google Kalender: {ref.org.gcal_last_sync ? `abgeglichen ${formatRelative(ref.org.gcal_last_sync)}` : 'noch nicht abgeglichen'}
          </span>
        ) : null}
        {google ? (
          <button type="button" className="btn" onClick={sync} disabled={syncing}>
            <RefreshCw className={syncing ? 'spin' : undefined} /> Jetzt abgleichen
          </button>
        ) : null}
      </div>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        <Segmented<Range>
          value={range}
          onChange={setRange}
          label="Zeitraum"
          options={[
            { value: 'week', label: 'Diese Woche' },
            { value: 'next', label: 'Nächste Woche' },
            { value: '30', label: '30 Tage' },
            { value: 'past', label: 'Vergangene' },
          ]}
        />
        <Segmented<Who>
          value={who}
          onChange={setWho}
          label="Wessen Termine"
          options={[
            { value: 'all', label: 'Team' },
            { value: 'host', label: 'Mit mir' },
            { value: 'setby', label: 'Von mir gelegt' },
          ]}
        />
      </div>

      {!google && !ref.org.calendly_connected_at ? (
        <div className="callout" style={{ marginBottom: 16 }}>
          <CalendarDays />
          <span>
            Tipp: Verbinde Calendly und euren Google Kalender (Einstellungen → Kalender), dann landen gebuchte Termine
            automatisch hier – inklusive wer sie gelegt hat.
          </span>
        </div>
      ) : null}

      {q.loading && !q.data ? (
        <Loading />
      ) : q.error ? (
        <div className="callout err">{q.error}</div>
      ) : !rows.length ? (
        <div className="panel">
          <Empty title="Keine Termine in diesem Zeitraum" />
        </div>
      ) : (
        [...groups.entries()].map(([day, list]) => (
          <div className="day-group" key={day}>
            <h3>{formatLongDay(`${day}T12:00:00`)}</h3>
            <div className="panel">
              {list.map((m) => (
                <MeetingRow key={m.id} m={m} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function MeetingRow({ m }: { m: Meeting }) {
  const { store } = useApp();
  const { name } = useLookups();
  const { toast } = useUi();
  const assign = useMenu();
  const past = new Date(m.starts_at).getTime() < Date.now();
  const source = m.source === 'calendly' ? 'Calendly' : m.source === 'google' ? 'Google' : 'CRM';
  const statusTag =
    m.status === 'canceled' ? <Tag tone="red">abgesagt</Tag>
    : m.status === 'rescheduled' ? <Tag tone="soft">verschoben</Tag>
    : m.status === 'completed' ? <Tag tone="green">stattgefunden</Tag>
    : m.status === 'no_show' ? <Tag tone="red">nicht erschienen</Tag>
    : null;

  const link = async (leadId: string) => {
    assign.close();
    try {
      await store.saveMeeting({ id: m.id, lead_id: leadId, title: m.title, starts_at: m.starts_at, ends_at: m.ends_at, host_user_id: m.host_user_id, location: m.location, join_url: m.join_url, description: m.description, invitee_name: m.invitee_name, invitee_email: m.invitee_email, contact_id: null });
      bus.emit('meetings');
      toast('Termin zugeordnet.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  return (
    <div className="meeting" style={m.status === 'canceled' || m.status === 'rescheduled' ? { opacity: 0.6 } : undefined}>
      <div>
        <div className="time num">{formatTime(m.starts_at)}</div>
        {m.ends_at ? <div className="xs muted num">bis {formatTime(m.ends_at)}</div> : null}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="row wrap">
          <strong className="ellipsis">{m.title}</strong>
          <Tag tone="soft">{source}</Tag>
          {statusTag}
        </div>
        <div className="small muted">
          {m.lead ? <a href={leadHref(m.lead.id)}>{m.lead.name}</a> : m.invitee_name ?? 'Kein Lead zugeordnet'}
          {m.host_user_id || m.host_name ? `, mit ${m.host_user_id ? name(m.host_user_id) : m.host_name}` : ''}
          {m.set_by ? `, gelegt von ${name(m.set_by)}` : ''}
        </div>
      </div>
      <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
        {!m.lead_id ? (
          <button type="button" className="btn small" onClick={assign.open}>
            <Link2 /> Lead zuordnen
          </button>
        ) : null}
        {m.join_url && !past && m.status === 'scheduled' ? (
          <a className="btn small primary" href={m.join_url} target="_blank" rel="noopener">
            Beitreten
          </a>
        ) : null}
        {past ? <MeetingActions meeting={m} /> : null}
      </div>
      {assign.isOpen ? (
        <Popover anchor={assign.anchor} onClose={assign.close} align="end">
          <div style={{ padding: 6, width: 300 }}>
            <LeadPicker onPick={(l) => link(l.id)} autoFocus />
          </div>
        </Popover>
      ) : null}
    </div>
  );
}
