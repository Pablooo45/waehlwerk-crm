-- =====================================================================
--  Wählwerk CRM – Datenbank, Teil 4: Startwerte
--  Rollen wie in Close und die Einrichtung aus dem Close-Konto der
--  Salus Digital GmbH (Status, Pipelines, Ergebnisse, Felder, Formulare,
--  Smart Views, Vorlagen). Alles lässt sich später unter Einstellungen ändern.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Rollen (wie in Close: Admin, Super User, User, Eingeschränkt)
-- ---------------------------------------------------------------------
insert into public.roles (id, name, description, is_builtin, permissions, lead_visibility, sort) values
  ('admin', 'Admin', 'Darf alles, auch Benutzer, Rollen, Telefonie und Abrechnung verwalten.', true,
   public.all_permissions(), 'all', 10),
  ('superuser', 'Super User', 'Darf alles außer die Organisation selbst verwalten (Benutzer, Rollen, Telefonie-Einstellungen).', true,
   array_remove(public.all_permissions(), 'manage_organization'), 'all', 20),
  ('user', 'User', 'Normales Teammitglied: telefoniert, bearbeitet Leads und sieht Team-Berichte.', true,
   array['use_ai', 'bulk_email', 'import', 'bulk_workflow', 'calling', 'delete_leads',
         'delete_own_activities', 'delete_own_opportunities', 'delete_own_tasks',
         'manage_others_activities', 'manage_others_opportunities', 'manage_others_tasks',
         'merge_leads', 'recordings_listen_all', 'recordings_download', 'view_team_reports'], 'all', 30),
  ('restricted', 'Eingeschränkt', 'Telefoniert und pflegt eigene Aktivitäten, ohne Löschen, Export und fremde Aufnahmen.', true,
   array['use_ai', 'calling', 'delete_own_activities', 'delete_own_opportunities', 'delete_own_tasks'], 'all', 40);

-- ---------------------------------------------------------------------
--  Lead-Status (Reihenfolge wie in Close)
-- ---------------------------------------------------------------------
insert into public.lead_statuses (label, color, sort, kind, is_default) values
  ('Kunde',              '#178a3e', 10, 'won',  false),
  ('Neu',                '#5b6b7f', 20, 'open', true),
  ('Wiedervorlage',      '#c78a12', 30, 'open', false),
  ('Setting vereinbart', '#2f8f6b', 40, 'open', false),
  ('Closing vereinbart', '#4c63d9', 50, 'open', false),
  ('KPK',                '#8a8f98', 60, 'open', false);

-- ---------------------------------------------------------------------
--  Anruf-Ergebnisse (wie in Close)
-- ---------------------------------------------------------------------
insert into public.call_outcomes (key, label, description, color, sort, counts_as_connected, is_meeting, next_status_id, followup_days) values
  ('nicht_erreicht', 'Nicht erreicht',
   'Entscheider nicht am Apparat (Gatekeeper, Mailbox, keine Antwort) — Tag #NE', '#8a8f98', 10, false, false, null, null),
  ('entscheider_gesprochen', 'Entscheider gesprochen',
   'Inhaber:in am Apparat, kein Termin — Tag #EG', '#c78a12', 20, true, false, null, null),
  ('setting_gelegt', 'Setting gelegt',
   'Termin vereinbart (KG oder MG) — Tag ''Setting gelegt''', '#2f8f6b', 30, true, true,
   (select id from public.lead_statuses where label = 'Setting vereinbart'), null);

-- ---------------------------------------------------------------------
--  Pipelines (wie in Close)
-- ---------------------------------------------------------------------
insert into public.pipelines (name, sort) values ('Sales', 10), ('Setting → Closing', 20);

