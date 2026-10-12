import json
import sys

from playwright.sync_api import expect, sync_playwright

# Durchklick-Test des Close-Umbaus (Demo): Lead-Seite, Editoren, Felder, Status, Suche, Telefon-Menü,
# neuer Lead, Einstellungen (Status, Felder, Aktivitäten, Ergebnisse), Pipeline ziehen, Power Dialer, Inbox.
URL, OUT = sys.argv[1], sys.argv[2]
errors = []
results = []


def check(name, fn):
    try:
        fn()
        results.append(('OK', name))
    except Exception as e:  # noqa: BLE001
        results.append(('FEHLER', f'{name}: {str(e).splitlines()[0][:300]}'))


def go(page, h, ms=1100):
    page.evaluate(f'location.hash = {json.dumps(h)}')
    page.wait_for_timeout(ms)


with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='de-DE', timezone_id='Europe/Berlin')
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(f'pageerror {page.url}: {e}'))
    page.on('console', lambda m: errors.append(f'console {page.url}: {m.text}') if m.type == 'error' else None)
    page.goto(URL)
    page.wait_for_timeout(1200)
    page.locator('.user-pick button', has_text='Alex').first.click()
    page.wait_for_timeout(2200)

    # ---------- Lead-Seite ----------
    go(page, '#/leads')
    page.locator('a.lead-name').nth(2).click()
    page.wait_for_timeout(1500)
    lead_url = page.url

    def note():
        page.locator('.note-quick').click()
        page.locator('#composer-note').fill('Close-Test: Notiz über den Editor')
        page.locator('.inline-panel button', has_text='Notiz speichern').click()
        expect(page.locator('.tl-item', has_text='Close-Test: Notiz über den Editor')).to_be_visible(timeout=4000)
        expect(page.locator('.inline-panel')).to_have_count(0)
    check('Notiz über den Editor im Verlauf', note)

    def note_hotkey():
        page.locator('body').click(position={'x': 900, 'y': 860})
        page.keyboard.press('n')
        expect(page.locator('#composer-note')).to_be_focused(timeout=2000)
        page.keyboard.press('Escape')
        expect(page.locator('.inline-panel')).to_have_count(0)
    check('Taste N öffnet Notiz, Esc schließt', note_hotkey)

    def email():
        page.locator('.lead-actions button', has_text='E-Mail').click()
        panel = page.locator('.inline-panel', has_text='E-Mail schreiben')
        expect(panel).to_be_visible()
        to = panel.locator('input[type=email]').first.input_value()
        if not to:
            panel.locator('input[type=email]').first.fill('test@beispiel.example')
        panel.locator('label:has-text("Betreff") + input, .field:has(label:has-text("Betreff")) input').first.fill('Close-Test Betreff')
        panel.locator('[contenteditable=true]').first.click()
        page.keyboard.type('Hallo aus dem Test')
        panel.locator('button', has_text='Senden').click()
        expect(page.locator('.tl-item', has_text='Close-Test Betreff')).to_be_visible(timeout=4000)
    check('E-Mail im Verlauf-Editor senden', email)

    def activity():
        page.locator('.lead-actions button', has_text='Aktivität').click()
        page.locator('.popover .menu-item', has_text='Wiedervorlage').click()
        panel = page.locator('.inline-panel')
        expect(panel).to_be_visible()
        # Pflichtfelder füllen: alle Auswahlen auf erste Option, Datum/Text füllen
        for sel in panel.locator('select').all():
            opts = sel.locator('option').all()
            if len(opts) > 1:
                sel.select_option(index=1)
        for inp in panel.locator('input[type="datetime-local"]').all():
            inp.fill('2026-10-20T10:00')
        for inp in panel.locator('input[type="date"]').all():
            inp.fill('2026-10-20')
        for ta in panel.locator('textarea').all():
            ta.fill('Test-Aktivität')
        panel.locator('button', has_text='Speichern').last.click()
        expect(page.locator('.tl-item', has_text='Wiedervorlage / Follow-Up').first).to_be_visible(timeout=4000)
    check('Eigene Aktivität (Wiedervorlage) erfassen', activity)

    def log_call():
        page.locator('.btn-split .caret').click()
        page.locator('.popover .menu-item', has_text='Anruf protokollieren').click()
        panel = page.locator('.inline-panel', has_text='Anruf protokollieren')
        expect(panel).to_be_visible()
        panel.locator('textarea').fill('Vom Handy angerufen – Close-Test')
        panel.locator('button', has_text='Anruf speichern').click()
        expect(page.locator('.tl-item', has_text='Vom Handy angerufen – Close-Test')).to_be_visible(timeout=4000)
    check('Anruf protokollieren über ▾', log_call)

    def status():
        page.locator('.lead-status-row .status-pill').click()
        page.locator('.popover .menu-item', has_text='Wiedervorlage').click()
        expect(page.locator('.lead-status-row .status-pill')).to_contain_text('Wiedervorlage', timeout=3000)
        expect(page.locator('.tl-item', has_text='Status:').first).to_be_visible(timeout=3000)
    check('Status über den Status-Knopf ändern', status)

    def field_edit():
        row = page.locator('.lead-fields dd').filter(has=page.locator('button.field-value')).first
        dt = page.locator('.lead-fields dt').nth(2).inner_text()
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
        page.wait_for_timeout(800)
        expect(page.locator('.lead-fields button.field-value').first).not_to_have_text('–')
    check('Feld per Klick bearbeiten', field_edit)

    def add_field():
        page.locator('.lead-sec-head button[aria-label="Feld ausfüllen"]').click()
        item = page.locator('.popover .menu-item').first
        label = item.inner_text().strip()
        item.click()
        page.wait_for_timeout(300)
        expect(page.locator('.lead-fields dt', has_text=label)).to_be_visible()
        page.keyboard.press('Escape')
    check('„+“ bei Felder zeigt ein verstecktes Feld', add_field)

    def task():
        page.locator('.lead-sec-head button[aria-label="Aufgabe hinzufügen"]').click()
        modal = page.locator('.modal')
        modal.locator('input').first.fill('Close-Test Aufgabe')
        modal.locator('button', has_text='Speichern').click()
        row = page.locator('.lead-row', has_text='Close-Test Aufgabe')
        expect(row).to_be_visible(timeout=3000)
        row.locator('.task-check').click()
        expect(row).to_have_count(0, timeout=3000)
    check('Aufgabe links anlegen und abhaken', task)

    def filter_feed():
        page.locator('.feed-head button', has_text='Alle Aktivitäten').click()
        page.locator('.popover .menu-item', has_text='Notizen').click()
        expect(page.locator('.feed-head button', has_text='Notizen')).to_be_visible()
        cnt = page.locator('.feed > .timeline .tl-item').count()
        assert cnt >= 1, 'keine Notizen sichtbar'
        page.locator('.feed-head button', has_text='Notizen').click()
        page.locator('.popover .menu-item', has_text='Alle Aktivitäten').click()
        page.keyboard.press('Control+f')
        page.locator('.feed-search input').fill('Close-Test Betreff')
        expect(page.locator('.feed > .timeline .tl-item')).to_have_count(1, timeout=2000)
        page.locator('.feed-search input').press('Escape')
    check('Verlauf filtern und durchsuchen (Strg + F)', filter_feed)

    def call():
        page.locator('.lead-actions .btn.call').first.click()
        expect(page.locator('.callbar')).to_be_visible(timeout=5000)
        page.wait_for_timeout(3500)
        page.locator('.callbar .ctrl.hangup').click()
        expect(page.locator('.wrapup')).to_be_visible(timeout=5000)
        page.keyboard.press('2')
        page.locator('#wrap-note').fill('Close-Test Anruf')
        page.locator('.wrapup button', has_text='Speichern').click()
        expect(page.locator('.tl-item', has_text='Close-Test Anruf')).to_be_visible(timeout=5000)
    check('Anrufen, auflegen, Ergebnis speichern', call)
    page.screenshot(path=f'{OUT}/flow-lead.png')

    # ---------- Suche, Telefon, neuer Lead ----------
    def palette():
        page.keyboard.press('Control+k')
        expect(page.locator('.palette')).to_be_visible()
        page.locator('.palette input').fill('Apotheke')
        page.wait_for_timeout(700)
        page.keyboard.press('Enter')
        page.wait_for_timeout(1200)
        assert '#/leads/' in page.url, page.url
    check('Suche (Strg + K) springt zum Lead', palette)

    def phone():
        page.locator('.sidebar .phone-btn').click()
        expect(page.locator('.phone-pop')).to_be_visible()
        sw = page.locator('.phone-pop .switch')
        before = sw.get_attribute('aria-checked')
        sw.click()
        page.wait_for_timeout(600)
        page.locator('.sidebar .phone-btn').click()
        page.wait_for_timeout(300)
        if not page.locator('.phone-pop').count():
            page.locator('.sidebar .phone-btn').click()
        after = page.locator('.phone-pop .switch').get_attribute('aria-checked')
        assert before != after, f'{before} -> {after}'
        page.locator('.phone-pop .switch').click()
        page.keyboard.press('Escape')
    check('Telefon-Menü: Erreichbarkeit umschalten', phone)

    def new_lead():
        page.locator('.nav-add').click()
        modal = page.locator('.modal')
        modal.locator('input').first.fill('Close-Test-Apotheke')
        modal.locator('button', has_text='Lead anlegen').click()
        expect(page.locator('.lead-title')).to_have_value('Close-Test-Apotheke', timeout=4000)
    check('„+“ neben Leads legt Lead an', new_lead)

    # ---------- Einstellungen ----------
    def statuses():
        go(page, '#/settings/statuses')
        page.locator('button', has_text='Neuer Status').click()
        modal = page.locator('.modal')
        modal.locator('input.input').first.fill('Close-Test-Status')
        modal.locator('.swatch').nth(2).click()
        modal.locator('button', has_text='Speichern').click()
        row = page.locator('.sort-row', has_text='Close-Test-Status')
        expect(row).to_be_visible(timeout=3000)
        # Ziehen nach oben
        src = row.locator('.drag-handle')
        dst = page.locator('.sort-row').first
        src.drag_to(dst)
        page.wait_for_timeout(800)
        expect(page.locator('.sort-row').first).to_contain_text('Close-Test-Status', timeout=3000)
        # Löschen
        page.locator('.sort-row', has_text='Close-Test-Status').locator('button.sort-main').click()
        page.locator('.modal button', has_text='Löschen').click()
        page.locator('.modal button', has_text='Löschen').last.click()
        expect(page.locator('.sort-row', has_text='Close-Test-Status')).to_have_count(0, timeout=3000)
    check('Lead-Status anlegen, ziehen, löschen', statuses)

    def status_in_use():
        page.locator('.sort-row', has_text='KPK').locator('button.sort-main').click()
        page.locator('.modal button', has_text='Löschen').click()
        expect(page.locator('.modal', has_text='stattdessen')).to_be_visible(timeout=2000)
        page.locator('.modal button', has_text='Zurück').click()
        page.locator('.modal button', has_text='Abbrechen').click()
    check('Status mit Leads fragt nach Ersatz', status_in_use)

    def pipelines():
        page.locator('.tabs button', has_text='Opportunity-Status').click()
        page.wait_for_timeout(600)
        page.locator('button', has_text='Neue Phase').click()
        page.locator('.modal input.input').first.fill('Close-Test-Phase')
        page.locator('.modal button', has_text='Speichern').click()
        expect(page.locator('.sort-row', has_text='Close-Test-Phase')).to_be_visible(timeout=3000)
    check('Pipeline-Phase anlegen', pipelines)

    def fields():
        go(page, '#/settings/fields')
        page.locator('button', has_text='Neues Lead-Feld').click()
        modal = page.locator('.modal')
        modal.locator('input.input').first.fill('Close-Test-Feld')
        modal.locator('select').first.select_option('choice')
        modal.locator('textarea').fill('Eins\nZwei\nDrei')
        modal.locator('button', has_text='Speichern').click()
        expect(page.locator('.sort-row', has_text='Close-Test-Feld')).to_be_visible(timeout=3000)
        expect(page.locator('.sort-row', has_text='Close-Test-Feld')).to_contain_text('Eins, Zwei, Drei')
    check('Eigenes Feld (Auswahl) anlegen', fields)

    def activities():
        go(page, '#/settings/forms')
        page.locator('.sort-row', has_text='Wiedervorlage').locator('button.sort-main').click()
        page.wait_for_timeout(500)
        page.get_by_role('button', name='Feld', exact=True).click()
        modal = page.locator('.modal')
        modal.locator('input.input').first.fill('Close-Test-Feld A')
        modal.locator('button', has_text='Speichern').click()
        expect(page.locator('.sort-row', has_text='Close-Test-Feld A')).to_be_visible(timeout=3000)
        page.locator('button', has_text='Alle eigenen Aktivitäten').click()
        expect(page.locator('.sort-row', has_text='Wiedervorlage')).to_contain_text('5 Felder')
    check('Eigene Aktivität: Feld hinzufügen', activities)

    def outcomes():
        go(page, '#/settings/outcomes')
        page.locator('button', has_text='Neues Ergebnis').click()
        modal = page.locator('.modal')
        modal.locator('input.input').first.fill('Bereits Kunde')
        modal.locator('.switch-row', has_text='Zählt als erreicht').locator('.switch').click()
        modal.locator('select').first.select_option(label='Kunde')
        modal.locator('button', has_text='Speichern').click()
        row = page.locator('.sort-row', has_text='Bereits Kunde')
        expect(row).to_be_visible(timeout=3000)
        expect(row).to_contain_text('Status → Kunde')
    check('Anruf-Ergebnis mit Automatik anlegen', outcomes)
    page.screenshot(path=f'{OUT}/flow-outcomes.png')

    # ---------- Pipeline ziehen ----------
    def pipeline_drag():
        go(page, '#/opportunities', 1500)
        cols = page.locator('.board-col')
        first_col = cols.nth(0)
        card = first_col.locator('.deal').first
        name = card.locator('.deal-name').inner_text()
        card.drag_to(cols.nth(1))
        page.wait_for_timeout(1000)
        expect(cols.nth(1).locator('.deal', has_text=name).first).to_be_visible(timeout=3000)
    check('Opportunity in andere Phase ziehen', pipeline_drag)

    # ---------- Internet weg ----------
    def offline():
        ctx = page.context
        ctx.set_offline(True)
        expect(page.locator('.offline-banner')).to_be_visible(timeout=3000)
        ctx.set_offline(False)
        expect(page.locator('.offline-banner')).to_have_count(0, timeout=3000)
    check('Internet weg: Hinweis oben, danach wieder weg', offline)

    # ---------- Inbox ----------
    def inbox():
        go(page, '#/inbox')
        expect(page.locator('.inbox-side')).to_be_visible()
        page.locator('.filterbar .chip-btn', has_text='Alle').first.click()
        page.wait_for_timeout(300)
        page.locator('.inbox-bar button', has_text='Später').click()
        page.wait_for_timeout(600)
        assert 'box=later' in page.url
    check('Inbox: Filter, Später, Termine-Spalte', inbox)

    # ---------- Power Dialer ----------
    def dialer():
        go(page, '#/leads', 1400)
        page.locator('.page-head .btn.call', has_text='Anrufen').click()
        page.wait_for_timeout(2500)
        assert '#/dialer' in page.url, page.url
        expect(page.locator('.dialer-bar')).to_be_visible()
        expect(page.locator('.dialer-page .lead-page')).to_be_visible(timeout=5000)
        page.screenshot(path=f'{OUT}/flow-dialer.png')
        # laufenden Anruf beenden, Ergebnis speichern
        page.wait_for_timeout(3000)
        if page.locator('.callbar .ctrl.hangup').count():
            page.locator('.callbar .ctrl.hangup').click()
            page.wait_for_timeout(1200)
        if page.locator('.dialer-wrapup').count():
            page.keyboard.press('1')
            page.locator('.dialer-wrapup button', has_text='Speichern').click()
            page.wait_for_timeout(1500)
        page.locator('.dialer-bar button', has_text='Pause').click()
        page.wait_for_timeout(500)
        page.locator('.dialer-bar button', has_text='Beenden').click()
        page.wait_for_timeout(800)
    check('Power Dialer zeigt die Lead-Seite', dialer)

    b.close()

for r in results:
    print(*r)
print('\n'.join(errors) if errors else 'KEINE KONSOLENFEHLER')
sys.exit(1 if errors else 0)
