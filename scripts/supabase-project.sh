#!/usr/bin/env bash
# Findet das Supabase-Projekt allein über den Access Token – für die GitHub Actions „Server“ und „Website“.
# So muss in GitHub nur ein einziges Secret eingetragen werden: SUPABASE_ACCESS_TOKEN.
#
# Schreibt nach $GITHUB_ENV: SUPABASE_PROJECT_REF, SUPABASE_REGION
# Mit --keys zusätzlich SUPABASE_URL und SUPABASE_ANON_KEY – nur den öffentlichen Schlüssel, nie einen geheimen.
# Optional vorher gesetzt (GitHub-Variable): SUPABASE_PROJECT_REF, falls es mehrere Projekte gibt.
set -euo pipefail

want_keys=0
[ "${1:-}" = "--keys" ] && want_keys=1
env_out() { echo "$1=$2" >> "${GITHUB_ENV:-/dev/null}"; }

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "::error::Das Secret SUPABASE_ACCESS_TOKEN fehlt (GitHub → Settings → Secrets and variables → Actions). Siehe EINRICHTUNG.md, Schritt 2."
  exit 1
fi

base="${SUPABASE_API:-https://api.supabase.com}"
api() {
  curl -fsS --retry 3 --retry-delay 5 -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "$base/v1/$1"
}

if ! projects=$(api projects); then
  echo "::error::Supabase lehnt den Access Token ab. In Supabase einen neuen Token erzeugen und das Secret SUPABASE_ACCESS_TOKEN ersetzen."
  exit 1
fi

ref="${SUPABASE_PROJECT_REF:-}"
if [ -z "$ref" ]; then
  ref=$(jq -r '[.[] | select((.name | ascii_downcase) == "waehlwerk-crm")] | if length == 1 then (.[0].ref // .[0].id) else "" end' <<<"$projects")
fi
if [ -z "$ref" ] && [ "$(jq 'length' <<<"$projects")" = "1" ]; then
  ref=$(jq -r '.[0].ref // .[0].id' <<<"$projects")
fi
if [ -z "$ref" ]; then
  names=$(jq -r '[.[].name] | join(", ")' <<<"$projects")
  echo "::error::Kein eindeutiges Supabase-Projekt gefunden (vorhanden: ${names:-keins}). Das Projekt „waehlwerk-crm“ nennen oder in GitHub die Variable SUPABASE_PROJECT_REF eintragen."
  exit 1
fi

# Ein frisch angelegtes Projekt braucht ein paar Minuten, bis es läuft
for _ in $(seq 1 40); do
  project=$(api "projects/$ref")
  status=$(jq -r '.status' <<<"$project")
  case "$status" in
    ACTIVE_HEALTHY) break ;;
    INACTIVE | PAUSING | PAUSE_FAILED)
      echo "::error::Das Supabase-Projekt ist pausiert. In Supabase „Restore project“ wählen und den Workflow danach neu starten."
      exit 1 ;;
    INIT_FAILED | REMOVED | RESTORE_FAILED)
      echo "::error::Das Supabase-Projekt ist nicht nutzbar (Status $status)."
      exit 1 ;;
  esac
  echo "Supabase-Projekt startet noch ($status) – warte 15 Sekunden …"
  sleep "${SUPABASE_WAIT:-15}"
done
if [ "$status" != "ACTIVE_HEALTHY" ]; then
  echo "::error::Das Supabase-Projekt ist nach 10 Minuten noch nicht bereit (Status $status). Workflow später neu starten."
  exit 1
fi

region=$(jq -r '.region' <<<"$project")
name=$(jq -r '.name' <<<"$project")
env_out SUPABASE_PROJECT_REF "$ref"
env_out SUPABASE_REGION "$region"
echo "Supabase-Projekt: $name ($ref), Region $region"
if [ "$region" != "eu-central-1" ]; then
  echo "::warning::Das Projekt liegt nicht in Frankfurt (eu-central-1), sondern in $region. Für kurze Wege beim Telefonieren ist Frankfurt empfohlen."
fi

if [ "$want_keys" = "1" ]; then
  keys=$(api "projects/$ref/api-keys?reveal=true")
  # Öffentlicher Schlüssel: bevorzugt „publishable“, sonst der alte „anon“-Schlüssel
  key=$(jq -r '([.[] | select(.type == "publishable")][0].api_key) // ([.[] | select(.name == "anon")][0].api_key) // ""' <<<"$keys")
  case "$key" in
    sb_publishable_* | eyJ*) ;;
    *)
      echo "::error::Kein öffentlicher Schlüssel (publishable/anon) im Supabase-Projekt gefunden."
      exit 1 ;;
  esac
  env_out SUPABASE_URL "https://$ref.supabase.co"
  env_out SUPABASE_ANON_KEY "$key"
fi
