"""Leistung im echten Betrieb mit großer Datenmenge (scripts/local-stack.sh start && scripts/local-stack.sh large).

Misst, wie lange die wichtigsten Seiten bis zur Anzeige brauchen – als Admin und als Mitarbeiterin mit
eingeschränkter Sicht – und nennt die langsamsten Anfragen. Grenze je Seite: PERF_LIMIT_MS (Standard 2500).

Nutzung: python3 tests/real/perf.py http://127.0.0.1:54320
"""

import json
import os
import sys
import time

from playwright.sync_api import expect, sync_playwright

APP = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:54320'
LIMIT = int(os.environ.get('PERF_LIMIT_MS', '2500'))
ADMIN = ('admin@waehlwerk.test', 'test-passwort-1')
MIA = ('mia@waehlwerk.test', 'test-passwort-2')

results = []
slow_requests = []
requests = []


def on_finished(req):
    t = req.timing
    if t and t.get('responseEnd', -1) > 0:
        requests.append((t['responseEnd'], req.method, req.url))


duplicates = []


def measure(page, name, action, ready):
    requests.clear()
    t0 = time.perf_counter()
    try:
        action()
        ready()
    except Exception as e:  # noqa: BLE001
        results.append((name, 10**9))
        print(f'FEHLER           {name}: {str(e).splitlines()[0][:200]}')
        return
    ms = (time.perf_counter() - t0) * 1000
    page.wait_for_timeout(600)
    top = sorted(requests, reverse=True)[:3]
    results.append((name, ms))
    slow_requests.extend((name, round(d), m, u.split('?')[0][-60:] + ('?…' if '?' in u else '')) for d, m, u in top if d > 300)
    seen = {}
    for _, m, u in requests:
        if '/rest/v1/' in u or '/functions/v1/' in u:
            seen[(m, u)] = seen.get((m, u), 0) + 1
    duplicates.extend((name, n, m, u[-140:]) for (m, u), n in seen.items() if n > 1)
    print(f'{"OK " if ms <= LIMIT else "LANGSAM"} {ms:7.0f} ms  {name}')


def login(page, who):
    page.goto(APP)
    page.wait_for_timeout(1000)
    page.fill('input[type=email]', who[0])
    page.fill('input[type=password]', who[1])
    page.click('button[type=submit]')
    expect(page.locator('.sidebar')).to_be_visible(timeout=15000)
    page.wait_for_timeout(1500)


def go(page, h):
    page.evaluate(f'location.hash = {json.dumps(h)}')


def run(page, who, lead_name):
    tag = who[0].split('@')[0]
    login(page, who)
    measure(page, f'{tag}: Leadliste', lambda: go(page, '#/leads'), lambda: expect(page.locator('a.lead-name').first).to_be_visible(timeout=20000))
    total = page.locator('.page-head h1').inner_text()
    print('         ', total.replace('\n', ' '))

    def search():
        box = page.locator('.page input[placeholder*="suchen"]').first
        box.fill('Lastapotheke 1234')
    measure(page, f'{tag}: Suche in der Leadliste', search, lambda: expect(page.locator('a.lead-name', has_text='Lastapotheke 1234').first).to_be_visible(timeout=20000))

    def palette():
        page.locator('.side-search').click()
        page.locator('.palette input').fill(lead_name)
    measure(page, f'{tag}: Suche (Strg + K)', palette, lambda: expect(page.locator('.palette-list button', has_text=lead_name).first).to_be_visible(timeout=20000))

    def open_lead():
        page.locator('.palette-list button', has_text=lead_name).first.click()
    measure(page, f'{tag}: Lead-Seite mit Verlauf', open_lead, lambda: expect(page.locator('.timeline .tl-item').first).to_be_visible(timeout=20000))

    measure(page, f'{tag}: Smart Views mit Zählungen', lambda: go(page, '#/views'),
            lambda: (expect(page.locator('.view-count').first).to_be_visible(timeout=20000), expect(page.locator('.view-count', has_text='…')).to_have_count(0, timeout=30000)))
    measure(page, f'{tag}: Inbox', lambda: go(page, '#/inbox'), lambda: expect(page.locator('.inbox-item, .empty').first).to_be_visible(timeout=20000))
    measure(page, f'{tag}: Kontakte', lambda: go(page, '#/contacts'), lambda: expect(page.locator('table tbody tr, .list-item').first).to_be_visible(timeout=20000))
    measure(page, f'{tag}: Gespräche', lambda: go(page, '#/calls'), lambda: expect(page.locator('.call-row, table tbody tr, .empty').first).to_be_visible(timeout=20000))
    measure(page, f'{tag}: Berichte', lambda: go(page, '#/reports'), lambda: (page.wait_for_load_state('networkidle'), expect(page.locator('.page h1')).to_be_visible(timeout=20000)))
    measure(page, f'{tag}: Opportunities', lambda: go(page, '#/opportunities'), lambda: (page.wait_for_load_state('networkidle'), expect(page.locator('.page h1')).to_be_visible(timeout=20000)))


with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
    # Mia sieht nur eigene und freie Leads: Lastapotheke 776 gehört ihr (jede vierte), 777 dem Admin
    for who, lead_name in ((ADMIN, 'Lastapotheke 777 '), (MIA, 'Lastapotheke 776 ')):
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='de-DE', timezone_id='Europe/Berlin')
        page = ctx.new_page()
        page.on('requestfinished', on_finished)
        try:
            run(page, who, lead_name)
        except Exception as e:  # noqa: BLE001
            results.append((f'{who[0]}: abgebrochen', 10**9))
            print('FEHLER', str(e).splitlines()[0][:300])
        ctx.close()
    b.close()

if duplicates:
    print('\nDoppelte Anfragen (gleiche Adresse mehrfach):')
    for name, n, m, u in duplicates:
        print(f'  {n}×  {m} …{u}   ({name})')

if slow_requests:
    print('\nLangsamste Anfragen (über 300 ms):')
    for name, d, m, u in slow_requests:
        print(f'  {d:6d} ms  {m} {u}   ({name})')
too_slow = [r for r in results if r[1] > LIMIT]
print(f'\n{len(results)} Messungen, {len(too_slow)} über {LIMIT} ms')
sys.exit(1 if too_slow else 0)
