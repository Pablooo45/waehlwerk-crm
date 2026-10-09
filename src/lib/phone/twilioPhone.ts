// Echtes Browser-Telefon über Twilio (Voice JavaScript SDK).
// Edge Frankfurt (Fallback Dublin), Opus-Codec, Wiederverbinden bei kurzen Netzaussetzern.

import { Call, Device, type PreflightTest } from '@twilio/voice-sdk';

interface TwilioError {
  code: number;
  message: string;
  name?: string;
}
import { normalizePhone } from '../format.ts';
import { uuid } from '../ids.ts';
import type { Store } from '../store/types.ts';
import type { CallQuality } from '../types.ts';
import {
  type ActiveCall,
  type DialRequest,
  MONITOR_HINT,
  type MonitorMode,
  type MonitorTarget,
  newCall,
  type Phone,
  PhoneBase,
  playDtmf,
  type PreflightReport,
  WARNING_TEXT,
} from './types.ts';

interface RtcSample {
  mos?: number | null;
  rtt?: number;
  jitter?: number;
  packetsLostFraction?: number;
  codecName?: string;
}

// Sammelt die Leitungsqualität eines Anrufs (Twilio liefert jede Sekunde eine Messung)
class QualityMeter {
  private n = 0;
  private mos = 0;
  private mosN = 0;
  private rtt = 0;
  private jitter = 0;
  private loss = 0;
  private minMos = 5;
  codec: string | null = null;
  warnings = new Set<string>();

  add(s: RtcSample) {
    this.n++;
    if (typeof s.mos === 'number' && s.mos > 0) {
      this.mos += s.mos;
      this.mosN++;
      this.minMos = Math.min(this.minMos, s.mos);
    }
    this.rtt += s.rtt ?? 0;
    this.jitter += s.jitter ?? 0;
    this.loss += s.packetsLostFraction ?? 0;
    if (s.codecName) this.codec = s.codecName;
  }

  result(edge: string | null): CallQuality | null {
    if (!this.n) return null;
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      mos: this.mosN ? r1(this.mos / this.mosN) : null,
      rtt: Math.round(this.rtt / this.n),
      jitter: r1(this.jitter / this.n),
      packetLoss: r1(this.loss / this.n),
      codec: this.codec,
      edge,
      warnings: [...this.warnings],
    };
  }
}

interface TokenResponse {
  token: string;
  identity: string;
  ttl: number;
  edge: string[];
  callerId: string | null;
  recordingMode: string;
}

function errorText(e: unknown): string {
  const err = e as Partial<TwilioError> & { code?: number; message?: string; name?: string };
  const code = err?.code ?? 0;
  if ([31208, 31401, 31402].includes(code) || err?.name === 'NotAllowedError') {
    return 'Mikrofon blockiert. Bitte im Browser erlauben (Schloss-Symbol neben der Adresse) und neu laden.';
  }
  if ([20101, 20104, 31204, 31205].includes(code)) return 'Zugang abgelaufen – wird erneuert. Bitte gleich nochmal versuchen.';
  if ([31005, 31009, 53000, 31003].includes(code)) return 'Verbindung zu Twilio gestört. Internet prüfen.';
  if (code === 31486) return 'Besetzt.';
  if (code === 31480) return 'Gerade nicht erreichbar.';
  if (code === 13227 || code === 21215) return 'Diese Nummer/Land ist bei Twilio nicht freigeschaltet (Geo Permissions).';
  return err?.message ? `${err.message}${code ? ` (Code ${code})` : ''}` : 'Unbekannter Telefonie-Fehler.';
}

export class TwilioPhone extends PhoneBase implements Phone {
  readonly kind = 'twilio' as const;
  private device: Device | null = null;
  private twCall: Call | null = null;
  private pending: Call | null = null;
  private edge: string[] = ['frankfurt', 'dublin'];
  private recordingMode = 'manual';
  private refreshing = false;

  constructor(private store: Store, private onError: (msg: string, details?: Record<string, unknown>) => void) {
    super();
  }

  private async fetchToken(): Promise<TokenResponse> {
    return this.store.invoke<TokenResponse>('twilio-token');
  }

