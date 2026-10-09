// Schreibt public/config.js aus Umgebungsvariablen (wird von der GitHub Action "Website" genutzt).
// SUPABASE_URL, SUPABASE_ANON_KEY (publishable/anon key, öffentlich), APP_NAME (optional)
// Fehlen beide Werte, bleibt eine bereits eingetragene public/config.js unverändert.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../public/config.js', import.meta.url);

// Werte aus einer vorhandenen config.js lesen (supabaseUrl: '…' oder "supabaseUrl": "…")
function fromFile() {
  if (!existsSync(file)) return { supabaseUrl: '', supabaseKey: '', appName: '' };
  const src = readFileSync(file, 'utf8');
  const pick = (name) => src.match(new RegExp(`["']?${name}["']?\\s*:\\s*["']([^"']*)["']`))?.[1]?.trim() ?? '';
  return { supabaseUrl: pick('supabaseUrl'), supabaseKey: pick('supabaseKey'), appName: pick('appName') };
}

function jwtRole(key) {
  try {
    const part = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(part, 'base64').toString('utf8')).role ?? null;
  } catch {
    return null;
  }
}

function assertPublic(key) {
  if (key.startsWith('sb_secret_') || jwtRole(key) === 'service_role') {
    console.error('::error::Das ist ein geheimer Schlüssel. Hier gehört der publishable/anon key hin.');
    process.exit(1);
  }
}

const cfg = {
  supabaseUrl: (process.env.SUPABASE_URL ?? '').trim(),
  supabaseKey: (process.env.SUPABASE_ANON_KEY ?? '').trim(),
  appName: (process.env.APP_NAME ?? '').trim() || 'Wählwerk',
};

if (!cfg.supabaseUrl && !cfg.supabaseKey) {
  const existing = fromFile();
  if (existing.supabaseUrl && existing.supabaseKey) {
    assertPublic(existing.supabaseKey);
    console.log(`config.js bleibt wie eingetragen (${existing.supabaseUrl})`);
    process.exit(0);
  }
}

if (!cfg.supabaseUrl || !cfg.supabaseKey) {
  console.log('::warning::SUPABASE_URL oder SUPABASE_ANON_KEY fehlt – die Website startet im Demo-Modus.');
}
assertPublic(cfg.supabaseKey);

writeFileSync(
  file,
  `// Automatisch erzeugt beim Veröffentlichen (scripts/write-config.mjs)\nwindow.CRM_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`,
);
console.log(`config.js geschrieben (${cfg.supabaseUrl || 'Demo-Modus'})`);
