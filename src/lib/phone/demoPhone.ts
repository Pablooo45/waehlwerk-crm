// Simuliertes Telefon für den Demo-Modus – keine echten Anrufe.

import { normalizePhone } from '../format.ts';
import { uuid } from '../ids.ts';
import type { DemoStore } from '../store/demoStore.ts';
import {
  type DialRequest,
  MONITOR_HINT,
  type MonitorMode,
  type MonitorTarget,
  newCall,
  type Phone,
  PhoneBase,
  playDtmf,
  type PreflightReport,
} from './types.ts';

type Scenario = 'answer' | 'mailbox' | 'no-answer' | 'busy';

export class DemoPhone extends PhoneBase implements Phone {
  readonly kind = 'demo' as const;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private scenario: Scenario = 'answer';
  private incomingTimer: ReturnType<typeof setTimeout> | null = null;
  private dialCount = 0;
  private monitorAudio: HTMLAudioElement | null = null;

  constructor(private store: DemoStore, private userId: () => string | null) {
    super();
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(setTimeout(fn, ms));
  }

  private clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  async start() {
    this.set({ status: 'starting', message: null });
    await new Promise((r) => setTimeout(r, 250));
    this.set({ status: 'ready', message: 'Demo-Telefon (simuliert)' });
  }

  stop() {
    this.clearTimers();
    this.stopMonitorAudio();
    this.set({ status: 'off' });
  }

  async dial(req: DialRequest) {
    if (this.snap.call) throw new Error('Es läuft schon ein Anruf.');
    const number = normalizePhone(req.number);
    if (!number) throw new Error('Die Nummer ist ungültig.');
    const id = uuid();
    this.dialCount++;
    // Abwechslungsreiche, aber vorhersehbare Simulation
    const roll = (this.dialCount * 7919) % 100;
    this.scenario = roll < 50 ? 'answer' : roll < 70 ? 'no-answer' : roll < 88 ? 'mailbox' : 'busy';
    this.set({ call: { ...newCall({ ...req, number }, id), hint: 'Verbinde…' }, ended: null });
    this.store.demoUpsertCall({
      id,
      lead_id: req.leadId ?? null,
      contact_id: req.contactId ?? null,
      user_id: this.userId(),
      direction: 'outbound',
      to_number: number,
      status: 'initiated',
      started_at: new Date().toISOString(),
      dialer_session: req.dialerSession ?? null,
    });

    this.later(700, () => {
      this.patchCall({ state: 'ringing', hint: 'Es klingelt…' });
      this.store.demoUpsertCall({ id, status: 'ringing' });
    });
    const ringMs = 2200 + ((this.dialCount * 37) % 3) * 900;
    this.later(ringMs, () => {
      if (!this.snap.call || this.snap.call.id !== id) return;
      if (this.scenario === 'busy') {
        this.patchCall({ hint: 'Besetzt' });
        this.store.demoUpsertCall({ id, status: 'busy', ended_at: new Date().toISOString() });
        this.later(900, () => this.finishCall('no-answer'));
        return;
      }
      if (this.scenario === 'no-answer') {
        this.patchCall({ hint: 'Niemand nimmt ab…' });
        this.later(6000, () => {
          if (!this.snap.call || this.snap.call.id !== id || this.snap.call.state === 'open') return;
          this.store.demoUpsertCall({ id, status: 'no-answer', ended_at: new Date().toISOString() });
          this.finishCall('no-answer');
        });
        return;
      }
      const auto = this.store.db.org.recording_mode === 'auto' || this.store.db.org.recording_mode === 'auto_agent';
      this.patchCall({
        state: 'open',
        answeredAt: Date.now(),
        recording: auto ? 'on' : 'off',
        hint: this.scenario === 'mailbox'
          ? 'Mailbox-Ansage läuft – jetzt „Mailbox-Nachricht“ hinterlassen'
          : `${this.snap.call.contactName || 'Gesprächspartner'} ist dran (simuliert)`,
      });
      this.store.demoUpsertCall({ id, status: 'in-progress', answered_at: new Date().toISOString(), recording_status: auto ? 'recording' : 'none' });
    });
  }

