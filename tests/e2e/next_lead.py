import sys
from playwright.sync_api import expect, sync_playwright
URL, OUT = sys.argv[1], sys.argv[2]
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1440, 'height': 900})
    page.on('pageerror', lambda e: errors.append(f'pageerror {e}'))
    page.on('console', lambda m: errors.append(f'console {m.text}') if m.type == 'error' else None)
    page.goto(URL); page.wait_for_timeout(1200)
    page.locator('.user-pick button', has_text='Mia').first.click(); page.wait_for_timeout(2000)
    page.evaluate("location.hash='#/inbox'"); page.wait_for_timeout(1200)
    page.locator('.page-head button', has_text='Abarbeiten').click(); page.wait_for_timeout(1500)
    print('url', page.url)
    expect(page.locator('.lead-inbox')).to_be_visible()
    page.screenshot(path=f'{OUT}/nextlead-1.png')
    seen = [page.locator('.lead-title').input_value()]
    for _ in range(6):
        if page.locator('.lead-inbox button', has_text='Erledigt').count():
            page.locator('.lead-inbox-item button', has_text='Erledigt').first.click(); page.wait_for_timeout(700)
        nxt = page.locator('.lead-inbox button', has_text='Nächster Lead')
        if not nxt.count():
            break
        nxt.click(); page.wait_for_timeout(1300)
        seen.append(page.locator('.lead-title').input_value())
    print('Leads der Reihe nach:', seen)
    page.screenshot(path=f'{OUT}/nextlead-2.png')
    page.evaluate("location.hash='#/inbox'"); page.wait_for_timeout(1200)
    print('Inbox-Einträge übrig:', page.locator('.inbox-item').count())
    b.close()
print('\n'.join(errors) if errors else 'KEINE FEHLER')
sys.exit(1 if errors else 0)
