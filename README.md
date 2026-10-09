# Wählwerk CRM

Ein eigenes Vertriebs-CRM fürs Telefon-Team, gebaut als Ersatz für Close. Es läuft im Browser, telefoniert über Twilio und speichert alles in einer eigenen Supabase-Datenbank in Frankfurt. Den Code habt ihr komplett selbst: Wenn etwas hakt, lässt sich der Fehler finden und beheben, ohne auf einen Anbieter zu warten.

Die Einrichtung Schritt für Schritt steht in **[EINRICHTUNG.md](EINRICHTUNG.md)**.

## Was drin ist

**Aufbau wie in Close**
- Seitenleiste mit Suche (Strg + K), Inbox, Leads (mit „+“ für neue Leads), Kontakte, Opportunities, Gespräche, Berichte, Workflows und euren Smart Views; Telefon und Konto oben links
- Lead-Seite in zwei Spalten: links Status, Aufgaben, Opportunities, Kontakte und Felder, rechts Anrufen, E-Mail, SMS, Notiz, Aktivität und Termin – der Editor öffnet sich direkt über dem Verlauf
- Inbox mit „Abarbeiten“ und „Nächster Lead“, Power Dialer auf der echten Lead-Seite, Pipeline zum Ziehen
- Alles anpassbar: Lead-Status, Pipelines und Phasen, eigene Felder, eigene Aktivitäten, Anruf-Ergebnisse (mit Status- und Wiedervorlage-Automatik), Links, Rollen – als Listen zum Ziehen mit Bearbeiten-Fenster

**Telefonie**
- Anrufen direkt aus dem Browser (Twilio, Server in Frankfurt, Ausweich-Server Dublin, Opus-Codec, `answerOnBridge`: kein Klicken, keine Verzögerung beim Verbinden)
- Power Dialer: wählt eine Liste nacheinander ab, sperrt den Lead für Kollegen, überspringt Kunden, „nicht anrufen“ und gerade erst Angerufene
- Absendernummer pro Person, „Local Presence“ (Nummer mit passender Vorwahl wird automatisch gewählt)
- Eingehende Anrufe wie in einer Telefonanlage: Rufzeiten, Begrüßung, Telefonmenü („Für den Vertrieb die 1“), zuerst der Zuständige, dann Gruppe oder Team (gleichzeitig oder reihum), Weiterleitung aufs Handy mit Annahme per Taste, danach Mailbox
- Verpasste Anrufe und Mailbox-Nachrichten werden zur Aufgabe, der Zuständige wird benachrichtigt
- Mailbox-Nachricht per Klick hinterlassen (Voicemail Drop), Weiterleiten an Kollegen (direkt oder mit Rücksprache), Tastenfeld, Stummschalten
- Teamleiter können live mithören, einflüstern (nur der Kollege hört es) oder sich dazuschalten
- Leitungsqualität (MOS, Verzögerung, Paketverlust) wird je Gespräch gespeichert

**Gesprächsaufnahmen in hoher Qualität**
- Aufnahme auf Knopfdruck, automatisch oder nur die eigene Stimme; Hinweis auf die Aufnahme wird auf Wunsch vorgespielt
- **Zwei getrennte Spuren** (wir / Kunde) als verlustfreie WAV-Datei im eigenen Speicher in Frankfurt; bei Twilio wird die Aufnahme erst gelöscht, wenn sie sicher gespeichert ist
- Keine Aufnahme geht verloren: Bricht das Speichern ab oder geht eine Rückmeldung von Twilio verloren, holt das CRM die Aufnahme automatisch erneut (oder per Klick auf „Erneut holen“)
- Player mit Zwei-Spur-Wellenform, Lautstärke je Seite, „Sprache verbessern“, Tempo, ±10 Sekunden, Markierungen mit Kommentar
- Redeanteile, Gesprächswechsel, längster Monolog des Kunden
- Abschrift (AssemblyAI, Server in der EU) – durch die zwei Spuren ist eindeutig, wer was gesagt hat; Suche in allen Abschriften
- KI-Zusammenfassung mit nächsten Schritten, Einwänden und Stimmung (Claude); Schritte werden per Klick zu Aufgaben
- Löschfrist für Aufnahmen (z. B. nach 90 Tagen automatisch)

**Leads und Vertrieb**
- Leads mit mehreren Kontakten und Nummern, eigene Felder, Verlauf (Anrufe, Notizen, E-Mails, SMS, Termine, eigene Aktivitäten, Änderungen) mit Filter und Suche
- Smart Views mit Filtern, Suche nach Name, Ort, Person oder Nummer, Spalten frei wählbar
- Sammelaktionen: Status/Zuständige ändern, löschen, Sammel-E-Mail, in Workflow aufnehmen; Dubletten finden und zusammenführen
- Opportunities mit mehreren Pipelines, eigene Aktivitäten (wie Custom Activities in Close), Aufgaben-Inbox mit Benachrichtigungen und @Erwähnungen

**E-Mail und SMS**
- Eigenes Postfach verbinden (IONOS, Google Workspace, Microsoft 365 …): Mails aus dem CRM senden, Kopie im „Gesendet“-Ordner, Antworten landen automatisch beim Lead
- Vorlagen mit Platzhaltern, geplanter Versand, Anhänge
- SMS senden und empfangen (Twilio)

**Workflows** (wie Workflows/Sequenzen in Close)
- Auslöser (neuer Lead, Status, Anruf-Ergebnis, Termin, Aktivität …), Schritte mit Wartezeiten: E-Mail, SMS, Anruf-Aufgabe, Aufgabe, Lead ändern, reihum zuweisen, Opportunity, Benachrichtigung, Bedingung
- Versandfenster (z. B. Mo–Fr 8–18 Uhr), Ziel (z. B. Termin gebucht) und „Stoppen bei Antwort“

