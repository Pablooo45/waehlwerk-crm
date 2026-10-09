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

export const SETTINGS_ITEMS: SettingsItem[] = [
  { id: 'profile', label: 'Mein Profil', group: 'Persönlich', words: 'profil name passwort farbe mikrofon kopfhörer erreichbar weiterleitung handy', visible: all },
  { id: 'voicemail', label: 'Mailbox-Nachrichten', group: 'Persönlich', words: 'mailbox voicemail drop nachricht hinterlassen', visible: all },
  { id: 'mailbox', label: 'E-Mail-Postfach', group: 'Persönlich', words: 'email postfach imap smtp ionos signatur', visible: all },
  { id: 'templates', label: 'Vorlagen', group: 'Persönlich', words: 'vorlagen email sms templates', visible: all },
  { id: 'team', label: 'Benutzer', group: 'Team', words: 'team benutzer anlegen einladen mitarbeiter zugang', visible: admin },
  { id: 'roles', label: 'Rollen & Rechte', group: 'Team', words: 'rollen rechte ränge berechtigungen admin super user eingeschränkt', visible: admin },
  { id: 'groups', label: 'Gruppen', group: 'Team', words: 'gruppen teams opener closer', visible: admin },
  { id: 'numbers', label: 'Telefonnummern', group: 'Telefonie', words: 'nummern gruppennummer rufzeiten telefonmenü weiterleitung', visible: ({ can }) => can('manage_phone_numbers') },
  { id: 'telephony', label: 'Telefonie', group: 'Telefonie', words: 'twilio absendernummer dialer klingeln mailbox ansage', visible: admin },
  { id: 'recordings', label: 'Aufnahmen & Abschriften', group: 'Telefonie', words: 'aufnahmen recording qualität wav abschrift transkript ki zusammenfassung aufbewahrung', visible: admin },
  { id: 'statuses', label: 'Lead-Status', group: 'Anpassen', words: 'status lead', visible: custom },
  { id: 'pipelines', label: 'Pipelines', group: 'Anpassen', words: 'pipeline phasen opportunities', visible: custom },
  { id: 'outcomes', label: 'Anruf-Ergebnisse', group: 'Anpassen', words: 'ergebnisse outcomes anruf', visible: custom },
  { id: 'fields', label: 'Eigene Felder', group: 'Anpassen', words: 'felder custom fields lead kontakt opportunity', visible: custom },
  { id: 'forms', label: 'Formulare', group: 'Anpassen', words: 'formulare custom activities setting wiedervorlage', visible: custom },
  { id: 'script', label: 'Gesprächsleitfaden', group: 'Anpassen', words: 'leitfaden skript script', visible: custom },
  { id: 'links', label: 'Links am Lead', group: 'Anpassen', words: 'links integration google', visible: custom },
  { id: 'calendar', label: 'Kalender & Calendly', group: 'Verbindungen', words: 'kalender calendly google termine', visible: admin },
  { id: 'ai', label: 'KI & Abschriften', group: 'Verbindungen', words: 'ki assemblyai anthropic claude abschrift zusammenfassung', visible: admin },
  { id: 'close', label: 'Umzug aus Close', group: 'Verbindungen', words: 'close umzug import api', visible: admin },
  { id: 'import', label: 'Import & Export', group: 'Daten', words: 'import export csv', visible: ({ can }) => can('import') || can('export') },
  { id: 'duplicates', label: 'Dubletten', group: 'Daten', words: 'dubletten doppelte zusammenführen merge', visible: ({ can }) => can('merge_leads') },
  { id: 'diagnose', label: 'Diagnose & Fehler', group: 'Daten', words: 'diagnose fehler test mikrofon netz', visible: all },
];