  hangup() {
    const call = this.snap.call;
    if (!call) return;
    this.clearTimers();
    if (call.monitor) {
      // Mithören beenden – keine Nachbearbeitung
      this.stopMonitorAudio();
      this.set({ call: null });
      return;
    }
    const now = Date.now();
    const answered = call.state === 'open';
    const duration = answered && call.answeredAt ? Math.round((now - call.answeredAt) / 1000) : 0;
    const recorded = call.recording !== 'off';
    this.store.demoUpsertCall({
      id: call.id,
      status: answered ? 'completed' : 'canceled',
      duration,
      ended_at: new Date(now).toISOString(),
      recording_status: recorded ? 'processing' : 'none',
    });
    if (recorded) {
      setTimeout(() => {
        this.store.demoUpsertCall({
          id: call.id,
          recording_status: 'ready',
          recording_path: `demo/live/${call.id}.wav`,
          recording_duration: Math.max(duration, 8),
        });
      }, 1500);
    }
    this.finishCall(answered ? 'completed' : 'canceled');
  }

  toggleMute() {
    if (!this.snap.call || this.snap.call.monitor?.mode === 'listen') return;
    this.patchCall({ muted: !this.snap.call.muted });
  }

  sendDigits(digits: string) {
    for (const d of digits) playDtmf(d);
  }

  accept() {
    const inc = this.snap.incoming;
    if (!inc) return;
    if (this.incomingTimer) clearTimeout(this.incomingTimer);
    const call = newCall(
      { number: inc.number, leadId: inc.leadId, leadName: inc.leadName, contactName: inc.contactName },
      inc.id,
      'inbound',
    );
    call.state = 'open';
    call.answeredAt = Date.now();
    call.hint = `${inc.contactName || 'Anrufer'} ist dran (simuliert)`;
    this.set({ incoming: null, call, ended: null });
    this.store.demoUpsertCall({ id: inc.id, status: 'in-progress', user_id: this.userId(), answered_at: new Date().toISOString() });
  }

  reject() {
    const inc = this.snap.incoming;
    if (!inc) return;
    if (this.incomingTimer) clearTimeout(this.incomingTimer);
    this.set({ incoming: null });
    this.missed(inc.id, inc.leadId, inc.leadName ?? inc.number);
  }

  private missed(callId: string, leadId: string | null, who: string) {
    this.store.demoUpsertCall({ id: callId, status: 'no-answer', ended_at: new Date().toISOString() });
    this.store.saveTask({
      title: `Verpasster Anruf von ${who}`,
      type: 'missed_call',
      lead_id: leadId,
      call_id: callId,
      assigned_to: this.userId(),
      due_at: new Date().toISOString(),
    });
  }

  // Eingehenden Anruf simulieren (Knopf im Demo-Menü)
  simulateIncoming() {
    if (this.snap.call || this.snap.incoming) return;
    const pick = this.store.randomLeadForInbound();
    const number = pick?.contact.phones[0]?.number ?? '+4961815550199';
    const id = uuid();
    this.store.demoUpsertCall({
      id,
      direction: 'inbound',
      status: 'ringing',
      from_number: number,
      to_number: this.store.db.org.default_caller_id,
      lead_id: pick?.lead.id ?? null,
      contact_id: pick?.contact.id ?? null,
      user_id: null,
    });
    this.set({
      incoming: {
        id,
        number,
        leadId: pick?.lead.id ?? null,
        leadName: pick?.lead.name ?? null,
        contactName: pick?.contact.name ?? null,
        transferFrom: null,
        receivedAt: Date.now(),
      },
    });
    this.incomingTimer = setTimeout(() => {
      if (this.snap.incoming?.id !== id) return;
      this.set({ incoming: null });
      this.missed(id, pick?.lead.id ?? null, pick?.lead.name ?? number);
    }, 25_000);
  }

  async startRecording() {
    if (!this.snap.call || this.snap.call.state !== 'open') throw new Error('Aufnahme geht erst, wenn jemand abgenommen hat.');
    if (this.store.db.org.recording_mode === 'off') throw new Error('Aufnahmen sind in den Einstellungen ausgeschaltet.');
    this.patchCall({ recording: 'starting' });
    await new Promise((r) => setTimeout(r, 400));
    this.patchCall({ recording: 'on' });
    this.store.demoUpsertCall({ id: this.snap.call!.id, recording_status: 'recording' });
  }

  async pauseRecording() {
    this.patchCall({ recording: 'paused' });
  }

  async resumeRecording() {
    this.patchCall({ recording: 'on' });
  }

