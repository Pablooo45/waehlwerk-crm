// Anzeigeformate (deutsch)

import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { normalizePhone } from '../../supabase/functions/_shared/phone.ts';
import { addDays, sameDay, startOfDay } from './dates.ts';

export { normalizePhone };

export function formatPhone(value: string | null | undefined): string {
  if (!value) return '';
  const e164 = normalizePhone(value) ?? value;
  try {
    const p = parsePhoneNumberFromString(e164);
    if (p) return p.country === 'DE' ? p.formatNational() : p.formatInternational();
  } catch {
    /* unverändert anzeigen */
  }
  return value;
}

export function telHref(value: string): string {
  return `tel:${normalizePhone(value) ?? value}`;
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(totalSeconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatTalkTime(totalSeconds: number): string {
  const m = Math.round(totalSeconds / 60);
  if (m < 60) return `${m}\u00a0Min.`;
  const h = Math.floor(m / 60);
  return `${h}\u00a0Std. ${m % 60}\u00a0Min.`;
}

const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const weekdayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
const longDayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = typeof v === 'string' ? new Date(v) : v;
  return isNaN(d.getTime()) ? null : d;
}

export function formatTime(v: string | Date | null | undefined): string {
  const d = toDate(v);
  return d ? timeFmt.format(d) : '';
}

export function formatDate(v: string | Date | null | undefined): string {
  const d = toDate(v);
  return d ? dateFmt.format(d) : '';
}

export function formatDateTime(v: string | Date | null | undefined): string {
  const d = toDate(v);
  return d ? `${dateFmt.format(d)}, ${timeFmt.format(d)}` : '';
}

// "Heute", "Morgen", "Gestern", "Mi., 9. Okt."
export function formatDay(v: string | Date | null | undefined, now = new Date()): string {
  const d = toDate(v);
  if (!d) return '';
  if (sameDay(d, now)) return 'Heute';
  if (sameDay(d, addDays(now, 1))) return 'Morgen';
  if (sameDay(d, addDays(now, -1))) return 'Gestern';
  return `${weekdayFmt.format(d)}, ${shortDateFmt.format(d)}`;
}

export function formatLongDay(v: string | Date): string {
  const d = toDate(v);
  return d ? longDayFmt.format(d) : '';
}

// "gerade eben", "vor 5 Min.", "Heute, 14:30", "Gestern, 9:12", "Mo., 3. Okt."
export function formatRelative(v: string | Date | null | undefined, now = new Date()): string {
  const d = toDate(v);
  if (!d) return '';
  const diff = now.getTime() - d.getTime();
  if (diff >= 0 && diff < 60_000) return 'gerade eben';
  if (diff >= 0 && diff < 3_600_000) return `vor ${Math.floor(diff / 60_000)} Min.`;
  if (sameDay(d, now)) return `Heute, ${formatTime(d)}`;
  if (sameDay(d, addDays(now, -1))) return `Gestern, ${formatTime(d)}`;
  if (sameDay(d, addDays(now, 1))) return `Morgen, ${formatTime(d)}`;
  const days = Math.abs(startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000;
  if (days < 7) return `${weekdayFmt.format(d)}, ${formatTime(d)}`;
  if (d.getFullYear() === now.getFullYear()) return shortDateFmt.format(d);
  return formatDate(d);
}

export function formatDue(v: string | null | undefined, now = new Date()): { text: string; overdue: boolean } {
  const d = toDate(v);
  if (!d) return { text: 'ohne Termin', overdue: false };
  const overdue = d.getTime() < now.getTime();
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  const day = formatDay(d, now);
  return { text: hasTime ? `${day}, ${formatTime(d)}` : day, overdue };
}

const money = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export function formatMoney(n: number | null | undefined): string {
  return money.format(n ?? 0);
}

const num = new Intl.NumberFormat('de-DE');
export function formatNumber(n: number | null | undefined): string {
  return num.format(n ?? 0);
}

export function formatPercent(part: number, total: number): string {
  if (!total) return '–';
  const p = (part / total) * 100;
  if (p >= 10) return `${Math.round(p)}\u00a0%`;
  const s = p.toFixed(1);
  return `${s.endsWith('.0') ? s.slice(0, -2) : s.replace('.', ',')}\u00a0%`;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function firstName(name: string | null | undefined): string {
  const clean = (name ?? '').replace(/^(dr\.|prof\.|herr|frau)\s+/i, '').trim();
  return clean.split(/\s+/)[0] ?? '';
}

export function plural(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function ensureUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// Platzhalter in E-Mail-Vorlagen ersetzen
export { fillTemplate } from '../../supabase/functions/_shared/template.ts';