insert into public.opportunity_statuses (pipeline_id, label, kind, color, sort)
select p.id, s.label, s.kind, s.color, s.sort
  from public.pipelines p
  join (values
    ('Sales', 'Setting terminiert',          'open', '#4c7bd9', 10),
    ('Sales', 'Closing vereinbart',          'open', '#8a5cd6', 20),
    ('Sales', 'Follow-Up',                   'open', '#c78a12', 30),
    ('Sales', '✅ Kunde',                    'won',  '#178a3e', 40),
    ('Sales', '❌ Nicht gekauft',            'lost', '#b5473a', 50),
    ('Setting → Closing', 'Setting vereinbart',           'open', '#4c7bd9', 10),
    ('Setting → Closing', 'No-Show',                      'open', '#8a8f98', 20),
    ('Setting → Closing', 'Setting durchgeführt',         'open', '#2f8f6b', 30),
    ('Setting → Closing', 'Closing vereinbart',           'open', '#8a5cd6', 40),
    ('Setting → Closing', 'Angebot / Entscheidung offen', 'open', '#c78a12', 50),
    ('Setting → Closing', 'Gewonnen',                     'won',  '#178a3e', 60),
    ('Setting → Closing', 'Verloren',                     'lost', '#b5473a', 70)
  ) as s (pipeline, label, kind, color, sort) on s.pipeline = p.name;

-- ---------------------------------------------------------------------
--  Organisation
-- ---------------------------------------------------------------------
insert into public.org_settings (id, name, meeting_status_id, voicemail_drop_outcome)
values (1, 'Salus Digital GmbH',
        (select id from public.lead_statuses where label = 'Setting vereinbart'),
        'nicht_erreicht');

-- ---------------------------------------------------------------------
--  Eigene Felder (wie in Close)
-- ---------------------------------------------------------------------
insert into public.custom_fields (key, entity, label, type, choices, sort, show_in_list) values
  ('lead_geprueft',          'lead', 'LEAD GEPRÜFT',            'choice',   '["JA"]', 10, false),
  ('anzahl_filialen',        'lead', 'Anzahl Filialen',         'number',   '[]', 20, false),
  ('inhaber',                'lead', 'Inhaber',                 'text',     '[]', 30, true),
  ('bundesland',             'lead', 'Bundesland',              'choice',
   '["Baden-Württemberg","Bayern","Berlin","Brandenburg","Bremen","Hamburg","Hessen","Mecklenburg-Vorpommern","Niedersachsen","Nordrhein-Westfalen","Rheinland-Pfalz","Saarland","Sachsen","Sachsen-Anhalt","Schleswig-Holstein","Thüringen"]', 40, false),
  ('lead_quelle',            'lead', 'Lead-Quelle',             'choice',   '["Empfehlung","Inbound","Kaltakquise-Liste","OSM-Recherche"]', 50, false),
  ('bestand_setting_notizen','lead', 'Bestand: Setting-Notizen','choice',   '["Ja"]', 60, false),
  ('manuell_pruefen',        'lead', 'Manuell prüfen',          'choice',   '["Ja"]', 70, false),
  ('inhaber_verifikation',   'lead', 'Inhaber-Verifikation',    'choice',   '["Abweichung gefunden","Impressum bestätigt","Team-Liste 07/2026","Ungeprüft"]', 80, false),
  ('gesperrt_bis',           'lead', 'Gesperrt bis',            'date',     '[]', 90, false),
  ('bafa_foerdersatz',       'lead', 'BAFA-Fördersatz',         'choice',   '["50 % (max. 1.750 €)","80 % (max. 2.800 €)"]', 100, false),
  ('geschlecht',             'lead', 'Geschlecht',              'choice',   '["Frau","Mann","unklar"]', 110, false),
  ('setting_termin',         'lead', 'Setting-Termin',          'datetime', '[]', 120, false),
  ('setting_art',            'lead', 'Setting-Art',             'choice',   '["Kundengewinnung","Mitarbeitergewinnung"]', 130, false),
  ('interesse',              'lead', 'Interesse',               'choice',   '["Beides","Kundengewinnung","Mitarbeitergewinnung","Unklar"]', 140, false),
  ('contact_role',           'contact', 'Contact Role',         'multichoice', '["Decision Maker","Gatekeeper","Point of Contact"]', 10, false),
  ('dealphase',              'contact', 'Dealphase',            'text',     '[]', 20, false);

-- Felder, die am Lead auch leer stehen (die übrigen erscheinen erst, wenn jemand sie ausfüllt)
update public.custom_fields set always_show = true
 where key in ('inhaber', 'anzahl_filialen', 'bundesland', 'lead_quelle', 'interesse', 'setting_art', 'setting_termin', 'gesperrt_bis', 'contact_role');

