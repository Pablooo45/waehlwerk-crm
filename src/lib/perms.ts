// Rechte-Katalog (gleiche Schlüssel wie public.all_permissions() in der Datenbank)
// und Helfer, um im Browser zu prüfen, was jemand darf.

import type { ID, LeadVisibility, Permission, Profile, RefData, Role } from './types.ts';

export interface PermissionDef {
  key: Permission;
  label: string;
  hint: string;
}

export interface PermissionGroup {
  title: string;
  items: PermissionDef[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: 'Organisation',
    items: [
      { key: 'manage_organization', label: 'Organisation verwalten', hint: 'Benutzer anlegen, Rollen & Rechte, Telefonie, Aufnahmen, Verbindungen (Twilio, Calendly, Google, KI).' },
      { key: 'manage_customizations', label: 'Einstellungen anpassen', hint: 'Status, Pipelines, Anruf-Ergebnisse, Felder, Formulare, Gesprächsleitfaden.' },
      { key: 'manage_phone_numbers', label: 'Telefonnummern verwalten', hint: 'Gruppennummern, Rufzeiten, Telefonmenü, Weiterleitungen.' },
      { key: 'manage_workflows', label: 'Workflows verwalten', hint: 'Workflows anlegen, ändern, starten und anhalten.' },
      { key: 'manage_team_smart_views', label: 'Smart Views fürs Team', hint: 'Smart Views für alle freigeben und fremde Smart Views ändern.' },
      { key: 'manage_team_templates', label: 'Vorlagen fürs Team', hint: 'E-Mail- und SMS-Vorlagen für alle freigeben und fremde ändern.' },
    ],
  },
  {
    title: 'Leads',
    items: [
      { key: 'delete_leads', label: 'Leads löschen', hint: 'Einzelne Leads endgültig löschen.' },
      { key: 'merge_leads', label: 'Leads zusammenführen', hint: 'Doppelte Leads zu einem zusammenführen.' },
      { key: 'edit_restricted_fields', label: 'Geschützte Felder bearbeiten', hint: 'Felder ändern, die als „geschützt“ markiert sind.' },
      { key: 'import', label: 'Importieren', hint: 'Leads aus CSV-Dateien oder Close übernehmen.' },
      { key: 'export', label: 'Exportieren', hint: 'Leads und Anrufe als CSV herunterladen.' },
    ],
  },
  {
    title: 'Sammelaktionen',
    items: [
      { key: 'bulk_edit', label: 'Gesammelt bearbeiten', hint: 'Status, Zuständige und Felder vieler Leads auf einmal ändern.' },
      { key: 'bulk_delete', label: 'Gesammelt löschen', hint: 'Viele Leads auf einmal löschen (braucht zusätzlich „Leads löschen“).' },
      { key: 'bulk_email', label: 'Sammel-E-Mails', hint: 'Eine Vorlage an viele Leads auf einmal senden.' },
      { key: 'bulk_workflow', label: 'Gesammelt in Workflows', hint: 'Viele Leads auf einmal in einen Workflow aufnehmen.' },
    ],
  },
  {
    title: 'Aktivitäten, Opportunities, Aufgaben',
    items: [
      { key: 'manage_others_activities', label: 'Aktivitäten anderer bearbeiten', hint: 'Notizen, Anrufe, E-Mails und Formulare von Kollegen ändern und löschen.' },
      { key: 'delete_own_activities', label: 'Eigene Aktivitäten löschen', hint: 'Eigene Notizen, Anrufe, E-Mails und Formulare löschen.' },
      { key: 'manage_others_opportunities', label: 'Opportunities anderer bearbeiten', hint: 'Fremde Opportunities ändern und löschen.' },
      { key: 'delete_own_opportunities', label: 'Eigene Opportunities löschen', hint: '' },
      { key: 'manage_others_tasks', label: 'Aufgaben anderer bearbeiten', hint: 'Fremde Aufgaben ändern, erledigen und löschen.' },
      { key: 'delete_own_tasks', label: 'Eigene Aufgaben löschen', hint: '' },
    ],
  },
  {
    title: 'Telefonie & Aufnahmen',
    items: [
      { key: 'calling', label: 'Telefonieren', hint: 'Anrufen, Power Dialer, Mailbox-Nachrichten, SMS.' },
      { key: 'recordings_listen_all', label: 'Alle Aufnahmen anhören', hint: 'Aufnahmen und Abschriften der Kollegen hören und lesen (eigene immer).' },
      { key: 'recordings_download', label: 'Aufnahmen herunterladen', hint: 'Zeigt den Download-Knopf am Player.' },
      { key: 'recordings_delete', label: 'Aufnahmen löschen', hint: 'Aufnahmen aller Kollegen löschen.' },
      { key: 'call_coach_listen', label: 'Mithören & Einflüstern', hint: 'Bei laufenden Gesprächen still mithören oder nur für den Kollegen hörbar sprechen.' },
      { key: 'call_coach_barge', label: 'Aufschalten', hint: 'Sich in ein laufendes Gespräch dazuschalten (alle hören mit).' },
    ],
  },
  {
    title: 'Team & Auswertung',
    items: [
      { key: 'view_team_reports', label: 'Team-Berichte sehen', hint: 'Zahlen aller Kollegen in den Berichten (sonst nur die eigenen).' },
      { key: 'view_others_inbox', label: 'Inbox anderer ansehen', hint: 'Aufgaben und Benachrichtigungen der Kollegen sehen.' },
      { key: 'use_ai', label: 'KI-Funktionen', hint: 'Zusammenfassungen und Abschriften anfordern.' },
    ],
  },
];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));

