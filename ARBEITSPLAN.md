# Arbeitsplan: Wählwerk fertig machen vor dem Start

Nico (Vertrieb, Salus Digital) stellt das Telefon-Team von Close auf Wählwerk um. Vor dem Start soll Wählwerk **so aufgebaut sein und so funktionieren wie Close** (gleiche Funktionen, gleiche Abläufe, eigenes Aussehen ohne Close-Branding), **maximal optimiert und fehlerfrei**. Diese Datei ist der gemeinsame Stand für alle Arbeitssitzungen, auch für die automatischen Läufe, die weitermachen, wenn eine Sitzung (z. B. wegen des Nutzungslimits) stehen bleibt.

## Regeln für jede Sitzung

1. Zuerst diese Datei, dann `README.md` und `EINRICHTUNG.md` lesen.
2. **Nur eine Sitzung arbeitet gleichzeitig.** Vor dem Start: `git fetch origin main && git log -1 --format=%cI FETCH_HEAD`. Ist der letzte Commit auf `main` jünger als **100 Minuten**, arbeitet vermutlich gerade eine andere Sitzung: nichts ändern, beenden.
3. **Lebenszeichen:** Während der Arbeit mindestens alle **45 Minuten** etwas auf `main` pushen – einen fertigen Teilschritt oder nur den Abschnitt „Stand“ unten.
4. Nach jeder erledigten Aufgabe: Tests (unten), Commit mit deutscher Nachricht (was es dem Team bringt), `git pull --rebase origin main`, Push, Haken hier setzen, Zeile im Protokoll.
5. **Datenbank:** Schema-Änderungen nur als **neue** Datei in `supabase/migrations/` (Zeitstempel im Namen). Bestehende Migrationen nie ändern – die Datenbank kann inzwischen live sein.
6. **Sicherheit:** keine Konten anlegen, keine Passwörter, Tokens oder API-Schlüssel irgendwo eintragen, keine OAuth-Freigaben erteilen, keine Kundendaten aus Close lesen. Close dient nur als Vorbild für Aufbau und Abläufe; in der Oberfläche steht der Name Close nur beim Umzug.
7. **Oberfläche:** Deutsch, einfach, Du-Form. Jede Änderung auf Desktop (1440 px), Handy (390 px) und im Dunkelmodus ansehen (Bildschirmfoto).
8. Nicht nachfragen (Nico ist oft nicht da): die vernünftigste Lösung wählen und im Protokoll begründen. Ausnahme: Aufgaben, die hier ausdrücklich „nur nach Rückfrage“ heißen.
9. Wenn alle Aufgaben erledigt sind: den geplanten Auftrag **„Wählwerk weiterbauen“** abschalten (`list_triggers` → `update_trigger` mit `enabled: false`) und das im Protokoll vermerken.

## Tests

| Was | Befehl | Einmalig nötig |
| --- | --- | --- |
| Typen | `npm run typecheck` | `npm ci` |
| Logik | `npm test` | – |
| Server-Funktionen | `npm run test:functions` | Deno, z. B. `npm i -g deno` |
| Datenbank | `PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run test:db` | PostgreSQL 16 starten, siehe unten |
| Echter Betrieb | `npm run test:real` | PostgreSQL 16, Deno, Playwright (siehe unten) |
| Browser (Demo) | `npm run test:e2e` | `pip install --break-system-packages playwright==1.56.0` (passt zum vorinstallierten Chromium 1194) |

PostgreSQL 16 für die Datenbank-Tests (als root; falls es fehlt: `apt-get install -y postgresql-16`):

```bash
mkdir -p /var/tmp/pgtest && chown postgres /var/tmp/pgtest
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/tmp/pgtest/data"   # nur beim ersten Mal
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/pgtest/data -o '-p 54329 -k /tmp' -l /var/tmp/pgtest/pg.log start"
```

Docker-Registries sind in der Arbeitsumgebung gesperrt; Downloads von GitHub-Releases funktionieren.

## Aufgaben

### A – Sichern
- [x] A1 Handy-Ansichten (Einstellungs-Listen, Smart Views), Gesprächsnotiz, Browser-Tests ins Repo (`tests/e2e`, `npm run test:e2e`)
- [x] A2 Dieser Arbeitsplan und die automatische Fortsetzung

