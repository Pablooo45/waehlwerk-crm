#!/usr/bin/env bash
# Echter Betrieb statt Demo: lokale Supabase-Umgebung frisch aufsetzen (scripts/local-stack.sh),
# Smart-View-Filter zwischen Datenbank und JavaScript vergleichen, Website mit zwei Rollen durchklicken.
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/local-stack.sh start
export NO_PROXY=127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}
export no_proxy=$NO_PROXY
echo "== Filter: Datenbank ↔ JavaScript"
SERVICE_KEY=$(bash scripts/local-stack.sh keys | sed -n 's/^SERVICE=//p') TZ=Europe/Berlin deno run -A tests/real/filters.ts
OUT=${E2E_OUT:-$(mktemp -d)}
mkdir -p "$OUT"
echo "== Website im echten Betrieb"
python3 tests/real/flows.py http://127.0.0.1:54320 "$OUT"
echo "Bildschirmfotos: $OUT"
