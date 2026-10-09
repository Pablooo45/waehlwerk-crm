// Gesprächsaufnahmen abspielen: Zwei-Spur-Wellenform (wir / Kunde), Lautstärke je Seite,
// Sprachverbesserung, Tempo, ±10 Sekunden, Markierungen mit Kommentar, Abschrift mitlaufend.

import { AlertTriangle, ArrowLeftRight, Download, FileText, Headphones, Loader2, Maximize2, Pause, Play, RefreshCw, RotateCcw, RotateCw, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useApp } from '../../app/context.tsx';
import { callHref } from '../../app/router.ts';
import { talkShare } from '../../lib/audio/analysis.ts';
import { bus } from '../../lib/bus.ts';
import { formatDuration } from '../../lib/format.ts';
import { canDeleteRecording, canListenCall } from '../../lib/perms.ts';
import type { Call, CallInsights, Comment, TranscriptSegment } from '../../lib/types.ts';
import { cx, errMsg, useUi } from '../../ui/ui.tsx';
import { AudioEngine, type EngineState } from './audioEngine.ts';

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function useEngine(call: Pick<Call, 'id' | 'recording_channels' | 'agent_channel' | 'recording_duration'>) {
  const engine = useMemo(
    () => new AudioEngine(call.recording_channels ?? 1, call.agent_channel ?? null, call.recording_duration ?? 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [call.id, call.agent_channel],
  );
  useEffect(() => () => engine.destroy(), [engine]);
  const state = useSyncExternalStore(
    useCallback((cb) => engine.subscribe(cb), [engine]),
    () => engine.state,
  );
  return { engine, state };
}

function cssVar(el: Element, name: string, fallback: string) {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

// ---------- Wellenform ----------

export function Waveform({
  peaks,
  duration,
  time,
  onSeek,
  markers = [],
  height = 88,
  compact = false,
  labels = true,
}: {
  peaks: CallInsights['peaks'];
  duration: number;
  time: number;
  onSeek: (t: number) => void;
  markers?: { at: number; title: string }[];
  height?: number;
  compact?: boolean;
  labels?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !width) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const agentColor = cssVar(c, '--wave-agent', '#2346a0');
    const customerColor = cssVar(c, '--wave-customer', '#0e8a5f');
    const rest = cssVar(c, '--wave-rest', '#b8c0cc');
    const progressX = duration > 0 ? (time / duration) * width : 0;
    // Stereo: oben wir, unten Kunde. Mono (z. B. Mailbox): eine Spur über die ganze Höhe.
    const mono = !!peaks && !peaks.customer.length;
    const lanes: [number[], string, number][] = peaks
      ? mono ? [[peaks.agent, customerColor, 0]] : [[peaks.agent, agentColor, 0], [peaks.customer, customerColor, 1]]
      : [];
    const laneH = height / Math.max(1, lanes.length);
    const bar = compact ? 2 : 2;
    const gap = 1;
    const cols = Math.max(1, Math.floor(width / (bar + gap)));
    for (const [values, color, lane] of lanes) {
      if (!values.length) continue;
      const mid = lane * laneH + laneH / 2;
      // Grundlinie für Stille, damit die Spur durchgehend lesbar bleibt
      g.globalAlpha = 1;
      g.fillStyle = rest;
      g.fillRect(0, Math.round(mid), width, 1);
      for (let x = 0; x < cols; x++) {
        const from = Math.floor((x / cols) * values.length);
        const to = Math.max(from + 1, Math.floor(((x + 1) / cols) * values.length));
        let v = 0;
        for (let i = from; i < to; i++) if (values[i] > v) v = values[i];
        if (v < 14) continue; // Leitungsrauschen nicht zeichnen
        const h = Math.max(2, (v / 255) * (laneH - 4));
        const px = x * (bar + gap);
        g.fillStyle = px < progressX ? color : rest;
        g.globalAlpha = px < progressX ? 1 : 0.9;
        g.fillRect(px, mid - h / 2, bar, h);
      }
      if (progressX > 0) {
        g.globalAlpha = 1;
        g.fillStyle = color;
        g.fillRect(0, Math.round(mid), Math.min(progressX, width), 1);
      }
    }
    g.globalAlpha = 1;
    if (!peaks) {
      // ohne Wellenform: einfacher Fortschrittsbalken
      g.fillStyle = rest;
      g.fillRect(0, height / 2 - 2, width, 4);
      g.fillStyle = agentColor;
      g.fillRect(0, height / 2 - 2, progressX, 4);
    }
    // Abspielposition
    if (duration > 0) {
      g.fillStyle = cssVar(c, '--ink', '#16202b');
      g.fillRect(Math.min(width - 2, progressX), 0, 2, height);
    }
  }, [peaks, duration, time, width, height, compact]);

  const tAt = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
  };

  const showLabels = labels && !!peaks && peaks.customer.length > 0 && !compact;
  return (
    <div className={cx('wave', (compact || !showLabels) && 'compact')}>
      {showLabels ? (
        <div className="wave-labels" aria-hidden="true">
          <span className="agent">Wir</span>
          <span className="customer">Kunde</span>
        </div>
      ) : null}
      <div
        ref={wrap}
        className="wave-canvas"
        style={{ height }}
        role="slider"
        tabIndex={0}
        aria-label="Position in der Aufnahme"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={`${formatDuration(time)} von ${formatDuration(duration)}`}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          onSeek(tAt(e.clientX));
        }}
        onPointerMove={(e) => {
          setHover(tAt(e.clientX));
          if (dragging.current) onSeek(tAt(e.clientX));
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onSeek(Math.max(0, time - 5));
          if (e.key === 'ArrowRight') onSeek(Math.min(duration, time + 5));
        }}
      >
        <canvas ref={canvas} style={{ width: '100%', height }} />
        {markers.map((m, i) => (
          <button
            key={i}
            type="button"
            className="wave-marker"
            style={{ left: `${duration ? (m.at / duration) * 100 : 0}%` }}
            title={`${formatDuration(m.at)}: ${m.title}`}
            aria-label={`Markierung bei ${formatDuration(m.at)}: ${m.title}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(m.at);
            }}
          />
        ))}
        {hover !== null && !compact ? (
          <span className="wave-hover" style={{ left: `${duration ? (hover / duration) * 100 : 0}%` }}>
            {formatDuration(hover)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ---------- Aufnahme nachholen ----------

// Eine Aufnahme liegt bei Twilio, bis sie sicher bei uns gespeichert ist – „Erneut holen“ versucht es sofort
function useRecordingRetry(call: Call) {
  const { store, ref } = useApp();
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      await store.retryRecording(call.id);
      toast('Aufnahme wird neu geholt – meist dauert das unter einer Minute.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return { busy, retry, allowed: canListenCall(ref, call) };
}

// Zu lange „läuft“ oder „wird gespeichert“ nach dem Auflegen? Dann darf man nachhelfen.
function recordingStuck(call: Call): boolean {
  const since = Date.parse(call.recording_tried_at ?? call.ended_at ?? '') || 0;
  return !!call.ended_at && since > 0 && Date.now() - since > 5 * 60_000;
}

// Gesprächsseite: Aufnahme läuft, wird gespeichert oder konnte nicht gespeichert werden
export function RecordingPending({ call }: { call: Call }) {
  const { busy, retry, allowed } = useRecordingRetry(call);
  const s = call.recording_status;
  const button = allowed ? (
    <button type="button" className="btn small" onClick={retry} disabled={busy}>
      <RefreshCw className={busy ? 'spin' : undefined} /> Erneut holen
    </button>
  ) : null;

  if ((s === 'recording' || s === 'paused') && !call.ended_at) {
    return (
      <div className="callout">
        <span className="rec-dot" aria-hidden="true" style={{ marginTop: 4 }} />
        <span>{s === 'paused' ? 'Aufnahme pausiert – das Gespräch läuft noch.' : 'Aufnahme läuft – nach dem Auflegen erscheint sie hier.'}</span>
      </div>
    );
  }
  if (s === 'recording' || s === 'paused' || s === 'processing') {
    return (
      <div className="callout">
        <Loader2 className="spin" />
        <span className="grow">Aufnahme wird gespeichert und ausgewertet – meist in unter einer Minute.</span>
        {recordingStuck(call) ? button : null}
      </div>
    );
  }
  const automatic = (call.recording_attempts ?? 0) < 4;
  return (
    <div className="callout err">
      <AlertTriangle />
      <span className="grow">
        <strong>Die Aufnahme konnte nicht gespeichert werden.</strong>
        {call.recording_error ? ` ${call.recording_error}` : ''}
        <br />
        {automatic ? 'Sie liegt weiter bei Twilio und wird automatisch erneut geholt.' : 'Solange sie bei Twilio liegt, lässt sie sich erneut holen.'}
      </span>
      {button}
    </div>
  );
}

// ---------- Kompakter Player (Listen, Verlauf) ----------

export function RecordingPlayer({ call, onOpen }: { call: Call; onOpen?: () => void }) {
  const { store, ref } = useApp();
  const { toast } = useUi();
  const { engine, state } = useEngine(call);
  const [insights, setInsights] = useState<CallInsights | null>(null);
  const { busy, retry, allowed } = useRecordingRetry(call);
  const status = call.recording_status;

  if ((status === 'recording' || status === 'paused') && !call.ended_at) {
    return (
      <div className="player">
        <span className="rec-dot" aria-hidden="true" />
        <span className="small">Aufnahme läuft…</span>
      </div>
    );
  }
  if (!call.recording_path && (status === 'processing' || status === 'recording' || status === 'paused')) {
    return (
      <div className="player">
        <Loader2 size={16} className="spin" />
        <span className="small muted">Aufnahme wird gespeichert…</span>
      </div>
    );
  }
  if (status === 'failed' && !call.recording_path) {
    return (
      <div className="player" onClick={(e) => e.stopPropagation()}>
        <AlertTriangle size={15} color="var(--signal)" aria-hidden="true" />
        <span className="small grow" style={{ color: 'var(--signal)' }} title={call.recording_error ?? undefined}>
          Aufnahme nicht gespeichert
        </span>
        {allowed ? (
          <button type="button" className="btn small" onClick={retry} disabled={busy}>
            <RefreshCw className={busy ? 'spin' : undefined} /> Erneut holen
          </button>
        ) : null}
      </div>
    );
  }
  if (status === 'deleted') return <div className="player"><span className="small muted">Aufnahme gelöscht.</span></div>;
  if (!call.recording_path) return null;
  if (!canListenCall(ref, call)) {
    return (
      <div className="player">
        <Headphones size={15} aria-hidden="true" />
        <span className="small muted">Aufnahme vorhanden – nur mit dem Recht „Alle Aufnahmen anhören“.</span>
      </div>
    );
  }

  const start = async () => {
    if (!engine.loaded) {
      try {
        const [url, ins] = await Promise.all([store.recordingUrl(call.recording_path!), store.getCallInsights(call.id).catch(() => null)]);
        setInsights(ins);
        engine.load(url);
      } catch (e) {
        toast(errMsg(e), { kind: 'error' });
        return;
      }
    }
    engine.toggle();
  };

  const duration = state.duration || call.recording_duration || 0;
  return (
    <div className="player" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="icon-btn small play" onClick={start} aria-label={state.playing ? 'Pause' : 'Abspielen'}>
        {state.loading && !state.ready ? <span className="spinner" /> : state.playing ? <Pause /> : <Play />}
      </button>
      <span className="xs muted num nowrap">
        {formatDuration(state.time)} / {formatDuration(duration)}
      </span>
      <div className="grow" style={{ minWidth: 80 }}>
        <Waveform peaks={insights?.peaks ?? null} duration={duration} time={state.time} onSeek={(t) => (engine.loaded ? engine.seek(t) : undefined)} height={28} compact labels={false} />
      </div>
      <SpeedButton state={state} engine={engine} />
      {call.transcript_status === 'ready' ? <span className="tag soft" title="Abschrift vorhanden"><FileText size={12} /> Abschrift</span> : null}
      <a className="icon-btn small" href={callHref(call.id)} onClick={onOpen} aria-label="Gespräch öffnen" title="Gespräch öffnen (Wellenform, Abschrift, Kommentare)">
        <Maximize2 />
      </a>
    </div>
  );
}

function SpeedButton({ state, engine }: { state: EngineState; engine: AudioEngine }) {
  return (
    <button
      type="button"
      className="speed"
      onClick={() => engine.setRate(SPEEDS[(SPEEDS.indexOf(state.rate) + 1) % SPEEDS.length])}
      title="Geschwindigkeit (Tonhöhe bleibt)"
      aria-label={`Geschwindigkeit ${state.rate}-fach`}
    >
      {String(state.rate).replace('.', ',')}×
    </button>
  );
}

// ---------- Großer Player (Gesprächsseite) ----------

export function FullPlayer({
  call,
  insights,
  comments,
  onMarker,
  engineRef,
}: {
  call: Call;
  insights: CallInsights | null;
  comments: Comment[];
  onMarker?: (atMs: number) => void;
  engineRef?: (e: AudioEngine, s: EngineState) => void;
}) {
  const { store, ref, can, me } = useApp();
  const { toast, confirm } = useUi();
  const { engine, state } = useEngine(call);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const duration = state.duration || call.recording_duration || 0;
  const stereo = (call.recording_channels ?? 1) >= 2;

  useEffect(() => {
    engineRef?.(engine, state);
  });

  useEffect(() => {
    let alive = true;
    if (!call.recording_path) return;
    store
      .recordingUrl(call.recording_path)
      .then((u) => {
        if (!alive) return;
        setLoadedUrl(u);
        engine.load(u);
      })
      .catch((e) => toast(errMsg(e), { kind: 'error' }));
    return () => {
      alive = false;
    };
  }, [call.recording_path, engine, store, toast]);

  useEffect(() => {
    const s = me.settings;
    if (s.playbackRate) engine.setRate(s.playbackRate);
    if (s.enhanceAudio) engine.setEnhance(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  // Tastatur: Leertaste, Pfeile, M
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === ' ') {
        e.preventDefault();
        engine.toggle();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        engine.skip(-10);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        engine.skip(10);
      } else if ((e.key === 'm' || e.key === 'M') && onMarker) {
        e.preventDefault();
        onMarker(Math.round(engine.el.currentTime * 1000));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, onMarker]);

  const markers = comments.filter((c) => c.at_ms !== null).map((c) => ({ at: (c.at_ms ?? 0) / 1000, title: c.body }));
  const talk = insights?.talk ?? (call.talk_agent_ms != null && call.talk_customer_ms != null ? { agent_ms: call.talk_agent_ms, customer_ms: call.talk_customer_ms } : null);

  const download = async () => {
    if (__DEMO_BUILD__) {
      toast('In der Demo-Vorschau sind Downloads gesperrt. Im echten CRM wird die WAV-Datei gespeichert.');
      return;
    }
    const u = loadedUrl ?? (await store.recordingUrl(call.recording_path!).catch(() => null));
    if (!u) return;
    const a = document.createElement('a');
    a.href = u;
    a.download = `gespraech-${call.started_at.slice(0, 10)}-${call.id.slice(0, 6)}.${call.recording_path?.endsWith('.mp3') ? 'mp3' : 'wav'}`;
    a.rel = 'noopener';
    a.click();
  };

  const remove = async () => {
    if (!(await confirm('Aufnahme und Abschrift endgültig löschen? Die Gesprächsdaten (Dauer, Ergebnis, Notiz) bleiben.', { danger: true, confirmLabel: 'Löschen' }))) return;
    try {
      await store.deleteRecording(call.id);
      bus.emit('calls');
      toast('Aufnahme gelöscht.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  // Falls „wir“ und „Kunde“ vertauscht sind (je nach Telefonanlage möglich): Spuren tauschen
  const canSwap = stereo && (call.user_id === me.id || can('manage_others_activities'));
  const swap = async () => {
    try {
      await store.swapRecordingChannels(call.id);
      bus.emit('calls');
      toast('Spuren getauscht – Wellenform, Redeanteile und Abschrift sind angepasst.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const savePref = (patch: { playbackRate?: number; enhanceAudio?: boolean }) =>
    store.updateMyProfile({ settings: { ...me.settings, ...patch } }).catch(() => undefined);

  return (
    <div className="full-player">
      <Waveform peaks={insights?.peaks ?? null} duration={duration} time={state.time} onSeek={(t) => engine.seek(t)} markers={markers} height={stereo ? 104 : 64} />
      <div className="player-controls">
        <button type="button" className="icon-btn" onClick={() => engine.skip(-10)} aria-label="10 Sekunden zurück" title="10 Sekunden zurück (←)">
          <RotateCcw />
        </button>
        <button type="button" className="btn primary play-big" onClick={() => engine.toggle()} aria-label={state.playing ? 'Pause' : 'Abspielen'} disabled={!loadedUrl}>
          {state.loading && !state.ready ? <span className="spinner" /> : state.playing ? <Pause /> : <Play />}
        </button>
        <button type="button" className="icon-btn" onClick={() => engine.skip(10)} aria-label="10 Sekunden vor" title="10 Sekunden vor (→)">
          <RotateCw />
        </button>
        <span className="num small nowrap">
          {formatDuration(state.time)} / {formatDuration(duration)}
        </span>
        <span className="grow" />
        <label className="speed-select small">
          Tempo
          <select
            className="select"
            value={state.rate}
            onChange={(e) => {
              engine.setRate(Number(e.target.value));
              savePref({ playbackRate: Number(e.target.value) });
            }}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>{String(s).replace('.', ',')}×</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={cx('btn small', state.enhance && 'active')}
          aria-pressed={state.enhance}
          onClick={() => {
            engine.setEnhance(!state.enhance);
            savePref({ enhanceAudio: !state.enhance });
          }}
          title="Brummen und Rauschen filtern, Sprache betonen, leise Stellen anheben"
        >
          <Wand2 size={15} /> Sprache verbessern
        </button>
        {onMarker ? (
          <button type="button" className="btn small" onClick={() => onMarker(Math.round(engine.el.currentTime * 1000))} title="Markierung mit Kommentar an dieser Stelle (M)">
            Markierung
          </button>
        ) : null}
        {can('recordings_download') ? (
          <button type="button" className="icon-btn" onClick={download} aria-label="Herunterladen" title="Herunterladen (WAV)">
            <Download />
          </button>
        ) : null}
        {canDeleteRecording(ref, call) ? (
          <button type="button" className="icon-btn" onClick={remove} aria-label="Aufnahme löschen" title="Aufnahme löschen">
            <Trash2 />
          </button>
        ) : null}
      </div>
      {stereo ? (
        <div className="mixer">
          <label className="mixer-ch agent">
            <span>Wir</span>
            <input type="range" min={0} max={2} step={0.05} value={state.agentGain} onChange={(e) => engine.setGains(Number(e.target.value), state.customerGain)} aria-label="Lautstärke unsere Seite" />
            <span className="num xs">{Math.round(state.agentGain * 100)} %</span>
          </label>
          <label className="mixer-ch customer">
            <span>Kunde</span>
            <input type="range" min={0} max={2} step={0.05} value={state.customerGain} onChange={(e) => engine.setGains(state.agentGain, Number(e.target.value))} aria-label="Lautstärke Kunde" />
            <span className="num xs">{Math.round(state.customerGain * 100)} %</span>
          </label>
          <button type="button" className="btn small ghost" onClick={() => engine.setGains(1, 1)}>Zurücksetzen</button>
          {canSwap ? (
            <button type="button" className="btn small ghost" onClick={swap} title="Falls unsere Stimme beim Kunden liegt: Spuren tauschen">
              <ArrowLeftRight size={14} /> Spuren tauschen
            </button>
          ) : null}
        </div>
      ) : null}
      {talk ? <TalkBar talk={talk} /> : null}
      {state.error ? <p className="small" style={{ color: 'var(--signal)' }}>{state.error}</p> : null}
    </div>
  );
}

export function TalkBar({ talk }: { talk: { agent_ms: number; customer_ms: number; longest_customer_ms?: number; switches?: number } }) {
  const share = talkShare(talk);
  if (share === null) return null;
  const a = Math.round(share * 100);
  return (
    <div className="talkbar">
      <div className="talkbar-bar" role="img" aria-label={`Redeanteil: wir ${a} Prozent, Kunde ${100 - a} Prozent`}>
        <span className="agent" style={{ width: `${a}%` }} />
        <span className="customer" style={{ width: `${100 - a}%` }} />
      </div>
      <div className="talkbar-legend small">
        <span><i className="sw agent" /> Wir {a}&nbsp;%</span>
        <span><i className="sw customer" /> Kunde {100 - a}&nbsp;%</span>
        {talk.longest_customer_ms ? <span className="muted">Längster Kunden-Monolog {formatDuration(Math.round(talk.longest_customer_ms / 1000))}</span> : null}
        {talk.switches ? <span className="muted">{talk.switches} Sprecherwechsel</span> : null}
      </div>
    </div>
  );
}

// ---------- Abschrift ----------

export function Transcript({ segments, time, onSeek, query }: { segments: TranscriptSegment[]; time: number; onSeek: (t: number) => void; query?: string }) {
  const list = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const activeIdx = segments.findIndex((s) => time * 1000 >= s.start && time * 1000 < s.end + 400);
  const q = (query ?? '').trim().toLowerCase();

  useEffect(() => {
    if (!follow || activeIdx < 0) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-i="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIdx, follow]);

  const mark = (text: string) => {
    if (!q) return text;
    const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
    return parts.map((p, i) => (p.toLowerCase() === q ? <mark key={i}>{p}</mark> : p));
  };

  return (
    <div className="transcript" ref={list} onWheel={() => setFollow(false)} onTouchMove={() => setFollow(false)}>
      {segments.map((s, i) => (
        <button key={i} type="button" data-i={i} className={cx('seg', s.speaker, i === activeIdx && 'active')} onClick={() => { setFollow(true); onSeek(s.start / 1000); }}>
          <span className="seg-meta">
            <span className="seg-who">{s.speaker === 'agent' ? 'Wir' : 'Kunde'}</span>
            <span className="num xs muted">{formatDuration(Math.floor(s.start / 1000))}</span>
          </span>
          <span className="seg-text">{mark(s.text)}</span>
        </button>
      ))}
      {!follow ? (
        <button type="button" className="btn small follow" onClick={() => setFollow(true)}>
          Mitlaufen
        </button>
      ) : null}
    </div>
  );
}

export function SummaryCard({ insights, onUseAsNote, onCreateTasks }: { insights: CallInsights; onUseAsNote?: () => void; onCreateTasks?: (steps: string[]) => void }) {
  const s = insights.summary;
  if (!s) return null;
  return (
    <div className="summary-card">
      <div className="row">
        <Sparkles size={16} aria-hidden="true" />
        <strong className="grow">KI-Zusammenfassung</strong>
        {s.mood ? <span className={cx('tag', s.mood === 'positiv' ? 'green' : s.mood === 'negativ' ? 'red' : s.mood === 'skeptisch' ? 'amber' : 'soft')}>Stimmung: {s.mood}</span> : null}
      </div>
      <p className="mt-8">{s.text}</p>
      {s.next_steps?.length ? (
        <>
          <h4>Nächste Schritte</h4>
          <ul>
            {s.next_steps.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </>
      ) : null}
      {s.objections?.length ? (
        <>
          <h4>Einwände</h4>
          <ul>
            {s.objections.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="row wrap mt-8">
        {onUseAsNote ? <button type="button" className="btn small" onClick={onUseAsNote}>Als Notiz übernehmen</button> : null}
        {onCreateTasks && s.next_steps?.length ? <button type="button" className="btn small" onClick={() => onCreateTasks(s.next_steps!)}>Schritte als Aufgaben</button> : null}
      </div>
      <p className="xs muted mt-8">Automatisch erstellt – bitte kurz gegenlesen.</p>
    </div>
  );
}

export function QualityBadge({ quality }: { quality: Call['quality'] }) {
  if (!quality?.mos) return null;
  const mos = quality.mos;
  const tone = mos >= 4 ? 'green' : mos >= 3.5 ? 'amber' : 'red';
  const text = mos >= 4 ? 'sehr gut' : mos >= 3.5 ? 'ordentlich' : 'schlecht';
  const details = [
    `MOS ${String(mos).replace('.', ',')} von 4,5`,
    quality.rtt != null ? `Verzögerung ${quality.rtt} ms` : null,
    quality.jitter != null ? `Schwankung ${quality.jitter} ms` : null,
    quality.packetLoss != null ? `Paketverlust ${String(quality.packetLoss).replace('.', ',')} %` : null,
    quality.edge ? `Server ${quality.edge}` : null,
  ].filter(Boolean).join(', ');
  return (
    <span className={cx('tag', tone)} title={details}>
      Leitung {text}
    </span>
  );
}
