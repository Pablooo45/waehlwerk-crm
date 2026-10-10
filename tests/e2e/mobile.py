import sys
from playwright.sync_api import sync_playwright
URL, OUT = sys.argv[1], sys.argv[2]
routes = ['#/settings/statuses', '#/settings/fields', '#/settings/forms', '#/settings/outcomes', '#/opportunities', '#/calls', '#/contacts', '#/views']
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(f'pageerror {page.url}: {e}'))
    page.on('console', lambda m: errors.append(f'console {page.url}: {m.text}') if m.type == 'error' else None)
    page.goto(URL); page.wait_for_timeout(1200)
    page.locator('.user-pick button', has_text='Alex').first.click(); page.wait_for_timeout(2200)
    for r in routes:
        page.evaluate(f"location.hash = '{r}'"); page.wait_for_timeout(1100)
        wide = page.evaluate('document.documentElement.scrollWidth - window.innerWidth')
        page.screenshot(path=f"{OUT}/m2-{r.replace('#/','').replace('/','_')}.png")
        print(r, 'zu breit um', wide)
    # Telefon-Menü und Suche am Handy
    page.locator('.topbar .phone-btn-m').click(); page.wait_for_timeout(500)
    page.screenshot(path=f'{OUT}/m2-phone.png')
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    page.locator('.topbar-search').click(); page.wait_for_timeout(500)
    page.screenshot(path=f'{OUT}/m2-search.png')
    b.close()
print('\n'.join(errors) if errors else 'KEINE FEHLER')
sys.exit(1 if errors else 0)
