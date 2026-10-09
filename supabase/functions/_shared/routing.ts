// Eingehende Anrufe verteilen – reine Entscheidungslogik (ohne Twilio, ohne Datenbank), damit sie testbar ist.
//
// Reihenfolge wie in Close / gängigen Telefonanlagen:
//  1. Außerhalb der Rufzeiten → Mailbox, Weiterleitung oder trotzdem klingeln
//  2. Nummer „immer weiterleiten“ → direkt zur Weiterleitungsnummer
//  3. Telefonmenü (falls eingerichtet) → Auswahl per Taste
//  4. Bekannter Anrufer → zuerst beim zuständigen Kollegen klingeln (wenn er online ist)
//  5. Gruppe/Personen der Nummer: alle gleichzeitig oder reihum
//  6. Niemand nimmt ab → Weiterleitung (wenn eingestellt) oder Mailbox
//
// Wer „nicht erreichbar“ geschaltet hat oder gerade telefoniert, wird übersprungen.
// Wer online ist (CRM offen, Lebenszeichen der letzten Minuten), klingelt bevorzugt.

import type { IvrMenu, PhoneNumberRow, Profile } from './db.ts';

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export const ONLINE_WINDOW_MS = 5 * 60_000;
export const MAX_PARALLEL = 10;

// Wochentag und Uhrzeit in Deutschland (Sommer-/Winterzeit automatisch)
export function berlinClock(now: Date): { day: (typeof DAY_KEYS)[number]; hm: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const wd = (parts.find((p) => p.type === 'weekday')?.value ?? 'Mon').toLowerCase().slice(0, 3);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const day = (DAY_KEYS as readonly string[]).includes(wd) ? (wd as (typeof DAY_KEYS)[number]) : 'mon';
  return { day, hm: `${h === '24' ? '00' : h}:${m}` };
}

export function isOpen(hours: PhoneNumberRow['business_hours'], now: Date): boolean {
  if (!hours) return true;
  const { day, hm } = berlinClock(now);
  const slots = hours[day] ?? [];
  return slots.some(([from, to]) => hm >= from && hm < to);
}

export interface RingTarget {
  userId: string;
  via: 'client' | 'number';
  number?: string;
}

export type Stage = 'owner' | 'pool' | `rr:${number}` | 'fallback';

export type Decision =
  | { kind: 'ring'; stage: Stage; targets: RingTarget[]; timeout: number }
  | { kind: 'forward'; number: string; reason: string }
  | { kind: 'voicemail'; reason: string }
  | { kind: 'ivr'; menu: IvrMenu };

export interface RouteInput {
  number: PhoneNumberRow | null;
  members: Profile[]; // aktive Teammitglieder
  groups: Record<string, string[]>; // Gruppe → Mitglieder
  busy: Set<string>;
  ownerId: string | null; // zuständig für den Anrufer (falls bekannt)
  ownerRung?: boolean; // wurde beim Zuständigen schon geklingelt?
  rrStart: number; // Zeiger für „reihum“
  defaultTimeout: number;
  now: Date;
}

// Wer kommt grundsätzlich infrage (ohne Erreichbarkeit)?
export function poolOf(input: Pick<RouteInput, 'number' | 'members' | 'groups'>): Profile[] {
  const n = input.number;
  const ids = new Set<string>();
  if (n?.members?.length) n.members.forEach((m) => ids.add(m));
  if (n?.group_id) (input.groups[n.group_id] ?? []).forEach((m) => ids.add(m));
  const list = ids.size ? input.members.filter((m) => ids.has(m.id)) : input.members;
  return list.filter((m) => m.active);
}

function reachable(p: Profile, busy: Set<string>): boolean {
  return p.active && p.available && !busy.has(p.id);
}

function forwardsAlways(p: Profile): boolean {
  return p.forward_mode === 'always' && !!p.forward_number;
}

export function isOnline(p: Profile, now: Date): boolean {
  if (forwardsAlways(p)) return true; // klingelt auf dem Handy
  if (!p.last_seen_at) return false;
  return now.getTime() - Date.parse(p.last_seen_at) < ONLINE_WINDOW_MS;
}

