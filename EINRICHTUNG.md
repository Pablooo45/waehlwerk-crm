# Einrichtung

Diese Anleitung bringt das CRM vom ZIP-Ordner bis zum ersten echten Anruf. Plane etwa zwei bis drei Stunden ein, dazu ein paar Tage Wartezeit, bis Twilio eure deutsche Telefonnummer freigibt.

## Vorher klären

- **Mit dem Chef abstimmen.** Ins CRM kommen Kontaktdaten von Ansprechpartnern (Name, Telefon, E-Mail) und Gesprächsaufnahmen. Dafür braucht die Firma Auftragsverarbeitungsverträge (AVV) mit Supabase und Twilio, beide bieten sie an – und mit AssemblyAI und Anthropic, wenn ihr Abschriften und KI-Zusammenfassungen nutzt. Die Datenbank und alle Aufnahmen liegen in Frankfurt. Twilio verarbeitet Verbindungsdaten (Nummern, Dauer) auch in den USA; Aufnahmen werden direkt nach dem Gespräch in eure Datenbank kopiert und bei Twilio gelöscht. AssemblyAI schreibt auf Servern in der EU ab; Anthropic (Claude) verarbeitet die Abschrift für die Zusammenfassung.
- **Gesprächsaufnahmen nur mit Einwilligung.** Nach § 201 StGB darf ein Gespräch nur aufgenommen werden, wenn der Gesprächspartner zustimmt. Möglichkeiten im CRM: Aufnahme „Auf Knopfdruck“ (das CRM erinnert vor dem Start an die Einwilligung), „Automatisch, nur eigene Stimme“ fürs Training oder automatische Aufnahme mit vorgespieltem Hinweis („Dieses Gespräch wird … aufgezeichnet“). Dazu eine Löschfrist festlegen. Das ist keine Rechtsberatung – im Zweifel den Datenschutzbeauftragten fragen.
- **Firmenunterlagen für die Telefonnummer.** Twilio vergibt deutsche Nummern nur an Firmen und verlangt einen Nachweis (z. B. Handelsregisterauszug oder Gewerbeanmeldung) und eine Adresse im Vorwahlbereich.

Du brauchst: ein GitHub-Konto, ein Supabase-Konto, ein Twilio-Konto (mit Kreditkarte), optional einen bezahlten Calendly-Tarif, Zugriff auf euren Google-Kalender, für Abschriften ein AssemblyAI-Konto und für Zusammenfassungen ein Anthropic-Konto.

---

## Schritt 1: Datenbank bei Supabase anlegen

