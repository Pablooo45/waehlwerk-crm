// Datums-Helfer (lokale Zeit des Browsers, Wochen beginnen montags)

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MIN);
}

export function startOfWeek(d = new Date()): Date {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // Montag = 0
  return addDays(x, -dow);
}

export function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Wert für <input type="datetime-local">
export function toLocalInput(d: Date | string | null | undefined): string {
  if (!d) return '';
  const x = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(x.getTime())) return '';
  return `${isoDay(x)}T${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}

export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Nächster Werktag um eine bestimmte Uhrzeit (für Wiedervorlagen)
export function nextWorkday(days: number, hour = 9): Date {
  let d = addDays(startOfDay(), days);
  while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export interface RangePreset {
  key: string;
  label: string;
  from: Date;
  to: Date;
}

export function rangePresets(now = new Date()): RangePreset[] {
  const today = startOfDay(now);
  const week = startOfWeek(now);
  const month = startOfMonth(now);
  return [
    { key: 'today', label: 'Heute', from: today, to: addDays(today, 1) },
    { key: 'yesterday', label: 'Gestern', from: addDays(today, -1), to: today },
    { key: 'week', label: 'Diese Woche', from: week, to: addDays(week, 7) },
    { key: 'lastweek', label: 'Letzte Woche', from: addDays(week, -7), to: week },
    { key: 'month', label: 'Dieser Monat', from: month, to: new Date(month.getFullYear(), month.getMonth() + 1, 1) },
    {
      key: 'lastmonth',
      label: 'Letzter Monat',
      from: new Date(month.getFullYear(), month.getMonth() - 1, 1),
      to: month,
    },
    { key: '30d', label: 'Letzte 30 Tage', from: addDays(today, -29), to: addDays(today, 1) },
  ];
}
