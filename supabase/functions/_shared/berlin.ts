// Deutsche Ortszeit (Europe/Berlin) – Versandfenster für Workflows, Uhrzeiten in Texten.

const FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hour12: false,
});

const ISO_DAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export interface BerlinParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  isoDay: number; // 1 = Montag … 7 = Sonntag
}

export function berlinParts(d: Date): BerlinParts {
  const parts = FMT.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    isoDay: ISO_DAY[get('weekday')] ?? 1,
  };
}

// Minuten, die Berlin der UTC voraus ist (60 im Winter, 120 im Sommer)
export function berlinOffsetMinutes(d: Date): number {
  const p = berlinParts(d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(d.getTime() / 60_000) * 60_000) / 60_000);
}

// Berliner Datum + Uhrzeit → Zeitpunkt
export function berlinToDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let t = naive - berlinOffsetMinutes(new Date(naive)) * 60_000;
  const second = naive - berlinOffsetMinutes(new Date(t)) * 60_000;
  if (second !== t) t = second;
  return new Date(t);
}

export interface SendWindow {
  days: number[]; // 1 = Montag … 7 = Sonntag
  from: string; // "08:00"
  to: string; // "18:00"
}

function hm(s: string, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
}

export function inWindow(w: SendWindow | null | undefined, now: Date): boolean {
  if (!w || !w.days?.length) return true;
  const p = berlinParts(now);
  const t = p.hour * 60 + p.minute;
  return w.days.includes(p.isoDay) && t >= hm(w.from, 0) && t < hm(w.to, 24 * 60);
}

// Nächster Beginn des Versandfensters (oder jetzt, wenn wir drin sind)
export function nextWindowStart(w: SendWindow | null | undefined, now: Date): Date {
  if (inWindow(w, now)) return now;
  const from = hm(w!.from, 0);
  const to = hm(w!.to, 24 * 60);
  for (let i = 0; i < 8; i++) {
    const probe = new Date(now.getTime() + i * 86_400_000);
    const p = berlinParts(probe);
    if (!w!.days.includes(p.isoDay)) continue;
    const start = berlinToDate(p.year, p.month, p.day, Math.floor(from / 60), from % 60);
    const end = berlinToDate(p.year, p.month, p.day, Math.floor(to / 60), to % 60);
    if (start.getTime() > now.getTime()) return start;
    if (end.getTime() > now.getTime()) return now;
  }
  return new Date(now.getTime() + 86_400_000);
}