-- ---------------------------------------------------------------------
--  Formulare (in Close: Custom Activities)
-- ---------------------------------------------------------------------
insert into public.activity_types (name, color, sort, fields) values
('Setting: Kundengewinnung', '#2346a0', 10, $json$[
  {"key":"apothekentyp","label":"Apothekentyp","type":"choice","choices":["Center-/Einkaufszentrum","Filialverbund","klassische Apotheke","Landapotheke","Sonstiges","Ärztehaus"]},
  {"key":"rx_anteil","label":"Rx-Anteil (%)","type":"text"},
  {"key":"otc_entwicklung","label":"OTC-Entwicklung","type":"choice","choices":["konstant","unklar","wandert ab","wächst"]},
  {"key":"kundenstruktur","label":"Kundenstruktur / Altersschnitt","type":"text"},
  {"key":"pdl_im_angebot","label":"pDL im Angebot?","type":"choice","choices":["ja, aber wenig genutzt","ja, läuft","nein — kein Interesse","nein — Personal","nein — Räumlichkeiten","unklar"]},
  {"key":"umsatzentwicklung","label":"Umsatzentwicklung letzte 12 Monate","type":"text"},
  {"key":"marketing_massnahmen","label":"Bisherige Marketing-Maßnahmen","type":"multichoice","choices":["Agentur beauftragt","Apotheken-App","Flyer","Google Ads","Google SEO","Internetauftritt / Website","nichts","Print / Zeitung","Social Media Ads","Social Media organisch"]},
  {"key":"warum_nicht_mehr","label":"Warum bisher nicht mehr gemacht?","type":"multichoice","choices":["kein Budget","keine Zeit","kennt sich nicht aus","schlechte Erfahrung","sieht keinen Bedarf","Sonstiges"]},
  {"key":"was_funktioniert","label":"Was hat funktioniert, was nicht?","type":"textarea"},
  {"key":"ziel","label":"Ziel","type":"choice","choices":["Nachfolge / Verkauf vorbereiten","OTC-Umsatz zurückholen","Sichtbarkeit / Bekanntheit","Sonstiges","Stabilisierung","Wachstum / Neukunden"]},
  {"key":"zielbeschreibung","label":"Zielbeschreibung in eigenen Worten","type":"textarea"},
  {"key":"kaufmotiv","label":"Dominantes Kaufmotiv","type":"textarea"},
  {"key":"dringlichkeit","label":"Dringlichkeit (Skala 1-10)","type":"number"},
  {"key":"ergebnisse_bis","label":"Bis wann sollen Ergebnisse da sein?","type":"date"},
  {"key":"angebotssumme","label":"Angebotssumme (€)","type":"text"},
  {"key":"bafa_foerderung","label":"Davon BAFA-Förderung (€)","type":"text"},
  {"key":"eigenanteil","label":"Eigenanteil (€)","type":"text"},
  {"key":"entscheider","label":"Entscheider","type":"text"},
  {"key":"einwaende","label":"Mögliche oder angedeutete Einwände","type":"textarea"},
  {"key":"naechster_schritt","label":"Nächster Schritt","type":"text"}
]$json$::jsonb),
('Setting: Mitarbeitergewinnung', '#7a3fb0', 20, $json$[
  {"key":"mitarbeiteranzahl","label":"Mitarbeiteranzahl","type":"text"},
  {"key":"fluktuation","label":"Fluktuation","type":"text"},
  {"key":"offene_stellen","label":"Offene Stellen","type":"text"},
  {"key":"dringlichkeit","label":"Dringlichkeit (Skala 1-10)","type":"number"},
  {"key":"mitarbeiter_bis","label":"Bis wann werden die Mitarbeiter gebraucht?","type":"date"},
  {"key":"suche_seit","label":"Seit wann wird gesucht?","type":"text"},
  {"key":"bisher_probiert","label":"Was wurde bisher probiert?","type":"choice","choices":["Eigene Website","Empfehlungen","Nichts","Personalvermittler","Social Media","Stellenbörsen","Zeitung / Print"]},
  {"key":"bewerber","label":"Anzahl und Qualität bisheriger Bewerber","type":"text"},
  {"key":"herausforderung","label":"Größte Herausforderung bei der Mitarbeitergewinnung","type":"textarea"},
  {"key":"kaufmotiv","label":"Dominantes Kaufmotiv","type":"textarea"},
  {"key":"budget_laufzeit","label":"Budget & Laufzeit","type":"text"},
  {"key":"entscheider","label":"Entscheider","type":"text"},
  {"key":"einwaende","label":"Mögliche oder angedeutete Einwände","type":"textarea"},
  {"key":"erster_start","label":"Wann kann der erste Mitarbeiter starten?","type":"date"},
  {"key":"bafa_besprochen","label":"BAFA-Förderung besprochen?","type":"choice","choices":["Ja","Nein","Später klären"]},
  {"key":"naechster_schritt","label":"Nächster Schritt","type":"text"}
]$json$::jsonb),
('Wiedervorlage / Follow-Up', '#b06f12', 30, $json$[
  {"key":"datum_uhrzeit","label":"Datum und Uhrzeit","type":"datetime","creates_task":true,
   "description":"Legt automatisch eine Aufgabe zu diesem Zeitpunkt an."},
  {"key":"notiz","label":"Notiz","type":"text"},
  {"key":"grund","label":"Grund","type":"choice","choices":["Angebot liegt vor","Gatekeeper blockt","Kein Interesse","Nicht erreicht","Sonstiges","Urlaub / abwesend","Zu früh — später nochmal"]},
  {"key":"sperrdauer","label":"Sperrdauer","type":"choice",
   "choices":["1 Woche","1 Monat","3 Monate","6 Monate","12 Monate","individuelles Datum (Feld unten)"],
   "description":"Setzt „Gesperrt bis“ am Lead.",
   "sets_lead_date":{"field":"gesperrt_bis","map":{"1 Woche":"7 days","1 Monat":"1 month","3 Monate":"3 months","6 Monate":"6 months","12 Monate":"12 months"}}}
]$json$::jsonb);