function targetOf(p: Profile): RingTarget {
  if (forwardsAlways(p)) return { userId: p.id, via: 'number', number: p.forward_number! };
  return { userId: p.id, via: 'client' };
}

function afterNoAnswer(n: PhoneNumberRow | null, single: Profile | null): Decision {
  if (single && single.forward_mode === 'no_answer' && single.forward_number) {
    return { kind: 'forward', number: single.forward_number, reason: `Weiterleitung von ${single.full_name || 'Kollege'}` };
  }
  if (n?.forward_to && (n.forward_mode === 'no_answer' || n.forward_mode === 'always')) {
    return { kind: 'forward', number: n.forward_to, reason: 'Niemand hat abgenommen' };
  }
  return { kind: 'voicemail', reason: 'Niemand hat abgenommen' };
}

function timeoutOf(input: RouteInput): number {
  return Math.max(5, Math.min(120, input.number?.ring_timeout || input.defaultTimeout || 25));
}

// Erster Schritt bei einem neuen Anruf
export function firstDecision(input: RouteInput, ivrDone = false): Decision {
  const n = input.number;
  const open = isOpen(n?.business_hours ?? null, input.now);
  if (n && !open) {
    if (n.outside_hours_action === 'forward' && n.forward_to) return { kind: 'forward', number: n.forward_to, reason: 'Außerhalb der Rufzeiten' };
    if (n.outside_hours_action !== 'ring') return { kind: 'voicemail', reason: 'Außerhalb der Rufzeiten' };
  }
  if (n?.forward_to && n.forward_mode === 'always') return { kind: 'forward', number: n.forward_to, reason: 'Nummer wird immer weitergeleitet' };
  if (n?.forward_to && n.forward_mode === 'outside_hours' && !open) return { kind: 'forward', number: n.forward_to, reason: 'Außerhalb der Rufzeiten' };
  if (n?.ivr && n.ivr.options?.length && !ivrDone) return { kind: 'ivr', menu: n.ivr };
  return ringDecision(input, n?.route_to_owner !== false && input.ownerId ? 'owner' : 'pool');
}

// Klingeln in einer bestimmten Stufe; liefert die nächste sinnvolle Entscheidung
export function ringDecision(input: RouteInput, stage: Stage): Decision {
  const n = input.number;
  const timeout = timeoutOf(input);

  if (stage === 'owner') {
    const owner = input.members.find((m) => m.id === input.ownerId);
    if (owner && reachable(owner, input.busy) && isOnline(owner, input.now)) {
      // Zuständiger zuerst – etwas kürzer, damit der Anrufer nicht lange wartet
      return { kind: 'ring', stage: 'owner', targets: [targetOf(owner)], timeout: Math.min(timeout, 18) };
    }
    return ringDecision({ ...input, ownerRung: false }, 'pool');
  }

  const exclude = input.ownerRung && input.ownerId ? input.ownerId : null;
  const free = poolOf(input).filter((p) => reachable(p, input.busy) && p.id !== exclude);
  // Wer online ist, klingelt; ist laut Lebenszeichen niemand online, trotzdem alle versuchen
  const online = free.filter((p) => isOnline(p, input.now));
  const list = online.length ? online : free;

  if (stage === 'pool') {
    if (!list.length) return afterNoAnswer(n, exclude ? input.members.find((m) => m.id === exclude) ?? null : null);
    if (n?.ring_mode === 'round_robin' && list.length > 1) return ringDecision(input, 'rr:0');
    return { kind: 'ring', stage: 'pool', targets: list.slice(0, MAX_PARALLEL).map(targetOf), timeout };
  }

  if (stage.startsWith('rr:')) {
    const step = Number(stage.slice(3)) || 0;
    if (step >= list.length) return afterNoAnswer(n, null);
    const ordered = [...list].sort((a, b) => a.id.localeCompare(b.id));
    const pick = ordered[(input.rrStart + step) % ordered.length];
    return { kind: 'ring', stage: `rr:${step}`, targets: [targetOf(pick)], timeout: Math.min(timeout, 20) };
  }

  return afterNoAnswer(n, null);
}

