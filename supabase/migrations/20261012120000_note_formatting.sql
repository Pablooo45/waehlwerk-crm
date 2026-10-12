-- Notizen mit Formatierung wie in Close (fett, kursiv, unterstrichen, Listen, Links).
-- „body“ bleibt der reine Text (Suche, Benachrichtigungen, Export, @Erwähnungen);
-- „body_html“ ist nur gesetzt, wenn die Notiz formatiert ist. Angezeigt wird es bereinigt.
alter table public.notes add column if not exists body_html text;
