// Ein Gespräch im Detail: Aufnahme mit Zwei-Spur-Wellenform, Abschrift, KI-Zusammenfassung,
// Coaching-Kommentare mit Zeitmarken.

import { ArrowLeft, ArrowDownLeft, ArrowUpRight, FileText, Loader2, MessageSquare, Search, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync, useLookups } from '../../app/hooks.ts';
import { leadHref } from '../../app/router.ts';
import { bus } from '../../lib/bus.ts';
import { formatDateTime, formatDuration, formatPhone, formatRelative } from '../../lib/format.ts';
import { canListenCall } from '../../lib/perms.ts';
import type { Comment } from '../../lib/types.ts';
import { MentionInput, mentionsIn, MentionText } from '../../ui/MentionInput.tsx';
import { Avatar, Empty, errMsg, Loading, Tag, useUi } from '../../ui/ui.tsx';
import { OutcomeTag } from '../common/bits.tsx';
import type { AudioEngine, EngineState } from './audioEngine.ts';
import { FullPlayer, QualityBadge, RecordingPending, SummaryCard, Transcript } from './Player.tsx';

export default function CallPage({ id }: { id: string }) {
  const { store, ref, can, me } = useApp();
  const { toast } = useUi();
  const { name, profileById } = useLookups();
  const call = useAsync(() => store.getCall(id), [store, id], ['calls']);
  const insights = useAsync(() => store.getCallInsights(id), [store, id], ['insights', 'calls']);
  const comments = useAsync(() => store.listCommentsFor('call', id), [store, id], ['comments']);
  const [q, setQ] = useState('');
  const [time, setTime] = useState(0);
  const engineRef = useRef<AudioEngine | null>(null);
  const [draft, setDraft] = useState('');
  const [markerAt, setMarkerAt] = useState<number | null>(null);
  const [requesting, setRequesting] = useState(false);

  if (call.loading && !call.data) return <Loading />;
  const c = call.data;
  if (!c) return <div className="page"><Empty title="Gespräch nicht gefunden">Vielleicht gelöscht oder für deine Rolle nicht sichtbar.</Empty></div>;

  const listen = canListenCall(ref, c);
  const ins = insights.data ?? null;

  const seek = (t: number) => engineRef.current?.seek(t);

  const addComment = async () => {
    if (!draft.trim() || !c.lead_id) return;
    try {
      await store.addComment({ lead_id: c.lead_id, target_kind: 'call', target_id: c.id, body: draft.trim(), at_ms: markerAt, mentions: mentionsIn(draft, ref.profiles) });
      setDraft('');
      setMarkerAt(null);
      comments.reload();
      bus.emit('comments');
      bus.emit('timeline', c.lead_id);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const requestTranscript = async () => {
    setRequesting(true);
    try {
      await store.requestTranscript(c.id);
      toast('Abschrift ist angefordert – dauert meist unter einer Minute.');
      call.reload();
      insights.reload();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setRequesting(false);
    }
  };

  const useAsNote = async () => {
    if (!ins?.summary || !c.lead_id) return;
    const s = ins.summary;
    const body = [s.text, s.next_steps?.length ? `Nächste Schritte:\n${s.next_steps.map((x) => `• ${x}`).join('\n')}` : '', s.objections?.length ? `Einwände:\n${s.objections.map((x) => `• ${x}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
    try {
      await store.addNote(c.lead_id, body, c.contact_id);
      bus.emit('timeline', c.lead_id);
      toast('Als Notiz am Lead gespeichert.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const createTasks = async (steps: string[]) => {
    try {
      for (const s of steps) await store.saveTask({ title: s, lead_id: c.lead_id, contact_id: c.contact_id, type: 'todo', assigned_to: me.id, due_at: null });
      bus.emit('tasks');
      toast(`${steps.length} Aufgaben angelegt.`);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const sorted = [...(comments.data ?? [])].sort((a, b) => (a.at_ms ?? -1) - (b.at_ms ?? -1) || a.created_at.localeCompare(b.created_at));
  const agent = c.user_id ? profileById.get(c.user_id) : undefined;

  return (
    <div className="page call-page">
      <div className="page-head">
        <button type="button" className="icon-btn" onClick={() => history.back()} aria-label="Zurück">
          <ArrowLeft />
        </button>
        <div className="grow">
          <h1>
            {c.lead_id && c.lead ? <a href={leadHref(c.lead_id)}>{c.lead.name}</a> : formatPhone(c.direction === 'inbound' ? c.from_number ?? '' : c.to_number ?? '')}
          </h1>
          <div className="row wrap gap-8 small muted mt-4">
            <span className="row gap-4">{c.direction === 'inbound' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}{c.direction === 'inbound' ? 'Eingehend' : 'Ausgehend'}</span>
            <span>{formatDateTime(c.started_at)}</span>
            <span>{formatDuration(c.duration || c.recording_duration || 0)}</span>
            {agent ? <span className="row gap-4"><Avatar name={agent.full_name} color={agent.color} /> {agent.full_name}</span> : null}
            <OutcomeTag outcome={c.outcome} />
            <QualityBadge quality={c.quality} />
            {c.is_voicemail ? <Tag tone="blue">Mailbox-Nachricht</Tag> : null}
          </div>
        </div>
      </div>

      {c.note ? <div className="callout mt-8"><MessageSquare /><span>{c.note}</span></div> : null}

      {!c.recording_path && ['recording', 'paused', 'processing', 'failed'].includes(c.recording_status) ? (
        <div className="section">
          <RecordingPending call={c} />
        </div>
      ) : !c.recording_path ? (
        <Empty title={c.recording_status === 'deleted' ? 'Aufnahme gelöscht' : 'Keine Aufnahme'}>
          {c.recording_status === 'deleted' ? 'Die Aufnahme wurde gelöscht oder hat die Aufbewahrungsfrist erreicht.' : 'Zu diesem Gespräch gibt es keine Aufnahme.'}
        </Empty>
      ) : !listen ? (
        <Empty title="Keine Berechtigung">Aufnahmen von Kollegen hören darf nur, wer das Recht „Alle Aufnahmen anhören“ hat.</Empty>
      ) : (
        <>
          <div className="section">
            <FullPlayer
              call={c}
              insights={ins}
              comments={comments.data ?? []}
              onMarker={c.lead_id ? (ms) => setMarkerAt(ms) : undefined}
              engineRef={(e: AudioEngine, s: EngineState) => {
                engineRef.current = e;
                if (Math.abs(s.time - time) > 0.2) setTime(s.time);
              }}
            />
          </div>

          <div className="call-columns">
            <section className="section">
              <div className="row wrap">
                <h2 className="grow"><FileText size={18} aria-hidden="true" /> Abschrift</h2>
                {ins?.segments?.length ? (
                  <label className="search-inline">
                    <Search size={15} aria-hidden="true" />
                    <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="In der Abschrift suchen" aria-label="In der Abschrift suchen" />
                  </label>
                ) : null}
              </div>
              {ins?.segments?.length ? (
                <Transcript segments={ins.segments} time={time} onSeek={seek} query={q} />
              ) : c.transcript_status === 'processing' || c.transcript_status === 'queued' ? (
                <p className="row gap-8 muted"><Loader2 size={16} className="spin" /> Wird abgeschrieben…</p>
              ) : c.transcript_status === 'failed' ? (
                <p className="small" style={{ color: 'var(--signal)' }}>Abschrift fehlgeschlagen{ins?.error ? `: ${ins.error}` : ''}.</p>
              ) : can('use_ai') ? (
                <div className="col gap-8">
                  <p className="muted small">Noch keine Abschrift. Getrennt nach Sprecher, auf Deutsch, mit KI-Zusammenfassung.</p>
                  <button type="button" className="btn" onClick={requestTranscript} disabled={requesting}>
                    <Sparkles size={16} /> {requesting ? 'Wird angefordert…' : 'Abschrift erstellen'}
                  </button>
                </div>
              ) : (
                <p className="muted small">Noch keine Abschrift.</p>
              )}
            </section>

            <aside className="col gap-16">
              {ins?.summary ? <SummaryCard insights={ins} onUseAsNote={c.lead_id ? useAsNote : undefined} onCreateTasks={c.lead_id ? createTasks : undefined} /> : null}
              <section className="section">
                <h2><MessageSquare size={18} aria-hidden="true" /> Kommentare & Markierungen</h2>
                {sorted.length ? (
                  <ul className="comments">
                    {sorted.map((cm: Comment) => (
                      <li key={cm.id}>
                        <div className="row gap-8">
                          <Avatar name={name(cm.user_id)} color={profileById.get(cm.user_id ?? '')?.color} />
                          <strong className="small">{name(cm.user_id)}</strong>
                          {cm.at_ms !== null ? (
                            <button type="button" className="chip time-chip" onClick={() => seek((cm.at_ms ?? 0) / 1000)}>
                              bei {formatDuration(Math.floor((cm.at_ms ?? 0) / 1000))}
                            </button>
                          ) : null}
                          <span className="xs muted grow">{formatRelative(cm.created_at)}</span>
                        </div>
                        <p className="comment-body"><MentionText text={cm.body} profiles={ref.profiles} /></p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="small muted">Noch keine Kommentare. Mit „Markierung“ (Taste M) hältst du eine Stelle fest, z. B. für Coaching.</p>
                )}
                {c.lead_id ? (
                  <div className="col gap-8 mt-12">
                    {markerAt !== null ? (
                      <div className="row gap-8 small">
                        <span className="chip time-chip">Markierung bei {formatDuration(Math.floor(markerAt / 1000))}</span>
                        <button type="button" className="btn small ghost" onClick={() => setMarkerAt(null)}>ohne Zeit</button>
                      </div>
                    ) : null}
                    <MentionInput value={draft} onChange={setDraft} profiles={ref.profiles} placeholder="Kommentar … mit @Name erwähnst du Kollegen" onSubmit={addComment} ariaLabel="Kommentar" />
                    <div className="row">
                      <button type="button" className="btn primary small" onClick={addComment} disabled={!draft.trim()}>Kommentieren</button>
                      <span className="xs muted">Strg + Enter</span>
                    </div>
                  </div>
                ) : null}
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
