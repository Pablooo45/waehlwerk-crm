import Papa from 'papaparse';
import { FileUp, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { bus } from '../../lib/bus.ts';
import { normalizePhone } from '../../lib/format.ts';
import type { ImportOptions, ImportResult, ImportRow } from '../../lib/store/types.ts';
import { errMsg, Field, useUi } from '../../ui/ui.tsx';
import { StatusSelect, UserSelect } from '../common/bits.tsx';

type Target =
  | 'name' | 'street' | 'zip' | 'city' | 'state' | 'url' | 'source' | 'note' | 'status' | 'owner'
  | 'contact' | 'title' | 'phone1' | 'phone2' | 'mobile' | 'email' | `custom:${string}`;

const TARGETS: { key: Target; label: string; patterns: RegExp[] }[] = [
  { key: 'name', label: 'Firma / Apotheke *', patterns: [/^(firma|firmenname|company|unternehmen|apotheke|name der apotheke|display_name|lead name|lead)$/i, /firma|company|apotheke|unternehmen/i] },
  { key: 'street', label: 'Straße', patterns: [/stra(ss|ß)e|street|address ?1|adresse|anschrift/i] },
  { key: 'zip', label: 'PLZ', patterns: [/^plz$|postleitzahl|zip|postal/i] },
  { key: 'city', label: 'Ort', patterns: [/^(ort|stadt|city)$/i, /ort|stadt|city/i] },
  { key: 'state', label: 'Bundesland', patterns: [/bundesland|state|region/i] },
  { key: 'url', label: 'Website', patterns: [/website|webseite|homepage|^url$|internet/i] },
  { key: 'source', label: 'Quelle', patterns: [/quelle|source|herkunft/i] },
  { key: 'note', label: 'Notiz / Beschreibung', patterns: [/notiz|bemerkung|kommentar|description|beschreibung|notes?/i] },
  { key: 'status', label: 'Status', patterns: [/status/i] },
  { key: 'owner', label: 'Zuständig (Name/E-Mail)', patterns: [/zust(ä|a)ndig|owner|betreuer|verantwortlich/i] },
  { key: 'contact', label: 'Ansprechpartner', patterns: [/ansprechpartner|kontakt ?name|contact ?name|primary_contact_name|inhaber|^name$/i] },
  { key: 'title', label: 'Position', patterns: [/position|titel|title|funktion|rolle/i] },
  { key: 'phone1', label: 'Telefon', patterns: [/^(telefon|tel|phone|telefonnummer)$/i, /primary_contact_primary_phone|telefon|phone|tel\./i] },
  { key: 'phone2', label: 'Telefon 2', patterns: [/telefon ?2|phone ?2|weitere/i] },
  { key: 'mobile', label: 'Mobil', patterns: [/mobil|handy|mobile|cell/i] },
  { key: 'email', label: 'E-Mail', patterns: [/e-?mail|mail/i] },
];

function guess(headers: string[], used: Set<string>, patterns: RegExp[]): string {
  for (const p of patterns) {
    const h = headers.find((x) => !used.has(x) && p.test(x.trim()));
    if (h) return h;
  }
  return '';
}

export default function ImportExport() {
  const { store, ref, can } = useApp();
  const { toast } = useUi();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [map, setMap] = useState<Record<string, string>>({});
  const [opts, setOpts] = useState<ImportOptions>({
    duplicateMode: 'skip',
    statusId: ref.statuses.find((s) => s.is_default)?.id ?? null,
    ownerId: null,
    source: '',
  });
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const targets = useMemo(
    () => [
      ...TARGETS,
      ...ref.customFields.map((f) => ({ key: `custom:${f.key}` as Target, label: f.label, patterns: [new RegExp(`^${f.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')] })),
    ],
    [ref.customFields],
  );

  const load = (file: File) => {
    setResult(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const hs = (res.meta.fields ?? []).filter(Boolean);
        setHeaders(hs);
        setRows(res.data);
        setFileName(file.name);
        const used = new Set<string>();
        const m: Record<string, string> = {};
        for (const t of targets) {
          const g = guess(hs, used, t.patterns);
          if (g) {
            m[t.key] = g;
            used.add(g);
          }
        }
        setMap(m);
        setOpts((o) => ({ ...o, source: o.source || file.name.replace(/\.(csv|txt)$/i, '') }));
        if (res.errors.length) toast(`${res.errors.length} Zeilen konnten nicht gelesen werden.`, { kind: 'error' });
      },
      error: (err) => toast(err.message, { kind: 'error' }),
    });
  };

  const build = (): ImportRow[] => {
    const get = (r: Record<string, string>, t: string) => (map[t] ? String(r[map[t]] ?? '').trim() : '');
    const statusByLabel = new Map(ref.statuses.map((s) => [s.label.toLowerCase(), s.id]));
    const userBy = (v: string) =>
      ref.profiles.find((p) => p.email.toLowerCase() === v.toLowerCase() || p.full_name.toLowerCase() === v.toLowerCase())?.id ?? null;
    return rows
      .map((r): ImportRow | null => {
        const name = get(r, 'name');
        if (!name) return null;
        const phones = [get(r, 'phone1'), get(r, 'phone2'), get(r, 'mobile')]
          .flatMap((p) => p.split(/[;,/|]\s*(?=[+0(])/))
          .map((p) => p.trim())
          .filter((p) => p && normalizePhone(p));
        const emails = get(r, 'email').split(/[;,\s]+/).filter((e) => /@/.test(e));
        const custom: Record<string, unknown> = {};
        for (const f of ref.customFields) {
          const v = get(r, `custom:${f.key}`);
          if (v) custom[f.key] = f.type === 'number' ? Number(v.replace(',', '.')) || null : f.type === 'checkbox' ? /^(ja|yes|true|1|x)$/i.test(v) : v;
        }
        const statusLabel = get(r, 'status').toLowerCase();
        const owner = get(r, 'owner');
        return {
          lead: {
            name,
            address_street: get(r, 'street') || null,
            address_zip: get(r, 'zip') || null,
            address_city: get(r, 'city') || null,
            address_state: get(r, 'state') || null,
            url: get(r, 'url') || null,
            source: get(r, 'source') || null,
            status_id: statusLabel ? statusByLabel.get(statusLabel) ?? null : null,
            owner_id: owner ? userBy(owner) : null,
            custom,
          },
          contacts: phones.length || emails.length || get(r, 'contact')
            ? [{ name: get(r, 'contact'), title: get(r, 'title') || null, phones, emails }]
            : [],
          note: get(r, 'note') || null,
        };
      })
      .filter((x): x is ImportRow => !!x);
  };

  const prepared = useMemo(build, [rows, map, ref]);

  const run = async () => {
    setProgress(0);
    setResult(null);
    try {
      const res = await store.importLeads(prepared, { ...opts, source: opts.source || null }, (n) => setProgress(n));
      setResult(res);
      bus.emit('leads');
      toast(`Import fertig: ${res.created} neu, ${res.merged} ergänzt, ${res.skipped} übersprungen.`);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setProgress(null);
    }
  };

  return (
    <>
      {can('import') ? <section className="section">
        <h2>Leads importieren</h2>
        <p className="muted">
          CSV-Datei aus Excel, Google Sheets oder dem Export aus Close. Spalten werden automatisch erkannt, Dubletten anhand
          der Telefonnummer oder Firmenname + PLZ gefunden.
        </p>
        <div className="row wrap">
          <button type="button" className="btn primary" onClick={() => fileRef.current?.click()}>
            <FileUp /> CSV-Datei wählen
          </button>
          {fileName ? <span className="small">{fileName}: {rows.length.toLocaleString('de-DE')} Zeilen, {prepared.length.toLocaleString('de-DE')} mit Firmenname</span> : null}
          <input ref={fileRef} type="file" accept=".csv,text/csv,.txt" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} />
        </div>

        {headers.length ? (
          <>
            <h3 className="mt-24">Spalten zuordnen</h3>
            <div className="form-grid mt-8">
              {targets.map((t) => (
                <Field key={t.key} label={t.label}>
                  <select className="select" value={map[t.key] ?? ''} onChange={(e) => setMap({ ...map, [t.key]: e.target.value })}>
                    <option value="">– nicht importieren –</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}{rows[0]?.[h] ? ` (z. B. ${String(rows[0][h]).slice(0, 24)})` : ''}</option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>

            <h3 className="mt-24">Optionen</h3>
            <div className="form-grid mt-8">
              <Field label="Wenn der Lead schon existiert">
                <select className="select" value={opts.duplicateMode} onChange={(e) => setOpts({ ...opts, duplicateMode: e.target.value as ImportOptions['duplicateMode'] })}>
                  <option value="skip">überspringen</option>
                  <option value="merge">neue Kontakte/Nummern ergänzen</option>
                  <option value="create">trotzdem neu anlegen</option>
                </select>
              </Field>
              <Field label="Quelle">
                <input className="input" value={opts.source ?? ''} onChange={(e) => setOpts({ ...opts, source: e.target.value })} />
              </Field>
              <Field label="Status (wenn in der Datei leer)">
                <StatusSelect value={opts.statusId} onChange={(v) => setOpts({ ...opts, statusId: v })} statuses={ref.statuses} />
              </Field>
              <Field label="Zuständig (wenn in der Datei leer)">
                <UserSelect value={opts.ownerId} onChange={(v) => setOpts({ ...opts, ownerId: v })} />
              </Field>
            </div>

            {prepared.length ? (
              <div className="table-wrap mt-16">
                <table className="table">
                  <thead>
                    <tr><th>Firma</th><th>Ort</th><th>Kontakt</th><th>Nummern</th></tr>
                  </thead>
                  <tbody>
                    {prepared.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        <td>{r.lead.name}</td>
                        <td>{[r.lead.address_zip, r.lead.address_city].filter(Boolean).join(' ')}</td>
                        <td>{r.contacts[0]?.name}</td>
                        <td>{r.contacts[0]?.phones.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="row wrap mt-16">
              <button type="button" className="btn primary" onClick={run} disabled={!map.name || !prepared.length || progress !== null}>
                <Upload /> {prepared.length.toLocaleString('de-DE')} Leads importieren
              </button>
              {progress !== null ? (
                <span className="small">
                  {progress.toLocaleString('de-DE')} / {prepared.length.toLocaleString('de-DE')}…
                </span>
              ) : null}
              {!map.name ? <span className="small" style={{ color: 'var(--signal)' }}>Bitte die Spalte für den Firmennamen wählen.</span> : null}
            </div>
            {result ? (
              <div className="callout ok mt-16">
                <span>
                  {result.created} neu angelegt, {result.merged} ergänzt, {result.skipped} übersprungen
                  {result.failed.length ? `, ${result.failed.length} fehlgeschlagen (z. B. Zeile ${result.failed[0].row}: ${result.failed[0].error})` : ''}.
                </span>
              </div>
            ) : null}
          </>
        ) : null}
      </section> : null}
      {can('export') ? <section className="section">
        <h2>Exportieren</h2>
        <p className="muted">
          Jede Lead-Liste und Smart View lässt sich über das Menü „…“ oben rechts als CSV exportieren – mit allen Kontakten,
          Nummern und eigenen Feldern. Eure Daten gehören euch und lassen sich jederzeit mitnehmen.
        </p>
        <a className="btn" href="#/leads">Zu den Leads</a>
      </section> : null}
    </>
  );
}
