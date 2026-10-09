import {
  ArrowRightLeft,
  Building2,
  Check,
  Circle,
  Grid3x3,
  Headphones,
  Mic,
  MicOff,
  PauseCircle,
  PhoneForwarded,
  PhoneOff,
  PlayCircle,
  Undo2,
  Voicemail,
} from 'lucide-react';
import { useState } from 'react';
import { useApp, usePhone } from '../../app/context.tsx';
import { leadHref, navigate } from '../../app/router.ts';
import { formatDuration, formatPhone } from '../../lib/format.ts';
import { type ActiveCall, MONITOR_LABEL, type MonitorMode } from '../../lib/phone/types.ts';
import { cx, Dot, errMsg, MenuItem, Popover, Segmented, Tag, useMenu, useNow, useUi } from '../../ui/ui.tsx';

const STATE_TEXT: Record<ActiveCall['state'], string> = {
  connecting: 'Verbinde…',
  ringing: 'Klingelt…',
  open: 'Verbunden',
  reconnecting: 'Verbindung wird wiederhergestellt…',
  closed: 'Beendet',
};

export function Keypad({ onDigit }: { onDigit: (d: string) => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
  return (
    <div className="keypad">
      {keys.map((k) => (
        <button key={k} type="button" onClick={() => onDigit(k)}>
          {k}
        </button>
      ))}
    </div>
  );
}

export function CallBar() {
  const snap = usePhone();
  const { phone, ref, me, can } = useApp();
  const { toast, confirm } = useUi();
  const now = useNow(500);
  const keypad = useMenu();
  const vm = useMenu();
  const transfer = useMenu();
  const [digits, setDigits] = useState('');
  const call = snap.call;
  if (!call) return null;

  const mode = ref.org.recording_mode;
  const open = call.state === 'open';
  const since = call.answeredAt ?? call.startedAt;
  const elapsed = Math.round((now - since) / 1000);
  const drops = ref.voicemailDrops;
  const colleagues = ref.profiles.filter((p) => p.active && p.id !== me.id);
  // Übergabe mit Rücksprache braucht eine Konferenz – die gibt es bei ausgehenden Anrufen im Konferenzmodus
  const warmPossible = ref.org.conference_mode && call.direction === 'outbound';

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const startRec = async () => {
    try {
      if (!sessionStorage.getItem('rec-consent-hint')) {
        const ok = await confirm(
          'Hast du die Zustimmung deines Gesprächspartners? In Deutschland darf ein Gespräch nur mit Einwilligung aufgezeichnet werden.',
          { title: 'Aufnahme starten', confirmLabel: 'Ja, aufnehmen' },
        );
        if (!ok) return;
        sessionStorage.setItem('rec-consent-hint', '1');
      }
    } catch {
      /* sessionStorage nicht verfügbar */
    }
    await run(() => phone.startRecording());
  };

  if (call.monitor) {
    const m = call.monitor;
    const modes: { value: MonitorMode; label: string }[] = [
      { value: 'listen', label: MONITOR_LABEL.listen },
      { value: 'whisper', label: MONITOR_LABEL.whisper },
      ...(can('call_coach_barge') ? [{ value: 'barge' as const, label: MONITOR_LABEL.barge }] : []),
    ];
    return (
      <section className={cx('callbar monitor', call.state)} aria-label="Mithören">
        <span className="led" aria-hidden="true" />
        <span className="timer" aria-label="Dauer">{formatDuration(elapsed)}</span>
        <div className="who">
          <strong className="row gap-4"><Headphones size={16} aria-hidden="true" /> {MONITOR_LABEL[m.mode]} bei {m.agentName ?? 'Kollege'}</strong>
          <span className="small muted">
            {call.leadName || formatPhone(call.number)}
          </span>
          {call.hint ? <div className="small" style={{ color: 'var(--ink-2)' }}>{call.hint}</div> : null}
        </div>
        <div className="controls">
          <Segmented<MonitorMode>
            value={m.mode}
            options={modes}
            label="Coaching-Modus"
            onChange={(v) => run(() => phone.setMonitorMode(v))}
          />
          {m.mode !== 'listen' ? (
            <button type="button" className="ctrl" aria-pressed={call.muted} onClick={() => phone.toggleMute()}>
              {call.muted ? <MicOff /> : <Mic />}
              {call.muted ? 'Stumm' : 'Mikro'}
            </button>
          ) : null}
          <button type="button" className="ctrl hangup" onClick={() => phone.hangup()}>
            <PhoneOff />
            Beenden
          </button>
        </div>
      </section>
    );
  }

  if (call.transfer) {
    const t = call.transfer;
    return (
      <section className={cx('callbar transfer', call.state)} aria-label="Übergabe">
        <span className="led" aria-hidden="true" />
        <span className="timer" aria-label="Dauer">{formatDuration(elapsed)}</span>
        <div className="who">
          <strong className="row gap-4"><PhoneForwarded size={16} aria-hidden="true" /> Übergabe an {t.name}</strong>
          <span className="small muted">{call.leadName || formatPhone(call.number)} wartet</span>
          {call.hint ? <div className="small" style={{ color: 'var(--ink-2)' }}>{call.hint}</div> : null}
        </div>
        <div className="controls">
          <button type="button" className="ctrl" aria-pressed={call.muted} onClick={() => phone.toggleMute()}>
            {call.muted ? <MicOff /> : <Mic />}
            {call.muted ? 'Stumm' : 'Mikro'}
          </button>
          <button type="button" className="ctrl" onClick={() => run(() => phone.cancelTransfer())}>
            <Undo2 />
            Zurück zum Kunden
          </button>
          <button type="button" className="ctrl ok" onClick={() => run(async () => { await phone.completeTransfer(); toast(`An ${t.name} übergeben.`); })}>
            <Check />
            Übergabe abschließen
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={cx('callbar', call.state)} aria-label="Laufender Anruf">
      <span className="led" aria-hidden="true" />
      <span className="timer" aria-label="Dauer">
        {open ? formatDuration(elapsed) : formatDuration(Math.round((now - call.startedAt) / 1000))}
      </span>
      <div className="who">
        <strong>{call.leadName || formatPhone(call.number)}</strong>
        <span className="small muted">
          {STATE_TEXT[call.state]}
          {call.contactName ? `, ${call.contactName}` : ''}
          {call.leadName ? <>, <span className="nowrap">{formatPhone(call.number)}</span></> : ''}
          {call.transferFrom ? `, weitergeleitet von ${call.transferFrom}` : ''}
        </span>
        {call.hint ? <div className="small" style={{ color: 'var(--ink-2)' }}>{call.hint}</div> : null}
      </div>
      {call.warnings.length ? (
        <div className="warnings">
          {call.warnings.map((w) => (
            <Tag key={w} tone="amber">
              {w}
            </Tag>
          ))}
        </div>
      ) : null}
      {call.recording !== 'off' ? (
        <Tag tone="red">
          {call.recording === 'paused' ? 'Aufnahme pausiert' : (
            <span className="row gap-4">
              <span className="rec-dot" /> Aufnahme
            </span>
          )}
        </Tag>
      ) : null}
      <div className="controls">
        <button type="button" className="ctrl" aria-pressed={call.muted} onClick={() => phone.toggleMute()} disabled={!open}>
          {call.muted ? <MicOff /> : <Mic />}
          {call.muted ? 'Stumm' : 'Mikro'}
        </button>
        <button type="button" className="ctrl" onClick={keypad.open} disabled={call.state === 'connecting'}>
          <Grid3x3 />
          Tasten
        </button>
        {mode !== 'off' ? (
          call.recording === 'off' || call.recording === 'starting' ? (
            <button type="button" className="ctrl rec" onClick={startRec} disabled={!open || call.recording === 'starting'}>
              <Circle />
              Aufnehmen
            </button>
          ) : call.recording === 'paused' ? (
            <button type="button" className="ctrl rec" onClick={() => run(() => phone.resumeRecording())}>
              <PlayCircle />
              Weiter
            </button>
          ) : (
            <button type="button" className="ctrl rec" aria-pressed="true" onClick={() => run(() => phone.pauseRecording())}>
              <PauseCircle />
              Pause
            </button>
          )
        ) : null}
        {call.direction === 'outbound' ? (
          <button type="button" className="ctrl" onClick={vm.open} disabled={!open}>
            <Voicemail />
            Mailbox
          </button>
        ) : null}
        <button type="button" className="ctrl" onClick={transfer.open} disabled={!open || !colleagues.length}>
          <ArrowRightLeft />
          Weiterleiten
        </button>
        {call.leadId ? (
          <button type="button" className="ctrl" onClick={() => navigate(leadHref(call.leadId!))}>
            <Building2 />
            Lead
          </button>
        ) : null}
        <button type="button" className="ctrl hangup" onClick={() => phone.hangup()}>
          <PhoneOff />
          Auflegen
        </button>
      </div>

      {keypad.isOpen ? (
        <Popover anchor={keypad.anchor} onClose={keypad.close} align="end">
          <div style={{ padding: 8 }}>
            <div className="num" style={{ textAlign: 'center', minHeight: 24, fontWeight: 700, marginBottom: 8 }}>
              {digits || <span className="muted small">Tasten für Telefonmenüs</span>}
            </div>
            <Keypad
              onDigit={(d) => {
                setDigits((x) => (x + d).slice(-16));
                phone.sendDigits(d);
              }}
            />
          </div>
        </Popover>
      ) : null}

      {vm.isOpen ? (
        <Popover anchor={vm.anchor} onClose={vm.close} align="end">
          <div className="menu-label">Nach dem Piepton auswählen</div>
          {drops.length ? (
            drops.map((d) => (
              <MenuItem
                key={d.id}
                icon={<Voicemail />}
                onClick={() => {
                  vm.close();
                  run(async () => {
                    await phone.dropVoicemail(d.id);
                    toast(`„${d.name}“ wird abgespielt – du kannst schon weitermachen.`);
                  });
                }}
              >
                {d.name}
                {d.duration ? <span className="muted"> ({d.duration} s)</span> : null}
              </MenuItem>
            ))
          ) : (
            <MenuItem icon={<Voicemail />} onClick={() => { vm.close(); navigate('#/settings/voicemail'); }}>
              Noch keine Nachricht – jetzt aufnehmen
            </MenuItem>
          )}
        </Popover>
      ) : null}

      {transfer.isOpen ? (
        <Popover anchor={transfer.anchor} onClose={transfer.close} align="end">
          <div className="menu-label">Direkt durchstellen</div>
          {colleagues.map((p) => (
            <MenuItem
              key={p.id}
              icon={<ArrowRightLeft />}
              onClick={() => {
                transfer.close();
                run(async () => {
                  await phone.transfer(p.id, 'cold');
                  toast(`Wird an ${p.full_name} weitergeleitet.`);
                });
              }}
            >
              <span className="row gap-4"><Dot color={p.available ? 'var(--cross)' : 'var(--signal)'} /> {p.full_name || p.email}</span>
            </MenuItem>
          ))}
          {warmPossible ? (
            <>
              <div className="menu-label">Mit Rücksprache (Kunde wartet)</div>
              {colleagues.map((p) => (
                <MenuItem key={`w-${p.id}`} icon={<PhoneForwarded />} onClick={() => { transfer.close(); run(() => phone.transfer(p.id, 'warm')); }}>
                  {p.full_name || p.email}
                </MenuItem>
              ))}
            </>
          ) : (
            <div className="menu-note">
              Übergabe mit Rücksprache braucht den Konferenz-Modus (Einstellungen → Telefonie).
            </div>
          )}
        </Popover>
      ) : null}
    </section>
  );
}
