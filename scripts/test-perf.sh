#!/usr/bin/env bash
# Leistung im echten Betrieb mit großer Datenmenge: lokale Supabase-Umgebung frisch aufsetzen,
# 20.000 Leads mit Anrufen, Notizen und Aufgaben anlegen und die wichtigsten Seiten messen (Admin und Mitarbeiterin).
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/local-stack.sh start
bash scripts/local-stack.sh large
export NO_PROXY=127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}
export no_proxy=$NO_PROXY
python3 tests/real/perf.py http://127.0.0.1:54320
