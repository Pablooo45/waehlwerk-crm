#!/usr/bin/env bash
# Klick-Tests im Browser gegen die Demo-Fassung (Playwright für Python).
# Einmalig: pip install playwright (Version passend zum installierten Chromium, sonst
# „python3 -m playwright install chromium“).
# Nutzung: npm run test:e2e        Bildschirmfotos landen in $E2E_OUT (sonst ein Temp-Ordner)
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build:demo-page >/dev/null
URL="file://$PWD/dist-demo/waehlwerk-demo.html"
OUT="${E2E_OUT:-$(mktemp -d)}"
mkdir -p "$OUT"
fail=0
for t in flows next_lead call_note notes mobile; do
  echo "== $t"
  if ! python3 "tests/e2e/$t.py" "$URL" "$OUT"; then
    echo "!! $t fehlgeschlagen"
    fail=1
  fi
done
echo "Bildschirmfotos: $OUT"
exit $fail
