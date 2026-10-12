"""Durchklick-Test im echten Betrieb: Website gegen die lokale Supabase-Umgebung (scripts/local-stack.sh).

Prüft dieselben Abläufe wie tests/e2e/flows.py, aber mit echter Datenbank, Rechten (RLS), Server-Funktionen
und Anmeldung – dazu Team, Smart Views, Sammeländerung über mehr als 1000 Leads und eine eingeschränkte Rolle.

Nutzung: python3 tests/real/flows.py http://127.0.0.1:54320 <Ordner für Bildschirmfotos>
"""

import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

from playwright.sync_api import expect, sync_playwright

APP, OUT = sys.argv[1], sys.argv[2]
ADMIN = ('admin@waehlwerk.test', 'test-passwort-1')
MIA = ('mia@waehlwerk.test', 'test-passwort-2')
# Twilio ist lokal nicht eingerichtet: diese Antworten sind erwartet
EXPECTED = [re.compile(r'/functions/v1/twilio-token')]
errors = []
bad = []
results = []


def check(name, fn):
    try:
        fn()
        results.append(('OK', name))
    except Exception as e:  # noqa: BLE001
        results.append(('FEHLER', f'{name}: {str(e).splitlines()[0][:300]}'))


def go(page, h, ms=1300):
    page.evaluate(f'location.hash = {json.dumps(h)}')
    page.wait_for_timeout(ms)


def login(page, who):
    page.goto(APP)
    page.wait_for_timeout(1200)
    page.fill('input[type=email]', who[0])
    page.fill('input[type=password]', who[1])
    page.click('button[type=submit]')
    expect(page.locator('.sidebar')).to_be_visible(timeout=10000)
    page.wait_for_timeout(1500)


def logout(page):
    page.locator('.account-btn').click()
    page.locator('.popover .menu-item', has_text='Abmelden').click()
    expect(page.locator('input[type=email]')).to_be_visible(timeout=8000)


def open_lead(page, name):
    page.keyboard.press('Control+k')
    page.locator('.palette input').fill(name)
    page.wait_for_timeout(900)
    page.locator('.palette-list button', has_text=name).first.click()
    expect(page.locator('.lead-title')).to_have_value(name, timeout=6000)
    page.wait_for_timeout(600)


GATEWAY = 'http://127.0.0.1:54321'


def sql(query):
    env = {**os.environ, 'PGHOST': os.environ.get('PGHOST', '/tmp'), 'PGPORT': os.environ.get('PGPORT', '54329'), 'PGUSER': os.environ.get('PGUSER', 'postgres')}
    out = subprocess.run(['psql', '-At', '-d', os.environ.get('LOCAL_DB', 'crm_local'), '-c', query], env=env, capture_output=True, text=True, check=True)
    return out.stdout.strip()