1. Auf [supabase.com](https://supabase.com) anmelden (geht mit dem GitHub-Konto) und **New project** wählen.
2. Name: **`waehlwerk-crm`** – unter diesem Namen findet GitHub das Projekt später von selbst. Bei **Database Password** auf „Generate a password“ klicken und das Passwort sicher speichern (Passwortmanager); im Alltag braucht ihr es nicht. Region: **Central EU (Frankfurt)** – darauf ist der schnelle Rufaufbau ausgelegt.
3. Tarif: Zum Ausprobieren reicht **Free**. Für den echten Betrieb **Pro** (25 $ im Monat): Free-Projekte pausieren nach einer Woche ohne Nutzung, haben nur 1 GB Dateispeicher und erlauben höchstens 50 MB je Datei. Pro hat 100 GB und tägliche Backups (7 Tage).
4. **Access Token** erzeugen: [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) (oben rechts dein Profil → Access Tokens) → „Generate new token“, Name z. B. `GitHub`. Den Token kopieren – er wird nur einmal angezeigt.
5. Nur bei Pro: **Storage → Settings → Global file size limit** auf z. B. 500 MB stellen. Dann bleiben auch sehr lange Gespräche (über 25 Minuten) verlustfreie WAV-Dateien. Bei 50 MB speichert das CRM solche Aufnahmen automatisch als MP3.

Mehr ist in Supabase nicht nötig: Tabellen, Zugriffsrechte, Zeitplan (`pg_cron`, `pg_net`), Server-Funktionen, Website-Adresse und Anmelde-Einstellungen richtet GitHub in Schritt 3 selbst ein.

## Schritt 2: Code zu GitHub bringen

1. Auf github.com ein neues Repository anlegen: oben rechts **+** → **New repository** → Name `waehlwerk-crm` → **Public** → ohne README → **Create repository**.
   - Mit dem kostenlosen GitHub-Tarif funktioniert die Website (GitHub Pages) nur bei einem **öffentlichen** Repository. Das ist unbedenklich: Im Code stehen keine Passwörter und keine Kundendaten, die liegen geschützt in Supabase. Wer das Repository privat halten will, braucht GitHub Pro.
2. Den Code hochladen – entweder Claude darum bitten (lädt ihn direkt ins Repository) oder selbst mit [GitHub Desktop](https://desktop.github.com): ZIP entpacken → **File → Add local repository** → Ordner wählen → **Publish repository**. Nicht per Drag-and-drop im Browser hochladen: Dabei fehlen oft die versteckten Ordner `.github` und die Datei `.gitignore`.
3. Im Repository: **Settings → Secrets and variables → Actions** → Reiter **Secrets** → „New repository secret“:
   - Name `SUPABASE_ACCESS_TOKEN`, Wert = Access Token aus Schritt 1.

   Das ist der einzige Eintrag. Projekt, Adresse und öffentlicher Schlüssel holen sich die Workflows damit selbst. Nur wenn es in eurem Supabase-Konto mehrere Projekte gibt und keines `waehlwerk-crm` heißt, zusätzlich unter **Variables** `SUPABASE_PROJECT_REF` eintragen (der Teil `abcdefgh` aus `https://abcdefgh.supabase.co`). Optional: Variable `APP_NAME` = Name, der oben links steht (Standard: Wählwerk).
4. **Settings → Pages** → bei „Build and deployment“ als Source **GitHub Actions** wählen.

## Schritt 3: Installieren lassen

Sobald der Code im Repository liegt, starten die beiden Workflows „Server“ und „Website“ von selbst (Reiter **Actions**). Nach drei bis fünf Minuten haben beide einen grünen Haken. Waren Secret oder Pages-Einstellung beim Hochladen noch nicht da: im Reiter **Actions** links den Workflow wählen → **Run workflow**.

- **Server** prüft die Server-Funktionen, legt alle Tabellen samt Zugriffsrechten an, schaltet den Zeitplan ein und installiert die zwölf Server-Funktionen (`admin`, `ai-webhook`, `call-control`, `calendly-webhook`, `email`, `gcal-sync`, `jobs`, `sms`, `twilio-sms`, `twilio-status`, `twilio-token`, `twilio-voice`).
- **Website** baut das CRM, veröffentlicht es und trägt die Adresse in Supabase ein (Site URL und Redirect URLs, damit Links aus „Passwort vergessen?“ und aus Einladungen funktionieren). Beim ersten Mal schaltet es außerdem die offene Registrierung ab – neue Kollegen legt ein Admin im CRM an.

Ab jetzt läuft das bei jeder Änderung am Code automatisch.

Ohne GitHub geht es auch im Terminal (im Projektordner):

```bash
npx supabase login
npx supabase link --project-ref DEIN_PROJECT_REF
npx supabase db push
npx supabase functions deploy
```

Optionale Einstellungen unter Supabase → Edge Functions → Secrets:
- `TWILIO_EDGE`: Twilio-Server fürs Browser-Telefon, Standard `frankfurt,dublin`
- `CRM_FUNCTION_REGION`: Region, in der Twilio die Funktionen aufruft. Setzt der Workflow „Server“ passend zur Region des Projekts (Standard `eu-central-1` = Frankfurt); `off` schaltet die feste Region ab.
- `CRM_FUNCTIONS_URL`: nur nötig, wenn ihr Supabase unter einer eigenen Domain betreibt

## Schritt 4: Adresse des CRM

Die Adresse steht unter **Settings → Pages**, z. B. `https://deinname.github.io/waehlwerk-crm/`. Als Lesezeichen an alle verteilen. Am Handy im Browser öffnen und **Zum Home-Bildschirm** hinzufügen – dann startet das CRM wie eine App.

Steht oben auf der Seite „Demo-Modus“, kennt die Website ihre Datenbank noch nicht: Secret `SUPABASE_ACCESS_TOKEN` prüfen (Schritt 2) und den Workflow „Website“ erneut starten.

## Schritt 5: Ersten Admin anlegen

1. Supabase → **Authentication → Users → Add user → Create new user**: deine E-Mail und ein Passwort, **Auto Confirm User** einschalten.
   Der erste Benutzer wird automatisch Admin. Wichtig: erst anlegen, wenn der Workflow „Server“ grün ist. Wer vorher angelegt wurde, hat kein Profil – dann den Benutzer löschen und neu anlegen.
2. Im CRM anmelden.
3. **Hintergrundaufgaben einschalten**: Nach der ersten Anmeldung steht oben der Hinweis „Die Hintergrundaufgaben sind noch aus“ → **Einschalten** (geht auch unter Einstellungen → Diagnose & Fehler bei „Hintergrundaufgaben“). Damit laufen jede Minute Workflows, geplante E-Mails und SMS, der Postfach-Abruf, das Nachholen von Aufnahmen und die Löschfristen, alle 5 Minuten der Kalender-Abgleich. Kontrolle unter Einstellungen → Diagnose & Fehler („Hintergrundaufgaben“).

## Schritt 6: Telefonie mit Twilio

1. Auf [twilio.com](https://www.twilio.com) ein Konto mit der Firmen-E-Mail anlegen und **upgraden** (Kreditkarte hinterlegen, Guthaben aufladen, automatisches Nachladen einschalten). Mit einem Testkonto können nur bestätigte Nummern angerufen werden, und Angerufene hören einen Twilio-Hinweis.
2. **Voice → Settings → Geo permissions**: Deutschland freischalten (und weitere Länder, die ihr anruft, z. B. Österreich und die Schweiz). Für SMS zusätzlich **Messaging → Settings → Geo permissions**.
3. Telefonnummer:
   - **Deutsche Ortsnummer kaufen** (empfohlen): Phone Numbers → Buy a number → Germany → Local, z. B. Vorwahl 069. Twilio fragt dabei ein „Regulatory Bundle“ ab: Firmenangaben, Adresse im Vorwahlbereich, Nachweis wie Handelsregisterauszug oder Gewerbeanmeldung. Die Prüfung dauert ein paar Tage. Über diese Nummer kommen dann auch Rückrufe ins CRM. Mehrere Nummern mit verschiedenen Vorwahlen nutzt das CRM für „Local Presence“.
   - **Bis dahin oder zusätzlich**: eure bestehende Firmennummer bestätigen (Phone Numbers → Verified Caller IDs → Add). Dann sehen Angerufene eure gewohnte Nummer. Rückrufe landen in dem Fall aber weiter auf eurer alten Telefonanlage.
   - **Für SMS** (optional): eine deutsche Handynummer (Mobile) – deutsche Ortsnummern können keine SMS.
4. Im CRM: **Einstellungen → Telefonie** → **Account SID** und **Auth Token** eintragen (Twilio-Startseite, Bereich „Account Info“) → **Verbinden & einrichten**.
   Das CRM richtet den Rest selbst ein: Schlüssel fürs Browser-Telefon, Twilio-App, Anrufe und SMS eurer Nummern ins CRM. Nach dem Kauf weiterer Nummern unter **Telefonnummern** auf **Von Twilio laden** klicken.
5. **Einstellungen → Telefonie**: Standard-Absendernummer, Local Presence, erlaubte Länder (Standard +49, +43, +41 – schützt vor teuren Fehlwahlen), Klingeldauer im Power Dialer, Mailbox-Ansage und auf Wunsch der **Konferenzmodus** (nötig für Mithören, Einflüstern, Aufschalten und Übergabe mit Rücksprache).
6. **Einstellungen → Telefonnummern**, je Nummer: wer klingelt (Personen oder Gruppe, gleichzeitig oder reihum), ob bekannte Anrufer zuerst beim Zuständigen landen, Rufzeiten, Weiterleitung, Telefonmenü, Begrüßung.
7. **Einstellungen → Aufnahmen & Abschriften**: Aufnahme-Modus, Hinweis an den Gesprächspartner, Format (WAV empfohlen), Löschfrist.
8. Jede Person unter **Mein Profil**: „Ich bin für eingehende Anrufe erreichbar“ einschalten und auf Wunsch die Weiterleitung aufs Handy. Ein weitergeleiteter Anruf gilt erst als angenommen, wenn am Handy die 1 gedrückt wird – so landet kein Anruf auf der Handy-Mailbox. Die eigene Absendernummer legt ein Admin unter **Benutzer** fest.
9. Testen: **Einstellungen → Diagnose & Fehler → Netz- und Audiotest**, danach die eigene Handynummer anrufen und einmal die eigene Twilio-Nummer.

## Schritt 7: Team, Rollen und Rechte

1. **Einstellungen → Rollen & Rechte**: Die Rollen Admin, Super User, User und Eingeschränkt gibt es schon. Eigene Rollen (z. B. „Opener“) mit einzelnen Rechten und Lead-Sichtbarkeit anlegen.
2. **Einstellungen → Gruppen**: z. B. „Opener-Team“, „Closer“ – für die Rufverteilung und Berichte.
3. **Einstellungen → Benutzer → Person hinzufügen**: Name, E-Mail, Funktion, Rolle, Gruppen. Entweder ein Startpasswort weitergeben oder eine Einladung per E-Mail schicken lassen.

Jede Person braucht:
- Chrome oder Edge (aktuell)
- ein kabelgebundenes USB-Headset
- beim ersten Anruf die Mikrofon-Erlaubnis im Browser

## Schritt 8: E-Mail-Postfach verbinden (jede Person)

**Einstellungen → E-Mail-Postfach**: Anbieter wählen (IONOS, Google, Microsoft, STRATO oder andere), E-Mail-Adresse und Passwort → **Prüfen** → **Verbinden**.
- Das CRM nutzt die verschlüsselten Ports **465 (Postausgang)** und **993 (Posteingang)**. Port 587 ist bei Supabase gesperrt.
- Google Workspace und Microsoft 365 brauchen bei aktivierter Zwei-Faktor-Anmeldung ein **App-Passwort** statt des normalen Passworts.
- Ab dann gehen E-Mails aus dem CRM über das eigene Postfach (mit Kopie im „Gesendet“-Ordner), und Antworten von Kontakten erscheinen innerhalb von 5 Minuten beim Lead. Beim ersten Abruf werden nur die Mails der letzten 7 Tage übernommen.

## Schritt 9: Calendly und Google Kalender

**Calendly**
1. In Calendly: **Integrationen & Apps → API und Webhooks → Persönlichen Zugangs-Token erstellen**. Am besten mit dem Konto, dem die Termin-Links gehören. Für Webhooks braucht dieses Konto einen bezahlten Tarif (z. B. Standard oder Teams).
2. Im CRM: **Einstellungen → Kalender & Calendly** → Token einfügen → **Verbinden**. Das CRM meldet sich bei Calendly für neue und abgesagte Buchungen an und übernimmt eure Termin-Links.
3. So funktioniert die Zuordnung: „Termin buchen“ im CRM öffnet den Calendly-Link mit Name und E-Mail vorausgefüllt und einer Markierung für Lead und Opener. Die Buchung landet dadurch beim richtigen Lead und zählt für den richtigen Opener, auch wenn der Kunde den Link erst später nutzt.

**Google Kalender**
1. [console.cloud.google.com](https://console.cloud.google.com) → neues Projekt, z. B. „CRM Kalender“.
2. **APIs & Services → Library** → „Google Calendar API“ → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account**, Name z. B. `crm-kalender`. Rollen sind nicht nötig.
4. Das Dienstkonto öffnen → **Keys → Add key → Create new key → JSON**. Die Datei wird heruntergeladen.
   Meldet Google, dass Schlüssel gesperrt sind („key creation is disabled“), muss ein Google-Workspace-Admin für dieses Projekt die Richtlinie `iam.disableServiceAccountKeyCreation` ausschalten.
5. Im CRM: **Einstellungen → Kalender & Calendly → Schlüsseldatei (.json) hochladen**.
6. In Google Kalender: euren Team-Kalender → **Einstellungen und Freigabe → Für bestimmte Personen freigeben** → E-Mail des Dienstkontos (endet auf `iam.gserviceaccount.com`) mit der Berechtigung **„Änderungen an Terminen vornehmen“**.
7. Die **Kalender-ID** (Einstellungen des Kalenders → „Kalender integrieren“) im CRM eintragen → **Verbinden**.

## Schritt 10: Abschriften und KI-Zusammenfassungen

1. Konto bei [assemblyai.com](https://www.assemblyai.com) anlegen → **API Keys** → Schlüssel kopieren → im CRM **Einstellungen → KI & Abschriften** eintragen. Abgeschrieben wird auf Servern in der EU.
2. Für Zusammenfassungen: Konto bei [console.anthropic.com](https://console.anthropic.com) → **API Keys** → Schlüssel im CRM eintragen. Das CRM nutzt Claude Sonnet 5.5.
3. **Einstellungen → Aufnahmen & Abschriften**: „Jedes Gespräch automatisch abschreiben“ und „Zusammenfassung schreiben“ einschalten – oder ausgeschaltet lassen und bei einzelnen Gesprächen auf **Abschrift erstellen** klicken.

## Schritt 11: Umzug aus Close

1. Zuerst alle Kollegen anlegen (Schritt 7) – mit derselben E-Mail-Adresse wie in Close. Darüber werden Leads, Anrufe und Aufgaben den richtigen Personen zugeordnet.
2. In Close: **Settings → Developer → API Keys → + New API Key**.
3. Im CRM: **Einstellungen → Umzug aus Close** → Schlüssel einfügen → **Verbinden**. Das CRM zeigt, wie viele Leads, Kontakte und Aktivitäten es findet.
4. Auswählen, was übernommen wird, und starten. Das Fenster dabei offen lassen; bei vielen Daten dauert der Verlauf eine Weile. Gesprächsaufnahmen sind abgewählt, weil sie am längsten dauern – sie lassen sich später in einem zweiten Lauf holen.
5. Den Umzug könnt ihr jederzeit wiederholen: Schon übernommene Leads und Aktivitäten werden erkannt und nicht doppelt angelegt. So könnt ihr Close bis zum Umstieg parallel weiterbenutzen.

Hinweise: Beim Umzug starten keine Workflows und niemand bekommt Benachrichtigungen. Die Filter von Smart Views gibt Close nicht in lesbarer Form heraus – die Namen werden übernommen, die Filter bitte im CRM nachbauen (die wichtigsten sind schon eingerichtet). Alternativ lassen sich Leads auch als CSV aus Close exportieren und unter **Einstellungen → Import & Export** einlesen.

---

## Damit Telefonate ohne Verzögerung laufen

- **LAN-Kabel statt WLAN.** Ein Gespräch braucht nur etwa 40 kbit/s, wichtig ist eine stabile Verbindung ohne Aussetzer.
- **Kabelgebundenes USB-Headset**, kein Bluetooth. Bluetooth verzögert und verschlechtert die Sprachqualität.
- **VPN aus**, große Uploads und Videostreams während Telefonaten vermeiden.
- **Netztest** unter Einstellungen → Diagnose: Eine Verzögerung (RTT) unter 150 ms ist gut, über 300 ms fallen sich Gesprächspartner ins Wort.
- **Firmen-Firewall**: Für Sprache muss UDP auf den Ports 10000–60000 zu Twilio (168.86.128.0/18) erlaubt sein, für die Steuerung TCP 443 zu `*.twilio.com`.

Das CRM nutzt den Twilio-Server in Frankfurt (Ausweich: Dublin) und den Opus-Codec, der kurze Netzaussetzer gut überbrückt. Ohne Konferenzmodus wird der Kunde direkt verbunden („answerOnBridge“) – das ist der kürzeste Weg. Die Server-Funktionen laufen in Frankfurt neben der Datenbank, damit der Rufaufbau nicht auf Abfragen über den Atlantik wartet. Bei Aussetzern zeigt die Anrufleiste eine Warnung und verbindet automatisch neu; die Leitungsqualität jedes Gesprächs wird gespeichert.

## Kosten

Stand Oktober 2026, Preise in US-Dollar, wie die Anbieter abrechnen.

| Posten | Preis |
| --- | --- |
| Browser-Telefon (jede Gesprächsminute, ein- und ausgehend) | 0,004 $ pro Minute |
| Anruf ins deutsche Festnetz | 0,0283 $ pro Minute |
| Anruf auf deutsche Handys | 0,042 $ pro Minute |
| Eingehender Anruf auf eine Ortsnummer | 0,01 $ pro Minute |
| Konferenzmodus (nur wenn eingeschaltet) | ab 0,0018 $ pro Teilnehmer und Minute |
| Gesprächsaufnahme | 0,0025 $ pro Minute |
| Deutsche Ortsnummer | 1,35 $ pro Monat |
| SMS nach Deutschland / eingehende SMS | 0,112 $ / 0,0075 $ pro SMS |
| Deutsche Handynummer (nur für SMS nötig) | 30 $ pro Monat |
| Abschrift (AssemblyAI, Universal-3.5 Pro) | 0,21 $ pro Stunde und Spur – ein Gespräch mit zwei Spuren also 0,007 $ pro Minute |
| KI-Zusammenfassung (Claude Sonnet 5.5) | 2 $ je Million Eingabe- und 10 $ je Million Ausgabe-Tokens – rund 1 Cent pro Gespräch |
| Supabase Pro (Datenbank, 100 GB Dateien, Server-Funktionen, Backups) | 25 $ pro Monat |
| Website auf GitHub Pages | kostenlos |

Twilio rechnet jeden Anruf auf volle Minuten auf: Ein Gespräch von 2:20 Minuten ins Festnetz kostet 3 × (0,0283 + 0,004) $ ≈ 0,10 $. Ein nicht abgenommener Anruf kostet nur die Browser-Minute, also etwa 0,004 $.

Speicherplatz für Aufnahmen: Eine Minute Gespräch als WAV mit zwei Spuren braucht knapp 2 MB. 9.450 Minuten im Monat sind also gut 18 GB – mit einer Löschfrist von 90 Tagen bleibt das dauerhaft unter den 100 GB von Supabase Pro.

Rechenbeispiel: 5 Leute mit je 90 abgerechneten Gesprächsminuten am Tag ins Festnetz, 21 Arbeitstage, alles aufgenommen, abgeschrieben und zusammengefasst:
- Telefonie: 9.450 Minuten × 0,0323 $ ≈ 305 $
- Aufnahmen: 9.450 Minuten × 0,0025 $ ≈ 24 $
- Abschriften: 9.450 Minuten × 0,007 $ ≈ 66 $ (nur bei angenommenen Gesprächen, tatsächlich meist deutlich weniger)
- Zusammenfassungen: je nach Zahl der Gespräche ≈ 10–30 $
- Nummer und Supabase: ≈ 26 $
- **zusammen ≈ 430–450 $ im Monat**, ohne Lizenzkosten pro Person

Quellen: [Twilio-Preise Deutschland (Telefonie)](https://www.twilio.com/en-us/voice/pricing/de), [Twilio-Preise Deutschland (SMS)](https://www.twilio.com/en-us/sms/pricing/de), [Twilio: Rundung auf Minuten](https://support.twilio.com/hc/en-us/articles/223132307-How-do-you-round-minutes-for-billing), [Twilio: Vorgaben für deutsche Nummern](https://www.twilio.com/en-us/guidelines/de/regulatory), [Twilio: Netzwerk-Anforderungen](https://www.twilio.com/docs/voice/sdks/network-connectivity-requirements), [AssemblyAI-Preise](https://www.assemblyai.com/pricing), [Claude-API-Preise](https://platform.claude.com/docs/en/about-claude/pricing), [Supabase-Preise](https://supabase.com/pricing), [Supabase: Dateigrößen](https://supabase.com/docs/guides/storage/uploads/file-limits), [Supabase-Backups](https://supabase.com/features/database-backups), [Calendly-API und Tarife](https://calendly.com/help/calendly-api-overview), [GitHub-Tarife](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)

## Wenn etwas nicht klappt

Erster Schritt immer: **Einstellungen → Diagnose & Fehler → Fehlerbericht kopieren** und den Bericht an Claude schicken.

| Problem | Lösung |
| --- | --- |
| Oben steht „Demo-Modus“ | Secret `SUPABASE_ACCESS_TOKEN` fehlt oder ist abgelaufen (Schritt 2), danach Workflow „Website“ neu starten |
| „Zu diesem Login gibt es kein Profil“ | Benutzer wurde vor Schritt 3 angelegt: in Supabase löschen und neu anlegen |
| „Dein Zugang ist noch nicht freigeschaltet“ | Die Person wurde nicht im CRM angelegt: Einstellungen → Benutzer → Person hinzufügen |
| Diagnose: Server-Funktionen nicht erreichbar | Im Reiter Actions das Protokoll des Workflows „Server“ ansehen, dann **Run workflow** |
| Diagnose: Hintergrundaufgaben laufen nicht | Supabase → Database → Extensions: `pg_cron` und `pg_net` aktiv? Dann unter Diagnose & Fehler auf **Neu einschalten** |
| „Telefonie nicht eingerichtet“ | Schritt 6, Punkt 4 |
| „Deine Rolle darf nicht telefonieren“ | Einstellungen → Rollen & Rechte: Recht „Telefonieren“ für die Rolle der Person |
| Fehler 13227 oder 21215 beim Wählen | Land ist in Twilio nicht freigeschaltet: Voice → Settings → Geo permissions |
| „Mikrofon blockiert“ | Im Browser links neben der Adresse auf das Schloss → Mikrofon erlauben → Seite neu laden |
| Gesprächspartner klingt abgehackt oder verzögert | Netztest in der Diagnose, LAN-Kabel, Headset, VPN aus |
| Eingehende Anrufe klingeln bei niemandem | Einstellungen → Telefonnummern: Rufzeiten und Personen prüfen; ist unter Mein Profil „Ich bin für eingehende Anrufe erreichbar“ an? |
| In der Aufnahme sind „Wir“ und „Kunde“ vertauscht | Im Gespräch unter dem Player auf **Spuren tauschen** klicken |
| „Die Aufnahme konnte nicht gespeichert werden“ | Kein Grund zur Sorge: Bei Twilio wird eine Aufnahme erst gelöscht, wenn sie sicher im CRM liegt. Das CRM holt sie automatisch bis zu dreimal erneut, sonst im Gespräch auf **Erneut holen** klicken. Den Grund zeigt das Fehlerprotokoll (Diagnose & Fehler) |
| Aufnahme bleibt lange bei „wird gespeichert“ | Laufen die Hintergrundaufgaben? (Diagnose & Fehler) – sie holen hängengebliebene Aufnahmen nach 10 Minuten neu |
| E-Mail: „Port 587 ist gesperrt“ | Beim Postausgang Port 465 (SSL/TLS) eintragen |
| E-Mail: Anmeldung fehlgeschlagen | Bei Google/Microsoft ein App-Passwort verwenden; bei IONOS das Passwort des Postfachs, nicht das des Kundenkontos |
| SMS kommen nicht an | Messaging → Settings → Geo permissions in Twilio; die Absendernummer muss eine Handynummer sein |
| Calendly-Termine kommen nicht an | Bezahlter Calendly-Tarif nötig, Token neu verbinden |
| Google-Kalender meldet „nicht gefunden“ oder 403 | Kalender ist nicht mit dem Dienstkonto geteilt oder nur „Frei/Gebucht sehen“: Schritt 9, Google Punkt 6 |
| Link aus „Passwort vergessen?“ oder Einladung funktioniert nicht | Supabase → Authentication → URL Configuration: Site URL und Redirect URLs müssen die Adresse aus Schritt 4 enthalten (setzt der Workflow „Website“) |

## Änderungen und Updates

Jede Änderung, die in GitHub landet, wird automatisch übernommen: Die Website ist nach etwa zwei Minuten aktualisiert, Datenbank und Server-Funktionen nach etwa vier. Am einfachsten: Claude beschreibt die Änderung oder liefert die geänderten Dateien, du übernimmst sie in GitHub Desktop mit „Commit“ und „Push“.
