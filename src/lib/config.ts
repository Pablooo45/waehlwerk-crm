// Laufzeit-Konfiguration aus public/config.js (siehe EINRICHTUNG.md)

const raw = typeof window !== 'undefined' ? window.CRM_CONFIG ?? {} : {};
const url = (raw.supabaseUrl ?? '').trim().replace(/\/$/, '');
const key = (raw.supabaseKey ?? '').trim();

export const config = {
  supabaseUrl: url,
  supabaseKey: key,
  appName: (raw.appName ?? '').trim() || 'Wählwerk',
  demo: __DEMO_BUILD__ || !url || !key,
  // Die Ein-Datei-Demo läuft in einer abgesicherten Vorschau: kein Mikrofon, keine Downloads, keine mailto-Links.
  demoBuild: __DEMO_BUILD__,
  version: __APP_VERSION__,
  functionsUrl: url ? `${url}/functions/v1` : '',
};