def track_sig(key, data):
    return base64.urlsafe_b64encode(hmac.new(key.encode(), data.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()[:22]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: ARG002
        return None


def fetch(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)
    try:
        with opener.open(url, timeout=15) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def on_response(r):
    if r.status >= 400 and not any(p.search(r.url) for p in EXPECTED):
        bad.append(f'{r.status} {r.request.method} {r.url[:180]}')


def on_console(m):
    if m.type != 'error':
        return
    # vom Browser selbst gemeldete Ladefehler der erwarteten Antworten
    if 'status of 409' in m.text and 'Failed to load resource' in m.text:
        return
    errors.append(f'console {m.text[:300]}')


with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='de-DE', timezone_id='Europe/Berlin')
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(f'pageerror {page.url}: {e}'))
    page.on('console', on_console)
    page.on('response', on_response)

    check('Anmelden als Admin', lambda: login(page, ADMIN))

    # ---------- Lead-Seite ----------
    check('Lead über die Suche öffnen', lambda: open_lead(page, 'Adler-Apotheke'))

    def note():
        page.locator('.note-quick').click()
        page.locator('#composer-note').fill('Echt-Test: Notiz über den Editor')
        page.locator('.inline-panel button', has_text='Notiz speichern').click()
        expect(page.locator('.tl-item', has_text='Echt-Test: Notiz über den Editor')).to_be_visible(timeout=5000)
        expect(page.locator('.inline-panel')).to_have_count(0)
    check('Notiz speichern', note)

    def activity():
        page.locator('.lead-actions button', has_text='Aktivität').click()
        page.locator('.popover .menu-item', has_text='Wiedervorlage').click()
        panel = page.locator('.inline-panel')
        expect(panel).to_be_visible()
        for sel in panel.locator('select').all():
            if len(sel.locator('option').all()) > 1:
                sel.select_option(index=1)
        for inp in panel.locator('input[type="datetime-local"]').all():
            inp.fill('2026-10-20T10:00')
        for inp in panel.locator('input[type="date"]').all():
            inp.fill('2026-10-20')
        for ta in panel.locator('textarea').all():
            ta.fill('Echt-Test Aktivität')
        panel.locator('button', has_text='Speichern').last.click()
        expect(page.locator('.tl-item', has_text='Wiedervorlage / Follow-Up').first).to_be_visible(timeout=5000)
    check('Eigene Aktivität erfassen', activity)

    def log_call():
        page.locator('.btn-split .caret').click()
        page.locator('.popover .menu-item', has_text='Anruf protokollieren').click()
        panel = page.locator('.inline-panel', has_text='Anruf protokollieren')
        expect(panel).to_be_visible()
        panel.locator('textarea').fill('Vom Handy angerufen – Echt-Test')
        panel.locator('button', has_text='Anruf speichern').click()
        expect(page.locator('.tl-item', has_text='Vom Handy angerufen – Echt-Test')).to_be_visible(timeout=5000)
    check('Anruf protokollieren', log_call)

    def status():
        page.locator('.lead-status-row .status-pill').click()
        page.locator('.popover .menu-item', has_text='Wiedervorlage').click()
        expect(page.locator('.lead-status-row .status-pill')).to_contain_text('Wiedervorlage', timeout=4000)
        expect(page.locator('.tl-item', has_text='Status:').first).to_be_visible(timeout=4000)
    check('Status ändern', status)

    def field_edit():
        btn = page.locator('.lead-fields button.field-value').first
        btn.click()
        el = page.locator('.lead-fields dd input, .lead-fields dd select.inline-edit, .lead-fields dd textarea').first
        tag = el.evaluate('e => e.tagName')
        if tag == 'SELECT':
            el.select_option(index=1)
        else:
            typ = el.get_attribute('type') or 'text'
            el.fill('7' if typ == 'number' else '2026-11-01' if typ == 'date' else '2026-11-01T09:00' if typ == 'datetime-local' else 'Testwert')
            el.press('Enter')
        page.wait_for_timeout(1000)
        expect(page.locator('.lead-fields button.field-value').first).not_to_have_text('–')
    check('Feld per Klick bearbeiten', field_edit)

    def task():
        page.locator('.lead-sec-head button[aria-label="Aufgabe hinzufügen"]').click()
        modal = page.locator('.modal')
        modal.locator('input').first.fill('Echt-Test Aufgabe')
        modal.locator('button', has_text='Speichern').click()
        row = page.locator('.lead-row', has_text='Echt-Test Aufgabe')
        expect(row).to_be_visible(timeout=4000)
        row.locator('.task-check').click()
        expect(row).to_have_count(0, timeout=4000)
    check('Aufgabe anlegen und abhaken', task)

    def opportunity():
        page.locator('.lead-sec-head button[aria-label="Opportunity hinzufügen"]').click()
        modal = page.locator('.modal')
        modal.locator('.field', has_text='Wert').locator('input').fill('5600')
        modal.locator('button', has_text='Speichern').click()
        expect(page.locator('.lead-sec', has_text='Opportunit').locator('.lead-row').first).to_contain_text('5.600', timeout=4000)
    check('Opportunity anlegen', opportunity)

    def feed_search():
        page.keyboard.press('Control+f')
        page.locator('.feed-search input').fill('Echt-Test: Notiz')
        expect(page.locator('.feed > .timeline .tl-item')).to_have_count(1, timeout=3000)
        page.locator('.feed-search input').press('Escape')
    check('Verlauf durchsuchen', feed_search)

    def email_without_mailbox():
        page.locator('.lead-actions button', has_text='E-Mail').click()
        panel = page.locator('.inline-panel', has_text='E-Mail schreiben')
        expect(panel).to_be_visible()
        # ohne verbundenes Postfach muss es einen klaren Hinweis geben
        expect(panel).to_contain_text('Postfach', timeout=3000)
        page.keyboard.press('Escape')
    check('E-Mail ohne Postfach: klarer Hinweis', email_without_mailbox)
    page.screenshot(path=f'{OUT}/real-lead.png')

    def call_without_twilio():
        page.locator('.lead-actions .btn.call').first.click()
        page.wait_for_timeout(1500)
        toast = page.locator('.toast')
        expect(toast.first).to_be_visible(timeout=4000)
        expect(page.locator('.callbar')).to_have_count(0)
    check('Anrufen ohne Twilio: klarer Hinweis', call_without_twilio)

    def email_tracking():
        lead_id = page.evaluate("location.hash").split('/')[2].split('?')[0]
        mail_id = sql(f"""insert into public.emails (lead_id, direction, status, subject, to_address, sent_at)
                         values ('{lead_id}', 'outbound', 'sent', 'Echt-Test Zählung', 'info@adler.example', now() - interval '1 minute')
                         returning id""").splitlines()[0]
        key = sql("select value from private.kv where key = 'TRACKING_KEY'")
        target = 'https://salus-digital.example/angebot?a=1&b=2'
        base = f'{GATEWAY}/functions/v1/email-track'
        click = f"{base}/c/{mail_id}.{track_sig(key, f'c:{mail_id}:{target}')}?u={urllib.parse.quote(target, safe='')}"
        status, headers, _ = fetch(click)
        assert status == 302 and headers.get('Location') == target, f'Klick: {status} {headers.get("Location")}'
        status, headers, body = fetch(f"{base}/o/{mail_id}.{track_sig(key, f'o:{mail_id}')}.gif")
        assert status == 200 and headers.get('Content-Type') == 'image/gif' and body[:6] == b'GIF89a', f'Pixel: {status}'
        evil = click.replace(urllib.parse.quote(target, safe=''), urllib.parse.quote('https://boese.example/', safe=''))
        assert fetch(evil)[0] == 400, 'manipulierter Link leitet weiter'
        assert sql(f"select opens || '/' || clicks from public.emails where id = '{mail_id}'") == '2/1'
        page.reload()
        page.wait_for_timeout(2000)
        item = page.locator('.tl-item', has_text='Echt-Test Zählung')
        expect(item.locator('.tag', has_text='2× geöffnet')).to_be_visible(timeout=6000)
        expect(item.locator('.tag', has_text='1× geklickt')).to_be_visible()
        item.locator('.tl-subject').click()
        expect(item.locator('.track-list li', has_text='Link geklickt')).to_be_visible()
    check('E-Mail-Öffnung und Link-Klick zählen (Server-Funktion)', email_tracking)

    # ---------- neuer Lead, Smart View, Sammeländerung ----------
    def new_lead():
        page.locator('.nav-add').click()
        modal = page.locator('.modal')
        modal.locator('input').first.fill('Echt-Test-Apotheke')
        modal.locator('button', has_text='Lead anlegen').click()
        expect(page.locator('.lead-title')).to_have_value('Echt-Test-Apotheke', timeout=6000)
    check('Neuen Lead anlegen', new_lead)

    def leads_total():
        go(page, '#/leads', 2500)
        expect(page.locator('.page-head h1')).to_contain_text(re.compile(r'2\.50\d'), timeout=6000)
    check('Leadliste zählt alle Leads (über 1000)', leads_total)

    def bulk_all():
        page.locator('.page-head button[aria-label="Weitere Aktionen"]').click()
        page.locator('.popover .menu-item', has_text='Sammelbearbeitung').click()
        modal = page.locator('.modal')
        expect(modal).to_contain_text(re.compile(r'2\.50\d Leads ändern'))
        modal.locator('select').nth(1).select_option(label='Wiedervorlage')
        modal.locator('button', has_text='Übernehmen').click()
        expect(page.locator('.toast', has_text='Leads geändert')).to_contain_text(re.compile(r'2\.50\d'), timeout=20000)
    check('Sammelbearbeitung über alle Leads', bulk_all)

    def bulk_result():
        go(page, '#/settings/statuses', 2000)
        row = page.locator('.sort-row', has_text='Wiedervorlage')
        expect(row).to_contain_text(re.compile(r'2\.50\d Leads|25\d\d Leads'), timeout=6000)
    check('Sammeländerung hat wirklich alle Leads erfasst', bulk_result)

    # ---------- Einstellungen ----------
    def statuses():
        go(page, '#/settings/statuses')
        page.locator('button', has_text='Neuer Status').click()
        modal = page.locator('.modal')
        modal.locator('input.input').first.fill('Echt-Test-Status')
        modal.locator('.swatch').nth(2).click()
        modal.locator('button', has_text='Speichern').click()
        row = page.locator('.sort-row', has_text='Echt-Test-Status')
        expect(row).to_be_visible(timeout=4000)
        row.locator('.drag-handle').drag_to(page.locator('.sort-row').first)
        page.wait_for_timeout(1200)
        expect(page.locator('.sort-row').first).to_contain_text('Echt-Test-Status', timeout=4000)
        page.locator('.sort-row', has_text='Echt-Test-Status').locator('button.sort-main').click()
        page.locator('.modal button', has_text='Löschen').click()
        page.locator('.modal button', has_text='Löschen').last.click()
        expect(page.locator('.sort-row', has_text='Echt-Test-Status')).to_have_count(0, timeout=4000)
    check('Lead-Status anlegen, ziehen, löschen', statuses)

    def status_replace():
        # Status mit über 1000 Leads löschen: alle müssen den Ersatz-Status bekommen
        page.locator('button', has_text='Neuer Status').click()
        page.locator('.modal input.input').first.fill('Ersatz-Test')
        page.locator('.modal button', has_text='Speichern').click()
        expect(page.locator('.sort-row', has_text='Ersatz-Test')).to_be_visible(timeout=4000)
        page.locator('.sort-row', has_text='Wiedervorlage').locator('button.sort-main').click()
        page.locator('.modal button', has_text='Löschen').click()
        modal = page.locator('.modal', has_text='stattdessen')
        expect(modal).to_be_visible(timeout=3000)
        modal.locator('select').select_option(label='Ersatz-Test')
        modal.locator('button', has_text='Löschen').last.click()
        page.wait_for_timeout(8000)
        expect(page.locator('.sort-row', has_text='Wiedervorlage')).to_have_count(0, timeout=10000)
        expect(page.locator('.sort-row', has_text='Ersatz-Test')).to_contain_text(re.compile(r'2\.50\d Leads|25\d\d Leads'), timeout=6000)
    check('Status mit über 1000 Leads löschen (Ersatz für alle)', status_replace)

    def fields():
        go(page, '#/settings/fields')
        page.locator('button', has_text='Neues Lead-Feld').click()
        modal = page.locator('.modal')
        modal.locator('input.input').first.fill('Echt-Test-Feld')
        modal.locator('select').first.select_option('choice')
        modal.locator('textarea').fill('Eins\nZwei\nDrei')
        modal.locator('button', has_text='Speichern').click()
        expect(page.locator('.sort-row', has_text='Echt-Test-Feld')).to_contain_text('Eins, Zwei, Drei', timeout=4000)
    check('Eigenes Feld anlegen', fields)

    def activities():
        go(page, '#/settings/forms')
        page.locator('.sort-row', has_text='Wiedervorlage').locator('button.sort-main').click()
        page.wait_for_timeout(600)
        page.get_by_role('button', name='Feld', exact=True).click()
        modal = page.locator('.modal')
        modal.locator('input.input').first.fill('Echt-Test-Feld A')
        modal.locator('button', has_text='Speichern').click()
        expect(page.locator('.sort-row', has_text='Echt-Test-Feld A')).to_be_visible(timeout=4000)
    check('Eigene Aktivität: Feld hinzufügen', activities)

    def outcomes():
        go(page, '#/settings/outcomes')
        page.locator('button', has_text='Neues Ergebnis').click()
        modal = page.locator('.modal')
        modal.locator('input.input').first.fill('Bereits Kunde')
        modal.locator('.switch-row', has_text='Zählt als erreicht').locator('.switch').click()
        modal.locator('select').first.select_option(label='Kunde')
        modal.locator('button', has_text='Speichern').click()
        expect(page.locator('.sort-row', has_text='Bereits Kunde')).to_contain_text('Status → Kunde', timeout=4000)
    check('Anruf-Ergebnis mit Automatik anlegen', outcomes)

    def team_user():
        go(page, '#/settings/team')
        page.locator('button', has_text='Person hinzufügen').first.click()
        modal = page.locator('.modal')
        expect(modal).to_be_visible()
        modal.locator('.field', has_text='Name').locator('input').fill('Tom Test')
        modal.locator('input[type=email]').fill('tom@waehlwerk.test')
        modal.locator('button', has_text='Zugang anlegen').click()
        expect(page.locator('.modal', has_text='Zugang angelegt')).to_be_visible(timeout=10000)
        page.locator('.modal button', has_text='Fertig').click()
        expect(page.locator('.content').first).to_contain_text('Tom Test', timeout=8000)
    check('Team: Benutzer anlegen (Server-Funktion)', team_user)
    page.screenshot(path=f'{OUT}/real-team.png')

    # ---------- Pipeline, Inbox ----------
    def pipeline():
        go(page, '#/opportunities', 2000)
        cols = page.locator('.board-col')
        card = cols.nth(0).locator('.deal').first
        name = card.locator('.deal-name').inner_text()
        card.drag_to(cols.nth(1))
        page.wait_for_timeout(1500)
        expect(cols.nth(1).locator('.deal', has_text=name).first).to_be_visible(timeout=4000)
        go(page, '#/opportunities', 2000)
        expect(page.locator('.board-col').nth(1).locator('.deal', has_text=name).first).to_be_visible(timeout=4000)
    check('Opportunity ziehen und gespeichert', pipeline)

    def inbox():
        go(page, '#/inbox', 1800)
        expect(page.locator('.inbox-side')).to_be_visible()
    check('Inbox öffnen', inbox)

    # In einem zweiten Tab abgemeldet: der erste Tab merkt es und zeigt die Anmeldung mit Hinweis
    def other_tab_logout():
        other = page.context.new_page()
        other.goto(APP)
        expect(other.locator('.sidebar')).to_be_visible(timeout=10000)
        other.wait_for_timeout(800)
        logout(other)
        other.close()
        expect(page.locator('input[type=email]')).to_be_visible(timeout=8000)
        expect(page.locator('.login-form .callout')).to_contain_text('abgemeldet')
    check('In anderem Tab abgemeldet: Anmeldung mit Hinweis', other_tab_logout)

    # ---------- eingeschränkte Rolle ----------
    def logout_if_needed():
        if page.locator('.sidebar').count():
            logout(page)
    check('Abmelden', logout_if_needed)
    check('Anmelden als Mia (nur eigene Leads)', lambda: login(page, MIA))

    def mia_visibility():
        go(page, '#/leads', 2500)
        h1 = page.locator('.page-head h1').inner_text()
        n = int(re.sub(r'\D', '', h1.split('Leads')[-1]) or 0)
        # 833 Testapotheken + 2 eigene + freie (Stern-Apotheke, Echt-Test-Apotheke)
        assert 830 <= n <= 840, f'Mia sieht {n} Leads'
        page.keyboard.press('Control+k')
        page.locator('.palette input').fill('Linden-Apotheke')
        page.wait_for_timeout(1200)
        assert page.locator('.palette-list button', has_text='Linden-Apotheke').count() == 0, 'fremder Lead sichtbar'
        page.keyboard.press('Escape')
    check('Mia sieht nur eigene und freie Leads', mia_visibility)

    def mia_settings():
        go(page, '#/settings/team', 1500)
        assert page.locator('.sort-row, .team-row, table').filter(has_text='Tom Test').count() == 0, 'Teamverwaltung sichtbar'
    check('Mia kommt nicht an die Teamverwaltung', mia_settings)

    def mia_note():
        open_lead(page, 'Adler-Apotheke')
        page.locator('.note-quick').click()
        page.locator('#composer-note').fill('Notiz von Mia')
        page.locator('.inline-panel button', has_text='Notiz speichern').click()
        expect(page.locator('.tl-item', has_text='Notiz von Mia')).to_be_visible(timeout=5000)
    check('Mia schreibt eine Notiz an ihrem Lead', mia_note)
    page.screenshot(path=f'{OUT}/real-mia.png')

    b.close()

for r in results:
    print(*r)
print('--- Browser-Fehler:', '\n'.join(errors) if errors else 'keine')
print('--- Fehlerhafte Antworten:', '\n'.join(sorted(set(bad))) if bad else 'keine')
failed = [r for r in results if r[0] != 'OK']
sys.exit(1 if failed or errors or bad else 0)
