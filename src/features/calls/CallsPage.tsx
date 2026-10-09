// Gespräche: alle Anrufe mit Aufnahme, Redeanteil und Leitungsqualität – durchsuchbar bis in die Abschriften.

import { Download, FileText, PhoneIncoming, PhoneMissed, PhoneOutgoing, Search, Voicemail } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync, useLookups } from '../../app/hooks.ts';
import { callHref, leadHref, navigate } from '../../app/router.ts';
import { talkShare } from '../../lib/audio/analysis.ts';
import { downloadText, toCsv } from '../../lib/csv.ts';
import { rangePresets } from '../../lib/dates.ts';
import { formatDateTime, formatDuration, formatPhone, formatRelative } from '../../lib/format.ts';
import type { Call, ID } from '../../lib/types.ts';
import { Avatar, cx, Empty, errMsg, Loading, useDebounced, useUi } from '../../ui/ui.tsx';
import { OutcomeTag, RecordingPlayer } from '../common/bits.tsx';
import { ConversationTabs } from './ConversationTabs.tsx';
import { QualityBadge } from './Player.tsx';

const PAGE = 50;

export default function CallsPage() {
  const { store, ref, can, me } = useApp();
  const { toast } = useUi();
  const { name } = useLookups();
  const presets = rangePresets();
  const [range, setRange] = useState('week');
  const [who, setWho] = useState(can('recordings_listen_all') || can('view_team_reports') ? '' : `u:${me.id}`);
  const [direction, setDirection] = useState<'' | 'outbound' | 'inbound'>('');
  const [outcome, setOutcome] = useState('');
  const [rec, setRec] = useState(false);
  const [withTranscript, setWithTranscript] = useState(false);
  const [minDuration, setMinDuration] = useState(0);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 350);
  const [limit, setLimit] = useState(PAGE);
  const preset = presets.find((p) => p.key === range) ?? presets[2];

  const userIds: ID[] | null = who.startsWith('g:')
    ? ref.groupMembers.filter((m) => m.group_id === who.slice(2)).map((m) => m.user_id)
    : who.startsWith('u:') ? [who.slice(2)] : null;

  const filter = {
    userIds,
    direction: direction || null,
    outcome: outcome || null,
    withRecording: rec,
    withTranscript,
    minDuration: minDuration || null,
    q: dq.trim() || null,
    from: preset.from,
    to: preset.to,
  };
  const data = useAsync(() => store.listCalls(filter, { offset: 0, limit }), [store, JSON.stringify({ ...filter, from: preset.key }), limit], ['calls']);
  const rows = data.data?.rows ?? [];
  const total = data.data?.total ?? 0;
  const reset = () => setLimit(PAGE);

  const exportCsv = async () => {
    try {
      const all: Call[] = [];
      for (let offset = 0; offset < 20000; offset += 500) {
        const part = await store.listCalls(filter, { offset, limit: 500 });
        all.push(...part.rows);
        if (part.rows.length < 500) break;
      }
      const header = ['Zeit', 'Richtung', 'Mitarbeiter', 'Lead', 'Nummer', 'Dauer (s)', 'Ergebnis', 'Notiz', 'Aufnahme', 'Redeanteil wir (%)', 'Leitung (MOS)'];
      const lines = all.map((c) => {
        const share = c.talk_agent_ms != null && c.talk_customer_ms != null ? talkShare({ agent_ms: c.talk_agent_ms, customer_ms: c.talk_customer_ms }) : null;
        return [
          formatDateTime(c.started_at), c.direction === 'inbound' ? 'eingehend' : 'ausgehend', name(c.user_id), c.lead?.name ?? '',
          formatPhone(c.direction === 'inbound' ? c.from_number : c.to_number), c.duration,
          ref.outcomes.find((o) => o.key === c.outcome)?.label ?? c.outcome ?? '', c.note ?? '', c.recording_path ? 'ja' : 'nein',
          share === null ? '' : Math.round(share * 100), c.quality?.mos ?? '',
        ];
      });
      if (__DEMO_BUILD__) {
        toast(`${all.length} Anrufe wären exportiert worden. In der Demo-Vorschau sind Downloads gesperrt.`);
        return;
      }
      downloadText(`anrufe-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([header, ...lines]));
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          Gespräche <span className="muted num" style={{ fontWeight: 500 }}>{data.data ? total.toLocaleString('de-DE') : ''}</span>
        </h1>
        {can('export') ? (
          <button type="button" className="btn" onClick={exportCsv} disabled={!total}>
            <Download /> Export
          </button>
        ) : null}
      </div>
      <ConversationTabs value="history" />

      <div className="filterbar">
        <div className="search" style={{ maxWidth: 320, flex: '1 1 220px' }}>
          <Search />
          <input
            className="input"
            value={q}
            onChange={(e) => { setQ(e.target.value); reset(); }}
            placeholder="In Abschriften suchen, z. B. „Preis“"
            aria-label="In Abschriften suchen"
          />
        </div>
        <select className="select" style={{ width: 'auto' }} value={range} onChange={(e) => { setRange(e.target.value); reset(); }} aria-label="Zeitraum">
          {presets.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto' }} value={who} onChange={(e) => { setWho(e.target.value); reset(); }} aria-label="Mitarbeiter">
          <option value="">Ganzes Team</option>
          {ref.groups.length ? (
            <optgroup label="Gruppen">
              {ref.groups.map((g) => <option key={g.id} value={`g:${g.id}`}>{g.name}</option>)}
            </optgroup>
          ) : null}
          <optgroup label="Person">
            {ref.profiles.filter((p) => p.active).map((p) => <option key={p.id} value={`u:${p.id}`}>{p.full_name || p.email}</option>)}
          </optgroup>
        </select>
        <select className="select" style={{ width: 'auto' }} value={direction} onChange={(e) => { setDirection(e.target.value as '' | 'outbound' | 'inbound'); reset(); }} aria-label="Richtung">
          <option value="">Ein- und ausgehend</option>
          <option value="outbound">Ausgehend</option>
          <option value="inbound">Eingehend</option>
        </select>
        <select className="select" style={{ width: 'auto' }} value={outcome} onChange={(e) => { setOutcome(e.target.value); reset(); }} aria-label="Ergebnis">
          <option value="">Alle Ergebnisse</option>
          {ref.outcomes.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto' }} value={minDuration} onChange={(e) => { setMinDuration(Number(e.target.value)); reset(); }} aria-label="Mindestdauer">
          <option value={0}>Jede Dauer</option>
          <option value={30}>ab 30 Sek.</option>
          <option value={60}>ab 1 Min.</option>
          <option value={180}>ab 3 Min.</option>
          <option value={600}>ab 10 Min.</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={rec} onChange={(e) => { setRec(e.target.checked); reset(); }} />
          Mit Aufnahme
        </label>
        <label className="check">
          <input type="checkbox" checked={withTranscript} onChange={(e) => { setWithTranscript(e.target.checked); reset(); }} />
          Mit Abschrift
        </label>
      </div>

      {data.loading && !data.data ? (
        <Loading />
      ) : data.error ? (
        <div className="callout err">{data.error}</div>
      ) : !rows.length ? (
        <div className="panel">
          <Empty title="Keine Gespräche gefunden">{dq ? 'In keiner Abschrift kommt das vor – oder du darfst die passenden Aufnahmen nicht hören.' : 'Zeitraum oder Filter ändern.'}</Empty>
        </div>
      ) : (
        <div className="panel">
          <div className="list">
            {rows.map((c) => (
              <CallRow key={c.id} call={c} query={dq} />
            ))}
          </div>
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

function CallRow({ call, query }: { call: Call; query: string }) {
  const { profileById } = useLookups();
  const [open, setOpen] = useState(false);
  const inbound = call.direction === 'inbound';
  const missed = inbound && !call.answered_at && !call.duration;
  const icon = call.is_voicemail ? (
    <Voicemail size={18} className="signal-text" aria-label="Mailbox-Nachricht" />
  ) : missed ? (
    <PhoneMissed size={18} className="signal-text" aria-label="Verpasst" />
  ) : inbound ? (
    <PhoneIncoming size={18} aria-label="Eingehend" />
  ) : (
    <PhoneOutgoing size={18} aria-label="Ausgehend" />
  );
  const agent = call.user_id ? profileById.get(call.user_id) : undefined;
  const share = call.talk_agent_ms != null && call.talk_customer_ms != null ? talkShare({ agent_ms: call.talk_agent_ms, customer_ms: call.talk_customer_ms }) : null;
  const hasRec = !!call.recording_path || ['processing', 'recording', 'paused', 'failed'].includes(call.recording_status);

  return (
    <div className={cx('list-item call-row', open && 'open')}>
      <span className="call-row-icon">{icon}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row wrap gap-8">
          {call.lead ? (
            <a href={leadHref(call.lead.id)} className="strong">{call.lead.name}</a>
          ) : (
            <strong className="num">{formatPhone(inbound ? call.from_number : call.to_number)}</strong>
          )}
          <OutcomeTag outcome={call.outcome} />
          <QualityBadge quality={call.quality} />
          {call.transcript_status === 'ready' ? <span className="tag soft" title="Abschrift vorhanden"><FileText size={12} /> Abschrift</span> : null}
        </div>
        <div className="row wrap gap-8 small muted">
          <span title={formatDateTime(call.started_at)}>{formatRelative(call.started_at)}</span>
          {agent ? <span className="row gap-4"><Avatar name={agent.full_name} color={agent.color} /> {agent.full_name}</span> : <span>niemand</span>}
          <span>{call.duration ? formatDuration(call.duration) : missed ? 'verpasst' : 'nicht verbunden'}</span>
          {share !== null ? (
            <span className="mini-talk" title={`Redeanteil: wir ${Math.round(share * 100)} %, Kunde ${100 - Math.round(share * 100)} %`}>
              <span className="mini-talk-bar"><i style={{ width: `${Math.round(share * 100)}%` }} /></span>
              wir {Math.round(share * 100)} %
            </span>
          ) : null}
        </div>
        {call.note ? <div className="small mt-4 pre-wrap clamp-2">{call.note}</div> : null}
        {query && call.transcript_status === 'ready' ? (
          <div className="xs muted mt-4">Treffer in der Abschrift – <a href={callHref(call.id)}>Stelle anhören</a></div>
        ) : null}
        {open ? <div className="mt-8"><RecordingPlayer call={call} /></div> : null}
      </div>
      <div className="row gap-4">
        {hasRec ? (
          <button type="button" className="btn small" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Schließen' : call.recording_path ? 'Anhören' : 'Aufnahme'}
          </button>
        ) : null}
        <button type="button" className="btn small ghost" onClick={() => navigate(callHref(call.id))}>Details</button>
      </div>
    </div>
  );
}