-- ---------------------------------------------------------------------
--  Smart Views (Namen wie in Close; die Filter sind aus den Namen
--  abgeleitet, weil Close sie über die Schnittstelle nicht herausgibt)
-- ---------------------------------------------------------------------
insert into public.smart_views (name, description, filters, sort, shared, pinned, position, created_by) values
  ('Kaltakquise 80 % Förderung (ohne PLZ 9)', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"all","conditions":[{"field":"custom:bafa_foerdersatz","op":"equals","value":"80 % (max. 2.800 €)"},{"field":"zip","op":"not_starts_with","value":"9"},{"field":"status","op":"in","value":["@Neu","@Wiedervorlage"]},{"field":"custom:gesperrt_bis","op":"past_or_empty"}]}',
   '{"field":"last_call_at","dir":"asc"}', true, true, 10, null),
  ('Kaltakquise Baden-Württemberg: Neu/Wiedervorlage (30 Tage kein Kontakt)', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"all","conditions":[{"field":"custom:bundesland","op":"equals","value":"Baden-Württemberg"},{"field":"status","op":"in","value":["@Neu","@Wiedervorlage"]},{"field":"last_call","op":"older_than_days","value":30},{"field":"custom:gesperrt_bis","op":"past_or_empty"}]}',
   '{"field":"last_call_at","dir":"asc"}', true, true, 20, null),
  ('Kaltakquise PLZ 2: 2. Durchlauf (>7 Tage kein Anruf)', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"all","conditions":[{"field":"zip","op":"starts_with","value":"2"},{"field":"status","op":"in","value":["@Neu","@Wiedervorlage"]},{"field":"call_count","op":"gte","value":1},{"field":"last_call","op":"older_than_days","value":7},{"field":"custom:gesperrt_bis","op":"past_or_empty"}]}',
   '{"field":"last_call_at","dir":"asc"}', true, true, 30, null),
  ('Kaltakquise PLZ 2: offen (Neu/Wiedervorlage)', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"all","conditions":[{"field":"zip","op":"starts_with","value":"2"},{"field":"status","op":"in","value":["@Neu","@Wiedervorlage"]},{"field":"custom:gesperrt_bis","op":"past_or_empty"}]}',
   '{"field":"last_call_at","dir":"asc"}', true, true, 40, null),
  ('Region: Grenzregion Schweiz (KN/WT/LÖ)', 'Aus Close übernommen – PLZ-Bereiche der Landkreise Konstanz, Waldshut und Lörrach (ungefähr), bitte prüfen.',
   '{"match":"all","conditions":[{"field":"zip","op":"starts_with","value":"782,783,784,795,796,797,798"}]}',
   '{"field":"name","dir":"asc"}', true, true, 50, null),
  ('Kaltakquise PLZ 9: geprüft & nie kontaktiert', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"all","conditions":[{"field":"zip","op":"starts_with","value":"9"},{"field":"custom:lead_geprueft","op":"equals","value":"JA"},{"field":"last_call","op":"never"}]}',
   '{"field":"created_at","dir":"asc"}', true, true, 60, null),
  ('Dialer: Neu', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"all","conditions":[{"field":"status","op":"in","value":["@Neu"]},{"field":"custom:gesperrt_bis","op":"past_or_empty"}]}',
   '{"field":"created_at","dir":"asc"}', true, false, 110, null),
  ('Dialer: Wiedervorlage heute', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"all","conditions":[{"field":"status","op":"in","value":["@Wiedervorlage"]},{"field":"next_task","op":"due"}]}',
   '{"field":"next_task_due","dir":"asc"}', true, false, 120, null),
  ('Dialer: Wiedervorlage (>3 Tage kein Anruf)', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"all","conditions":[{"field":"status","op":"in","value":["@Wiedervorlage"]},{"field":"last_call","op":"older_than_days","value":3},{"field":"custom:gesperrt_bis","op":"past_or_empty"}]}',
   '{"field":"last_call_at","dir":"asc"}', true, false, 130, null),
  ('Region: PLZ 9 (Franken/Oberpfalz)', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"all","conditions":[{"field":"zip","op":"starts_with","value":"9"}]}',
   '{"field":"name","dir":"asc"}', true, false, 140, null),
  ('Prüfen A: Inhaber fehlt (im Call erfragen)', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"all","conditions":[{"field":"custom:inhaber","op":"empty"}]}',
   '{"field":"name","dir":"asc"}', true, false, 150, null),
  ('Prüfen B: Zuordnung unklar (Recherche nötig)', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"all","conditions":[{"field":"custom:manuell_pruefen","op":"equals","value":"Ja"}]}',
   '{"field":"name","dir":"asc"}', true, false, 160, null),
  ('Prüfen: alle offenen Fälle (A+B)', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"any","conditions":[{"field":"custom:inhaber","op":"empty"},{"field":"custom:manuell_pruefen","op":"equals","value":"Ja"}]}',
   '{"field":"name","dir":"asc"}', true, false, 170, null),
  ('Ungeprüft (Inhaber offen)', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"any","conditions":[{"field":"custom:inhaber_verifikation","op":"equals","value":"Ungeprüft"},{"field":"custom:inhaber_verifikation","op":"empty"}]}',
   '{"field":"name","dir":"asc"}', true, false, 180, null),
  ('Geprüft', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"all","conditions":[{"field":"custom:lead_geprueft","op":"equals","value":"JA"}]}',
   '{"field":"name","dir":"asc"}', true, false, 190, null),
  ('Inhaber-Abweichungen (Impressum ≠ CRM)', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"all","conditions":[{"field":"custom:inhaber_verifikation","op":"equals","value":"Abweichung gefunden"}]}',
   '{"field":"name","dir":"asc"}', true, false, 200, null),
  ('Apotheken: Neue Bundesländer', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"all","conditions":[{"field":"custom:bundesland","op":"in","value":["Brandenburg","Mecklenburg-Vorpommern","Sachsen","Sachsen-Anhalt","Thüringen"]}]}',
   '{"field":"name","dir":"asc"}', true, false, 210, null),
  ('Kunden', 'Aus Close übernommen.',
   '{"match":"all","conditions":[{"field":"status","op":"in","value":["@Kunde"]}]}',
   '{"field":"name","dir":"asc"}', true, false, 220, null),
  ('Nachfassen: Settings ohne Anruf (7 Tage)', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"all","conditions":[{"field":"status","op":"in","value":["@Setting vereinbart"]},{"field":"last_call","op":"older_than_days","value":7}]}',
   '{"field":"last_call_at","dir":"asc"}', true, false, 230, null),
  ('Setting-Leads (Notizen seit Dez 2025)', 'Aus Close übernommen – Filter bitte prüfen.',
   '{"match":"all","conditions":[{"field":"custom:bestand_setting_notizen","op":"equals","value":"Ja"}]}',
   '{"field":"name","dir":"asc"}', true, false, 240, null);

