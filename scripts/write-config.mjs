// Schreibt public/config.js aus Umgebungsvariablen (wird von der GitHub Action "Website" genutzt).
// SUPABASE_URL, SUPABASE_ANON_KEY (publishable/anon key, öffentlich), APP_NAME (optional)

import { writeFileSync } from 'node:fs';

const cfg = {
  supabaseUrl: (process.env.SUPABASE_URL ?? '').trim(),
  supabaseKey: (process.env.SUPABASE_ANON_KEY ?? '').trim(),
  appName: (process.env.APP_NAME ?? '').trim() || 'Wählwerk',
};

if (!cfg.supabaseUrl || !cfg.supabaseKey) {
  console.log('::warning::SUPABASE_URL oder SUPABASE_ANON_KEY fehlt – die Website startet im Demo-Modus.');
}
function jwtRole(key) {
  try {
    const part = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(part, 'base64').toString('utf8')).role ?? null;
  } catch {
    return null;
  }
}

if (cfg.supabaseKey.startsWith('sb_secret_') || jwtRole(cfg.supabaseKey) === 'service_role') {
  console.error('::error::Das ist ein geheimer Schlüssel. Hier gehört der publishable/anon key hin.');
  process.exit(1);
}

writeFileSync(
  new URL('../public/config.js', import.meta.url),
  `// Automatisch erzeugt beim Veröffentlichen (scripts/write-config.mjs)\nwindow.CRM_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`,
);
console.log(`config.js geschrieben (${cfg.supabaseUrl || 'Demo-Modus'})`);
