#!/usr/bin/env bash
# Lokale Supabase-Umgebung ohne Docker – zum Testen des echten Betriebs (nicht des Demo-Modus).
#
#   scripts/local-stack.sh start    Datenbank frisch aufsetzen, Dienste starten, Website bauen
#   scripts/local-stack.sh large    zusätzlich 20.000 Leads für Leistungsmessungen (tests/real/perf.py)
#   scripts/local-stack.sh stop     Dienste beenden
#   scripts/local-stack.sh status   Läuft alles?
#
# Danach:  Website  http://127.0.0.1:54320   (wie GitHub Pages)
#          Gateway  http://127.0.0.1:54321   (wie https://<projekt>.supabase.co)
# Logins:  admin@waehlwerk.test / test-passwort-1   (Admin)
#          mia@waehlwerk.test   / test-passwort-2   (Rolle „Nur eigene“: sieht nur eigene und freie Leads)
#
# Braucht PostgreSQL 16, Node, Deno und curl. PostgREST und Supabase Auth werden beim ersten Start aus
# den offiziellen GitHub-Releases geladen (die echten Programme, die auch bei Supabase laufen).
# Wie bei Supabase liefert PostgREST höchstens 1000 Zeilen pro Abfrage.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
STATE=${LOCAL_STACK_DIR:-$ROOT/.local-stack}
BIN=$STATE/bin
LOGS=$STATE/logs
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
PG_DATA=${PG_DATA:-/var/tmp/pgtest/data}
export PGHOST=${PGHOST:-/tmp} PGPORT=${PGPORT:-54329} PGUSER=${PGUSER:-postgres}
DB=${LOCAL_DB:-crm_local}
POSTGREST_VERSION=12.2.12
AUTH_VERSION=2.197.0
JWT_SECRET=lokaler-test-schluessel-nur-fuer-diese-umgebung
GW=http://127.0.0.1:54321
APP=http://127.0.0.1:54320
export NO_PROXY=127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}
export no_proxy=$NO_PROXY
DENO=${DENO:-$(command -v deno || true)}

mkdir -p "$BIN" "$LOGS" "$STATE/storage"

jwt() {
  node -e '
    const c = require("node:crypto");
    const [secret, role] = process.argv.slice(1);
    const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const h = b({ alg: "HS256", typ: "JWT" });
    const p = b({ iss: "supabase-local", role, iat: 1700000000, exp: 2000000000 });
    console.log(`${h}.${p}.${c.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`);
  ' "$JWT_SECRET" "$1"
}
ANON=$(jwt anon)
SERVICE=$(jwt service_role)

fetch_bins() {
  if [ ! -x "$BIN/postgrest" ]; then
    echo "Lade PostgREST $POSTGREST_VERSION …"
    curl -sSL "https://github.com/PostgREST/postgrest/releases/download/v$POSTGREST_VERSION/postgrest-v$POSTGREST_VERSION-linux-static-x86-64.tar.xz" | tar -xJ -C "$BIN"
  fi
  if [ ! -x "$BIN/auth" ]; then
    echo "Lade Supabase Auth $AUTH_VERSION …"
    local tmp
    tmp=$(mktemp -d)
    curl -sSL "https://github.com/supabase/auth/releases/download/v$AUTH_VERSION/auth-v$AUTH_VERSION-x86.tar.gz" | tar -xz -C "$tmp"
    mv "$tmp/auth" "$BIN/auth"
    rm -rf "$BIN/auth-migrations"
    mv "$tmp/migrations" "$BIN/auth-migrations"
    rm -rf "$tmp"
  fi
  if [ -z "$DENO" ]; then
    echo "Deno fehlt (z. B. npm i -g deno)." >&2
    exit 1
  fi
}

ensure_pg() {
  if pg_isready -q; then return; fi
  if [ ! -d "$PG_DATA" ]; then
    mkdir -p "$(dirname "$PG_DATA")"
    chown postgres "$(dirname "$PG_DATA")"
    su postgres -c "$PG_BIN/initdb -D $PG_DATA" >/dev/null
  fi
  su postgres -c "$PG_BIN/pg_ctl -D $PG_DATA -o '-p $PGPORT -k /tmp' -l $(dirname "$PG_DATA")/pg.log start" >/dev/null
  for _ in $(seq 1 30); do pg_isready -q && return; sleep 0.5; done
  echo "PostgreSQL startet nicht." >&2
  exit 1
}

auth_env() {
  export GOTRUE_DB_DRIVER=postgres
  export GOTRUE_DB_DATABASE_URL="postgres://postgres@127.0.0.1:$PGPORT/$DB?sslmode=disable&search_path=auth"
  export GOTRUE_DB_MIGRATIONS_PATH=$BIN/auth-migrations
  export GOTRUE_DB_NAMESPACE=auth
  export API_EXTERNAL_URL=$GW/auth/v1
  export GOTRUE_API_HOST=127.0.0.1
  export PORT=54332
  export GOTRUE_SITE_URL=$APP
  export GOTRUE_URI_ALLOW_LIST='*'
  export GOTRUE_JWT_SECRET=$JWT_SECRET
  export GOTRUE_JWT_EXP=3600
  export GOTRUE_JWT_AUD=authenticated
  export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
  export GOTRUE_JWT_ADMIN_ROLES=service_role
  export GOTRUE_DISABLE_SIGNUP=false
  export GOTRUE_EXTERNAL_EMAIL_ENABLED=true
  export GOTRUE_MAILER_AUTOCONFIRM=true
  export GOTRUE_SMTP_ADMIN_EMAIL=admin@waehlwerk.test
  export GOTRUE_RATE_LIMIT_EMAIL_SENT=1000
  export GOTRUE_LOG_LEVEL=warn
}