-- ---------------------------------------------------------------------
--  E-Mail-Vorlagen (wie in Close)
-- ---------------------------------------------------------------------
insert into public.email_templates (name, subject, body, is_html, shared, created_by) values
('Cold Call: Infos Kundengewinnung',
 'Wie besprochen: mehr Kunden für Ihre Apotheke – kurze Übersicht',
 $tpl$<p>Guten Tag {{ contact.name }},</p><p>danke für das kurze Gespräch eben. Wie versprochen die wichtigsten Punkte, wie wir Apotheken bei der Kundengewinnung unterstützen – in 30 Sekunden gelesen:</p><p><strong>1. Ihre Apotheke wird lokal zur ersten Wahl:</strong> Wir sorgen dafür, dass Menschen in Ihrem Umkreis Sie zuerst finden – bei Google und auf Social Media, dort wo sich heute nahezu jeder befindet.<br><strong>2. Messbar statt Bauchgefühl:</strong> Sie sehen schwarz auf weiß, wie viele Neukunden über die Kampagnen kommen.<br><strong>3. Staatlich gefördert:</strong> Als BAFA-gelistetes Unternehmen können wir einen Großteil der Kosten über Fördermittel abdecken – was genau bei Ihnen möglich ist, klären wir in 15 Minuten.</p><p>Hier der Link zu unserer Infoseite: <a href="https://www.apokunden.de" rel="noopener noreferrer nofollow">www.apokunden.de</a></p><p>Wann passt es Ihnen am besten für ein kurzes Gespräch (15 Minuten)? Antworten Sie einfach mit Tag und Uhrzeit – ich versuche mich nach Ihnen zu richten. Dann zeige ich Ihnen an Beispielen aus anderen Apotheken, wie das konkret aussieht.</p><p>Beste Grüße<br>Salus Digital GmbH</p>$tpl$,
 true, true, null),
