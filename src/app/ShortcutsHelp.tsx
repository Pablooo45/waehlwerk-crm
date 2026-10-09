import { Modal } from '../ui/ui.tsx';

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Überall',
    keys: [
      ['Strg + K  oder  /', 'Suchen und springen'],
      ['Strg + Umschalt + L', 'Neuer Lead'],
      ['?', 'Diese Übersicht'],
    ],
  },
  {
    title: 'Springen (erst G, dann …)',
    keys: [
      ['G  I', 'Inbox'],
      ['G  L', 'Leads'],
      ['G  K', 'Kontakte'],
      ['G  O', 'Opportunities'],
      ['G  A', 'Gespräche'],
      ['G  T', 'Termine'],
      ['G  W', 'Workflows'],
      ['G  R', 'Berichte'],
      ['G  S', 'Einstellungen'],
    ],
  },
  {
    title: 'Auf einer Lead-Seite',
    keys: [
      ['C  oder  Strg + Umschalt + D', 'Anrufen'],
      ['E  oder  Strg + Umschalt + E', 'E-Mail schreiben'],
      ['S  oder  Strg + Umschalt + K', 'SMS schreiben'],
      ['N  oder  Strg + Umschalt + O', 'Notiz schreiben'],
      ['A', 'Aktivität erfassen'],
      ['T', 'Aufgabe anlegen'],
      ['Strg + F', 'Aktivitäten durchsuchen'],
    ],
  },
  {
    title: 'Power Dialer',
    keys: [
      ['Strg + Umschalt + X', 'Nächster Lead / weiter'],
      ['Strg + .', 'Pause'],
    ],
  },
  {
    title: 'Nach dem Anruf',
    keys: [
      ['1 … 9', 'Ergebnis wählen'],
      ['Strg + Enter', 'Speichern und weiter'],
    ],
  },
  {
    title: 'Aufnahme abspielen',
    keys: [
      ['Leertaste', 'Abspielen / Pause'],
      ['← / →', '10 Sekunden zurück / vor'],
      ['M', 'Markierung mit Kommentar setzen'],
    ],
  },
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Tastenkürzel" onClose={onClose} wide>
      <div className="shortcuts">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.keys.map(([k, v]) => (
                <div key={k} className="row">
                  <dt>
                    {k.split('  ').map((part) => (
                      <kbd key={part}>{part}</kbd>
                    ))}
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
