// Telefon im Browser – gemeinsame Schnittstelle (Twilio echt / Demo simuliert)

export type PhoneStatus = 'off' | 'starting' | 'ready' | 'unconfigured' | 'error' | 'offline';
export type CallState = 'connecting' | 'ringing' | 'open' | 'reconnecting' | 'closed';
export type RecState = 'off' | 'starting' | 'on' | 'paused';
export type EndReason = 'completed' | 'no-answer' | 'canceled' | 'failed' | 'voicemail' | 'transferred' | 'rejected';
export type MonitorMode = 'listen' | 'whisper' | 'barge';

// Laufendes Gespräch eines Kollegen, bei dem man mithört / einflüstert / sich aufschaltet
export interface MonitorTarget {
  callId: string;
  agentName: string | null;
  leadId: string | null;
  leadName: string | null;
  number: string | null;
}

// Übergabe mit Rücksprache: Kunde wartet, ich spreche erst mit dem Kollegen
export interface WarmTransfer {
  userId: string;
  name: string;
  state: 'calling' | 'talking' | 'failed';
}

export interface ActiveCall {
  id: string; // = calls.id in der Datenbank
  direction: 'outbound' | 'inbound';
  number: string;
  leadId: string | null;
  contactId: string | null;
  leadName: string | null;
  contactName: string | null;
  state: CallState;
  startedAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  muted: boolean;
  recording: RecState;
  warnings: string[];
  endReason: EndReason | null;
  error: string | null;
  dialerSession: string | null;
  transferFrom: string | null;
  hint: string | null; // nur Demo: was "am anderen Ende" passiert
  monitor: { callId: string; mode: MonitorMode; agentName: string | null } | null;
  transfer: WarmTransfer | null;
}

export interface IncomingCall {
  id: string;
  number: string;
  leadId: string | null;
  leadName: string | null;
  contactName: string | null;
  transferFrom: string | null;
  receivedAt: number;
}

export interface PhoneSnapshot {
  status: PhoneStatus;
  message: string | null;
  call: ActiveCall | null;
  incoming: IncomingCall | null;
  ended: ActiveCall | null; // zuletzt beendeter Anruf → Nachbearbeitung
}

export interface DialRequest {
  number: string;
  leadId?: string | null;
  contactId?: string | null;
  leadName?: string | null;
  contactName?: string | null;
  dialerSession?: string | null;
}

export interface PreflightReport {
  quality: string;
  rttMs: number | null;
  jitterMs: number | null;
  mos: number | null;
  edge: string | null;
  warnings: string[];
}

export interface Phone {
  readonly kind: 'demo' | 'twilio';
  getSnapshot(): PhoneSnapshot;
  subscribe(cb: () => void): () => void;
  start(): Promise<void>;
  stop(): void;
  dial(req: DialRequest): Promise<void>;
  hangup(): void;
  toggleMute(): void;
  sendDigits(digits: string): void;
  accept(): void;
  reject(): void;
  startRecording(): Promise<void>;
  pauseRecording(): Promise<void>;
  resumeRecording(): Promise<void>;
  dropVoicemail(dropId: string): Promise<void>;
  // Übergeben: „cold“ = sofort durchstellen, „warm“ = erst mit dem Kollegen sprechen (Kunde wartet)
  transfer(userId: string, mode?: 'cold' | 'warm'): Promise<void>;
  completeTransfer(): Promise<void>;
  cancelTransfer(): Promise<void>;
  // Coaching (braucht Konferenz-Modus): mithören, einflüstern, aufschalten
  monitor(target: MonitorTarget, mode: MonitorMode): Promise<void>;
  setMonitorMode(mode: MonitorMode): Promise<void>;
  clearEnded(): void;
  setDevices(inputId?: string | null, outputId?: string | null): Promise<void>;
  preflight(): Promise<PreflightReport>;
}

export const WARNING_TEXT: Record<string, string> = {
  'high-rtt': 'Hohe Verzögerung in der Leitung',
  'low-mos': 'Sprachqualität schlecht',
  'high-jitter': 'Verbindung schwankt',
  'high-packet-loss': 'Datenpakete gehen verloren',
  'high-packets-lost-fraction': 'Datenpakete gehen verloren',
  'low-bytes-received': 'Kein Ton vom Gesprächspartner',
  'low-bytes-sent': 'Dein Ton kommt nicht an',
  'ice-connectivity-lost': 'Verbindung unterbrochen',
  'constant-audio-input-level': 'Mikrofon liefert kein Signal',
  'constant-audio-output-level': 'Kein Ton am Lautsprecher',
};

// Basisklasse: verwaltet den Zustand und benachrichtigt die Oberfläche
export abstract class PhoneBase {
  protected snap: PhoneSnapshot = { status: 'off', message: null, call: null, incoming: null, ended: null };
  private subs = new Set<() => void>();

  getSnapshot(): PhoneSnapshot {
    return this.snap;
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  protected set(patch: Partial<PhoneSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.subs.forEach((cb) => cb());
  }

  protected patchCall(patch: Partial<ActiveCall>) {
    if (!this.snap.call) return;
    this.set({ call: { ...this.snap.call, ...patch } });
  }

  protected finishCall(reason: EndReason, error: string | null = null) {
    const call = this.snap.call;
    if (!call) return;
    const ended: ActiveCall = {
      ...call,
      state: 'closed',
      endedAt: Date.now(),
      endReason: call.endReason ?? reason,
      error: call.error ?? error,
      recording: call.recording === 'off' ? 'off' : 'on',
    };
    this.set({ call: null, ended });
  }

  clearEnded() {
    this.set({ ended: null });
  }
}

export function newCall(req: DialRequest, id: string, direction: 'outbound' | 'inbound' = 'outbound'): ActiveCall {
  return {
    id,
    direction,
    number: req.number,
    leadId: req.leadId ?? null,
    contactId: req.contactId ?? null,
    leadName: req.leadName ?? null,
    contactName: req.contactName ?? null,
    state: 'connecting',
    startedAt: Date.now(),
    answeredAt: null,
    endedAt: null,
    muted: false,
    recording: 'off',
    warnings: [],
    endReason: null,
    error: null,
    dialerSession: req.dialerSession ?? null,
    transferFrom: null,
    hint: null,
    monitor: null,
    transfer: null,
  };
}

export const MONITOR_LABEL: Record<MonitorMode, string> = {
  listen: 'Mithören',
  whisper: 'Einflüstern',
  barge: 'Aufschalten',
};

export const MONITOR_HINT: Record<MonitorMode, string> = {
  listen: 'Du hörst still mit. Niemand hört dich.',
  whisper: 'Nur dein Kollege hört dich – der Kunde nicht.',
  barge: 'Du bist im Gespräch. Kunde und Kollege hören dich.',
};

// DTMF-Töne lokal abspielen (Rückmeldung beim Tippen)
const DTMF: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
};
let toneCtx: AudioContext | null = null;
export function playDtmf(digit: string) {
  const f = DTMF[digit];
  if (!f) return;
  try {
    toneCtx ??= new AudioContext();
    const t = toneCtx.currentTime;
    const gain = toneCtx.createGain();
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    gain.connect(toneCtx.destination);
    for (const freq of f) {
      const o = toneCtx.createOscillator();
      o.frequency.value = freq;
      o.connect(gain);
      o.start(t);
      o.stop(t + 0.18);
    }
  } catch {
    /* ohne Ton weiter */
  }
}
