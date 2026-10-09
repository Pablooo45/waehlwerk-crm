// Google Kalender über einen Service-Account (kein OAuth-Login nötig).
// Der Kalender wird im Google Kalender mit der Service-Account-E-Mail geteilt.

import { base64url, signRs256 } from './crypto.ts';

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export function parseServiceAccount(raw: string): ServiceAccount {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Die Schlüsseldatei ist kein gültiges JSON. Bitte den kompletten Inhalt der .json-Datei einfügen.');
  }
  if (typeof data.client_email !== 'string' || typeof data.private_key !== 'string') {
    throw new Error('In der Schlüsseldatei fehlen "client_email" oder "private_key".');
  }
  return {
    client_email: data.client_email,
    private_key: data.private_key,
    token_uri: typeof data.token_uri === 'string' ? data.token_uri : undefined,
  };
}

const tokenCache = new Map<string, { token: string; until: number }>();

export async function googleAccessToken(sa: ServiceAccount): Promise<string> {
  const hit = tokenCache.get(sa.client_email);
  if (hit && hit.until > Date.now() + 60_000) return hit.token;
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const sig = await signRs256(sa.private_key, unsigned);
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${base64url(sig)}`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Google-Anmeldung fehlgeschlagen: ${data.error_description || data.error || res.status}`);
  }
  tokenCache.set(sa.client_email, { token: data.access_token, until: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

export class GoogleError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function gcal<T = Record<string, unknown>>(
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {} as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    throw new GoogleError(res.status, `Google Kalender ${res.status}: ${msg}`);
  }
  return data as T;
}

export interface GEvent {
  id: string;
  status?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  creator?: { email?: string; displayName?: string };
  attendees?: { email?: string; displayName?: string; organizer?: boolean; self?: boolean; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}

export async function listEvents(token: string, calendarId: string, timeMin: Date, timeMax: Date): Promise<GEvent[]> {
  const out: GEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({
      singleEvents: 'true',
      showDeleted: 'true',
      maxResults: '250',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
    });
    if (pageToken) qs.set('pageToken', pageToken);
    const data = await gcal<{ items?: GEvent[]; nextPageToken?: string }>(
      token,
      'GET',
      `/calendars/${encodeURIComponent(calendarId)}/events?${qs}`,
    );
    out.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}