  async start() {
    if (this.device) return;
    this.set({ status: 'starting', message: 'Telefon wird verbunden…' });
    let t: TokenResponse;
    try {
      t = await this.fetchToken();
    } catch (e) {
      const status = (e as { status?: number }).status;
      this.set({
        status: status === 409 ? 'unconfigured' : 'error',
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    this.edge = t.edge?.length ? t.edge : this.edge;
    this.recordingMode = t.recordingMode;
    const device = new Device(t.token, {
      edge: this.edge,
      codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
      closeProtection: 'Es läuft gerade ein Anruf. Seite wirklich verlassen?',
      allowIncomingWhileBusy: false,
      enableImprovedSignalingErrorPrecision: true,
      maxCallSignalingTimeoutMs: 30000,
      logLevel: 'warn',
      appName: 'waehlwerk-crm',
      appVersion: __APP_VERSION__,
    });
    device.audio?.outgoing(false);
    this.device = device;

    device.on('registered', () => this.set({ status: 'ready', message: null }));
    device.on('unregistered', () => {
      if (this.snap.status === 'ready') this.set({ status: 'offline', message: 'Telefon getrennt – verbinde neu…' });
    });
    device.on('error', (err: TwilioError) => {
      const msg = errorText(err);
      if ([20101, 20104, 31204, 31205].includes(err.code)) {
        this.refreshToken();
        return;
      }
      this.onError(`Telefon: ${msg}`, { code: err.code, message: err.message });
      if (!this.snap.call) this.set({ status: 'error', message: msg });
    });
    device.on('tokenWillExpire', () => this.refreshToken());
    device.on('incoming', (call: Call) => this.onIncoming(call));

    try {
      await device.register();
    } catch (e) {
      this.set({ status: 'error', message: errorText(e) });
    }
    window.addEventListener('online', this.onOnline);
  }

  private onOnline = () => {
    if (this.device && this.device.state !== Device.State.Registered) {
      this.device.register().catch(() => undefined);
    }
  };

  private async refreshToken() {
    if (this.refreshing || !this.device) return;
    this.refreshing = true;
    try {
      const t = await this.fetchToken();
      this.device.updateToken(t.token);
      if (this.device.state !== Device.State.Registered) await this.device.register();
    } catch (e) {
      this.onError('Telefon-Zugang konnte nicht erneuert werden', { error: String(e) });
    } finally {
      this.refreshing = false;
    }
  }

  stop() {
    window.removeEventListener('online', this.onOnline);
    try {
      this.device?.destroy();
    } catch {
      /* egal */
    }
    this.device = null;
    this.set({ status: 'off', call: null, incoming: null });
  }

  private wire(call: Call, id: string, monitor = false) {
    this.twCall = call;
    const meter = monitor ? null : new QualityMeter();
    if (meter) call.on('sample', (sample: RtcSample) => meter.add(sample));
    call.on('ringing', () => this.patchCall({ state: 'ringing' }));
    call.on('accept', () => {
      const auto = this.recordingMode === 'auto' || this.recordingMode === 'auto_agent';
      this.patchCall({ state: 'open', answeredAt: Date.now(), recording: auto ? 'on' : 'off' });
    });
    call.on('reconnecting', () => this.patchCall({ state: 'reconnecting' }));
    call.on('reconnected', () => this.patchCall({ state: 'open' }));
    call.on('mute', (muted: boolean) => this.patchCall({ muted }));
    call.on('warning', (name: string) => {
      meter?.warnings.add(name);
      const text = WARNING_TEXT[name];
      if (text && this.snap.call && !this.snap.call.warnings.includes(text)) {
        this.patchCall({ warnings: [...this.snap.call.warnings, text] });
      }
    });
    call.on('warning-cleared', (name: string) => {
      const text = WARNING_TEXT[name];
      if (this.snap.call) this.patchCall({ warnings: this.snap.call.warnings.filter((w) => w !== text) });
    });
    const end = (reason: 'completed' | 'no-answer' | 'canceled' | 'failed') => {
      if (this.twCall !== call) return;
      this.twCall = null;
      if (monitor) {
        this.set({ call: null });
        return;
      }
      const q = meter?.result(this.device?.edge ?? null);
      if (q) this.store.saveCallQuality(id, q).catch(() => undefined);
      const wasOpen = this.snap.call?.state === 'open' || this.snap.call?.state === 'reconnecting';
      this.finishCall(wasOpen ? 'completed' : reason);
    };
    call.on('disconnect', () => end('no-answer'));
    call.on('cancel', () => end('canceled'));
    call.on('reject', () => end('canceled'));
    call.on('error', (err: TwilioError) => {
      const msg = errorText(err);
      this.patchCall({ error: msg });
      this.onError(`Anruf: ${msg}`, { code: err.code, callId: id });
    });
  }

  async dial(req: DialRequest) {
    if (!this.device) throw new Error('Telefon ist nicht verbunden.');
    if (this.snap.call) throw new Error('Es läuft schon ein Anruf.');
    const number = normalizePhone(req.number);
    if (!number) throw new Error('Die Nummer ist ungültig.');
    const id = uuid();
    this.set({ call: newCall({ ...req, number }, id), ended: null });
    try {
      const params: Record<string, string> = { To: number, callId: id };
      if (req.leadId) params.leadId = req.leadId;
      if (req.contactId) params.contactId = req.contactId;
      if (req.dialerSession) params.dialerSession = req.dialerSession;
      const call = await this.device.connect({ params });
      this.wire(call, id);
    } catch (e) {
      const msg = errorText(e);
      this.patchCall({ error: msg });
      this.finishCall('failed', msg);
      throw new Error(msg);
    }
  }

  hangup() {
    if (this.twCall) this.twCall.disconnect();
    else if (this.snap.call) this.finishCall('canceled');
  }

  toggleMute() {
    if (!this.twCall || !this.snap.call || this.snap.call.monitor?.mode === 'listen') return;
    this.twCall.mute(!this.snap.call.muted);
  }

  sendDigits(digits: string) {
    this.twCall?.sendDigits(digits);
    for (const d of digits) playDtmf(d);
  }

  private onIncoming(call: Call) {
    if (this.snap.call || this.snap.incoming) {
      call.reject();
      return;
    }
    const p = call.customParameters;
    const id = p.get('callId') ?? uuid();
    this.pending = call;
    this.set({
      incoming: {
        id,
        number: p.get('fromNumber') || call.parameters.From || 'unbekannt',
        leadId: p.get('leadId') || null,
        leadName: p.get('leadName') || null,
        contactName: p.get('contactName') || null,
        transferFrom: p.get('transferFrom') || null,
        receivedAt: Date.now(),
      },
    });
    const clear = () => {
      if (this.pending === call) {
        this.pending = null;
        this.set({ incoming: null });
      }
    };
    call.on('cancel', clear);
    call.on('disconnect', clear);
    call.on('reject', clear);
  }

  accept() {
    const call = this.pending;
    const inc = this.snap.incoming;
    if (!call || !inc) return;
    this.pending = null;
    const active: ActiveCall = newCall(
      { number: inc.number, leadId: inc.leadId, leadName: inc.leadName, contactName: inc.contactName },
      inc.id,
      'inbound',
    );
    active.transferFrom = inc.transferFrom;
    this.set({ incoming: null, call: active, ended: null });
    this.wire(call, inc.id);
    call.accept();
  }

  reject() {
    this.pending?.reject();
    this.pending = null;
    this.set({ incoming: null });
  }

  private async control(action: string, extra: Record<string, unknown> = {}) {
    const call = this.snap.call;
    if (!call) throw new Error('Kein laufender Anruf.');
    return this.store.invoke('call-control', { action, callId: call.id, ...extra });
  }

  async startRecording() {
    if (!this.snap.call || this.snap.call.state !== 'open') throw new Error('Aufnahme geht erst, wenn jemand abgenommen hat.');
    this.patchCall({ recording: 'starting' });
    try {
      await this.control('record_start');
      this.patchCall({ recording: 'on' });
    } catch (e) {
      this.patchCall({ recording: 'off' });
      throw e;
    }
  }

  async pauseRecording() {
    await this.control('record_pause');
    this.patchCall({ recording: 'paused' });
  }

  async resumeRecording() {
    await this.control('record_resume');
    this.patchCall({ recording: 'on' });
  }

  async dropVoicemail(dropId: string) {
    await this.control('voicemail_drop', { dropId });
    this.patchCall({ endReason: 'voicemail' });
  }

  async transfer(userId: string, mode: 'cold' | 'warm' = 'cold') {
    const call = this.snap.call;
    if (!call) return;
    if (mode === 'warm') {
      const res = await this.control('transfer', { targetUserId: userId, mode: 'warm' }) as { name?: string };
      this.patchCall({
        transfer: { userId, name: res?.name ?? 'Kollege', state: 'calling' },
        hint: `Kunde hört Wartemusik. Es klingelt bei ${res?.name ?? 'deinem Kollegen'} – sobald abgenommen wird, hörst du ihn.`,
      });
      return;
    }
    await this.control('transfer', { targetUserId: userId, mode: 'cold' });
    this.patchCall({ endReason: 'transferred' });
  }

  async completeTransfer() {
    if (!this.snap.call?.transfer) return;
    await this.control('transfer_complete');
    this.patchCall({ endReason: 'transferred' });
    // Der Server nimmt uns aus der Konferenz; zur Sicherheit auch lokal auflegen
    setTimeout(() => this.twCall?.disconnect(), 1500);
  }

  async cancelTransfer() {
    if (!this.snap.call?.transfer) return;
    await this.control('transfer_cancel');
    this.patchCall({ transfer: null, hint: 'Du bist wieder beim Kunden.' });
  }

  async monitor(target: MonitorTarget, mode: MonitorMode) {
    if (!this.device) throw new Error('Telefon ist nicht verbunden.');
    if (this.snap.call) throw new Error('Du bist gerade selbst im Gespräch.');
    const id = uuid();
    const active = newCall({ number: target.number ?? '', leadId: target.leadId, leadName: target.leadName }, id);
    active.monitor = { callId: target.callId, mode, agentName: target.agentName };
    active.hint = MONITOR_HINT[mode];
    this.set({ call: active, ended: null });
    try {
      const call = await this.device.connect({ params: { monitorCallId: target.callId, mode, callId: id } });
      this.wire(call, id, true);
    } catch (e) {
      this.set({ call: null });
      throw new Error(errorText(e));
    }
  }

  async setMonitorMode(mode: MonitorMode) {
    const call = this.snap.call;
    if (!call?.monitor) return;
    await this.store.invoke('call-control', { action: 'monitor_mode', callId: call.monitor.callId, mode });
    this.patchCall({ monitor: { ...call.monitor, mode }, hint: MONITOR_HINT[mode] });
  }

  async setDevices(inputId?: string | null, outputId?: string | null) {
    const audio = this.device?.audio;
    if (!audio) return;
    if (inputId) await audio.setInputDevice(inputId).catch(() => undefined);
    if (outputId && audio.isOutputSelectionSupported) {
      await audio.speakerDevices.set(outputId).catch(() => undefined);
      await audio.ringtoneDevices.set(outputId).catch(() => undefined);
    }
  }

  async preflight(): Promise<PreflightReport> {
    const t = await this.fetchToken();
    return new Promise((resolve, reject) => {
      const test = Device.runPreflight(t.token, { edge: this.edge[0], codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU] });
      test.on('completed', (report: PreflightTest.Report) => {
        resolve({
          quality: report.callQuality ?? 'unbekannt',
          rttMs: report.stats?.rtt?.average ?? null,
          jitterMs: report.stats?.jitter?.average ?? null,
          mos: report.stats?.mos?.average ?? null,
          edge: report.selectedEdge ?? report.edge ?? null,
          warnings: (report.warnings ?? []).map((w) => w.description || w.name),
        });
      });
      test.on('failed', (err: unknown) => reject(new Error(errorText(err))));
    });
  }
}
