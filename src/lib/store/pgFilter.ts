// Übersetzt Smart-View-Filter in eine PostgREST-Bedingung (or=(…) / and(…)),
// damit „alle Bedingungen“ und „eine der Bedingungen“ in der Datenbank laufen.

import { addDays, isoDay } from '../dates.ts';
import { daysBoundary, resolveStatusIds, todayEnd, zipPrefixes } from '../filters.ts';
import type { Condition, CustomField, FilterSet, LeadStatus } from '../types.ts';

export interface PgFilterCtx {
  me: string;
  statuses: LeadStatus[];
  customFields: CustomField[];
  now?: Date;
}

// Werte immer in Anführungszeichen: Kommas, Punkte, Klammern und Doppelpunkte sind in PostgREST reserviert.
export function pgQuote(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidList(values: unknown): string[] {
  return ((Array.isArray(values) ? values : []) as unknown[]).map(String).filter((v) => UUID.test(v));
}

function keyList(values: unknown): string[] {
  return ((Array.isArray(values) ? values : []) as unknown[]).map(String).filter((v) => /^[a-z0-9_]+$/.test(v));
}

function or(...parts: string[]): string {
  return parts.length === 1 ? parts[0] : `or(${parts.join(',')})`;
}

function and(...parts: string[]): string {
  return parts.length === 1 ? parts[0] : `and(${parts.join(',')})`;
}

function likeEscape(v: string): string {
  // * ist in PostgREST das Platzhalterzeichen; % und _ wären in LIKE ebenfalls Platzhalter
  return v.replace(/[%_*]/g, ' ').trim();
}

export function conditionExpr(c: Condition, ctx: PgFilterCtx): string | null {
  const now = ctx.now ?? new Date();
  const n = Number(c.value ?? 0);
  const text = String(c.value ?? '');
  const days = (col: string): string | null => {
    if (c.op === 'never') return `${col}.is.null`;
    if (c.op === 'within_days') return `${col}.gte.${pgQuote(daysBoundary(n, now).toISOString())}`;
    if (c.op === 'older_than_days') return or(`${col}.is.null`, `${col}.lt.${pgQuote(daysBoundary(n, now).toISOString())}`);
    return null;
  };
  const users = (col: string): string | null => {
    if (c.op === 'me') return `${col}.eq.${ctx.me}`;
    if (c.op === 'none') return `${col}.is.null`;
    if (c.op === 'in') {
      const ids = uuidList(c.value);
      return ids.length ? `${col}.in.(${ids.join(',')})` : null;
    }
    return null;
  };
  switch (c.field) {
    case 'status': {
      const ids = resolveStatusIds(c.value, ctx.statuses).filter((v) => UUID.test(v));
      if (!ids.length) return null;
      return c.op === 'not_in' ? or('status_id.is.null', `status_id.not.in.(${ids.join(',')})`) : `status_id.in.(${ids.join(',')})`;
    }
    case 'owner':
      return users('owner_id');
    case 'opener':
      return users('opener_id');
    case 'name':
      return text.trim() ? `name.ilike.${pgQuote(`*${likeEscape(text)}*`)}` : null;
    case 'city':
      if (c.op === 'empty') return or('address_city.is.null', 'address_city.eq.""');
      if (!text.trim()) return null;
      return c.op === 'equals' ? `address_city.ilike.${pgQuote(likeEscape(text))}` : `address_city.ilike.${pgQuote(`*${likeEscape(text)}*`)}`;
    case 'zip': {
      const prefixes = zipPrefixes(c.value);
      if (!prefixes.length) return null;
      if (c.op === 'not_starts_with') return or('address_zip.is.null', and(...prefixes.map((p) => `address_zip.not.like.${p}*`)));
      return or(...prefixes.map((p) => `address_zip.like.${p}*`));
    }
    case 'state':
      if (c.op === 'empty') return or('address_state.is.null', 'address_state.eq.""');
      return text.trim() ? `address_state.ilike.${pgQuote(likeEscape(text))}` : null;
    case 'source':
      if (!text.trim()) return null;
      return c.op === 'equals' ? `source.ilike.${pgQuote(likeEscape(text))}` : `source.ilike.${pgQuote(`*${likeEscape(text)}*`)}`;
    case 'last_call':
      return days('last_call_at');
    case 'reached':
      return days('last_connected_at');
    case 'last_activity':
      return days('last_activity_at');
    case 'created':
      return days('created_at');
    case 'last_outcome': {
      const keys = keyList(c.value);
      if (!keys.length) return null;
      return c.op === 'not_in'
        ? or('last_call_outcome.is.null', `last_call_outcome.not.in.(${keys.join(',')})`)
        : `last_call_outcome.in.(${keys.join(',')})`;
    }
    case 'call_count':
      return c.op === 'lt' ? `call_count.lt.${Math.floor(n)}` : `call_count.gte.${Math.floor(n)}`;
    case 'next_task':
      if (c.op === 'none') return 'next_task_due.is.null';
      if (c.op === 'any') return 'next_task_due.not.is.null';
      if (c.op === 'overdue') return `next_task_due.lt.${pgQuote(now.toISOString())}`;
      return `next_task_due.lte.${pgQuote(todayEnd(now).toISOString())}`;
    case 'meeting':
      if (c.op === 'upcoming') return `next_meeting_at.gt.${pgQuote(now.toISOString())}`;
      return or('next_meeting_at.is.null', `next_meeting_at.lte.${pgQuote(now.toISOString())}`);
    case 'do_not_call':
      return c.op === 'is_true' ? 'do_not_call.is.true' : 'do_not_call.is.false';
    default: {
      if (!c.field.startsWith('custom:')) return null;
      const key = c.field.slice(7).replace(/[^a-z0-9_]/g, '');
      if (!key) return null;
      const cf = ctx.customFields.find((f) => f.key === key);
      const txt = `custom->>${key}`;
      const js = `custom->${key}`;
      const emptyExpr = or(`${txt}.is.null`, `${txt}.eq.""`);
      if (c.op === 'empty') return emptyExpr;
      if (c.op === 'not_empty') return and(`${txt}.not.is.null`, `${txt}.neq.""`);
      if (cf?.type === 'user') {
        if (c.op === 'me') return `${txt}.eq.${ctx.me}`;
        const ids = uuidList(c.value);
        return ids.length ? `${txt}.in.(${ids.join(',')})` : null;
      }
      if (cf?.type === 'date' || cf?.type === 'datetime') {
        const isDate = cf.type === 'date';
        const nowVal = isDate ? isoDay(now) : now.toISOString();
        switch (c.op) {
          case 'past_or_empty':
            return or(`${txt}.is.null`, `${txt}.eq.""`, `${txt}.lt.${pgQuote(nowVal)}`);
          case 'future':
            return `${txt}.gte.${pgQuote(nowVal)}`;
          case 'within_next_days': {
            const end = isDate ? isoDay(addDays(now, n)) : addDays(now, n).toISOString();
            return and(`${txt}.gte.${pgQuote(nowVal)}`, `${txt}.lte.${pgQuote(end)}`);
          }
          case 'within_days': {
            const start = isDate ? isoDay(addDays(now, -n)) : daysBoundary(n, now).toISOString();
            return and(`${txt}.gte.${pgQuote(start)}`, `${txt}.lte.${pgQuote(nowVal)}`);
          }
          default:
            return null;
        }
      }
      switch (c.op) {
        case 'is_true':
          return `${js}.eq.true`;
        case 'is_false':
          return or(`${js}.is.null`, `${js}.eq.false`);
        case 'gte':
          return `${js}.gte.${Number.isFinite(n) ? n : 0}`;
        case 'lt':
          return `${js}.lt.${Number.isFinite(n) ? n : 0}`;
        case 'equals':
          if (cf?.type === 'choice') return `${txt}.eq.${pgQuote(text)}`;
          return text.trim() ? `${txt}.ilike.${pgQuote(likeEscape(text))}` : null;
        case 'not_equals':
          return or(`${txt}.is.null`, `${txt}.neq.${pgQuote(text)}`);
        case 'in': {
          const vals = ((Array.isArray(c.value) ? c.value : []) as unknown[]).map(String);
          return vals.length ? `${txt}.in.(${vals.map(pgQuote).join(',')})` : null;
        }
        case 'contains':
          if (cf?.type === 'multichoice') return `${js}.cs.${pgQuote(JSON.stringify([text]))}`;
          return text.trim() ? `${txt}.ilike.${pgQuote(`*${likeEscape(text)}*`)}` : null;
        default:
          return null;
      }
    }
  }
}

export function filterExpr(filter: FilterSet, ctx: PgFilterCtx): string | null {
  const parts = (filter.conditions ?? []).map((c) => conditionExpr(c, ctx)).filter((p): p is string => !!p);
  if (!parts.length) return null;
  return filter.match === 'any' ? or(...parts) : and(...parts);
}