stop() {
  for svc in gateway auth postgrest; do
    if [ -f "$STATE/$svc.pid" ]; then
      kill "$(cat "$STATE/$svc.pid")" 2>/dev/null || true
      rm -f "$STATE/$svc.pid"
    fi
  done
}

wait_for() {
  local url=$1 what=$2
  for _ in $(seq 1 120); do
    if curl -s -o /dev/null -f "$url"; then return; fi
    sleep 0.5
  done
  echo "$what antwortet nicht – siehe $LOGS" >&2
  exit 1
}

reset_db() {
  psql -q -c "drop database if exists $DB with (force);" -c "create database $DB;" >/dev/null
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -f scripts/local-stack/pre.sql >/dev/null
  (auth_env; "$BIN/auth" migrate >"$LOGS/auth-migrate.log" 2>&1) || { echo "Supabase Auth: Migration fehlgeschlagen (siehe $LOGS/auth-migrate.log)" >&2; exit 1; }
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -f scripts/local-stack/post.sql 2>&1 | grep -v "wal_level\|HINT" || true
  for f in supabase/migrations/*.sql; do
    psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>"$LOGS/migration.err" || { cat "$LOGS/migration.err" >&2; exit 1; }
  done
}

start_services() {
  cat >"$STATE/postgrest.conf" <<EOF
db-uri = "postgres://authenticator@127.0.0.1:$PGPORT/$DB"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public, extensions"
db-max-rows = 1000
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = 54331
log-level = "warn"
EOF
  "$BIN/postgrest" "$STATE/postgrest.conf" >"$LOGS/postgrest.log" 2>&1 &
  echo $! >"$STATE/postgrest.pid"
  (auth_env; exec "$BIN/auth" serve) >"$LOGS/auth.log" 2>&1 &
  echo $! >"$STATE/auth.pid"
  (
    cd supabase/functions
    SUPABASE_URL=$GW SUPABASE_ANON_KEY=$ANON SUPABASE_SERVICE_ROLE_KEY=$SERVICE JWT_SECRET=$JWT_SECRET \
      STORAGE_DIR=$STATE/storage APP_DIR=$ROOT/dist \
      exec "$DENO" run --allow-all --config deno.json "$ROOT/scripts/local-stack/gateway.ts"
  ) >"$LOGS/gateway.log" 2>&1 &
  echo $! >"$STATE/gateway.pid"
  wait_for "http://127.0.0.1:54331/" PostgREST
  wait_for "http://127.0.0.1:54332/health" "Supabase Auth"
  wait_for "$GW/__health" Gateway
}

add_user() { # E-Mail Passwort Name app_metadata-JSON
  curl -sf -X POST "$GW/auth/v1/admin/users" -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"$3\"},\"app_metadata\":$4}" >/dev/null
}

seed() {
  # erster Benutzer wird Admin; Mia bekommt eine Rolle, die nur eigene und freie Leads sieht
  add_user admin@waehlwerk.test test-passwort-1 'Alex Admin' '{}'
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -c "insert into public.roles (id, name, description, is_builtin, permissions, lead_visibility, sort)
    values ('nur_eigene', 'Nur eigene', 'Testrolle', false, array['calling','delete_own_activities','delete_own_tasks'], 'own_and_unassigned', 50)
    on conflict (id) do nothing;" >/dev/null
  add_user mia@waehlwerk.test test-passwort-2 'Mia Schulte' '{}'
  # wie die Server-Funktion „admin“ beim Anlegen: Rolle und Freischaltung direkt im Profil
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -c "update public.profiles set role_id = 'nur_eigene', active = true where email = 'mia@waehlwerk.test';" >/dev/null
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -f scripts/local-stack/seed.sql >/dev/null
}

build_app() {
  npm run build >"$LOGS/build.log" 2>&1 || { tail -20 "$LOGS/build.log" >&2; exit 1; }
  cat >dist/config.js <<EOF
window.CRM_CONFIG = { supabaseUrl: '$GW', supabaseKey: '$ANON', appName: 'Wählwerk (lokal)' };
EOF
}

case "${1:-start}" in
  start)
    fetch_bins
    ensure_pg
    stop
    reset_db
    build_app
    start_services
    seed
    echo "Lokale Umgebung läuft: Website $APP, Gateway $GW (Logs: $LOGS)"
    ;;
  large)
    # zusätzlich 20.000 Leads mit Anrufen, Notizen und Aufgaben (für Leistungsmessungen; Umgebung muss laufen)
    psql -q -d "$DB" -v ON_ERROR_STOP=1 -f scripts/local-stack/seed-large.sql >/dev/null
    echo "Große Testmenge angelegt: $(psql -At -d "$DB" -c 'select count(*) from public.leads') Leads, $(psql -At -d "$DB" -c 'select count(*) from public.calls') Anrufe."
    ;;
  stop)
    stop
    echo "Gestoppt."
    ;;
  status)
    for svc in postgrest auth gateway; do
      if [ -f "$STATE/$svc.pid" ] && kill -0 "$(cat "$STATE/$svc.pid")" 2>/dev/null; then echo "$svc läuft"; else echo "$svc aus"; fi
    done
    ;;
  keys)
    echo "ANON=$ANON"
    echo "SERVICE=$SERVICE"
    ;;
  *)
    echo "Nutzung: $0 start|large|stop|status|keys" >&2
    exit 2
    ;;
esac
