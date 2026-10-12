# Mein Verdienst: einrichten, Kunden eintragen, Stufe und Provision, Storno, Modell anpassen, Monate wechseln,
# gewonnene Opportunity übernehmen, Vorlagen in den Einstellungen – und jede Person sieht nur ihre eigenen Zahlen.
import json
import sys

from playwright.sync_api import expect, sync_playwright
URL, OUT = sys.argv[1], sys.argv[2]
errors = []


def login(page, who):
    page.goto(URL); page.wait_for_timeout(1000)
    page.locator('.user-pick button', has_text=who).first.click(); page.wait_for_timeout(1500)


def logout(page):
    page.locator('.account-btn').click()
    page.get_by_role('button', name='Abmelden').click(); page.wait_for_timeout(800)


def kpi(page, i):
    return page.locator('.earn-kpis .kpi').nth(i)


def db(page):
    return page.evaluate("() => JSON.parse(localStorage.getItem('waehlwerk-demo') || '{}')")


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1440, 'height': 1000})
    page.on('pageerror', lambda e: errors.append(f'pageerror {e}'))
    page.on('console', lambda m: errors.append(f'console {m.text}') if m.type == 'error' else None)

    # Jonas hat noch nichts eingerichtet
    login(page, 'Jonas')
    page.locator('.nav a', has_text='Verdienst').click(); page.wait_for_timeout(800)
    expect(page.locator('.earn-setup')).to_contain_text('Richte deinen Verdienst ein')
    expect(page.locator('.earn-private')).to_contain_text('Nur du siehst diese Seite')
    page.get_by_role('button', name='Jetzt einrichten').click(); page.wait_for_timeout(300)
    dlg = page.get_by_role('dialog')
    expect(dlg.locator('#plan-model option:checked')).to_have_text('Stufenprovision (Beispiel)')
    dlg.get_by_role('button', name='Speichern').click()
    expect(dlg.locator('[role=alert]')).to_contain_text('Fixgehalt')  # ohne Fixgehalt geht es nicht
    dlg.locator('#plan-base').fill('3.000')
    dlg.locator('#plan-goal').fill('5.000')
    dlg.get_by_role('button', name='Speichern').click(); page.wait_for_timeout(600)
    expect(page.locator('.earn-setup')).to_have_count(0)
    expect(kpi(page, 2).locator('.v')).to_contain_text('3.000')
    expect(page.locator('.earn-plan')).to_contain_text('Stufenprovision (Beispiel)')
    expect(page.locator('.earn-ladder')).to_contain_text('Noch 20.000')

    # Kunden eintragen: Lead suchen, Dealwert 21.000 € → Stufe 2 % → 420 € Provision
    page.get_by_role('button', name='Kunde eintragen').first.click(); page.wait_for_timeout(300)
    dlg = page.get_by_role('dialog')
    dlg.get_by_label('Lead suchen').fill('Apotheke'); page.wait_for_timeout(500)
    lead_name = dlg.locator('.menu-item strong').first.inner_text()
    dlg.locator('.menu-item').first.click(); page.wait_for_timeout(500)
    expect(dlg.locator('#deal-customer')).to_have_value(lead_name)
    dlg.locator('#deal-value').fill('21.000')
    dlg.locator('#deal-note').fill('Testkunde')
    page.screenshot(path=f'{OUT}/earnings-deal-modal.png')
    dlg.get_by_role('button', name='Speichern').click(); page.wait_for_timeout(700)
    expect(kpi(page, 0).locator('.v')).to_contain_text('21.000')
    expect(kpi(page, 1).locator('.v')).to_contain_text('420')
    expect(kpi(page, 1)).to_contain_text('Stufe 2')
    expect(kpi(page, 2).locator('.v')).to_contain_text('3.420')
    expect(page.locator('.earn-ladder .step.reached')).to_have_count(1)
    row = page.locator('.earn-deals tbody tr', has_text=lead_name)
    expect(row).to_contain_text('21.000')
    page.screenshot(path=f'{OUT}/earnings-jonas.png', full_page=True)

    # Storno: bleibt in der Liste, zählt nicht mehr
    row.click(); page.wait_for_timeout(300)
    dlg = page.get_by_role('dialog')
    expect(dlg.locator('h2')).to_have_text('Kunde bearbeiten')
    dlg.locator('#deal-canceled').click()
    dlg.get_by_role('button', name='Speichern').click(); page.wait_for_timeout(600)
    expect(kpi(page, 0).locator('.v')).to_contain_text('0')
    expect(kpi(page, 0)).to_contain_text('1 storniert')
    expect(row.locator('.tag', has_text='storniert')).to_be_visible()

    # Modell für sich anpassen: erste Stufe 3 % statt 2 %
    page.locator('.earn-plan').get_by_role('button', name='Ändern').click(); page.wait_for_timeout(300)
    dlg = page.get_by_role('dialog')
    dlg.get_by_role('button', name='Für mich anpassen').click()
    dlg.locator('#plan-tier-rate-0').fill('3')
    dlg.get_by_role('button', name='Speichern').click(); page.wait_for_timeout(600)
    expect(page.locator('.earn-plan')).to_contain_text('(angepasst)')
    row.click(); page.wait_for_timeout(300)
    dlg = page.get_by_role('dialog')
    dlg.locator('#deal-canceled').click()
    dlg.get_by_role('button', name='Speichern').click(); page.wait_for_timeout(600)
    expect(kpi(page, 1).locator('.v')).to_contain_text('630')  # 3 % von 21.000 €

    # Löschen mit Rückfrage
    row.click(); page.wait_for_timeout(300)
    page.get_by_role('dialog').get_by_role('button', name='Löschen').click(); page.wait_for_timeout(300)
    page.get_by_role('dialog').last.get_by_role('button', name='Löschen').click(); page.wait_for_timeout(600)
    expect(page.locator('.earn-deals')).to_have_count(0)
    expect(page.get_by_text('Noch kein Kunde in diesem Monat')).to_be_visible()

    # Monate wechseln
    label = page.locator('.month-nav-label').inner_text()
    page.get_by_role('button', name='Vorheriger Monat').click(); page.wait_for_timeout(500)
    assert page.locator('.month-nav-label').inner_text() != label
    assert 'month=' in page.evaluate('location.hash')
    page.get_by_role('button', name='Dieser Monat').click(); page.wait_for_timeout(500)
    expect(page.locator('.month-nav-label')).to_have_text(label)

    data = db(page)
    jonas = next(x['id'] for x in data['profiles'] if x['full_name'].startswith('Jonas'))
    assert [p_['user_id'] for p_ in data['payPlans']].count(jonas) == 1, data['payPlans']

    # Jonas darf keine Vorlagen pflegen
    page.evaluate("location.hash = '#/settings/commission'"); page.wait_for_timeout(600)
    expect(page.get_by_text('Dieser Bereich ist für deine Rolle nicht freigegeben')).to_be_visible()
    logout(page)

    # Alex sieht seine eigenen Zahlen, nicht die von Jonas
    login(page, 'Alex')
    page.evaluate("location.hash = '#/earnings'"); page.wait_for_timeout(800)
    expect(page.locator('.earn-plan')).to_contain_text('2.800')
    expect(page.locator('.earn-plan')).not_to_contain_text('(angepasst)')
    # Admin legt eine Vorlage fürs Team an
    page.evaluate("location.hash = '#/settings/commission'"); page.wait_for_timeout(600)
    page.get_by_role('button', name='Neues Modell').click(); page.wait_for_timeout(300)
    dlg = page.get_by_role('dialog')
    dlg.locator('#model-name').fill('Opener: je Termin-Kunde')
    dlg.locator('#model-per-deal').fill('150')
    dlg.locator('#model-deal-value').fill('6.500')
    dlg.get_by_role('button', name='Speichern').click(); page.wait_for_timeout(600)
    expect(page.locator('.sort-row', has_text='Opener: je Termin-Kunde')).to_contain_text('150')
    page.screenshot(path=f'{OUT}/earnings-settings.png')
    logout(page)

    # Lea übernimmt eine gewonnene Opportunity
    login(page, 'Lea')
    page.evaluate("location.hash = '#/earnings'"); page.wait_for_timeout(900)
    sugg = page.locator('.earn-suggest .list-item')
    n = sugg.count()
    assert n >= 1, 'keine Vorschläge'
    name = sugg.first.locator('strong').inner_text()
    before = page.locator('.earn-deals tbody tr').count()
    sugg.first.get_by_role('button', name='Übernehmen').click(); page.wait_for_timeout(300)
    dlg = page.get_by_role('dialog')
    expect(dlg.locator('#deal-customer')).to_have_value(name)
    dlg.get_by_role('button', name='Speichern').click(); page.wait_for_timeout(700)
    expect(page.locator('.earn-deals tbody tr')).to_have_count(before + 1)
    expect(page.locator('.earn-suggest .list-item')).to_have_count(n - 1) if n > 1 else expect(page.locator('.earn-suggest')).to_have_count(0)
    taken = [d for d in db(page)['wonDeals'] if d['customer'] == name and d['opportunity_id']]
    assert taken, 'Opportunity nicht verknüpft'
    print(json.dumps({'übernommen': name, 'dealwert': taken[-1]['deal_value']}, ensure_ascii=False))

    # Handy: nichts ragt seitlich heraus
    m = b.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    m.on('pageerror', lambda e: errors.append(f'pageerror {e}'))
    m.goto(URL); m.wait_for_timeout(1000)
    m.evaluate("location.hash = '#/earnings'"); m.wait_for_timeout(1000)
    if m.locator('.user-pick').count():
        m.locator('.user-pick button', has_text='Alex').first.click(); m.wait_for_timeout(1500)
        m.evaluate("location.hash = '#/earnings'"); m.wait_for_timeout(1000)
    over = m.evaluate("() => { const c = document.querySelector('.content'); const p = document.querySelector('.earn'); return [c.scrollWidth - c.clientWidth, p.scrollWidth - p.clientWidth]; }")
    m.screenshot(path=f'{OUT}/earnings-mobile.png', full_page=True)
    assert max(over) <= 1, f'Seite ragt am Handy seitlich heraus: {over}'
    b.close()
print('\n'.join(errors) if errors else 'KEINE FEHLER')
sys.exit(1 if errors else 0)
