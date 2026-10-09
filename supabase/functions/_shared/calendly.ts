// Calendly API v2 + Webhook-Signatur

import { hmac, safeEqual, toHex } from './crypto.ts';

export class CalendlyError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function calendly<T = Record<string, unknown>>(
  token: string,
  method: 'GET' | 'POST' | 'DELETE',
  pathOrUrl: string,
  body?: unknown,
): Promise<T> {
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `https://api.calendly.com${pathOrUrl}`;
  const res = await fetch(url, {
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
    const msg = data?.message || data?.title || res.statusText;
    const details = Array.isArray(data?.details) ? ` (${data.details.map((d: { message?: string }) => d.message).join('; ')})` : '';
    throw new CalendlyError(res.status, `Calendly ${res.status}: ${msg}${details}`);
  }
  return data as T;
}

// Header "Calendly-Webhook-Signature: t=1492774577,v1=5257a869…"
export async function verifyCalendlySignature(
  header: string | null,
  rawBody: string,
  signingKey: string,
  toleranceSeconds = 600,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header || !signingKey) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;
  if (Math.abs(nowSeconds - Number(t)) > toleranceSeconds) return false;
  const expected = toHex(await hmac('SHA-256', signingKey, `${t}.${rawBody}`));
  return safeEqual(expected, v1);
}

export interface CalendlyInvitee {
  uri: string;
  email?: string;
  name?: string;
  first_name?: string | null;
  last_name?: string | null;
  status?: string;
  rescheduled?: boolean;
  text_reminder_number?: string | null;
  questions_and_answers?: { question: string; answer: string; position?: number }[];
  tracking?: {
    utm_campaign?: string | null;
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_content?: string | null;
    utm_term?: string | null;
  };
  cancellation?: { canceled_by?: string; reason?: string | null };
  scheduled_event?: {
    uri?: string;
    name?: string;
    start_time?: string;
    end_time?: string;
    status?: string;
    location?: { type?: string; location?: string | null; join_url?: string | null };
    event_memberships?: { user?: string; user_email?: string; user_name?: string }[];
  };
}