### B – Echter Betrieb geprüft (wichtigste Aufgabe)
Bisher ist vor allem die Demo-Fassung durchgeklickt. Der echte Betrieb (Supabase + Server-Funktionen) muss genauso sicher laufen.
- [x] B0 Abgleich Code ↔ Datenbank: `scripts/check-queries.mjs` prüft bei `npm run test:db` alle Abfragen (Tabellen, Spalten, Verknüpfungen, Filter, Felder beim Speichern – auch über TypeScript-Typen –, RPC-Parameter, Speicher-Buckets, Realtime). Stand: 281 Abfragen, alle passend.
- [x] B1 Lokale Supabase-Umgebung ohne Docker: `scripts/local-stack.sh start|stop|status` – PostgreSQL 16, PostgREST 12 und Supabase Auth (offizielle GitHub-Releases, Nico hat das erlaubt), Server-Funktionen direkt in einem Deno-Gateway, Speicher- und Realtime-Attrappe, Website auf Port 54320. Wie bei Supabase höchstens 1000 Zeilen pro Abfrage.
- [x] B2 Website im echten Modus durchgeklickt (`tests/real/flows.py`): Anmelden, Lead-Seite (Notiz, Aktivität, Anruf protokollieren, Status, Feld, Aufgabe, Opportunity, Verlauf-Suche), Hinweise ohne Postfach/Twilio, neuer Lead, Sammeländerung über 2.500 Leads, Status mit über 1000 Leads löschen, Einstellungen, Team (Server-Funktion), Pipeline ziehen, eingeschränkte Rolle (sieht nur eigene/freie Leads, keine Teamverwaltung).
- [x] B3 Gefundene Fehler behoben (Smart-View-Filter „leer/ausgefüllt“ bei Mehrfachauswahl). Dauerhaft: `npm run test:real` (Filter-Vergleich Datenbank ↔ JavaScript über alle Felder und Bedingungen + Durchklick-Test), läuft auch bei jeder Änderung auf GitHub.

### C – Close-Funktionen, die noch fehlen
- [x] C1 E-Mail-Öffnungen und Link-Klicks erfassen wie in Close: Server-Funktion `email-track` (signierte Links, keine offene Weiterleitung), im Verlauf „2× geöffnet / 1× geklickt“ mit Liste, auf Wunsch Hinweis in der Inbox, unter Einstellungen → E-Mail-Postfach fürs Team schaltbar (standardmäßig aus, TDDDG). Getestet in Deno, Datenbank und im echten Betrieb.
- [ ] C2 Smart Views beim Close-Umzug mit ihren Filtern übernehmen (Close-Abfrage → eigene Filter, soweit übersetzbar; der Rest als Hinweis an der Smart View).
- [ ] C3 Notizen mit Formatierung wie in Close (fett, kursiv, Listen, Links) – im Editor und im Verlauf.
- [ ] C4 Predictive Dialer (mehrere Leitungen gleichzeitig) – **nur nach Rückfrage bei Nico**: In Deutschland heikel, weil dabei „stille Anrufe“ entstehen (Kunde hebt ab, niemand ist dran).

### D – Leistung und Stabilität
- [ ] D1 20.000 Leads: Leadliste, Suche, Smart-View-Zählungen und Lead-Seite bleiben schnell (Indizes, Seitenweise laden, Zählungen begrenzen) – im lokalen Stack mit Testdaten messen.
- [ ] D2 Fehlerfälle verständlich: Internet weg, Anmeldung abgelaufen, Mikrofon oder Twilio nicht verfügbar, Server-Funktion antwortet nicht.

### E – Abschluss
- [ ] E1 Rundgang Desktop, Handy, Dunkelmodus; Texte und Abstände glätten.
- [ ] E2 README und EINRICHTUNG aktualisieren, Demo neu bauen.

## Stand

- 2026-10-12: C1 erledigt. Als Nächstes C2 (Smart Views aus Close mit Filtern).

## Protokoll

- 2026-10-10 – Handy-Ansichten der Einstellungs-Listen und Smart Views, Gesprächsnotiz während des Anrufs, „Nächster Lead“ aus der Inbox; Browser-Tests ins Repo übernommen; Arbeitsplan angelegt.
- 2026-10-10 – Abgleich aller Datenbank-Abfragen mit dem Schema (281 Abfragen, keine Abweichung); fängt Tippfehler in Tabellen, Spalten, Verknüpfungen, Feldern und Funktionen.
- 2026-10-10 – Echter Betrieb geprüft: lokale Supabase-Umgebung (`scripts/local-stack.sh`), Durchklick-Test mit zwei Rollen und Filter-Vergleich (239 Bedingungen). Gefunden und behoben: Filter „ist leer/ausgefüllt“ für Mehrfachauswahl-Felder zählte eine leere Auswahl als ausgefüllt.
- 2026-10-12 – E-Mail-Öffnungen und Link-Klicks (C1). Entscheidung: standardmäßig aus, weil Zählbild und umgeleitete Links nach TDDDG meist eine Einwilligung brauchen; Klick zählt auch als Öffnung; Abrufe in den ersten 10 Sekunden nach dem Versand zählen nicht (Virenscanner); die Kopie im Gesendet-Ordner bleibt ohne Zählbild, damit das eigene Öffnen nicht zählt.
