#!/usr/bin/env bash
# Stellt in Supabase die Adresse der Website ein (Links aus „Passwort vergessen?“ und Einladungen
# führen dorthin) und schaltet beim ersten Mal die offene Registrierung ab – neue Kollegen legt ein
# Admin im CRM an. Aufruf: scripts/supabase-auth.sh https://name.github.io/waehlwerk-crm/
# Braucht SUPABASE_ACCESS_TOKEN und SUPABASE_PROJECT_REF (aus scripts/supabase-project.sh).
set -euo pipefail

site="${1:?Adresse der Website fehlt}"
site="${site%/}/"
url="${SUPABASE_API:-https://api.supabase.com}/v1/projects/$SUPABASE_PROJECT_REF/config/auth"
call() {
  curl -fsS --retry 3 --retry-delay 5 -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" "$@"
}

config=$(call "$url")
current=$(jq -r '.site_url // ""' <<<"$config")
allow=$(jq -r '.uri_allow_list // ""' <<<"$config")

patch='{}'
# Nur beim ersten Mal (Supabase-Standard ist localhost) – spätere eigene Einstellungen bleiben
if [ -z "$current" ] || [[ "$current" == http://localhost* ]] || [[ "$current" == http://127.0.0.1* ]]; then
  patch=$(jq -n --arg s "$site" '{site_url: $s, disable_signup: true}')
  echo "Website-Adresse eingetragen, offene Registrierung abgeschaltet."
fi
if ! tr ',' '\n' <<<"$allow" | grep -qxF "${site}**"; then
  patch=$(jq --arg a "${allow:+$allow,}${site}**" '. + {uri_allow_list: $a}' <<<"$patch")
fi

if [ "$patch" = '{}' ]; then
  echo "Anmelde-Einstellungen in Supabase passen schon ($site)."
else
  call -X PATCH -d "$patch" "$url" > /dev/null
  echo "Anmelde-Einstellungen in Supabase aktualisiert: $site"
fi
