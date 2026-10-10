import sys
from playwright.sync_api import sync_playwright

# Desktop-Rundgang durch die Demo: Seiten öffnen und Bildschirmfotos machen.
URL, OUT = sys.argv[1], sys.argv[2]
routes = sys.argv[3].split(',') if len(sys.argv) > 3 else ['#/inbox', '#/leads', '#/contacts', '#/opportunities', '#/pipeline', '#/calls', '#/meetings', '#/reports', '#/settings/customize', '#/settings/profile']
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(f'pageerror {page.url}: {e}'))
    page.on('console', lambda m: errors.append(f'console {page.url}: {m.text}') if m.type == 'error' else None)
    page.goto(URL)
    page.wait_for_timeout(1500)
    page.screenshot(path=f'{OUT}/d-login.png')
    page.locator('.user-pick button', has_text=sys.argv[4] if len(sys.argv) > 4 else 'Mia').first.click()
    page.wait_for_timeout(2500)
    for r in routes:
        page.evaluate(f"location.hash = '{r}'")
        page.wait_for_timeout(1300)
        name = r.replace('#/', '').replace('/', '_') or 'home'
        page.screenshot(path=f'{OUT}/d-{name}.png')
        print(r, page.url)
    page.evaluate("location.hash = '#/leads'")
    page.wait_for_timeout(1200)
    page.locator('a.lead-name').first.click()
    page.wait_for_timeout(1800)
    page.screenshot(path=f'{OUT}/d-lead.png', full_page=False)
    print('lead', page.url)
    b.close()
print('\n'.join(errors) if errors else 'KEINE FEHLER')
sys.exit(1 if errors else 0)
