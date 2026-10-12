# Notizen mit Formatierung wie in Close: fett, Liste, @Erwähnung, bearbeiten; reiner Text bleibt reiner Text.
import json
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
    page.evaluate("location.hash='#/leads'"); page.wait_for_timeout(1200)
    page.locator('a.lead-name').first.click(); page.wait_for_timeout(1500)
    page.keyboard.press('n'); page.wait_for_timeout(400)
    ed = page.locator('#composer-note')
    expect(ed).to_be_focused()
    page.keyboard.type('Gespräch mit Inhaber: ')
    page.keyboard.press('Control+b'); page.keyboard.type('sehr interessiert'); page.keyboard.press('Control+b')
    page.keyboard.press('Enter')
    page.locator('.note-editor button[aria-label="Liste"]').click()
    page.keyboard.type('Budget klären'); page.keyboard.press('Enter'); page.keyboard.type('Termin Dienstag')
    page.keyboard.press('Enter'); page.keyboard.press('Enter')
    page.keyboard.type('Bitte übernehmen @Lea')
    page.wait_for_timeout(300)
    expect(page.locator('.mention-pop button').first).to_be_visible()
    page.keyboard.press('Enter'); page.wait_for_timeout(200)
    page.keyboard.type('danke')
    page.screenshot(path=f'{OUT}/note-editor.png')
    page.keyboard.press('Control+Enter'); page.wait_for_timeout(900)
    page.screenshot(path=f'{OUT}/note-after-save.png')
    item = page.locator('.tl-item', has_text='Budget klären').first
    expect(item.locator('.note-html :is(b,strong)', has_text='sehr interessiert')).to_be_visible()
    expect(item.locator('.note-html ul li')).to_have_count(2)
    expect(item.locator('.note-html .mention-tag', has_text='@Lea')).to_be_visible()
    page.screenshot(path=f'{OUT}/note-timeline.png')
    body = page.evaluate("""() => { const db = JSON.parse(localStorage.getItem('waehlwerk-demo') || '{}');
      const n = (db.notes || []).find((x) => (x.body || '').includes('Budget klären')); return n ? { body: n.body, html: n.body_html, mentions: n.mentions } : null; }""")
    print(json.dumps(body, ensure_ascii=False))
    assert body['body'].startswith('Gespräch mit Inhaber: sehr interessiert\n• Budget klären\n• Termin Dienstag\n'), body
    assert '@Lea Hoffmann danke' in body['body'] and len(body['mentions']) == 1, body
    # bearbeiten: Formatierung bleibt, Änderung wird gespeichert
    item.hover()
    item.locator('button[aria-label="Bearbeiten"]').click()
    edit = item.locator('.note-editor .note-body')
    expect(edit.locator(':is(b,strong)')).to_have_text('sehr interessiert')
    edit.click(); page.keyboard.press('Control+End'); page.keyboard.type(' und Rückruf')
    item.locator('button', has_text='Speichern').click(); page.wait_for_timeout(800)
    expect(page.locator('.tl-item', has_text='und Rückruf').locator('.note-html :is(b,strong)')).to_be_visible()
    # Notiz ohne Formatierung bleibt reiner Text
    page.locator('.note-quick').click(); page.wait_for_timeout(300)
    page.keyboard.type('Nur Text ohne Formatierung')
    page.keyboard.press('Control+Enter'); page.wait_for_timeout(800)
    plain = page.locator('.tl-item', has_text='Nur Text ohne Formatierung').first
    expect(plain.locator('.note-html')).to_have_count(0)
    b.close()
print('\n'.join(errors) if errors else 'KEINE FEHLER')
sys.exit(1 if errors else 0)