**Termine**
- Calendly: gebuchte und abgesagte Termine kommen automatisch ins CRM, inklusive Zuordnung zum Opener
- Google Kalender: wird alle 5 Minuten abgeglichen; Termine aus dem CRM landen im Kalender

**Team, Rollen und Rechte** (wie in Close)
- Benutzer anlegen oder per E-Mail einladen, sperren, löschen mit Übergabe der Leads
- Eigene Rollen mit 30 einzelnen Rechten und Lead-Sichtbarkeit (alle / nur eigene / eigene + ohne Zuständigen), Gruppen
- Gesprächsdauer, Status und Aufnahmen setzt nur das Telefonsystem – im Browser lassen sich nur Ergebnis, Notiz und Lead ändern, damit Berichte verlässlich bleiben

**Berichte**
- Anwahlen, erreichte Entscheider, gelegte und gebuchte Termine, Gesprächszeit, Abschlüsse – pro Person und Zeitraum
- Beste Anrufzeiten (Wochentag × Stunde), Ergebnisse, Statuswechsel, Pipeline-Trichter, Auswertung eigener Aktivitäten

**Umzug aus Close**
- Übernahme über die Close-Schnittstelle: Einstellungen, Leads, Kontakte, Opportunities, Verlauf, offene Aufgaben und Aufnahmen – in Etappen, wiederholbar ohne Doppelungen

**Betrieb**
- Diagnose-Seite mit Systemprüfung, Netz- und Audiotest und dem Knopf „Fehlerbericht kopieren“
- Fehlerprotokoll aus allen Browsern und Server-Funktionen
- Hell- und Dunkelmodus, läuft auch am Handy

## Was (noch) fehlt im Vergleich zu Close

- Predictive Dialer (mehrere Leitungen gleichzeitig)
- E-Mail-Öffnungen zählen (Tracking-Pixel)
- Smart-View-Filter aus Close werden beim Umzug nur als Name übernommen und müssen nachgebaut werden

## Kosten

Die genauen Preise stehen in [EINRICHTUNG.md](EINRICHTUNG.md#kosten). Kurz: Hosting der Website kostet nichts, die Datenbank 25 $ im Monat, Telefonie wird pro Minute bei Twilio abgerechnet (rund 3 Cent pro Minute ins deutsche Festnetz), Abschrift und KI-Zusammenfassung kosten zusammen knapp 1 Cent pro Gesprächsminute.

## Für Entwickler

```bash
npm install
npm run dev          # Entwicklungsserver (ohne config.js-Werte: Demo-Modus)
npm run typecheck    # TypeScript prüfen
npm test             # Tests der Browser-Logik (Vitest)
npm run build        # echtes CRM nach dist/
npm run build:demo-page  # Ein-Datei-Demo nach dist-demo/waehlwerk-demo.html
npm run test:functions   # Tests der Server-Funktionen (braucht Deno)
npm run test:db          # Datenbank-Tests (braucht lokales PostgreSQL)
```

| Ordner | Inhalt |
| --- | --- |
| `src/` | Browser-App (React, TypeScript, Vite) |
| `src/lib/store/` | Datenzugriff: `supabaseStore.ts` (echt) und `demoStore.ts` (Demo) |
| `src/lib/phone/` | Telefon: `twilioPhone.ts` (echt) und `demoPhone.ts` (Demo) |
| `supabase/migrations/` | Datenbank-Schema, Rechte (Row Level Security), Berichte, Workflows |
| `supabase/functions/` | Server-Funktionen (siehe unten) |
| `supabase/functions/_shared/` | Gemeinsame Bausteine: Rufverteilung, WAV-Auswertung, E-Mail (SMTP/IMAP/MIME), KI |
| `.github/workflows/` | Automatisches Veröffentlichen von Website und Server |

| Server-Funktion | Aufgabe |
| --- | --- |
| `twilio-voice` | Anweisungen für Twilio bei jedem Anruf (ausgehend, eingehend, Telefonmenü, Mithören) |
| `twilio-status` | Rückmeldungen von Twilio; holt Aufnahmen ab, wertet sie aus und legt sie ab |
| `call-control` | Aktionen während des Anrufs (Aufnahme, Mailbox-Drop, Weiterleiten, Coaching, Abschrift, Aufnahme erneut holen) |
| `twilio-token` | Zugang fürs Browser-Telefon |
| `twilio-sms`, `sms` | SMS empfangen und senden |
| `email` | Postfach verbinden, E-Mails senden, Sammel-E-Mails |
| `jobs` | jede Minute: Workflows, geplante E-Mails/SMS, Postfach-Abruf, Aufnahmen nachholen, Löschfristen, Aufräumen |
| `ai-webhook` | fertige Abschriften übernehmen, Zusammenfassung schreiben |
| `admin` | Team, Rollen, Twilio/Calendly/Google/KI verbinden, Umzug aus Close, Systemstatus |
| `calendly-webhook`, `gcal-sync` | Termine aus Calendly und Google Kalender |

Twilio ruft die Funktionen immer in der Region der Datenbank auf (`forceFunctionRegion`, Standard `eu-central-1`, änderbar über das Secret `CRM_FUNCTION_REGION`). So läuft jede Datenbankabfrage beim Rufaufbau innerhalb von Frankfurt.

## Hilfe bei Problemen

1. Im CRM unter **Einstellungen → Diagnose & Fehler** auf **Fehlerbericht kopieren** klicken.
2. Den Bericht in den Chat mit Claude einfügen und beschreiben, was passiert ist.
3. Die Korrektur in GitHub übernehmen – Website und Server aktualisieren sich danach von selbst.
