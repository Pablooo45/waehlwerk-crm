// Tests für die Hilfsfunktionen im Browser (npm test)

import { describe, expect, it } from 'vitest';
import { toCsv } from './csv.ts';
import { matchesCondition, resolveStatusIds, searchTerms } from './filters.ts';
import { formatDuration, formatPercent, formatPhone, formatTalkTime, normalizePhone } from './format.ts';
import type { Lead, LeadStatus, Profile } from './types.ts';

const NBSP = ' ';

describe('Formatierung', () => {
  it('Prozent ohne unnötige Nachkommastelle', () => {
    expect(formatPercent(0, 10)).toBe(`0${NBSP}%`);
    expect(formatPercent(1, 20)).toBe(`5${NBSP}%`);
    expect(formatPercent(1, 30)).toBe(`3,3${NBSP}%`);
    expect(formatPercent(1, 8)).toBe(`13${NBSP}%`);
    expect(formatPercent(3, 0)).toBe('–');
  });

  it('Dauer und Gesprächszeit', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatTalkTime(2700)).toBe(`45${NBSP}Min.`);
    expect(formatTalkTime(3900)).toBe(`1${NBSP}Std. 5${NBSP}Min.`);
  });

  it('Telefonnummern werden einheitlich gespeichert und lesbar angezeigt', () => {
    expect(normalizePhone('06181 123456')).toBe('+496181123456');
    expect(normalizePhone('+49 (0) 6181 / 12 34 56')).toBe('+496181123456');
    expect(normalizePhone('0049 69 555000')).toBe('+4969555000');
    expect(normalizePhone('abc')).toBeNull();
    expect(formatPhone('+4969555000')).toBe('069 555000');
  });
});

describe('CSV-Export', () => {
  it('maskiert Semikolons, Anführungszeichen und Zeilenumbrüche', () => {
    const csv = toCsv([
      ['Name', 'Notiz'],
      ['Stern-Apotheke; Rodgau', 'sagt "später"'],
      ['Adler', 'Zeile 1\nZeile 2'],
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"Stern-Apotheke; Rodgau";"sagt ""später"""');
    expect(csv).toContain('Adler;"Zeile 1\nZeile 2"');
  });
});

describe('Suche und Filter', () => {
  it('zerlegt Suchbegriffe und erkennt Nummern', () => {
    expect(searchTerms('069 / 555-000 Apotheke')).toEqual(['069', '555000', 'apotheke']);
    expect(searchTerms('  ')).toEqual([]);
  });

  const statuses: LeadStatus[] = [
    { id: 's1', label: 'Neu', color: '#000', sort: 1, kind: 'open', is_default: true },
    { id: 's2', label: 'Termin gelegt', color: '#000', sort: 2, kind: 'open', is_default: false },
  ];
  const me = { id: 'u1' } as Profile;
  const now = new Date('2026-10-07T12:00:00');
  const lead = (patch: Partial<Lead>): Lead =>
    ({
      id: 'l1',
      name: 'Löwen-Apotheke',
      status_id: 's1',
      owner_id: null,
      opener_id: null,
      address_city: 'Hanau',
      address_zip: '63450',
      source: null,
      custom: { filialen: 3 },
      last_call_at: null,
      last_call_outcome: null,
      last_connected_at: null,
      call_count: 0,
      next_task_due: null,
      next_meeting_at: null,
      created_at: '2026-09-01T10:00:00Z',
      ...patch,
    }) as Lead;

  it('Status per Name (@Termin gelegt) auflösen', () => {
    expect(resolveStatusIds(['@Termin gelegt', 's1'], statuses)).toEqual(['s2', 's1']);
    expect(matchesCondition(lead({ status_id: 's2' }), { field: 'status', op: 'in', value: ['@Termin gelegt'] }, { statuses, me }, now)).toBe(true);
    expect(matchesCondition(lead({}), { field: 'status', op: 'not_in', value: ['@Termin gelegt'] }, { statuses, me }, now)).toBe(true);
  });

  it('Anrufzeitraum: heute, nie, älter als', () => {
    const today = lead({ last_call_at: '2026-10-07T08:00:00' });
    const old = lead({ last_call_at: '2026-09-20T08:00:00' });
    expect(matchesCondition(today, { field: 'last_call', op: 'within_days', value: 0 }, { statuses, me }, now)).toBe(true);
    expect(matchesCondition(old, { field: 'last_call', op: 'within_days', value: 0 }, { statuses, me }, now)).toBe(false);
    expect(matchesCondition(lead({}), { field: 'last_call', op: 'never' }, { statuses, me }, now)).toBe(true);
    expect(matchesCondition(old, { field: 'last_call', op: 'older_than_days', value: 7 }, { statuses, me }, now)).toBe(true);
  });

  it('eigene Felder und Zuständigkeit', () => {
    expect(matchesCondition(lead({}), { field: 'custom:filialen', op: 'gte', value: 2 }, { statuses, me }, now)).toBe(true);
    expect(matchesCondition(lead({}), { field: 'custom:filialen', op: 'lt', value: 2 }, { statuses, me }, now)).toBe(false);
    expect(matchesCondition(lead({ owner_id: 'u1' }), { field: 'owner', op: 'me' }, { statuses, me }, now)).toBe(true);
    expect(matchesCondition(lead({}), { field: 'owner', op: 'none' }, { statuses, me }, now)).toBe(true);
  });
});