  async dropVoicemail(dropId: string) {
    const call = this.snap.call;
    if (!call) return;
    this.clearTimers();
    this.store.demoUpsertCall({
      id: call.id,
      status: 'completed',
      outcome: this.store.db.org.voicemail_drop_outcome ?? null,
      voicemail_drop_id: dropId,
      duration: call.answeredAt ? Math.round((Date.now() - call.answeredAt) / 1000) : 0,
      ended_at: new Date().toISOString(),
    });
    this.patchCall({ endReason: 'voicemail' });
    this.finishCall('voicemail');
  }

  async transfer(userId: string, mode: 'cold' | 'warm' = 'cold') {
    const call = this.snap.call;
    if (!call) return;
    const target = this.store.db.profiles.find((p) => p.id === userId);
    const name = target?.full_name ?? 'Kollege';
    if (mode === 'warm') {
      this.patchCall({ transfer: { userId, name, state: 'calling' }, hint: `Kunde hört Wartemusik. Es klingelt bei ${name}…` });
      this.later(1800, () => {
        if (this.snap.call?.id !== call.id || !this.snap.call.transfer) return;
        this.patchCall({ transfer: { userId, name, state: 'talking' }, hint: `${name} ist dran (simuliert). Kurz briefen, dann „Übergabe abschließen“.` });
      });
      return;
    }
    this.clearTimers();
    this.store.demoUpsertCall({
      id: call.id,
      status: 'completed',
      transferred_to: userId,
      note: `Weitergeleitet an ${name}`,
      ended_at: new Date().toISOString(),
    });
    this.patchCall({ endReason: 'transferred' });
    this.finishCall('transferred');
  }

  async completeTransfer() {
    const call = this.snap.call;
    if (!call?.transfer) return;
    this.clearTimers();
    this.store.demoUpsertCall({
      id: call.id,
      status: 'completed',
      transferred_to: call.transfer.userId,
      duration: call.answeredAt ? Math.round((Date.now() - call.answeredAt) / 1000) : 0,
      note: `Übergeben an ${call.transfer.name} (mit Rücksprache)`,
      ended_at: new Date().toISOString(),
    });
    this.patchCall({ endReason: 'transferred' });
    this.finishCall('transferred');
  }

  async cancelTransfer() {
    if (!this.snap.call?.transfer) return;
    this.clearTimers();
    this.patchCall({ transfer: null, hint: 'Du bist wieder beim Kunden.' });
  }

  // ---------- Coaching (Demo: spielt ein Beispielgespräch ab) ----------
  async monitor(target: MonitorTarget, mode: MonitorMode) {
    if (this.snap.call) throw new Error('Du bist gerade selbst im Gespräch.');
    const call = newCall({ number: target.number ?? '', leadId: target.leadId, leadName: target.leadName }, uuid());
    call.state = 'open';
    call.answeredAt = Date.now();
    call.muted = mode === 'listen';
    call.monitor = { callId: target.callId, mode, agentName: target.agentName };
    call.hint = `${MONITOR_HINT[mode]} (Demo: Beispielgespräch)`;
    this.set({ call, ended: null });
    try {
      const { url, offset } = await this.store.demoLiveAudio(target.callId);
      if (this.currentCallId() !== call.id) return;
      const audio = new Audio(url);
      audio.addEventListener('loadedmetadata', () => {
        audio.currentTime = Math.min(offset, Math.max(0, audio.duration - 5));
      });
      audio.addEventListener('ended', () => {
        if (this.currentCallId() === call.id) this.patchCall({ hint: 'Gespräch beendet (Demo).' });
      });
      this.monitorAudio = audio;
      await audio.play().catch(() => undefined);
    } catch {
      /* ohne Ton weiter */
    }
  }

  async setMonitorMode(mode: MonitorMode) {
    const call = this.snap.call;
    if (!call?.monitor) return;
    this.patchCall({ monitor: { ...call.monitor, mode }, muted: mode === 'listen', hint: `${MONITOR_HINT[mode]} (Demo: Beispielgespräch)` });
  }

  private currentCallId(): string | null {
    return this.snap.call?.id ?? null;
  }

  private stopMonitorAudio() {
    if (!this.monitorAudio) return;
    this.monitorAudio.pause();
    this.monitorAudio.removeAttribute('src');
    this.monitorAudio = null;
  }

  async setDevices() {
    /* Demo: nichts zu tun */
  }

  async preflight(): Promise<PreflightReport> {
    await new Promise((r) => setTimeout(r, 1200));
    return { quality: 'excellent', rttMs: 28, jitterMs: 2.1, mos: 4.4, edge: 'frankfurt (simuliert)', warnings: [] };
  }
}
