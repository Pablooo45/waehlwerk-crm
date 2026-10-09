#!/usr/bin/env bash
# Schaltet die Hintergrundaufgaben ein (Zeitplan in der Datenbank: Workflows, geplante E-Mails,
# Postfach-Abruf, Aufnahmen nachholen, Löschfristen, Kalender-Abgleich). Läuft nach jeder
# Installation; mehrfach aufrufen schadet nicht. Klappt es nicht, geht es auch im CRM
# (Einstellungen → Diagnose & Fehler → Hintergrundaufgaben → Einschalten).
# Braucht SUPABASE_ACCESS_TOKEN und SUPABASE_PROJECT_REF (aus scripts/supabase-project.sh).
set -euo pipefail

if ! [[ "$SUPABASE_PROJECT_REF" =~ ^[a-z]{20}$ ]]; then
  echo "::warning::Unerwartete Projekt-Kennung – Hintergrundaufgaben bitte im CRM einschalten."
  exit 0
fi
base="${SUPABASE_API:-https://api.supabase.com}"
functions="https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1"
body=$(jq -n --arg q "select public.crm_schedule_jobs('$functions') as ergebnis" '{query: $q}')

response=$(curl -sS --retry 3 --retry-delay 5 -w '\n%{http_code}' -X POST \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "$body" "$base/v1/projects/$SUPABASE_PROJECT_REF/database/query")
code=$(tail -n 1 <<<"$response")
detail=$(sed '$d' <<<"$response" | tr -d '\n' | head -c 300)
if [[ "$code" == 2* ]]; then
  echo "Hintergrundaufgaben eingeschaltet (laufen jede Minute)."
else
  echo "::warning::Hintergrundaufgaben konnten nicht eingeschaltet werden (HTTP $code: $detail) – im CRM unter Diagnose & Fehler auf „Einschalten“ tippen."
fi