('Cold Call: Infos Mitarbeitergewinnung',
 'Wie besprochen: Personal für Ihre Apotheke – kurze Übersicht',
 $tpl$<p>Guten Tag {{ contact.name }},</p><p>danke für das kurze Gespräch eben. Wie versprochen die wichtigsten Punkte, wie wir Apotheken bei der Mitarbeitergewinnung unterstützen – in 30 Sekunden gelesen:</p><p><strong>1. Sichtbar, wo Ihre künftigen Mitarbeiter wirklich sind:</strong> Wir machen Ihre Apotheke regional auf Social Media als Arbeitgeber sichtbar – statt auf Stellenbörsen zu warten, auf denen sich nur meldet, wer aktiv sucht.<br><strong>2. Bewerbungen kommen zu Ihnen:</strong> Interessierte PTA, PKA und Apotheker melden sich direkt bei Ihnen – ohne Umwege, ohne Vermittlungsprovision pro Kopf.<br><strong>3. Staatlich gefördert:</strong> Als BAFA-gelistetes Beratungsunternehmen können wir einen Großteil der Kosten über Fördermittel abdecken – was genau bei Ihnen möglich ist, klären wir in 15 Minuten.</p><p>Hier noch der Link zu unserer Webseite: www.salus-digital.de</p><p>Wann passt es Ihnen am besten für ein kurzes Gespräch (15 Minuten)? Antworten Sie einfach mit Tag und Uhrzeit – ich versuche mich nach Ihnen zu richten. Dann zeige ich Ihnen an Beispielen aus anderen Apotheken, wie das konkret aussieht.</p><p>Beste Grüße</p><p><br>Salus Digital GmbH</p><p><em>PS: Wenn gerade keine Stelle offen ist, lohnt sich das Gespräch trotzdem – die Apotheken, die zuerst sichtbar sind, bekommen die Bewerbungen, wenn es ernst wird.</em></p>$tpl$,
 true, true, null);

-- ---------------------------------------------------------------------
--  Links auf der Lead-Seite
-- ---------------------------------------------------------------------
insert into public.integration_links (name, url_template, scope, sort) values
  ('Google-Suche', 'https://www.google.com/search?q={{lead.name}} {{lead.address_city}}', 'lead', 10),
  ('Google Maps',  'https://www.google.com/maps/search/{{lead.name}} {{lead.address_street}} {{lead.address_zip}} {{lead.address_city}}', 'lead', 20);