export const VISIBILITY_OPTIONS: { value: LeadVisibility; label: string; hint: string }[] = [
  { value: 'all', label: 'Alle Leads', hint: 'Sieht alle Leads des Teams.' },
  { value: 'own', label: 'Nur eigene Leads', hint: 'Sieht nur Leads, bei denen die Person zuständig oder Opener ist.' },
  {
    value: 'own_and_unassigned',
    label: 'Eigene und freie Leads',
    hint: 'Eigene Leads plus alle Leads ohne Zuständigen – gut für Opener, die sich Leads aus dem Pool nehmen.',
  },
];

export function permissionLabel(p: Permission): string {
  for (const g of PERMISSION_GROUPS) {
    const hit = g.items.find((i) => i.key === p);
    if (hit) return hit.label;
  }
  return p;
}

export function visibilityLabel(v: LeadVisibility): string {
  return VISIBILITY_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

export function roleOf(ref: Pick<RefData, 'roles'>, p: Pick<Profile, 'role_id'> | null | undefined): Role | undefined {
  return p ? ref.roles.find((r) => r.id === p.role_id) : undefined;
}

export function permsOfRole(role: Role | undefined): Permission[] {
  if (!role) return [];
  return role.id === 'admin' ? [...ALL_PERMISSIONS] : role.permissions;
}

export function visibilityOfRole(role: Role | undefined): LeadVisibility {
  if (!role) return 'all';
  return role.id === 'admin' ? 'all' : role.lead_visibility;
}

// Darf ich …? (UI – die Datenbank prüft zusätzlich selbst)
export function hasPerm(ref: Pick<RefData, 'perms'>, p: Permission): boolean {
  return ref.perms.includes(p);
}

export function isAdmin(ref: Pick<RefData, 'perms'>): boolean {
  return ref.perms.includes('manage_organization');
}

export function canSeeLead(
  ref: Pick<RefData, 'visibility' | 'me'>,
  lead: { owner_id: ID | null; opener_id: ID | null },
): boolean {
  if (ref.visibility === 'all') return true;
  if (lead.owner_id === ref.me.id || lead.opener_id === ref.me.id) return true;
  return ref.visibility === 'own_and_unassigned' && !lead.owner_id;
}

export function canEditActivity(ref: Pick<RefData, 'perms' | 'me'>, ownerId: ID | null): boolean {
  return ownerId === ref.me.id || hasPerm(ref, 'manage_others_activities');
}

export function canDeleteActivity(ref: Pick<RefData, 'perms' | 'me'>, ownerId: ID | null): boolean {
  return (ownerId === ref.me.id && hasPerm(ref, 'delete_own_activities')) || hasPerm(ref, 'manage_others_activities');
}

export function canListenCall(
  ref: Pick<RefData, 'perms' | 'me'>,
  call: { user_id: ID | null; is_voicemail?: boolean },
): boolean {
  return call.user_id === ref.me.id || !!call.is_voicemail || hasPerm(ref, 'recordings_listen_all');
}

export function canDeleteRecording(ref: Pick<RefData, 'perms' | 'me'>, call: { user_id: ID | null }): boolean {
  return hasPerm(ref, 'recordings_delete') || (call.user_id === ref.me.id && hasPerm(ref, 'delete_own_activities'));
}

export function slugKey(label: string, taken: string[] = []): string {
  const base =
    label
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'feld';
  let key = /^[a-z]/.test(base) ? base : `f_${base}`;
  let i = 2;
  while (taken.includes(key)) key = `${base}_${i++}`;
  return key;
}
