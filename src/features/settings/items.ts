// Menü der Einstellungen – wer welchen Bereich sieht, hängt an den Rechten der Rolle.

import type { Permission } from '../../lib/types.ts';

export interface SettingsItem {
  id: string;
  label: string;
  group: string;
  words: string; // für die Suche oben
  visible: (ctx: { can: (p: Permission) => boolean; isAdmin: boolean }) => boolean;
}

const all = () => true;
const admin = ({ isAdmin }: { isAdmin: boolean }) => isAdmin;
const custom = ({ can }: { can: (p: Permission) => boolean }) => can('manage_customizations');

// Aufbau wie in Close: Persönlich, Team, Anpassen, Kommunikation, Verbindungen, Daten
export const SETTINGS_ITEMS: SettingsItem[] = [
  { id: 'profile', label: 'Mein Profil', group: 'Persönlich', words: 'profil name passwort farbe mikrofon kopfhörer audio erreichbar weiterleitung handy darstellung', visible: all },
  { id: 'voicemail', label: 'Mailbox-Nachrichten', group: 'Persönlich', words: 'mailbox voicemail drop nachricht hinterlassen', visible: all },
  { id: 'mailbox', label: 'E-Mail-Postfach', group: 'Persönlich', words: 'email postfach imap smtp ionos signatur', visible: all },
  { id: 'team', label: 'Benutzer', group: 'Team', words: 'team benutzer anlegen einladen mitarbeiter zugang', visible: admin },
  { id: 'roles', label: 'Rollen & Rechte', group: 'Team', words: 'rollen rechte ränge berechtigungen admin super user eingeschränkt', visible: admin },
  { id: 'groups', label: 'Gruppen', group: 'Team', words: 'gruppen teams opener closer', visible: admin },
  { id: 'statuses', label: 'Status & Pipelines', group: 'Anpassen', words: 'status lead statuses pipeline pipelines phasen opportunity', visible: custom },
  { id: 'fields', label: 'Eigene Felder', group: 'Anpassen', words: 'felder custom fields lead kontakt opportunity', visible: custom },
  { id: 'forms', label: 'Eigene Aktivitäten', group: 'Anpassen', words: 'aktivitäten custom activities formulare setting wiedervorlage aktionen', visible: custom },
  { id: 'outcomes', label: 'Anruf-Ergebnisse', group: 'Anpassen', words: 'ergebnisse outcomes anruf aktionen automatik', visible: custom },
  { id: 'script', label: 'Gesprächsleitfaden', group: 'Anpassen', words: 'leitfaden skript script playbook', visible: custom },
  { id: 'links', label: 'Links am Lead', group: 'Anpassen', words: 'links integration google', visible: custom },
  { id: 'templates', label: 'Vorlagen (E-Mail & SMS)', group: 'Kommunikation', words: 'vorlagen email sms templates snippets', visible: all },
  { id: 'numbers', label: 'Telefonnummern', group: 'Kommunikation', words: 'nummern gruppennummer rufzeiten telefonmenü weiterleitung', visible: ({ can }) => can('manage_phone_numbers') },
  { id: 'telephony', label: 'Telefonie', group: 'Kommunikation', words: 'twilio absendernummer dialer klingeln mailbox ansage', visible: admin },
  { id: 'recordings', label: 'Aufnahmen & Abschriften', group: 'Kommunikation', words: 'aufnahmen recording qualität wav abschrift transkript ki zusammenfassung aufbewahrung', visible: admin },
  { id: 'calendar', label: 'Kalender & Calendly', group: 'Kommunikation', words: 'kalender calendly google termine', visible: admin },
  { id: 'ai', label: 'KI & Abschriften', group: 'Verbindungen', words: 'ki assemblyai anthropic claude abschrift zusammenfassung', visible: admin },
  { id: 'close', label: 'Umzug aus Close', group: 'Verbindungen', words: 'close umzug import api', visible: admin },
  { id: 'import', label: 'Import & Export', group: 'Daten', words: 'import export csv', visible: ({ can }) => can('import') || can('export') },
  { id: 'duplicates', label: 'Dubletten', group: 'Daten', words: 'dubletten doppelte zusammenführen merge', visible: ({ can }) => can('merge_leads') },
  { id: 'diagnose', label: 'Diagnose & Fehler', group: 'Daten', words: 'diagnose fehler test mikrofon netz', visible: all },
];

// Unterseiten, die zu einem Menüpunkt gehören (Close: „Statuses & Pipelines“ ist eine Seite)
export const SETTINGS_ALIASES: Record<string, string> = { pipelines: 'statuses' };
