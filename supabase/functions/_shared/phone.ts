// Telefonnummern vereinheitlichen (E.164, z. B. +4969123456).
// Diese Datei wird von den Edge Functions UND vom Frontend benutzt.
// Gleiche Logik wie public.normalize_phone() in der Datenbank.

export function normalizePhone(input: string | null | undefined): string | null {
  if (input == null) return null;
  let s = String(input).replace(/\(\s*0\s*\)/g, '');
  s = s.replace(/[^0-9+]/g, '');
  if (s === '' || s === '+') return null;
  let d: string;
  if (s.startsWith('+')) d = '+' + s.slice(1).replace(/[^0-9]/g, '');
  else if (s.startsWith('00')) d = '+' + s.slice(2);
  else if (s.startsWith('0')) d = '+49' + s.slice(1);
  else if (s.startsWith('49') && s.length >= 11) d = '+' + s;
  else d = '+49' + s;
  if (/^\+(49|43|41)0/.test(d)) d = d.slice(0, 3) + d.slice(4);
  if (d.length < 8 || d.length > 16) return null;
  return d;
}

// Kostenpflichtige Sonderrufnummern & Auskünfte sperren (Schutz vor teuren Fehlwahlen)
const BLOCKED_PREFIXES = [
  '+49900', // Premium-Dienste
  '+49137', // Televoting
  '+49138',
  '+4918', // Service-Nummern 018x
  '+4919', // alte Mehrwertdienste
  '+49118', // Auskunft
];

export function isBlockedNumber(e164: string): boolean {
  return BLOCKED_PREFIXES.some((p) => e164.startsWith(p));
}

export function isAllowedNumber(e164: string, allowedPrefixes: string[] | null | undefined): boolean {
  if (isBlockedNumber(e164)) return false;
  const list = (allowedPrefixes ?? []).filter(Boolean);
  if (list.length === 0) return true;
  return list.some((p) => e164.startsWith(p));
}