// Nach erfolglosem Klingeln: nächste Stufe bestimmen
export function nextAfter(input: RouteInput, stage: Stage, lastTargets: string[]): Decision {
  if (stage === 'owner') {
    const owner = input.members.find((m) => m.id === input.ownerId) ?? null;
    const rest = ringDecision({ ...input, ownerRung: true }, 'pool');
    if (rest.kind !== 'ring' || rest.targets.every((t) => lastTargets.includes(t.userId))) return afterNoAnswer(input.number, owner);
    return rest;
  }
  if (stage.startsWith('rr:')) return ringDecision(input, `rr:${(Number(stage.slice(3)) || 0) + 1}`);
  const single = lastTargets.length === 1 ? input.members.find((m) => m.id === lastTargets[0]) ?? null : null;
  return afterNoAnswer(input.number, single);
}

// Telefonmenü: Taste → Entscheidung
export function ivrChoice(input: RouteInput, digit: string): Decision {
  const menu = input.number?.ivr;
  const opt = menu?.options.find((o) => o.digit === digit);
  if (!opt) {
    if (menu?.timeout_action === 'voicemail') return { kind: 'voicemail', reason: 'Keine Auswahl im Telefonmenü' };
    return firstDecision(input, true);
  }
  switch (opt.action) {
    case 'voicemail':
      return { kind: 'voicemail', reason: `Telefonmenü: ${opt.label}` };
    case 'forward':
      return opt.target ? { kind: 'forward', number: opt.target, reason: `Telefonmenü: ${opt.label}` } : { kind: 'voicemail', reason: 'Weiterleitung fehlt' };
    case 'user': {
      const p = input.members.find((m) => m.id === opt.target);
      if (!p || !reachable(p, input.busy)) return afterNoAnswer(input.number, p ?? null);
      return { kind: 'ring', stage: 'fallback', targets: [targetOf(p)], timeout: Math.max(10, timeoutOf(input)) };
    }
    case 'group': {
      // Gruppe aus dem Menü: alle gleichzeitig, danach wie bei der Nummer (Weiterleitung oder Mailbox)
      const ids = new Set(input.groups[opt.target ?? ''] ?? []);
      const free = input.members.filter((m) => ids.has(m.id) && reachable(m, input.busy));
      const online = free.filter((p) => isOnline(p, input.now));
      const list = online.length ? online : free;
      if (!list.length) return afterNoAnswer(input.number, null);
      return { kind: 'ring', stage: 'fallback', targets: list.slice(0, MAX_PARALLEL).map(targetOf), timeout: timeoutOf(input) };
    }
    default:
      return ringDecision(input, input.number?.route_to_owner !== false && input.ownerId ? 'owner' : 'pool');
  }
}

// Absendernummer wählen: „Local Presence“ = Nummer mit gleicher Vorwahl wie der Angerufene
export function pickCallerId(o: {
  requested: string | null;
  profileNumber: string | null;
  orgDefault: string | null;
  numbers: Pick<PhoneNumberRow, 'number' | 'available_to_all' | 'members'>[];
  userId: string;
  to: string;
  localPresence: boolean;
}): string | null {
  const usable = o.numbers.filter((n) => n.available_to_all || n.members.includes(o.userId));
  const known = new Set([...usable.map((n) => n.number), o.orgDefault, o.profileNumber].filter(Boolean) as string[]);
  if (o.requested && known.has(o.requested)) return o.requested;
  if (o.localPresence && o.to.startsWith('+49')) {
    // längste gemeinsame Vorwahl (mind. 3 Ziffern nach +49)
    let best: { n: string; len: number } | null = null;
    for (const n of usable) {
      if (!n.number.startsWith('+49')) continue;
      let len = 0;
      while (len < Math.min(n.number.length, o.to.length) && n.number[len] === o.to[len]) len++;
      if (len >= 6 && (!best || len > best.len)) best = { n: n.number, len };
    }
    if (best) return best.n;
  }
  return o.profileNumber || o.orgDefault || usable[0]?.number || null;
}
