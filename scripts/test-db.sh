#!/usr/bin/env bash
# Testet die Datenbank-Migration lokal gegen PostgreSQL (16+).
# Nutzung: PGHOST=/tmp PGPORT=54329 PGUSER=postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=crm_test_$$
psql -q -c "create database $DB;" >/dev/null
trap 'psql -q -c "drop database if exists $DB;" >/dev/null' EXIT
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/supabase_stub.sql 2>&1 | grep -v "wal_level\|HINT" || true
for f in supabase/migrations/*.sql; do
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f"
done
psql -q -d "$DB" -v ON_ERROR_STOP=1 -o /dev/null -f supabase/tests/db_test.sql 2>&1 | sed "s/^psql:[^ ]* NOTICE:  //"
psql -q -d "$DB" -At -c "select 'ALLE DATENBANK-TESTS BESTANDEN'"
