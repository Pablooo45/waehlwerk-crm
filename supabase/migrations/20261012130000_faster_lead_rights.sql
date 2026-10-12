-- Schnellere Rechteprüfung für alles, was an einem Lead hängt (Kontakte, Anrufe, Notizen, E-Mails, Aufgaben …).
--
-- Bisher riefen die Regeln für jede einzelne Zeile public.can_see_lead(lead_id) auf. Diese Funktion läuft mit
-- erweiterten Rechten und kann von PostgreSQL nicht in die Abfrage eingebaut werden – bei Mitarbeitern mit
-- eingeschränkter Sicht kostete das bei 20.000 Leads mehrere Sekunden pro Liste.
--
-- Neu prüfen die Regeln direkt „gibt es den Lead für diese Person?“:
--   exists (select 1 from public.leads where id = <tabelle>.lead_id)
-- Dabei greift die Sichtbarkeitsregel der Tabelle leads selbst (dieselbe Logik wie can_see_lead), und PostgreSQL
-- rechnet das als schnelle Index-Abfrage. can_see_lead bleibt für Funktionen mit erweiterten Rechten.

do $$
declare
  p   record;
  re  constant text := '(^|[^a-z_.])(public\.)?can_see_lead\(([a-z_]+)\)';
  q   text;
  c   text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (qual ~ re or with_check ~ re)
  loop
    -- Spalte mit Tabellennamen, damit sie sich eindeutig auf die geprüfte Zeile bezieht
    q := regexp_replace(p.qual, re, format('\1(EXISTS (SELECT 1 FROM public.leads vis_l WHERE vis_l.id = %I.\3))', p.tablename), 'g');
    c := regexp_replace(p.with_check, re, format('\1(EXISTS (SELECT 1 FROM public.leads vis_l WHERE vis_l.id = %I.\3))', p.tablename), 'g');
    if p.qual ~ re then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, q);
    end if;
    if p.with_check ~ re then
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, c);
    end if;
  end loop;
end $$;
