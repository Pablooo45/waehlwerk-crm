// Macht aus dist-demo/index.html eine einzelne Seite ohne <html>/<head>/<body>-Gerüst,
// wie sie die Claude-Artifact-Vorschau erwartet (das Gerüst setzt die Vorschau selbst).
// Aufruf: npm run build:demo-page  →  dist-demo/waehlwerk-demo.html

import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../dist-demo/index.html', import.meta.url), 'utf8');

const title = src.slice(0, 4000).match(/<title>([^<]*)<\/title>/)?.[1] ?? 'Wählwerk CRM';

const scriptOpen = src.indexOf('<script type="module"');
if (scriptOpen < 0) throw new Error('Kein Modul-Skript gefunden – erst "npm run build:demo" ausführen.');
const scriptBodyStart = src.indexOf('>', scriptOpen) + 1;
const scriptEnd = src.indexOf('</script>', scriptBodyStart);
const script = src.slice(scriptBodyStart, scriptEnd);

const styleOpen = src.indexOf('<style', scriptEnd);
const styleBodyStart = src.indexOf('>', styleOpen) + 1;
const styleEnd = src.indexOf('</style>', styleBodyStart);
const style = src.slice(styleBodyStart, styleEnd);

const bodyStart = src.indexOf('<body>', styleEnd) + '<body>'.length;
const bodyEnd = src.lastIndexOf('</body>');
const body = src.slice(bodyStart, bodyEnd).trim();

// Viewport zuerst: so passt sich die Seite auch ohne Gerüst (Datei direkt geöffnet) dem Handy an
const out = `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="light dark" />
<title>${title}</title>
<style>${style}</style>
${body}
<script type="module">${script}</script>
`;

writeFileSync(new URL('../dist-demo/waehlwerk-demo.html', import.meta.url), out);
console.log(`dist-demo/waehlwerk-demo.html: ${(out.length / 1024).toFixed(0)} kB`);
